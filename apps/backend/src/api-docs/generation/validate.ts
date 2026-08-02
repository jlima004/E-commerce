import type {
  ContractSurface,
  OpenApiDocument,
  OperationMetadata,
} from "../contracts"

const HTTP_METHOD_KEYS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
])

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

const SENSITIVE_EXAMPLE_KEY_SEGMENTS = /(?:^|_)(?:id|ids|identifier|identifiers|provider|address|street|city|postal(?:_code)?|zip|email|phone|telephone|mobile|cpf|cnpj|tax(?:_id|_number)?|document(?:_id|_number)?|authorization|token|secret|signature|api_key|client_secret|pix|qr_code|copy_paste)(?:_|$)/

function isSensitiveExampleKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
  return SENSITIVE_EXAMPLE_KEY_SEGMENTS.test(normalized)
}

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

function assertSafeExamples(
  value: unknown,
  insideExample = false,
  schemaPropertyName?: string
): void {
  if (typeof value === "string" && insideExample) {
    if (SENSITIVE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new Error("Sensitive OpenAPI example detected")
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertSafeExamples(item, insideExample, schemaPropertyName)
    }
    return
  }
  if (!value || typeof value !== "object") {
    return
  }
  for (const [key, child] of Object.entries(value)) {
    const childInsideExample = insideExample || /^examples?$/i.test(key)
    if (
      (!insideExample &&
        /^examples?$/i.test(key) &&
        schemaPropertyName !== undefined &&
        isSensitiveExampleKey(schemaPropertyName)) ||
      (insideExample &&
        isSensitiveExampleKey(key) &&
        child !== null &&
        child !== undefined)
    ) {
      throw new Error("Sensitive OpenAPI example detected")
    }
    if (
      !insideExample &&
      key === "properties" &&
      child &&
      typeof child === "object" &&
      !Array.isArray(child)
    ) {
      for (const [propertyName, propertySchema] of Object.entries(child)) {
        assertSafeExamples(propertySchema, false, propertyName)
      }
      continue
    }
    assertSafeExamples(child, childInsideExample, schemaPropertyName)
  }
}

function validateSurfacePartition(
  surface: ContractSurface,
  paths: Record<string, unknown>
): void {
  for (const routePath of Object.keys(paths)) {
    const valid =
      surface === "store"
        ? routePath.startsWith("/store/") || routePath.startsWith("/health/")
        : surface === "admin"
          ? routePath.startsWith("/admin/")
          : routePath.startsWith("/hooks/")

    if (!valid) {
      throw new Error(`Contract partition violation: ${surface} ${routePath}`)
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
  if (document.info.version !== "1.0.0") {
    throw new Error(`Unexpected contract version: ${document.info.version}`)
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
  assertSafeExamples(document)
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
