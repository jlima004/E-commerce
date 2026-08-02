import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi"
import { z, ZodType } from "zod"
import {
  CONTRACT_SURFACES,
  type ContractSurface,
  type OperationMetadata,
} from "./contracts"
import { registerStoreContract } from "./operations/store"
import { registerAdminContract } from "./operations/admin"
import { registerWebhookContract } from "./operations/webhooks"

extendZodWithOpenApi(z)

type RegistryScope = ContractSurface | "shared"
type SchemaDirection = "shared" | "request" | "response"

declare const registerComponentSignature: OpenAPIRegistry["registerComponent"]

export type ComponentTypeKey = Parameters<typeof registerComponentSignature>[0]
export type ComponentTypeOf<K extends ComponentTypeKey> = Parameters<
  typeof registerComponentSignature<K>
>[2]

type RegistryState = {
  openapi: OpenAPIRegistry
  operations: OperationMetadata[]
}

const SENSITIVE_EXAMPLE_PATTERNS = [
  /\bsk_(?:live|test)_[A-Za-z0-9_-]+/i,
  /\bwhsec_[A-Za-z0-9_-]+/i,
  /\bBearer\s+[A-Za-z0-9._~-]+/i,
  /\bpostgres(?:ql)?:\/\//i,
  /\bredis(?:s)?:\/\//i,
  /\bpi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/i,
  /\b(?:cpf|cnpj)\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}\b/,
  /\b000201(?:\d|[A-Z]){12,}\b/i,
  /\b(?:pi|evt|ch|cus|pm|prod|price)_[A-Za-z0-9]{12,}\b/i,
]

const SENSITIVE_EXAMPLE_KEY_SEGMENTS = /(?:^|_)(?:address|street|city|postal(?:_code)?|zip|email|phone|telephone|mobile|cpf|cnpj|tax(?:_id|_number)?|document(?:_id|_number)?|token|secret|signature|api_key|client_secret|pix|qr_code|copy_paste)(?:_|$)/

function isSensitiveExampleKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase()
  return SENSITIVE_EXAMPLE_KEY_SEGMENTS.test(normalized)
}

