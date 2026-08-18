import {
  AUTH_HTTP_CONTRACT,
  type AuthHttpContractEntry,
} from "../../api/auth-surface/contracts"
import {
  AUTH_SURFACE_NATIVE_OPERATIONS,
} from "../../api/auth-surface/manifest"
import {
  STORE_AUTH_HEADERS_BY_REQUIREMENT,
  STORE_AUTH_PUBLIC_BFF_NO_SESSION_NOTE,
  STORE_AUTH_REFRESH_HEADER_PARAMETER,
  STORE_AUTH_SECURITY_BY_REQUIREMENT,
} from "../components/security-schemes"
import {
  AUTH_DOCUMENTATION_DENY_EXCLUSIONS,
  ROUTE_EXCLUSIONS,
} from "../coverage/exclusions"
import { STORE_DOCUMENTATION_AUTH_OPERATIONS } from "../coverage/verify-coverage"
import { buildContracts } from "../generation/build-documents"
import { createFoundationRegistry } from "../registry"
import { buildApiDocsInitializerJs } from "../runtime/swagger-config"
import {
  assertSafeExamples,
  type SafeExampleOptions,
} from "../safe-examples"
import {
  STORE_AUTH_REQUEST_FIELDS,
  STORE_AUTH_SCHEMA_CONTRACT,
  STORE_AUTH_SCHEMAS,
  STORE_AUTH_SUCCESS_FIELDS,
} from "../operations/store/schemas"

type JsonSchema = {
  type?: string | string[]
  additionalProperties?: boolean
  required?: string[]
  properties?: Record<string, JsonSchema>
  const?: unknown
  enum?: unknown[]
  format?: string
  minLength?: number
  maxLength?: number
  pattern?: string
  description?: string
  example?: unknown
  examples?: unknown
  writeOnly?: boolean
}

const WALKER_OPTIONS: SafeExampleOptions = {
  isUnsafeExampleValue: () => false,
  errorMessage: "Sensitive OpenAPI example detected",
  rootLocation: "schema",
}

const PLANTED_JWT = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.sig"
const PLANTED_EMAIL = "customer@gmail.com"
const PLANTED_PROVIDER_METADATA = "synthetic-reference"
const PLANTED_CAPABILITY =
  "dGVzdC1yZXNldC1jYXBhYmlsaXR5LXZhbHVlLW5vdC1mb3ItZG9jcw"

function schemaPropertyKeys(schema: JsonSchema | undefined): string[] {
  return Object.keys(schema?.properties ?? {}).sort()
}

function collectExamples(value: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExamples(item, found)
    }
    return found
  }
  if (!value || typeof value !== "object") {
    return found
  }
  const record = value as Record<string, unknown>
  if ("example" in record) {
    found.push(record.example)
  }
  if ("examples" in record) {
    found.push(record.examples)
  }
  for (const child of Object.values(record)) {
    collectExamples(child, found)
  }
  return found
}

