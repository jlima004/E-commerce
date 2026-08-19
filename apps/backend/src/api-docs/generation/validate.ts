import type {
  ContractSurface,
  OpenApiDocument,
  OperationMetadata,
} from "../contracts"
import { CONTRACT_VERSIONS } from "../document"
import { assertSafeExamples } from "../safe-examples"

const HTTP_METHOD_KEYS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
])

/**
 * Store OpenAPI documentation ownership of `/auth` is this method+path
 * exact-set only — never a generic `/auth/*` prefix. Coverage mapping and
 * the registry exact-set (Subagent D) must agree with this list so only
 * these six BFF/backend contracts can compose the Store document.
 */
export const STORE_DOCUMENTATION_AUTH_OPERATIONS = [
  "POST /auth/customer/emailpass/register",
  "POST /auth/customer/emailpass",
  "POST /auth/customer/emailpass/revoke-current-lineage",
  "POST /auth/customer/emailpass/reset-password",
  "POST /auth/customer/emailpass/update",
  "POST /auth/token/refresh",
] as const

export type StoreDocumentationAuthOperation =
  (typeof STORE_DOCUMENTATION_AUTH_OPERATIONS)[number]

const STORE_DOCUMENTATION_AUTH_OPERATION_SET: ReadonlySet<string> = new Set(
  STORE_DOCUMENTATION_AUTH_OPERATIONS
)

export function isStoreDocumentationAuthOperation(
  method: string,
  path: string
): boolean {
  return STORE_DOCUMENTATION_AUTH_OPERATION_SET.has(
    `${method.toUpperCase()} ${path}`
  )
}

const SENSITIVE_PATTERNS = [
  /\bsk_(?:live|test)_[A-Za-z0-9_-]+/i,
  /\bwhsec_[A-Za-z0-9_-]+/i,
  /\bBearer\s+[A-Za-z0-9._~-]+/i,
  /\bpi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/i,
  /\bpostgres(?:ql)?:\/\//i,
  /\bredis(?:s)?:\/\//i,
  /\b(?:cpf|cnpj)\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/,
  /\b000201(?:\d|[A-Z]){12,}\b/i,
  /\b[a-z][a-z0-9]{1,11}_[A-Za-z0-9]{12,}\b/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  /\b\d{16,}\b/,
]

function resolveJsonPointer(document: unknown, reference: string): unknown {
  if (!reference.startsWith("#/")) {
    throw new Error(`Only local OpenAPI references are allowed: ${reference}`)
  }

  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== "object" || !(part in current)) {
        throw new Error(`Unresolved local OpenAPI reference: ${reference}`)
      }
      return (current as Record<string, unknown>)[part]
    }, document)
}

function walk(
  value: unknown,
  visitor: (value: unknown, key: string | undefined, parent: unknown) => void,
  key?: string,
  parent?: unknown
): void {
  visitor(value, key, parent)
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visitor, undefined, value)
    }
  } else if (value && typeof value === "object") {
    for (const [childKey, child] of Object.entries(value)) {
      walk(child, visitor, childKey, value)
    }
  }
}

export function validateSurfacePartition(
  surface: ContractSurface,
  paths: Record<string, unknown>
): void {
  for (const [routePath, pathItem] of Object.entries(paths)) {
    if (surface === "admin") {
      if (!routePath.startsWith("/admin/")) {
        throw new Error(`Contract partition violation: ${surface} ${routePath}`)
      }
      continue
    }
    if (surface === "webhooks") {
      if (!routePath.startsWith("/hooks/")) {
        throw new Error(`Contract partition violation: ${surface} ${routePath}`)
      }
      continue
    }

    if (routePath.startsWith("/store/") || routePath.startsWith("/health/")) {
      continue
    }

    const methods = Object.keys(
      pathItem && typeof pathItem === "object" ? pathItem : {}
    ).filter((key) => HTTP_METHOD_KEYS.has(key))

    if (methods.length === 0) {
      throw new Error(`Contract partition violation: ${surface} ${routePath}`)
    }

    for (const method of methods) {
      if (!isStoreDocumentationAuthOperation(method, routePath)) {
        throw new Error(
          `Contract partition violation: ${surface} ${method.toUpperCase()} ${routePath}`
        )
      }
    }
  }
}

export function validateDocument(
  surface: ContractSurface,
  document: OpenApiDocument
): string[] {
  if (document.openapi !== "3.1.2") {
    throw new Error(`Unexpected OpenAPI version: ${document.openapi}`)
  }
  if (document.info.version !== CONTRACT_VERSIONS[surface]) {
    throw new Error(
      `Unexpected contract version for ${surface}: ${document.info.version}`
    )
  }
  if (document["x-medusa-version"] !== "2.16.0") {
    throw new Error("Unexpected Medusa metadata version")
  }
  if (
    document.servers.length !== 1 ||
    document.servers[0].url !== "/" ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(document.servers[0].url)
  ) {
    throw new Error("OpenAPI server must be the same-origin relative URL only")
  }

  validateSurfacePartition(surface, document.paths)
  assertSafeExamples(document, {
    isUnsafeExampleValue: (value) =>
      SENSITIVE_PATTERNS.some((pattern) => pattern.test(value)),
    errorMessage: "Sensitive OpenAPI example detected",
    rootLocation: "document",
  })
  const operationIds: string[] = []
  const securitySchemes = new Set(
    Object.keys(document.components.securitySchemes ?? {})
  )

  for (const pathItem of Object.values(document.paths)) {
    for (const [method, candidate] of Object.entries(pathItem)) {
      if (!HTTP_METHOD_KEYS.has(method) || !candidate || typeof candidate !== "object") {
        continue
      }
      const operation = candidate as Record<string, unknown>
      if (typeof operation.operationId !== "string" || !operation.operationId) {
        throw new Error("Every OpenAPI operation must have an operationId")
      }
      operationIds.push(operation.operationId)

      for (const requirement of (operation.security ?? []) as Array<
        Record<string, unknown>
      >) {
        for (const scheme of Object.keys(requirement)) {
          if (!securitySchemes.has(scheme)) {
            throw new Error(`Unknown security scheme reference: ${scheme}`)
          }
        }
      }
    }
  }

  walk(document, (value, key, parent) => {
    if (key === "nullable" && value === true) {
      throw new Error("OpenAPI 3.0 nullable: true is forbidden")
    }
    if (key === "$ref" && typeof value === "string") {
      resolveJsonPointer(document, value)
    }
    if (
      typeof value === "string" &&
      /^(?:[A-Za-z]:\\|\/(?:home|Users|mnt|tmp)(?:\/|$))/.test(value)
    ) {
      throw new Error("Absolute filesystem path detected in OpenAPI output")
    }
  })

  return operationIds
}

export function validateDocuments(
  documents: Array<{ surface: ContractSurface; document: OpenApiDocument }>
): void {
  const operationIds = documents.flatMap(({ surface, document }) =>
    validateDocument(surface, document)
  )
  const unique = new Set(operationIds)
  if (unique.size !== operationIds.length) {
    throw new Error("Duplicate global operationId")
  }
}

export function operationKey(operation: Pick<OperationMetadata, "method" | "path">) {
  return `${operation.method} ${operation.path}`
}