type ZodInternals = {
  def?: {
    [key: string]: unknown
    type?: string
    coerce?: boolean
    catchall?: unknown
    shape?: Record<string, ZodType> | (() => Record<string, ZodType>)
    innerType?: ZodType
    in?: ZodType
    out?: ZodType
    schema?: ZodType
    getter?: () => ZodType
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? (<T>() => T extends B ? 1 : 2) extends
      (<T>() => T extends A ? 1 : 2)
      ? true
      : false
    : false

export type DirectionSafeSchema<T extends ZodType> =
  Equal<z.input<T>, z.output<T>> extends true ? T : never

function schemaDefinition(schema: ZodType): NonNullable<ZodInternals["def"]> {
  return ((schema as ZodType & { _zod?: ZodInternals })._zod?.def ?? {}) as NonNullable<
    ZodInternals["def"]
  >
}

function assertDirectionSafeSchema(
  schema: ZodType,
  seenSchemas = new Set<ZodType>(),
  seenDefinitions = new Set<object>()
): void {
  if (seenSchemas.has(schema)) {
    return
  }
  seenSchemas.add(schema)

  const definition = schemaDefinition(schema)
  const forbiddenTypes = new Set([
    "pipe",
    "transform",
    "default",
    "prefault",
    "catch",
  ])

  if (definition.coerce || (definition.type && forbiddenTypes.has(definition.type))) {
    throw new Error(
      "Shared request/response schemas cannot coerce, preprocess, transform, or default values"
    )
  }

  if (definition.type === "object" && definition.catchall === undefined) {
    throw new Error(
      "Shared request/response object schemas must not strip unknown properties"
    )
  }

  const visitDefinitionValue = (value: unknown): void => {
    if (value instanceof ZodType) {
      assertDirectionSafeSchema(value, seenSchemas, seenDefinitions)
      return
    }
    if (!value || typeof value !== "object" || seenDefinitions.has(value)) {
      return
    }

    seenDefinitions.add(value)
    for (const child of Object.values(value)) {
      visitDefinitionValue(child)
    }
  }

  if (typeof definition.shape === "function") {
    visitDefinitionValue(definition.shape())
  }
  if (definition.type === "lazy" && definition.getter) {
    assertDirectionSafeSchema(
      definition.getter(),
      seenSchemas,
      seenDefinitions
    )
  }
  visitDefinitionValue(definition)
}

function assertRepresentable(value: unknown, seen = new Set<object>()): void {
  if (
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint" ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new Error("OpenAPI metadata contains an unrepresentable value")
  }

  if (!value || typeof value !== "object" || value instanceof ZodType) {
    return
  }

  if (seen.has(value)) {
    throw new Error("OpenAPI metadata contains a circular value")
  }
  seen.add(value)

  for (const child of Object.values(value)) {
    assertRepresentable(child, seen)
  }

  seen.delete(value)
}

function assertSafeExamples(value: unknown, insideExample = false): void {
  if (typeof value === "string" && insideExample) {
    if (SENSITIVE_EXAMPLE_PATTERNS.some((pattern) => pattern.test(value))) {
      throw new Error("OpenAPI metadata contains an unsafe example")
    }
    return
  }

  if (!value || typeof value !== "object" || value instanceof ZodType) {
    return
  }

  for (const [key, child] of Object.entries(value)) {
    const childInsideExample = insideExample || /^examples?$/i.test(key)
    if (
      insideExample &&
      isSensitiveExampleKey(key) &&
      child !== null &&
      child !== undefined
    ) {
      throw new Error("OpenAPI metadata contains an unsafe example")
    }
    assertSafeExamples(child, childInsideExample)
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`Operation metadata is missing ${field}`)
  }
}

function validateOperationMetadata(
  operation: OperationMetadata,
  knownSecuritySchemes: ReadonlySet<string>
): void {
  requireNonEmpty(operation.path, "path")
  requireNonEmpty(operation.operationId, "operationId")
  requireNonEmpty(operation.summary, "summary")
  requireNonEmpty(operation.sourceClassification, "sourceClassification")
  requireNonEmpty(operation.officialReference, "officialReference")
  requireNonEmpty(operation.inclusionReason, "inclusionReason")

  if (!operation.path.startsWith("/")) {
    throw new Error(`Operation path must start with "/": ${operation.path}`)
  }
  if (operation.tags.length === 0) {
    throw new Error("Operation metadata is missing tags")
  }
  if (operation.sourceFiles.length === 0 || operation.testEvidence.length === 0) {
    throw new Error("Operation metadata is missing provenance")
  }
  if (Object.keys(operation.responses).length === 0) {
    throw new Error("Operation metadata is missing response metadata")
  }

  for (const [status, response] of Object.entries(operation.responses)) {
    if (
      !("$ref" in response) &&
      (typeof response.description !== "string" || !response.description.trim())
    ) {
      throw new Error(`Response ${status} is missing a description`)
    }
  }

  for (const requirement of operation.security) {
    for (const scheme of Object.keys(requirement)) {
      if (!knownSecuritySchemes.has(scheme)) {
        throw new Error(`Unknown security scheme: ${scheme}`)
      }
    }
  }

  assertRepresentable(operation)
  assertSafeExamples(operation)
}

function mutableSecurityRequirements(
  security: OperationMetadata["security"]
): Array<Record<string, string[]>> {
  return security.map((requirement) =>
    Object.fromEntries(
      Object.entries(requirement).map(([scheme, scopes]) => [scheme, [...scopes]])
    )
  )
}

export class ContractRegistryBundle {
  readonly shared = new OpenAPIRegistry()
  readonly surfaces: Record<ContractSurface, RegistryState>

  private readonly componentKeys = new Set<string>()
  private readonly componentScopes = new Map<string, Set<RegistryScope>>()
  private readonly operationKeys = new Set<string>()
  private readonly operationIds = new Set<string>()
  private readonly securitySchemes = new Set<string>()

  constructor() {
    const createSurfaceState = (): RegistryState => ({
      openapi: new OpenAPIRegistry([this.shared]),
      operations: [],
    })

    this.surfaces = {
      store: createSurfaceState(),
      admin: createSurfaceState(),
      webhooks: createSurfaceState(),
    }
  }

  registerComponent<K extends ComponentTypeKey>(
    scope: RegistryScope,
    type: K,
    name: string,
    component: ComponentTypeOf<K>
  ): void {
    requireNonEmpty(name, "component name")
    const key = `${scope}:${type}:${name}`
    if (this.componentKeys.has(key)) {
      throw new Error(`Duplicate component: ${type}/${name}`)
    }
    const componentIdentity = `${type}:${name}`
    const scopes = this.componentScopes.get(componentIdentity) ?? new Set()
    if (
      (scope === "shared" && scopes.size > 0) ||
      (scope !== "shared" && scopes.has("shared"))
    ) {
      throw new Error(`Duplicate shared component: ${type}/${name}`)
    }

    assertRepresentable(component)
    assertSafeExamples(component)
    this.componentKeys.add(key)
    scopes.add(scope)
    this.componentScopes.set(componentIdentity, scopes)
    const registry = scope === "shared" ? this.shared : this.surfaces[scope].openapi
    registry.registerComponent(type, name, component)

    if (type === "securitySchemes") {
      this.securitySchemes.add(name)
    }
  }

  registerSchema<T extends ZodType>(
    scope: RegistryScope,
    name: string,
    schema: DirectionSafeSchema<T>,
    direction: SchemaDirection
  ): T {
    requireNonEmpty(name, "schema name")
    const key = `${scope}:schemas:${name}`
    if (this.componentKeys.has(key)) {
      throw new Error(`Duplicate component: schemas/${name}`)
    }
    const componentIdentity = `schemas:${name}`
    const scopes = this.componentScopes.get(componentIdentity) ?? new Set()
    if (
      (scope === "shared" && scopes.size > 0) ||
      (scope !== "shared" && scopes.has("shared"))
    ) {
      throw new Error(`Duplicate shared component: schemas/${name}`)
    }

    assertDirectionSafeSchema(schema)

    this.componentKeys.add(key)
    scopes.add(scope)
    this.componentScopes.set(componentIdentity, scopes)
    const registry = scope === "shared" ? this.shared : this.surfaces[scope].openapi
    return registry.register(name, schema)
  }

  registerDirectionalSchemas<TRequest extends ZodType, TResponse extends ZodType>(
    scope: RegistryScope,
    requestName: string,
    requestSchema: DirectionSafeSchema<TRequest>,
    responseName: string,
    responseSchema: DirectionSafeSchema<TResponse>
  ): { request: TRequest; response: TResponse } {
    if (requestName === responseName) {
      throw new Error("Divergent request and response schemas require distinct names")
    }

    assertDirectionSafeSchema(requestSchema)
    assertDirectionSafeSchema(responseSchema)

    return {
      request: this.registerSchema(scope, requestName, requestSchema, "request"),
      response: this.registerSchema(scope, responseName, responseSchema, "response"),
    }
  }

  registerSharedSchema<T extends ZodType>(
    scope: RegistryScope,
    name: string,
    schema: DirectionSafeSchema<T>
  ): T {
    return this.registerSchema(scope, name, schema, "shared")
  }

  registerOperation(operation: OperationMetadata): void {
    validateOperationMetadata(operation, this.securitySchemes)

    const operationKey = `${operation.method} ${operation.path}`
    if (this.operationKeys.has(operationKey)) {
      throw new Error(`Duplicate method/path: ${operationKey}`)
    }
    if (this.operationIds.has(operation.operationId)) {
      throw new Error(`Duplicate operationId: ${operation.operationId}`)
    }

    this.operationKeys.add(operationKey)
    this.operationIds.add(operation.operationId)
    this.surfaces[operation.surface].operations.push(operation)
    this.surfaces[operation.surface].openapi.registerPath({
      method: operation.method.toLowerCase() as Lowercase<OperationMetadata["method"]>,
      path: operation.path,
      operationId: operation.operationId,
      summary: operation.summary,
      description: operation.description ?? operation.summary,
      tags: operation.tags,
      security: mutableSecurityRequirements(operation.security),
      parameters: operation.parameters as never,
      request:
        operation.requestBody === null
          ? undefined
          : { body: operation.requestBody as never },
      responses: operation.responses,
    })
  }

  getOperations(surface?: ContractSurface): OperationMetadata[] {
    if (surface) {
      return [...this.surfaces[surface].operations]
    }
    return CONTRACT_SURFACES.flatMap((item) => this.surfaces[item].operations)
  }
}

export function createFoundationRegistry(): ContractRegistryBundle {
  const registry = new ContractRegistryBundle()
  registerStoreContract(registry)
  registerAdminContract(registry)
  registerWebhookContract(registry)
  return registry
}