describe("Phase 14 auth OpenAPI schema and security contract", () => {
  it("covers all 12 AUTH_HTTP_CONTRACT operations exactly once", () => {
    expect(AUTH_HTTP_CONTRACT).toHaveLength(12)
    expect(Object.keys(STORE_AUTH_SCHEMA_CONTRACT).sort()).toEqual(
      [...AUTH_HTTP_CONTRACT.map((entry) => entry.operation)].sort()
    )
  })

  it("proves method, path, request, headers, status, response, codes, and security against AUTH_HTTP_CONTRACT", () => {
    for (const entry of AUTH_HTTP_CONTRACT) {
      const docs = STORE_AUTH_SCHEMA_CONTRACT[entry.operation]
      expect(docs).toBeDefined()
      expect(docs.method).toBe(entry.method)
      expect(docs.path).toBe(entry.path)
      expect(docs.auth).toBe(entry.auth)
      expect(docs.request).toBe(entry.request)
      expect(docs.success).toEqual(entry.success)
      expect(docs.failures).toEqual([...entry.failures])
      expect(docs.sensitive).toEqual([...entry.sensitive])
      expect(docs.headerNames).toEqual([
        ...STORE_AUTH_HEADERS_BY_REQUIREMENT[entry.auth],
      ])
      expect(docs.security).toEqual(
        STORE_AUTH_SECURITY_BY_REQUIREMENT[entry.auth]
      )
    }
  })

  it("keeps password-change public failures on AUTH_HTTP_CONTRACT, without the SPEC extra Redis 503", () => {
    const passwordChange = AUTH_HTTP_CONTRACT.find(
      (entry) => entry.operation === "password_change"
    )
    expect(passwordChange?.failures).toEqual([
      [400, "CURRENT_CREDENTIAL_INVALID"],
      [401, "AUTHENTICATION_REQUIRED"],
      [429, "RATE_LIMITED"],
      [503, "AUTH_RECOVERY_PENDING"],
    ])
    expect(STORE_AUTH_SCHEMA_CONTRACT.password_change.failures).toEqual(
      passwordChange?.failures
    )
    expect(
      STORE_AUTH_SCHEMA_CONTRACT.password_change.failures.some(
        ([status, code]) =>
          status === 503 && code === "AUTH_TEMPORARILY_UNAVAILABLE"
      )
    ).toBe(false)
  })

  it("defines request schemas with exact fields for every contract request shape", () => {
    for (const entry of AUTH_HTTP_CONTRACT) {
      const docs = STORE_AUTH_SCHEMA_CONTRACT[entry.operation]
      const expectedFields = [...STORE_AUTH_REQUEST_FIELDS[entry.request]]
      expect(docs.requestSchemaName === null).toBe(entry.request === "none")

      if (docs.requestSchemaName === null) {
        continue
      }

      const schema = STORE_AUTH_SCHEMAS[
        docs.requestSchemaName
      ] as JsonSchema
      expect(schema.type).toBe("object")
      expect(schema.additionalProperties).toBe(false)
      expect([...(schema.required ?? [])].sort()).toEqual(expectedFields.sort())
      expect(schemaPropertyKeys(schema)).toEqual(expectedFields.sort())
    }
  })

  it("defines success schemas with exact fields for every contract response shape", () => {
    for (const entry of AUTH_HTTP_CONTRACT) {
      const docs = STORE_AUTH_SCHEMA_CONTRACT[entry.operation]
      const expectedFields = [...STORE_AUTH_SUCCESS_FIELDS[entry.success.body]]
      expect(docs.successSchemaName === null).toBe(entry.success.body === "empty")
      expect(docs.success.status).toBe(entry.success.status)

      if (docs.successSchemaName === null) {
        continue
      }

      const schema = STORE_AUTH_SCHEMAS[
        docs.successSchemaName
      ] as JsonSchema
      expect(schema.type).toBe("object")
      expect(schema.additionalProperties).toBe(false)
      expect([...(schema.required ?? [])].sort()).toEqual(expectedFields.sort())
      expect(schemaPropertyKeys(schema)).toEqual(expectedFields.sort())
    }
  })

  it("documents AuthSessionEnvelope as server-to-server BFF material with the closed customer allowlist", () => {
    const envelope = STORE_AUTH_SCHEMAS.StoreAuthSessionEnvelope as JsonSchema
    const customer = STORE_AUTH_SCHEMAS.StoreAuthCustomer as JsonSchema

    expect(envelope.description).toMatch(/server-to-server/i)
    expect(envelope.description).toMatch(/BFF/i)
    expect(envelope.description).toMatch(/browser/i)
    expect(schemaPropertyKeys(envelope)).toEqual(
      [
        "accessExpiresAt",
        "accessToken",
        "absoluteExpiresAt",
        "customer",
        "originalAuthenticatedAt",
        "refreshExpiresAt",
        "refreshToken",
        "verificationState",
      ].sort()
    )
    expect(schemaPropertyKeys(customer)).toEqual(
      ["email", "firstName", "id", "lastName"].sort()
    )
    expect(customer.required).toEqual(
      expect.arrayContaining(["id", "email", "firstName", "lastName"])
    )
    expect(JSON.stringify(customer)).not.toMatch(/lineage/i)
    expect(JSON.stringify(customer)).not.toMatch(/credential_version/i)
    expect(JSON.stringify(envelope)).not.toMatch(/provider/i)
  })

  it("documents current-auth customer without tokens, lineage, or provider metadata", () => {
    const current = STORE_AUTH_SCHEMAS.StoreAuthCurrentCustomer as JsonSchema
    const auth = current.properties?.auth
    expect(schemaPropertyKeys(current)).toEqual(["auth", "customer"].sort())
    expect(schemaPropertyKeys(auth)).toEqual(
      ["absoluteExpiresAt", "originalAuthenticatedAt", "verificationState"].sort()
    )
    expect(auth?.properties?.verificationState?.enum).toEqual([
      "pending",
      "verified",
    ])
    expect(JSON.stringify(current)).not.toMatch(/accessToken|refreshToken/)
    expect(JSON.stringify(current)).not.toMatch(/lineage|SID/i)
  })

  it("closes public error codes on StoreAuthErrorResponse to AUTH_HTTP_CONTRACT failures", () => {
    const errorSchema = STORE_AUTH_SCHEMAS.StoreAuthErrorResponse as JsonSchema
    const contractCodes = [
      ...new Set(
        AUTH_HTTP_CONTRACT.flatMap((entry) =>
          entry.failures.map((failure) => failure[1])
        )
      ),
    ].sort()

    expect(errorSchema.required).toEqual(
      expect.arrayContaining(["code", "message", "retryable", "correlationId"])
    )
    expect(errorSchema.additionalProperties).toBe(false)
    expect([...(errorSchema.properties?.code?.enum ?? [])].sort()).toEqual(
      contractCodes
    )

    for (const entry of AUTH_HTTP_CONTRACT) {
      for (const [, code] of entry.failures) {
        expect(errorSchema.properties?.code?.enum).toContain(code)
      }
    }
  })

  it("records reset-confirm pre_lookup Retry-After 60 without inventing password-change Redis 503", () => {
    const resetConfirm = AUTH_HTTP_CONTRACT.find(
      (entry) => entry.operation === "reset_confirm"
    ) as AuthHttpContractEntry
    expect(resetConfirm.failures).toEqual(
      expect.arrayContaining([
        [
          503,
          "AUTH_TEMPORARILY_UNAVAILABLE",
          { retryAfterSeconds: 60, stage: "pre_lookup" },
        ],
        [503, "AUTH_RECOVERY_PENDING", { stage: "correlated_recovery" }],
      ])
    )
    expect(STORE_AUTH_SCHEMA_CONTRACT.reset_confirm.failures).toEqual(
      resetConfirm.failures
    )
  })

  it("maps each auth requirement to BFF-only security and the matching headers", () => {
    expect(STORE_AUTH_SECURITY_BY_REQUIREMENT.public_bff).toEqual([
      { publishableApiKey: [] },
    ])
    expect(STORE_AUTH_SECURITY_BY_REQUIREMENT.public_bff_no_session).toEqual([
      { publishableApiKey: [] },
    ])
    expect(STORE_AUTH_PUBLIC_BFF_NO_SESSION_NOTE).toMatch(/no customer session/i)
    expect(STORE_AUTH_PUBLIC_BFF_NO_SESSION_NOTE).toMatch(/browser/i)
    expect(STORE_AUTH_SECURITY_BY_REQUIREMENT.access_bearer).toEqual([
      { publishableApiKey: [], customerBearer: [] },
    ])
    expect(
      STORE_AUTH_SECURITY_BY_REQUIREMENT.access_bearer_and_idempotency_key
    ).toEqual([{ publishableApiKey: [], customerBearer: [] }])
    expect(
      STORE_AUTH_SECURITY_BY_REQUIREMENT.refresh_header_and_idempotency_key
    ).toEqual([{ publishableApiKey: [] }])
    expect(
      STORE_AUTH_SECURITY_BY_REQUIREMENT.capability_and_idempotency_key
    ).toEqual([{ publishableApiKey: [] }])

    expect(STORE_AUTH_HEADERS_BY_REQUIREMENT.refresh_header_and_idempotency_key).toEqual(
      ["x-indicio-refresh-token", "Idempotency-Key"]
    )
    expect(STORE_AUTH_HEADERS_BY_REQUIREMENT.capability_and_idempotency_key).toEqual(
      ["Idempotency-Key"]
    )
    expect(
      STORE_AUTH_HEADERS_BY_REQUIREMENT.access_bearer_and_idempotency_key
    ).toEqual(["Idempotency-Key"])
  })

  it("documents the refresh header as BFF-only, non-interactive, and not a browser credential", () => {
    expect(STORE_AUTH_REFRESH_HEADER_PARAMETER).toEqual(
      expect.objectContaining({
        name: "x-indicio-refresh-token",
        in: "header",
        required: true,
      })
    )
    expect(STORE_AUTH_REFRESH_HEADER_PARAMETER.description).toMatch(/BFF/i)
    expect(STORE_AUTH_REFRESH_HEADER_PARAMETER.description).toMatch(/browser/i)
    expect(STORE_AUTH_REFRESH_HEADER_PARAMETER.description).toMatch(
      /not a (?:user\/)?browser credential/i
    )
    expect(STORE_AUTH_REFRESH_HEADER_PARAMETER.description).toMatch(
      /Try-It-Out|non-interactive/i
    )
    expect(STORE_AUTH_REFRESH_HEADER_PARAMETER).not.toHaveProperty("example")
    expect(STORE_AUTH_REFRESH_HEADER_PARAMETER).not.toHaveProperty("examples")
    expect(
      STORE_AUTH_REFRESH_HEADER_PARAMETER["x-not-browser-credential"]
    ).toBe(true)
    expect(STORE_AUTH_REFRESH_HEADER_PARAMETER["x-bff-only"]).toBe(true)

    const registry = createFoundationRegistry()
    const store = registry.surfaces.store.openapi
    expect(store).toBeDefined()
  })

  it("registers auth schemas and the refresh header without adding a browser-interactive refresh scheme", () => {
    const registry = createFoundationRegistry()
    const contracts = buildContracts(registry)
    const store = contracts.find((contract) => contract.surface === "store")
    const schemas = store?.document.components.schemas ?? {}
    const schemes = store?.document.components.securitySchemes ?? {}
    const parameters = store?.document.components.parameters ?? {}

    for (const name of Object.keys(STORE_AUTH_SCHEMAS)) {
      expect(schemas[name]).toBeDefined()
    }

    expect(parameters.XIndicioRefreshToken).toEqual(
      expect.objectContaining({
        name: "x-indicio-refresh-token",
        in: "header",
      })
    )
    expect(parameters.XIndicioRefreshToken).not.toHaveProperty("example")
    expect(schemes).not.toHaveProperty("bffRefreshHeader")
    expect(schemes).not.toHaveProperty("refreshToken")
    expect(Object.keys(schemes).sort()).toEqual(
      ["customerBearer", "customerSession", "publishableApiKey"].sort()
    )

    for (const [name, scheme] of Object.entries(schemes)) {
      expect(scheme).toEqual(
        expect.objectContaining({
          description: expect.stringMatching(/BFF|server-to-server/i),
        })
      )
      expect(scheme).toEqual(
        expect.objectContaining({
          description: expect.stringMatching(/browser/i),
        })
      )
      expect(scheme).not.toHaveProperty("example")
      expect(JSON.stringify(scheme)).not.toMatch(/bff secret|service credential as a user/i)
      expect(name).not.toMatch(/bffSecret/i)
    }
  })

  it("does not turn the publishable key into caller authentication", () => {
    expect(JSON.stringify(STORE_AUTH_SECURITY_BY_REQUIREMENT)).toMatch(
      /publishableApiKey/
    )
    for (const entry of AUTH_HTTP_CONTRACT) {
      const security = STORE_AUTH_SECURITY_BY_REQUIREMENT[entry.auth]
      const usesPublishable = security.some((requirement) =>
        Object.prototype.hasOwnProperty.call(requirement, "publishableApiKey")
      )
      expect(usesPublishable).toBe(true)
      if (entry.auth === "public_bff" || entry.auth === "public_bff_no_session") {
        expect(security).toEqual([{ publishableApiKey: [] }])
      }
    }
  })

  it("omits examples on sensitive auth schema fields", () => {
    const sensitiveKeys = [
      "password",
      "currentPassword",
      "newPassword",
      "token",
      "email",
      "accessToken",
      "refreshToken",
    ]

    for (const [name, schema] of Object.entries(STORE_AUTH_SCHEMAS)) {
      expect(collectExamples(schema)).toEqual([])
      const serialized = JSON.stringify(schema)
      for (const key of sensitiveKeys) {
        if (serialized.includes(`"${key}"`)) {
          const property = (schema as JsonSchema).properties?.[key]
          expect(property).not.toHaveProperty("example")
          expect(property).not.toHaveProperty("examples")
        }
      }
      expect(name).toBeTruthy()
    }
  })

  it("lets every auth schema pass the sensitive example walker", () => {
    for (const [name, schema] of Object.entries(STORE_AUTH_SCHEMAS)) {
      expect(() =>
        assertSafeExamples(schema, {
          ...WALKER_OPTIONS,
          rootSemanticName: name,
        })
      ).not.toThrow()
    }

    expect(() =>
      assertSafeExamples(STORE_AUTH_REFRESH_HEADER_PARAMETER, {
        isUnsafeExampleValue: () => false,
        errorMessage: "Sensitive OpenAPI example detected",
        rootLocation: "parameter",
      })
    ).not.toThrow()
  })

  it("rejects planted JWT, capability, password, real email, and provider metadata examples", () => {
    const registry = createFoundationRegistry()

    expect(() =>
      registry.registerComponent("store", "schemas", "PlantedAuthJwtExample", {
        type: "string",
        example: PLANTED_JWT,
      })
    ).toThrow(/unsafe example/i)

    expect(() =>
      registry.registerComponent(
        "store",
        "schemas",
        "PlantedAuthCapabilityExample",
        {
          type: "object",
          properties: {
            token: {
              type: "string",
              example: PLANTED_CAPABILITY,
            },
          },
        }
      )
    ).toThrow(/unsafe example/i)

    expect(() =>
      registry.registerComponent(
        "store",
        "schemas",
        "PlantedAuthPasswordExample",
        {
          type: "object",
          example: {
            password: PLANTED_JWT,
            currentPassword: PLANTED_JWT,
            newPassword: PLANTED_JWT,
          },
        }
      )
    ).toThrow(/unsafe example/i)

    expect(() =>
      registry.registerComponent("store", "schemas", "PlantedAuthEmailExample", {
        type: "object",
        properties: {
          email: {
            type: "string",
            example: PLANTED_EMAIL,
          },
        },
      })
    ).toThrow(/unsafe example/i)

    expect(() =>
      registry.registerComponent(
        "store",
        "schemas",
        "PlantedAuthProviderExample",
        {
          type: "object",
          properties: {
            provider_order_id: {
              type: "string",
              example: PLANTED_PROVIDER_METADATA,
            },
          },
        }
      )
    ).toThrow(/unsafe example/i)
  })
})

