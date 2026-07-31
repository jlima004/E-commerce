import fs from "fs"
import path from "path"
import ts from "typescript"
import { HTTP_METHODS, type HttpMethod } from "../contracts"

export type DiscoveredRoute = {
  sourceFile: string
  method: HttpMethod
  path: string
  exportKind: "function" | "const" | "reexport"
}

const HTTP_METHOD_SET = new Set<string>(HTTP_METHODS)

function listRouteFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listRouteFiles(absolute))
    } else if (entry.name === "route.ts") {
      files.push(absolute)
    }
  }
  return files.sort()
}

function hasExportModifier(node: ts.Node): boolean {
  return (ts.getModifiers(node as ts.HasModifiers) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
  )
}

function sourceFileFor(file: string): ts.SourceFile {
  const source = fs.readFileSync(file, "utf8")
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
}

function resolveLocalModule(containingFile: string, specifier: string): string {
  if (!specifier.startsWith(".")) {
    throw new Error(`External route re-export is not allowed: ${specifier}`)
  }

  const base = path.resolve(path.dirname(containingFile), specifier)
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ]
  const resolved = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  )

  if (!resolved) {
    throw new Error(`Unresolvable local route re-export: ${specifier}`)
  }
  return resolved
}

function moduleExportsSymbol(
  file: string,
  symbol: string,
  visited = new Set<string>()
): boolean {
  const visitKey = `${file}:${symbol}`
  if (visited.has(visitKey)) {
    throw new Error(`Circular route re-export: ${visitKey}`)
  }
  visited.add(visitKey)

  const source = sourceFileFor(file)
  for (const statement of source.statements) {
    if (
      hasExportModifier(statement) &&
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === symbol
    ) {
      return true
    }

    if (hasExportModifier(statement) && ts.isVariableStatement(statement)) {
      if (
        statement.declarationList.declarations.some(
          (declaration) =>
            ts.isIdentifier(declaration.name) &&
            declaration.name.text === symbol
        )
      ) {
        return true
      }
    }

    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
        throw new Error(`Ambiguous route re-export in ${file}`)
      }

      for (const element of statement.exportClause.elements) {
        if (element.name.text !== symbol) {
          continue
        }

        const original = element.propertyName?.text ?? element.name.text
        if (!statement.moduleSpecifier) {
          return source.statements.some((candidate) => {
            if (
              ts.isFunctionDeclaration(candidate) &&
              candidate.name?.text === original
            ) {
              return true
            }
            return (
              ts.isVariableStatement(candidate) &&
              candidate.declarationList.declarations.some(
                (declaration) =>
                  ts.isIdentifier(declaration.name) &&
                  declaration.name.text === original
              )
            )
          })
        }

        const moduleName = (statement.moduleSpecifier as ts.StringLiteral).text
        return moduleExportsSymbol(
          resolveLocalModule(file, moduleName),
          original,
          visited
        )
      }
    }
  }

  return false
}

function normalizeRoutePath(apiRoot: string, routeFile: string): string {
  const relativeDirectory = path.relative(apiRoot, path.dirname(routeFile))
  const segments = relativeDirectory
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => {
      const bracket = segment.match(/^\[([^\]]+)\]$/)
      return bracket ? `{${bracket[1]}}` : segment
    })

  return `/${segments.join("/")}`
}

function sourceFilePath(repositoryRoot: string, file: string): string {
  return path.relative(repositoryRoot, file).split(path.sep).join("/")
}

export function discoverRoutes(options?: {
  repositoryRoot?: string
  apiRoot?: string
}): DiscoveredRoute[] {
  const repositoryRoot = path.resolve(options?.repositoryRoot ?? path.join(__dirname, "../../../../.."))
  const apiRoot = path.resolve(
    options?.apiRoot ?? path.join(repositoryRoot, "apps/backend/src/api")
  )
  const routes: DiscoveredRoute[] = []

  for (const file of listRouteFiles(apiRoot)) {
    const source = sourceFileFor(file)
    const routePath = normalizeRoutePath(apiRoot, file)
    const sourceFile = sourceFilePath(repositoryRoot, file)

    for (const statement of source.statements) {
      if (
        hasExportModifier(statement) &&
        ts.isFunctionDeclaration(statement) &&
        statement.name &&
        HTTP_METHOD_SET.has(statement.name.text)
      ) {
        routes.push({
          sourceFile,
          method: statement.name.text as HttpMethod,
          path: routePath,
          exportKind: "function",
        })
      }

      if (hasExportModifier(statement) && ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            HTTP_METHOD_SET.has(declaration.name.text)
          ) {
            routes.push({
              sourceFile,
              method: declaration.name.text as HttpMethod,
              path: routePath,
              exportKind: "const",
            })
          }
        }
      }

      if (ts.isExportDeclaration(statement)) {
        if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
          throw new Error(`Ambiguous route re-export in ${sourceFile}`)
        }

        for (const element of statement.exportClause.elements) {
          if (!HTTP_METHOD_SET.has(element.name.text)) {
            continue
          }

          const original = element.propertyName?.text ?? element.name.text
          if (statement.moduleSpecifier) {
            const moduleName = (statement.moduleSpecifier as ts.StringLiteral).text
            const target = resolveLocalModule(file, moduleName)
            if (!moduleExportsSymbol(target, original)) {
              throw new Error(
                `Unresolvable route handler re-export: ${sourceFile}#${element.name.text}`
              )
            }
          } else if (!moduleExportsSymbol(file, element.name.text)) {
            throw new Error(
              `Unresolvable local route handler export: ${sourceFile}#${element.name.text}`
            )
          }

          routes.push({
            sourceFile,
            method: element.name.text as HttpMethod,
            path: routePath,
            exportKind: "reexport",
          })
        }
      }
    }
  }

  return routes.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      HTTP_METHODS.indexOf(left.method) - HTTP_METHODS.indexOf(right.method)
  )
}