describe("Phase 14 auth OpenAPI registry exact-set", () => {
  const APPROVED_KEYS = AUTH_HTTP_CONTRACT.map(
    (entry) => `${entry.method} ${entry.path}`
  )
  const DENIED_NATIVE_SURFACES = [
    "POST /auth/session",
    "DELETE /auth/session",
    "GET /auth/{actor_type}/{auth_provider}/callback",
    "POST /auth/{actor_type}/{auth_provider}/callback",
    "GET /auth/mfa/factors",
    "POST /auth/mfa/factors",
    "POST /auth/mfa/challenges/{id}/verify",
    "POST /auth/verification/request",
    "POST /auth/verification/confirm",
    "POST /auth/{actor_type}/{auth_provider}/reset-password",
    "POST /auth/{actor_type}/{auth_provider}/update",
    "GET /auth/token/refresh",
    "POST /auth/refresh",
    "POST /auth/token",
  ] as const

  function storeAuthOperations() {
    const registry = createFoundationRegistry()
    const storeOperations = registry.getOperations("store")
    const documented = AUTH_HTTP_CONTRACT.map((entry) => {
      const operation = storeOperations.find(
        (candidate) =>
          candidate.method === entry.method && candidate.path === entry.path
      )
      expect(operation).toBeDefined()
      return { entry, operation: operation! }
    })
    return { registry, storeOperations, documented }
  }

  function responseSchemaRef(response: unknown): string | undefined {
    const content = (response as {
      content?: { "application/json"?: { schema?: { $ref?: string } } }
    }).content
    return content?.["application/json"]?.schema?.$ref
  }

  it("registers exactly the 12 AUTH_HTTP_CONTRACT operations and no 13th", () => {
    const { storeOperations, documented } = storeAuthOperations()
    expect(AUTH_HTTP_CONTRACT).toHaveLength(12)
    expect(documented).toHaveLength(12)
    expect(storeOperations).toHaveLength(21)
    expect(
      documented.map(({ entry }) => `${entry.method} ${entry.path}`).sort()
    ).toEqual([...APPROVED_KEYS].sort())
    expect(
      storeOperations.filter((operation) =>
        APPROVED_KEYS.includes(`${operation.method} ${operation.path}`)
      )
    ).toHaveLength(12)
    expect(
      storeOperations.some((operation) => operation.path.includes("*"))
    ).toBe(false)
    expect(
      storeOperations.some(
        (operation) =>
          operation.method === "POST" &&
          operation.path === "/store/customers/me/cart/attach"
      )
    ).toBe(false)
  })

  it("proves registered method, path, request, status, codes, and security against AUTH_HTTP_CONTRACT", () => {
    const { documented } = storeAuthOperations()

    for (const { entry, operation } of documented) {
      const docs = STORE_AUTH_SCHEMA_CONTRACT[entry.operation]
      expect(operation.method).toBe(entry.method)
      expect(operation.path).toBe(entry.path)
      expect(operation.security).toEqual(
        STORE_AUTH_SECURITY_BY_REQUIREMENT[entry.auth]
      )
      expect(operation.surface).toBe("store")
      expect(operation.sourceClassification).toBe("project-custom")
      expect(operation.nonInteractive).toBe(true)
      expect(operation.interactiveCandidate).toBe(false)
      expect(operation.operationId).toMatch(/^store[A-Z]/)

      if (entry.request === "none") {
        expect(operation.requestBody).toBeNull()
        expect(docs.requestSchemaName).toBeNull()
      } else {
        expect(operation.requestBody).toEqual(
          expect.objectContaining({
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: `#/components/schemas/${docs.requestSchemaName}`,
                },
              },
            },
          })
        )
        expect(operation.requestBody).not.toHaveProperty("example")
        expect(
          (operation.requestBody as { content?: Record<string, unknown> })
            .content?.["application/json"]
        ).not.toHaveProperty("example")
        expect(
          (operation.requestBody as { content?: Record<string, unknown> })
            .content?.["application/json"]
        ).not.toHaveProperty("examples")
      }

      const successKey = String(entry.success.status)
      expect(operation.responses[successKey]).toBeDefined()
      if (docs.successSchemaName === null) {
        expect(operation.responses[successKey]).toEqual(
          expect.objectContaining({
            description: expect.any(String),
            headers: expect.objectContaining({
              "x-correlation-id": {
                $ref: "#/components/headers/XCorrelationId",
              },
            }),
          })
        )
        expect(operation.responses[successKey]).not.toHaveProperty("content")
        expect(operation.responses[successKey]).not.toHaveProperty("example")
      } else {
        expect(responseSchemaRef(operation.responses[successKey])).toBe(
          `#/components/schemas/${docs.successSchemaName}`
        )
      }

      const failureStatuses = [
        ...new Set(entry.failures.map((failure) => String(failure[0]))),
      ]
      for (const status of failureStatuses) {
        const response = operation.responses[status]
        expect(response).toBeDefined()
        expect(responseSchemaRef(response)).toBe(
          "#/components/schemas/StoreAuthErrorResponse"
        )
        expect(JSON.stringify(response)).not.toMatch(/StoreErrorResponse/)
      }

      const retryAfterFailure = entry.failures.find((failure) => {
        const detail = failure[2]
        return (
          detail != null &&
          "retryAfterSeconds" in detail &&
          detail.retryAfterSeconds === 60
        )
      })
      if (retryAfterFailure) {
        const response = operation.responses[String(retryAfterFailure[0])] as {
          description?: string
          headers?: Record<string, unknown>
        }
        expect(response.description).toMatch(/Retry-After is 60/)
        expect(response.headers).toEqual({
          "x-correlation-id": {
            $ref: "#/components/headers/XCorrelationId",
          },
        })
      }
    }
  })

  it("registers required provenance, Auth/Customer tags, and the BFF hop description", () => {
    const { documented } = storeAuthOperations()

    for (const { entry, operation } of documented) {
      expect(operation.summary.trim().length).toBeGreaterThan(0)
      expect(operation.tags.length).toBeGreaterThan(0)
      expect(operation.sourceFiles.length).toBeGreaterThan(0)
      expect(operation.testEvidence.length).toBeGreaterThan(0)
      expect(operation.officialReference.trim().length).toBeGreaterThan(0)
      expect(operation.inclusionReason).toMatch(
        /BFF\/backend contract; browser must not call Medusa directly/
      )
      expect(operation.description).toMatch(/same-origin Next\.js BFF/i)
      expect(operation.description).toMatch(/service credential/i)
      expect(operation.description).toMatch(/browser/i)
      expect(operation.description).not.toMatch(/bff secret/i)
      expect(operation.description).not.toMatch(/\bSID\b/)
      expect(operation.description).not.toMatch(/lineage/i)
      expect(JSON.stringify(operation)).not.toMatch(
        /browser (?:may|can|should) call Medusa directly/i
      )

      if (entry.path.startsWith("/auth/")) {
        expect(operation.tags).toEqual(["Auth"])
      } else {
        expect(operation.tags).toEqual(["Customer"])
      }
    }
  })

  it("registers revoke-current-lineage and does not invent a browser logout operation", () => {
    const { storeOperations } = storeAuthOperations()
    const revoke = storeOperations.find(
      (operation) =>
        operation.method === "POST" &&
        operation.path === "/auth/customer/emailpass/revoke-current-lineage"
    )
    const browserLogout = AUTH_DOCUMENTATION_DENY_EXCLUSIONS.find(
      (exclusion) => exclusion.key === "browser-raw-logout"
    )

    expect(revoke).toBeDefined()
    expect(revoke?.operationId).toMatch(/^store[A-Z]/)
    expect(
      storeOperations.some(
        (operation) =>
          /logout/i.test(operation.path) || /logout/i.test(operation.operationId)
      )
    ).toBe(false)
    expect(browserLogout).toBeDefined()
    expect(browserLogout?.path).toBeNull()
    expect(browserLogout?.owner).toMatch(/BFF/i)
    expect(browserLogout?.rationale).toMatch(/not invent/i)
    expect(browserLogout?.reviewTrigger.trim().length).toBeGreaterThan(0)
    expect(browserLogout?.provenance.trim().length).toBeGreaterThan(0)
  })

  it("keeps AUTH_DOCUMENTATION_DENY_EXCLUSIONS out of the 12, the /auth allowlist, and the Store registry", () => {
    const { storeOperations } = storeAuthOperations()
    const registeredKeys = new Set(
      storeOperations.map(
        (operation) => `${operation.method} ${operation.path}`
      )
    )

    expect(AUTH_DOCUMENTATION_DENY_EXCLUSIONS.length).toBeGreaterThan(0)
    expect(ROUTE_EXCLUSIONS).toHaveLength(4)
    expect(
      ROUTE_EXCLUSIONS.map(({ method, path }) => `${method} ${path}`).sort()
    ).toEqual(
      [
        "GET /admin/custom",
        "GET /store/custom",
        "POST /store/carts/{id}/complete",
        "POST /store/customers/me/cart/attach",
      ].sort()
    )

    for (const exclusion of AUTH_DOCUMENTATION_DENY_EXCLUSIONS) {
      expect(exclusion.owner.trim().length).toBeGreaterThan(0)
      expect(exclusion.rationale.trim().length).toBeGreaterThan(0)
      expect(exclusion.reviewTrigger.trim().length).toBeGreaterThan(0)
      expect(exclusion.provenance.trim().length).toBeGreaterThan(0)
      expect(APPROVED_KEYS).not.toContain(exclusion.key)
      expect([...STORE_DOCUMENTATION_AUTH_OPERATIONS]).not.toContain(
        exclusion.key
      )

      if (exclusion.path && !exclusion.localOverrideDocumentsSamePath) {
        expect(registeredKeys.has(`${exclusion.method} ${exclusion.path}`)).toBe(
          false
        )
      }
    }

    expect(
      AUTH_DOCUMENTATION_DENY_EXCLUSIONS.some(
        (exclusion) => exclusion.key === "POST /auth/session"
      )
    ).toBe(true)
    expect(
      AUTH_DOCUMENTATION_DENY_EXCLUSIONS.some(
        (exclusion) =>
          exclusion.path === "/auth/{actor_type}/{auth_provider}/callback"
      )
    ).toBe(true)
    expect(
      AUTH_DOCUMENTATION_DENY_EXCLUSIONS.some((exclusion) =>
        exclusion.path?.includes("/auth/mfa/")
      )
    ).toBe(true)
  })

  it("keeps /auth/session, callbacks, MFA, and native aliases out of the registered 12", () => {
    const { storeOperations } = storeAuthOperations()
    const registeredKeys = new Set(
      storeOperations.map(
        (operation) => `${operation.method} ${operation.path}`
      )
    )

    for (const key of DENIED_NATIVE_SURFACES) {
      expect(APPROVED_KEYS).not.toContain(key)
      expect(registeredKeys.has(key)).toBe(false)
      expect([...STORE_DOCUMENTATION_AUTH_OPERATIONS]).not.toContain(key)
    }

    expect(
      AUTH_SURFACE_NATIVE_OPERATIONS.some(
        (entry) =>
          entry.method === "POST" && entry.pathTemplate === "/auth/session"
      )
    ).toBe(true)
    expect(registeredKeys.has("POST /auth/customer/emailpass/revoke-current-lineage")).toBe(
      true
    )
  })

  it("lets registered auth operations and their schemas pass the sensitive example walker", () => {
    const { documented } = storeAuthOperations()

    for (const { operation } of documented) {
      expect(() =>
        assertSafeExamples(operation, {
          ...WALKER_OPTIONS,
          rootLocation: "operationMetadata",
        })
      ).not.toThrow()
      expect(collectExamples(operation)).toEqual([])
    }

    for (const [name, schema] of Object.entries(STORE_AUTH_SCHEMAS)) {
      expect(() =>
        assertSafeExamples(schema, {
          ...WALKER_OPTIONS,
          rootSemanticName: name,
        })
      ).not.toThrow()
    }
  })

  it("keeps Swagger non-interactive for the registered auth operations", () => {
    const { documented } = storeAuthOperations()
    const initializer = buildApiDocsInitializerJs([
      { name: "Store", url: "/openapi/store.json" },
    ])

    expect(
      documented.every(
        ({ operation }) =>
          operation.nonInteractive === true &&
          operation.interactiveCandidate === false
      )
    ).toBe(true)
    expect(initializer).toContain("tryItOutEnabled: false")
    expect(initializer).toContain("supportedSubmitMethods: []")
    expect(initializer).toContain("persistAuthorization: false")
  })
})
