import fs from "fs"
import path from "path"
import { z, type ZodType } from "zod"
import type { OpenApiDocument, OperationMetadata } from "../contracts"
import { CONTRACT_TITLES, CONTRACT_VERSIONS } from "../document"
import { buildContracts } from "../generation/build-documents"
import { canonicalize } from "../generation/canonicalize"
import { serializeDocument } from "../generation/serialize"
import { validateDocument, validateSurfacePartition } from "../generation/validate"
import { STORE_DOCUMENTATION_AUTH_OPERATIONS } from "../coverage/verify-coverage"
import {
  ContractRegistryBundle,
  createFoundationRegistry,
  type ComponentTypeOf,
  type DirectionSafeSchema,
} from "../registry"
import { parseGenerateArguments } from "../../../scripts/openapi/generate"
import {
  CORRELATION_ID_HEADER,
  STORE_CORRELATION_ID_HEADER,
} from "../components"

function syntheticOperation(
  overrides: Partial<OperationMetadata> = {}
): OperationMetadata {
  return {
    surface: "store",
    method: "GET",
    path: "/store/synthetic",
    operationId: "storeSyntheticGet",
    summary: "Synthetic operation",
    tags: ["Synthetic"],
    security: [],
    parameters: [],
    requestBody: null,
    responses: {
      "200": {
        description: "Synthetic response",
      },
    },
    sourceClassification: "synthetic-test",
    sourceFiles: ["src/api/synthetic/route.ts"],
    testEvidence: ["src/api-docs/__tests__/generation.unit.spec.ts"],
    officialReference: "https://spec.openapis.org/oas/v3.1.2.html",
    inclusionReason: "Synthetic registry invariant proof",
    interactiveCandidate: false,
    nonInteractive: true,
    ...overrides,
  }
}

function schemaComponent(
  schema: ComponentTypeOf<"schemas">
): ComponentTypeOf<"schemas"> {
  return schema
}

describe("OpenAPI foundation generation", () => {
  it("builds three deterministic populated OpenAPI 3.1.2 documents", () => {
    const first = buildContracts()
    const second = buildContracts()

    expect(first.map((contract) => contract.surface)).toEqual([
      "store",
      "admin",
      "webhooks",
    ])
    expect(first.map((contract) => contract.bytes)).toEqual(
      second.map((contract) => contract.bytes)
    )

    for (const contract of first) {
      expect(contract.document.openapi).toBe("3.1.2")
      expect(contract.document.info.version).toBe(
        CONTRACT_VERSIONS[contract.surface]
      )
      expect(contract.document.info.title).toBe(CONTRACT_TITLES[contract.surface])
      expect(contract.document["x-medusa-version"]).toBe("2.16.0")
      expect(contract.document.servers).toEqual([
        { url: "/", description: "Same-origin" },
      ])
      expect(contract.bytes.endsWith("\n")).toBe(true)
      expect(contract.bytes.endsWith("\n\n")).toBe(false)
      expect(contract.bytes).not.toMatch(
        /(?:generatedAt|gitSha|\/home\/|localhost|herokuapp)/i
      )
    }

    const store = first.find((contract) => contract.surface === "store")
    const admin = first.find((contract) => contract.surface === "admin")
    const webhooks = first.find((contract) => contract.surface === "webhooks")
    expect(Object.keys(store?.document.paths ?? {}).sort()).toEqual([
      "/auth/customer/emailpass",
      "/auth/customer/emailpass/register",
      "/auth/customer/emailpass/reset-password",
      "/auth/customer/emailpass/revoke-current-lineage",
      "/auth/customer/emailpass/update",
      "/auth/token/refresh",
      "/health/live",
      "/health/ready",
      "/store/customers/me",
      "/store/customers/me/password",
      "/store/customers/me/verify",
      "/store/customers/me/verify/status",
      "/store/customers/verify",
      "/store/customers/verify/resend",
    ])
    expect(
      Object.keys(store?.document.paths ?? {}).filter((routePath) =>
        routePath.startsWith("/store/")
      ).sort()
    ).toEqual([
      "/store/customers/me",
      "/store/customers/me/password",
      "/store/customers/me/verify",
      "/store/customers/me/verify/status",
      "/store/customers/verify",
      "/store/customers/verify/resend",
    ])
    expect(Object.keys(admin?.document.paths ?? {}).sort()).toEqual([
      "/admin/exchanges",
      "/admin/exchanges/{id}",
      "/admin/operational-alerts",
      "/admin/operational-alerts/{id}",
      "/admin/products",
      "/admin/products/{id}",
      "/admin/products/{id}/variants",
      "/admin/products/{id}/variants/{variant_id}",
      "/admin/refunds/request",
    ])
    expect(Object.keys(webhooks?.document.paths ?? {}).sort()).toEqual([
      "/hooks/gelato",
      "/hooks/stripe",
    ])
  })

  it("validates the closed contract version expected by each surface", () => {
    const contracts = buildContracts()
    const bySurface = Object.fromEntries(
      contracts.map((contract) => [contract.surface, contract.document])
    ) as Record<"store" | "admin" | "webhooks", OpenApiDocument>

    expect(bySurface.store.info.version).toBe("1.1.0")
    expect(bySurface.admin.info.version).toBe("1.0.0")
    expect(bySurface.webhooks.info.version).toBe("1.0.0")

    expect(() => validateDocument("store", bySurface.store)).not.toThrow()
    expect(() => validateDocument("admin", bySurface.admin)).not.toThrow()
    expect(() => validateDocument("webhooks", bySurface.webhooks)).not.toThrow()

    const wrongStore = structuredClone(bySurface.store)
    wrongStore.info.version = "1.0.0"
    expect(() => validateDocument("store", wrongStore)).toThrow(
      "Unexpected contract version for store"
    )

    for (const surface of ["admin", "webhooks"] as const) {
      const wrong = structuredClone(bySurface[surface])
      wrong.info.version = "1.1.0"
      expect(() => validateDocument(surface, wrong)).toThrow(
        `Unexpected contract version for ${surface}`
      )
    }
  })

  it("partitions Store documents to /store, /health, and the approved /auth exact-set", () => {
    expect(() =>
      validateSurfacePartition("store", {
        "/health/live": { get: {} },
        "/store/customers/me": { get: {} },
        "/auth/customer/emailpass": { post: {} },
        "/auth/token/refresh": { post: {} },
      })
    ).not.toThrow()

    for (const key of STORE_DOCUMENTATION_AUTH_OPERATIONS) {
      const [method, ...pathParts] = key.split(" ")
      expect(() =>
        validateSurfacePartition("store", {
          [pathParts.join(" ")]: { [method.toLowerCase()]: {} },
        })
      ).not.toThrow()
    }

    expect(() =>
      validateSurfacePartition("store", {
        "/auth/session": { post: {} },
      })
    ).toThrow("Contract partition violation: store POST /auth/session")
    expect(() =>
      validateSurfacePartition("store", {
        "/auth/{actor_type}/{auth_provider}/callback": { get: {} },
      })
    ).toThrow(/Contract partition violation: store GET \/auth\/\{actor_type\}\/\{auth_provider\}\/callback/)
    expect(() =>
      validateSurfacePartition("store", {
        "/auth/mfa/factors": { get: {} },
      })
    ).toThrow("Contract partition violation: store GET /auth/mfa/factors")
    expect(() =>
      validateSurfacePartition("admin", {
        "/auth/customer/emailpass": { post: {} },
      })
    ).toThrow("Contract partition violation: admin /auth/customer/emailpass")
  })

  it("keeps Store correlation semantics isolated from stable Admin and generated artifacts", () => {
    const contracts = buildContracts()
    const bySurface = Object.fromEntries(
      contracts.map((contract) => [contract.surface, contract.document])
    ) as Record<"store" | "admin" | "webhooks", OpenApiDocument>

    for (const healthPath of ["/health/live", "/health/ready"] as const) {
      const operation = bySurface.store.paths[healthPath] as {
        get: { parameters: Array<Record<string, unknown>> }
      }
      expect(operation.get.parameters[0]).toEqual(STORE_CORRELATION_ID_HEADER)
      expect(operation.get.parameters[0]).not.toEqual(CORRELATION_ID_HEADER)
    }

    const adminProductList = bySurface.admin.paths["/admin/products"] as {
      post: { parameters: Array<Record<string, unknown>> }
    }
    expect(adminProductList.post.parameters[0]).toEqual(CORRELATION_ID_HEADER)
    expect(adminProductList.post.parameters[0]).not.toEqual(
      STORE_CORRELATION_ID_HEADER
    )

    const generatedDir = path.resolve(__dirname, "..", "generated")
    for (const contract of contracts.filter(
      (entry) => entry.surface !== "store"
    )) {
      expect(contract.bytes).toBe(
        fs.readFileSync(path.join(generatedDir, contract.fileName), "utf8")
      )
    }
    const committedStore = fs.readFileSync(
      path.join(generatedDir, "store.openapi.json"),
      "utf8"
    )
    const builtStore = contracts.find((contract) => contract.surface === "store")
    expect(committedStore).toContain("/health/live")
    expect(JSON.parse(committedStore).paths["/auth/session"]).toBeUndefined()
    expect(builtStore?.bytes).toBeDefined()
    expect(Object.keys(JSON.parse(committedStore).paths).sort()).toEqual([
      "/health/live",
      "/health/ready",
    ])
  })

  it("uses an explicit operation description and otherwise falls back to summary", () => {
    const registry = new ContractRegistryBundle()
    registry.registerOperation(
      syntheticOperation({ surface: "admin", path: "/admin/synthetic" })
    )
    registry.registerOperation(
      syntheticOperation({
        surface: "admin",
        method: "POST",
        path: "/admin/synthetic-described",
        operationId: "storeSyntheticDescribed",
        description: "Explicit operation description",
      })
    )

    const admin = buildContracts(registry).find(
      (contract) => contract.surface === "admin"
    )?.document
    expect((admin?.paths["/admin/synthetic"] as { get: { description: string } }).get.description)
      .toBe("Synthetic operation")
    expect((admin?.paths["/admin/synthetic-described"] as { post: { description: string } }).post.description)
      .toBe("Explicit operation description")
  })

  it("uses canonical HTTP method order only inside Path Items", () => {
    const value = canonicalize({
      paths: {
        "/z": { head: {}, patch: {}, get: {}, post: {} },
        "/a": { delete: {}, put: {} },
      },
    })
    expect(Object.keys(value.paths)).toEqual(["/a", "/z"])
    expect(Object.keys(value.paths["/z"])).toEqual([
      "get",
      "post",
      "patch",
      "head",
    ])
  })

  it("uses lexical ordering for schema properties that look like HTTP methods", () => {
    const value = canonicalize({
      components: {
        schemas: {
          Synthetic: {
            properties: {
              post: {},
              get: {},
              alpha: {},
            },
          },
        },
      },
    })

    expect(
      Object.keys(value.components.schemas.Synthetic.properties)
    ).toEqual(["alpha", "get", "post"])
  })

  it("rejects duplicate method/path and duplicate operationId", () => {
    const registry = new ContractRegistryBundle()
    registry.registerOperation(syntheticOperation())

    expect(() =>
      registry.registerOperation(
        syntheticOperation({ operationId: "storeSyntheticDuplicate" })
      )
    ).toThrow("Duplicate method/path")

    expect(() =>
      registry.registerOperation(
        syntheticOperation({
          method: "POST",
          path: "/store/another",
        })
      )
    ).toThrow("Duplicate operationId")
  })

  it("rejects duplicate components and unrepresentable component values", () => {
    const registry = new ContractRegistryBundle()
    registry.registerComponent("shared", "schemas", "Synthetic", {
      type: "string",
    })
    expect(() =>
      registry.registerComponent("shared", "schemas", "Synthetic", {
        type: "number",
      })
    ).toThrow("Duplicate component")

    expect(() =>
      registry.registerComponent("shared", "schemas", "Invalid", {
        type: "string",
        invalid: () => "not-json",
      } as never)
    ).toThrow("unrepresentable")
  })

  it("rejects a surface component that collides with a shared component", () => {
    const registry = new ContractRegistryBundle()
    registry.registerComponent("shared", "schemas", "SharedCollision", {
      type: "string",
    })
    expect(() =>
      registry.registerComponent("store", "schemas", "SharedCollision", {
        type: "string",
      })
    ).toThrow("Duplicate shared component")
  })

  it("rejects missing provenance, inclusion reason, response metadata, and security schemes", () => {
    expect(() =>
      new ContractRegistryBundle().registerOperation(
        syntheticOperation({ sourceFiles: [] })
      )
    ).toThrow("missing provenance")
    expect(() =>
      new ContractRegistryBundle().registerOperation(
        syntheticOperation({ inclusionReason: "" })
      )
    ).toThrow("inclusionReason")
    expect(() =>
      new ContractRegistryBundle().registerOperation(
        syntheticOperation({ responses: {} })
      )
    ).toThrow("response metadata")
    expect(() =>
      new ContractRegistryBundle().registerOperation(
        syntheticOperation({ security: [{ missingScheme: [] }] })
      )
    ).toThrow("Unknown security scheme")
  })

  it("rejects unsafe examples", () => {
    const unsafeExamples = [
      { authorization: "Bearer token-value" },
      { authorization: "******" },
      { authorization: "redacted" },
      { note: "cpf informado" },
      { description: "cnpj presente" },
      { email: "shopper@example.test" },
      { phone: "+55 11 91234-5678" },
      { address_1: "Rua Exemplo, 123" },
      { copy_paste: "00020126580014BRGOVBCBPIX" },
      { tracking_token: "synthetic-token" },
      { token: "usable-tracking-token-123" },
      { shipping_address: "Rua Exemplo, 123" },
      { pix_qr_code: "synthetic-pix-payload" },
      { webhook_secret: "synthetic-secret" },
      { payment_intent_id: "pi_1234567890abcdef" },
      { refund_id: "re_1234567890abcdef" },
      { account_id: "acct_1234567890abcdef" },
      { provider_order_id: "ord_1234567890abcdef" },
      { provider_order_id: "gelato-order-production-98765" },
      { payment_intent_id: "payment-production-98765" },
      { event_id: "stripe-event-production-98765" },
      { provider_id: "123e4567-e89b-42d3-a456-426614174000" },
      { document_number: "synthetic-personal-document" },
      { fullAddress: "Rua Exemplo, 123" },
      { signature: "synthetic-signature" },
      { api_key: "synthetic-api-key" },
      { event_id: "evt_1234567890abcdef" },
    ]

    for (const example of unsafeExamples) {
      expect(() =>
        new ContractRegistryBundle().registerOperation(
          syntheticOperation({
            responses: {
              "200": {
                description: "Unsafe",
                content: {
                  "application/json": { example },
                },
              },
            },
          })
        )
      ).toThrow("unsafe example")

      const document = structuredClone(
        buildContracts()[0].document
      ) as OpenApiDocument & { example?: unknown }
      document.example = example
      expect(() => validateDocument("store", document)).toThrow(
        "Sensitive OpenAPI example"
      )
    }
  })

  describe.each([
    {
      boundary: "ContractRegistryBundle",
      expectedError: "unsafe example",
      exercise: (name: string, schema: unknown) => {
        const registry = new ContractRegistryBundle()
        Reflect.apply(
          registry.registerComponent,
          registry,
          ["shared", "schemas", name, schema]
        )
      },
    },
    {
      boundary: "validateDocument",
      expectedError: "Sensitive OpenAPI example",
      exercise: (name: string, schema: unknown) => {
        const document = structuredClone(buildContracts()[0].document)
        Object.defineProperty(document.components.schemas, name, {
          configurable: true,
          enumerable: true,
          value: schema,
        })
        validateDocument("store", document)
      },
    },
  ])("rejects examples owned by sensitive properties at $boundary", ({
    expectedError,
    exercise,
  }) => {
    it.each([
      {
        componentName: "SensitivePaymentIntentExample",
        label: "payment_intent_id with a singular example",
        schema: schemaComponent({
          type: "object",
          properties: {
            payment_intent_id: {
              type: "string",
              example: "synthetic-reference",
            },
          },
        }),
      },
      {
        componentName: "SensitiveTrackingTokenExamples",
        label: "trackingToken with an examples array",
        schema: schemaComponent({
          type: "object",
          properties: {
            trackingToken: {
              type: "string",
              examples: ["synthetic-reference"],
            },
          },
        }),
      },
      {
        componentName: "SensitiveTrackingTokenExample",
        label: "tracking_token with an opaque singular example",
        schema: schemaComponent({
          type: "object",
          properties: {
            tracking_token: {
              type: "string",
              example: "actual-opaque-tracking-value",
            },
          },
        }),
      },
      {
        componentName: "SensitiveAuthorizationExamples",
        label: "authorization with a redacted examples array",
        schema: {
          type: "object",
          properties: {
            authorization: {
              type: "string",
              examples: ["redacted"],
            },
          },
        },
      },
      {
        componentName: "NestedSensitivePropertyExample",
        label: "a sensitive property nested in an object",
        schema: schemaComponent({
          type: "object",
          properties: {
            envelope: {
              type: "object",
              properties: {
                tracking_token: {
                  type: "string",
                  example: "nested-opaque-tracking-value",
                },
              },
            },
          },
        }),
      },
      {
        componentName: "SensitivePropertyExamplesMap",
        label: "authorization with examples represented as a map",
        schema: {
          type: "object",
          properties: {
            authorization: {
              type: "string",
              examples: {
                publicSample: {
                  value: "redacted",
                },
              },
            },
          },
        },
      },
    ])("rejects $label", ({ componentName, schema }) => {
      expect(() => exercise(componentName, schema)).toThrow(expectedError)
    })

    it.each([
      {
        componentName: "SafeStatusExample",
        label: "status with a singular example",
        schema: schemaComponent({
          type: "object",
          properties: {
            status: {
              type: "string",
              example: "pending",
            },
          },
        }),
      },
      {
        componentName: "SafeStatusExamples",
        label: "status with an examples array",
        schema: schemaComponent({
          type: "object",
          properties: {
            status: {
              type: "string",
              examples: ["pending"],
            },
          },
        }),
      },
    ])("accepts $label", ({ componentName, schema }) => {
      expect(() => exercise(componentName, schema)).not.toThrow()
    })
  })

  it("keeps response status keys non-semantic after responseMap propagation", () => {
    const response = {
      description: "Synthetic response",
      content: {
        "application/json": { example: "opaque-reference" },
      },
    }
    const responses = { "200": response, default: response }

    expect(() =>
      new ContractRegistryBundle().registerOperation(
        syntheticOperation({ responses })
      )
    ).not.toThrow()

    const document = structuredClone(buildContracts()[0].document)
    document.paths["/store/synthetic"] = {
      get: {
        operationId: "storeSyntheticResponseStatusExamples",
        responses,
      },
    }
    expect(() => validateDocument("store", document)).not.toThrow()
  })

  describe.each([
    {
      label: "tracking_token parameter example",
      parameter: {
        name: "tracking_token",
        in: "query",
        example: "actual-opaque-value",
      },
    },
    {
      label: "camelCase trackingToken examples array",
      parameter: {
        name: "trackingToken",
        in: "query",
        examples: ["actual-opaque-value"],
      },
    },
    {
      label: "provider_order_id header examples map",
      parameter: {
        name: "provider_order_id",
        in: "header",
        examples: {
          syntheticReference: { value: "synthetic-reference" },
        },
      },
    },
    {
      label: "authorization header parameter example",
      parameter: {
        name: "authorization",
        in: "header",
        example: "redacted",
      },
    },
  ])("rejects named parameter examples at $label", ({ parameter }) => {
    it.each([
      {
        boundary: "ContractRegistryBundle",
        exercise: () =>
          new ContractRegistryBundle().registerOperation(
            syntheticOperation({ parameters: [parameter] })
          ),
        expectedError: "unsafe example",
      },
      {
        boundary: "validateDocument",
        exercise: () => {
          const document = structuredClone(buildContracts()[0].document)
          document.paths["/store/synthetic"] = {
            get: {
              operationId: "storeSyntheticNamedExample",
              parameters: [parameter],
              responses: { "200": { description: "Synthetic response" } },
            },
          }
          validateDocument("store", document)
        },
        expectedError: "Sensitive OpenAPI example",
      },
    ])("rejects at $boundary", ({ exercise, expectedError }) => {
      expect(exercise).toThrow(expectedError)
    })
  })

  describe.each([
    {
      label: "authorization response header example",
      headerName: "authorization",
      header: { example: "redacted" },
    },
    {
      label: "provider_order_id response header examples map",
      headerName: "provider_order_id",
      header: {
        examples: { syntheticReference: { value: "synthetic-reference" } },
      },
    },
  ])("rejects named response headers at $label", ({ headerName, header }) => {
    it.each([
      {
        boundary: "ContractRegistryBundle",
        exercise: () => {
          const operation = syntheticOperation()
          Reflect.set(operation.responses["200"], "headers", {
            [headerName]: header,
          })
          new ContractRegistryBundle().registerOperation(operation)
        },
        expectedError: "unsafe example",
      },
      {
        boundary: "validateDocument",
        exercise: () => {
          const document = structuredClone(buildContracts()[0].document)
          document.paths["/store/synthetic"] = {
            get: {
              operationId: "storeSyntheticHeaderExample",
              responses: {
                "200": {
                  description: "Synthetic response",
                  headers: { [headerName]: header },
                },
              },
            },
          }
          validateDocument("store", document)
        },
        expectedError: "Sensitive OpenAPI example",
      },
    ])("rejects at $boundary", ({ exercise, expectedError }) => {
      expect(exercise).toThrow(expectedError)
    })
  })

  describe.each([
    {
      boundary: "ContractRegistryBundle",
      exercise: () =>
        new ContractRegistryBundle().registerComponent(
          "shared",
          "parameters",
          "TrackingTokenParameter",
          {
            name: "tracking_token",
            in: "query",
            example: "actual-opaque-value",
          }
        ),
      expectedError: "unsafe example",
    },
    {
      boundary: "ContractRegistryBundle",
      exercise: () =>
        new ContractRegistryBundle().registerComponent(
          "shared",
          "responses",
          "TrackingTokenResponse",
          {
            description: "Synthetic response",
            content: {
              "application/json": {
                example: "opaque-reference",
              },
            },
          }
        ),
      expectedError: "unsafe example",
    },
    {
      boundary: "ContractRegistryBundle",
      exercise: () =>
        new ContractRegistryBundle().registerComponent(
          "shared",
          "headers",
          "authorization",
          { example: "redacted" }
        ),
      expectedError: "unsafe example",
    },
    {
      boundary: "validateDocument",
      exercise: () => {
        const document = structuredClone(buildContracts()[0].document)
        document.components.parameters.TrackingTokenParameter = {
          name: "tracking_token",
          in: "query",
          example: "actual-opaque-value",
        }
        validateDocument("store", document)
      },
      expectedError: "Sensitive OpenAPI example",
    },
    {
      boundary: "validateDocument",
      exercise: () => {
        const document = structuredClone(buildContracts()[0].document)
        document.components.headers.authorization = { example: "redacted" }
        validateDocument("store", document)
      },
      expectedError: "Sensitive OpenAPI example",
    },
    {
      boundary: "validateDocument",
      exercise: () => {
        const document = structuredClone(buildContracts()[0].document)
        document.components.responses.TrackingTokenResponse = {
          description: "Synthetic response",
          content: {
            "application/json": {
              example: "opaque-reference",
            },
          },
        }
        validateDocument("store", document)
      },
      expectedError: "Sensitive OpenAPI example",
    },
  ])("rejects named components at $boundary", ({ exercise, expectedError }) => {
    expect(exercise).toThrow(expectedError)
  })

  describe.each([
    {
      label: "requestBody content schema property",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                tracking_token: {
                  type: "string",
                  example: "actual-opaque-value",
                },
              },
            },
          },
        },
      },
    },
    {
      label: "response content schema property",
      responseContent: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              authorization: {
                type: "string",
                examples: ["redacted"],
              },
            },
          },
        },
      },
    },
    {
      label: "requestBody dependent and pattern schemas",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              dependentSchemas: {
                metadata: {
                  patternProperties: {
                    "^token$": {
                      type: "object",
                      properties: {
                        tracking_token: {
                          type: "string",
                          example: "actual-opaque-value",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      label: "response content and unevaluated schemas",
      responseContent: {
        "application/json": {
          schema: {
            type: "object",
            contentSchema: {
              type: "object",
              unevaluatedProperties: {
                type: "object",
                properties: {
                  authorization: {
                    type: "string",
                    example: "redacted",
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      label: "requestBody defs schema",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "array",
              items: { $ref: "#/$defs/Item" },
              $defs: {
                Item: {
                  type: "object",
                  properties: {
                    tracking_token: {
                      type: "string",
                      example: "actual-opaque-value",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      label: "response content and unevaluated items",
      responseContent: {
        "application/json": {
          schema: {
            type: "array",
            unevaluatedItems: {
              type: "object",
              properties: {
                authorization: {
                  type: "string",
                  example: "redacted",
                },
              },
            },
          },
        },
      },
    },
  ])("rejects sensitive properties in $label", ({ requestBody, responseContent }) => {
    it.each([
      {
        boundary: "ContractRegistryBundle",
        exercise: () => {
          const operation = syntheticOperation()
          if (requestBody) {
            Reflect.set(operation, "requestBody", requestBody)
          }
          if (responseContent) {
            Reflect.set(operation.responses["200"], "content", responseContent)
          }
          new ContractRegistryBundle().registerOperation(operation)
        },
        expectedError: "unsafe example",
      },
      {
        boundary: "validateDocument",
        exercise: () => {
          const document = structuredClone(buildContracts()[0].document)
          document.paths["/store/synthetic"] = {
            get: {
              operationId: "storeSyntheticSchemaExample",
              ...(requestBody ? { requestBody } : {}),
              responses: {
                "200": {
                  description: "Synthetic response",
                  ...(responseContent ? { content: responseContent } : {}),
                },
              },
            },
          }
          validateDocument("store", document)
        },
        expectedError: "Sensitive OpenAPI example",
      },
    ])("rejects at $boundary", ({ exercise, expectedError }) => {
      expect(exercise).toThrow(expectedError)
    })
  })

  describe.each([
    {
      label: "safe status parameter example",
      parameter: { name: "status", in: "query", example: "pending" },
    },
    {
      label: "safe fields parameter examples array",
      parameter: { name: "fields", in: "query", examples: ["id,title"] },
    },
    {
      label: "safe examples map name",
      parameter: {
        name: "status",
        in: "query",
        examples: { authorization: { value: "redacted" } },
      },
    },
    {
      label: "arbitrary name outside a parameter",
      responseContentExample: {
        metadata: { name: "tracking_token", example: "opaque-value" },
      },
    },
  ])("accepts non-semantic names in $label", ({ parameter, responseContentExample }) => {
    it("accepts at both boundaries", () => {
      expect(() =>
        new ContractRegistryBundle().registerOperation(
          syntheticOperation({
            parameters: parameter ? [parameter] : [],
            responses: {
              "200": {
                description: "Synthetic response",
                content: responseContentExample
                  ? { "application/json": { example: responseContentExample } }
                  : undefined,
              },
            },
          })
        )
      ).not.toThrow()

      const document = structuredClone(buildContracts()[0].document)
      document.paths["/store/synthetic"] = {
        get: {
          operationId: "storeSyntheticSafeNamedExample",
          parameters: parameter ? [parameter] : [],
          responses: {
            "200": {
              description: "Synthetic response",
              content: responseContentExample
                ? { "application/json": { example: responseContentExample } }
                : undefined,
            },
          },
        },
      }
      expect(() => validateDocument("store", document)).not.toThrow()
    })
  })

  describe.each([
    {
      componentName: "SensitiveTrackingTokenDescendantExample",
      label: "tracking_token.properties.value.example",
      schema: {
        type: "object",
        properties: {
          tracking_token: {
            type: "object",
            properties: {
              value: {
                type: "string",
                example: "synthetic-reference",
              },
            },
          },
        },
      },
    },
    {
      componentName: "SensitiveTrackingTokenCamelDescendantExamples",
      label: "trackingToken.properties.value.examples array",
      schema: {
        type: "object",
        properties: {
          trackingToken: {
            type: "object",
            properties: {
              value: {
                type: "string",
                examples: ["synthetic-reference", "synthetic-reference-2"],
              },
            },
          },
        },
      },
    },
    {
      componentName: "SensitiveTrackingTokenDescendantExamplesMap",
      label: "tracking_token.properties.value.examples map",
      schema: {
        type: "object",
        properties: {
          tracking_token: {
            type: "object",
            properties: {
              value: {
                type: "string",
                examples: {
                  publicSample: { value: "synthetic-reference" },
                },
              },
            },
          },
        },
      },
    },
    {
      componentName: "SensitiveTrackingTokenDeepDescendantExample",
      label: "tracking_token with a deeper descendant example",
      schema: {
        type: "object",
        properties: {
          tracking_token: {
            type: "object",
            properties: {
              envelope: {
                type: "object",
                properties: {
                  value: {
                    type: "string",
                    example: "synthetic-reference",
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      componentName: "SensitiveProviderOrderPatternExample",
      label: "patternProperties provider_order_id direct example",
      schema: {
        type: "object",
        patternProperties: {
          "^provider_order_id$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveGroupedProviderOrderPatternExample",
      label: "grouped sensitive patternProperties direct example",
      schema: {
        type: "object",
        patternProperties: {
          "^(provider_order_id)$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveSeparatedProviderOrderPatternExample",
      label: "separator character class in sensitive patternProperties",
      schema: {
        type: "object",
        patternProperties: {
          "^provider[_-]order[_-]id$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveBroadTokenPatternExample",
      label: "sensitive literal token inside a broad pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^.*token.*$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveApiKeyPatternExample",
      label: "separator character class in api_key pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^api[._-]key$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveBroadApiKeyPatternExample",
      label: "optional separator in a broad api_key pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^.*api[._-]?key.*$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveEscapedProviderOrderPatternExample",
      label: "escaped separator class in provider_order_id pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^provider[\\._-]order[\\._-]id$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveBroadProviderOrderPatternExample",
      label: "broad provider_order_id pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^.*provider[_-]order[_-]id.*$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveHexEscapedTrackingPatternExample",
      label: "hex escaped separator in tracking_token pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^tracking\\x5ftoken$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveHexEscapedApiKeyPatternExample",
      label: "hex escaped separator in api_key pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^api\\u005Fkey$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveHexEscapedTrackingTokenPatternExample",
      label: "hex escaped token letter in tracking_token pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^tracking_\\x74oken$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveUnicodeEscapedApiKeyPatternExample",
      label: "unicode escaped token letter in api_key pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^api_\\u006Bey$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveHexEscapedTrackingClassPatternExample",
      label: "hex escaped singleton class in tracking_token pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^tracking_[\\x74]oken$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveUnicodeEscapedApiKeyClassPatternExample",
      label: "unicode escaped singleton class in api_key pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^api_[\\u006b]ey$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveGroupedTrackingPatternExample",
      label: "noncapturing group inside tracking_token pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^tracking_(?:t)oken$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveGroupedApiKeyPatternExample",
      label: "noncapturing group inside api_key pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^api_(?:k)ey$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveLookaheadTrackingPatternExample",
      label: "lookahead inside tracking_token pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^tracking_(?=token)token$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveLookaheadApiKeyPatternExample",
      label: "lookahead inside api_key pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^api_(?=key)key$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitivePositiveLookaheadTrackingPatternExample",
      label: "positive lookahead that supplies tracking_token pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=tracking_token$).+$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitivePositiveLookaheadApiKeyPatternExample",
      label: "positive lookahead that supplies api_key pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=api_key$).+$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveNestedLookaheadTrackingPatternExample",
      label: "nested positive lookahead reconstructing tracking_token pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=tracking_(?=token)token$).+$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveNestedLookaheadApiKeyPatternExample",
      label: "nested positive lookahead reconstructing api_key pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=api_(?=key)key$).+$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveDeeperNestedLookaheadTrackingPatternExample",
      label: "deeper nested positive lookahead reconstructing tracking_token",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=tracking_(?=tok(?=en)en)token$).+$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveNestedLookbehindTrackingPatternExample",
      label: "nested positive lookbehind reconstructing tracking_token pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^(?<=tracking_(?=token)token).+$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveMalformedNestedLookaheadPatternExample",
      label: "unclosed nested positive lookahead fails closed",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=tracking_(?=token)token$.+$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveNestedLookaheadDepthLimitPatternExample",
      label: "five nested positive lookaheads exceed depth limit",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=(?=(?=(?=(?=status)status)status)status)status).+$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveNestedLookaheadTrackingPatternExamples",
      label: "nested positive lookahead tracking_token examples array",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=tracking_(?=token)token$).+$": {
            type: "string",
            examples: ["opaque-reference", "opaque-reference-2"],
          },
        },
      },
    },
    {
      componentName: "SensitiveNestedLookaheadApiKeyPatternExamplesMap",
      label: "nested positive lookahead api_key examples map",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=api_(?=key)key$).+$": {
            type: "string",
            examples: {
              publicSample: { value: "opaque-reference" },
            },
          },
        },
      },
    },
    {
      componentName: "SensitiveTrackingPatternExamples",
      label: "patternProperties trackingToken direct examples",
      schema: {
        type: "object",
        patternProperties: {
          "^trackingToken$": {
            type: "string",
            examples: ["opaque-reference", "opaque-reference-2"],
          },
        },
      },
    },
    {
      componentName: "TrackingToken",
      label: "sensitive schema component name",
      schema: {
        type: "string",
        example: "opaque-reference",
      },
    },
    {
      componentName: "PublicEnvelopeWithSensitiveDefinition",
      label: "sensitive local $defs schema name",
      schema: {
        type: "object",
        $defs: {
          TrackingToken: {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "PublicEnvelopeWithSensitiveDependentSchema",
      label: "sensitive dependentSchemas property name",
      schema: {
        type: "object",
        dependentSchemas: {
          tracking_token: {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SensitiveProviderOrderPatternDescendantExample",
      label: "sensitive patternProperties descendant example",
      schema: {
        type: "object",
        patternProperties: {
          "^provider_order_id$": {
            type: "object",
            properties: {
              value: {
                type: "string",
                example: "opaque-reference",
              },
            },
          },
        },
      },
    },
  ])("rejects nested sensitive examples at both boundaries: $label", ({
    componentName,
    schema,
  }) => {
    it.each([
      {
        boundary: "ContractRegistryBundle",
        exercise: () => {
          const registry = new ContractRegistryBundle()
          Reflect.apply(
            registry.registerComponent,
            registry,
            ["shared", "schemas", componentName, schema]
          )
        },
        expectedError: "unsafe example",
      },
      {
        boundary: "validateDocument",
        exercise: () => {
          const document = structuredClone(buildContracts()[0].document)
          Object.defineProperty(document.components.schemas, componentName, {
            configurable: true,
            enumerable: true,
            value: schema,
          })
          validateDocument("store", document)
        },
        expectedError: "Sensitive OpenAPI example",
      },
    ])("rejects at $boundary", ({ exercise, expectedError }) => {
      expect(exercise).toThrow(expectedError)
    })
  })

  describe.each([
    {
      componentName: "SafeStatusDescendantExample",
      label: "status.properties.value.example",
      schema: {
        type: "object",
        properties: {
          status: {
            type: "object",
            properties: {
              value: {
                type: "string",
                example: "pending",
              },
            },
          },
        },
      },
    },
    {
      componentName: "SafeMetadataStatusExamples",
      label: "metadata.properties.status.examples",
      schema: {
        type: "object",
        properties: {
          metadata: {
            type: "object",
            properties: {
              status: {
                type: "string",
                examples: ["pending", "complete"],
              },
            },
          },
        },
      },
    },
    {
      componentName: "SafeStatusPatternExample",
      label: "patternProperties ^status$ example",
      schema: {
        type: "object",
        patternProperties: {
          "^status$": {
            type: "string",
            example: "pending",
          },
        },
      },
    },
    {
      componentName: "SafePublicFieldPatternExamples",
      label: "patternProperties ^publicField$ examples",
      schema: {
        type: "object",
        patternProperties: {
          "^publicField$": {
            type: "string",
            examples: ["public"],
          },
        },
      },
    },
    {
      componentName: "SafeSiblingOutsideSensitiveSubtree",
      label: "sibling outside the sensitive subtree",
      schema: {
        type: "object",
        properties: {
          tracking_token: {
            type: "object",
            properties: {
              value: { type: "string" },
            },
          },
          publicField: {
            type: "string",
            example: "public",
          },
        },
      },
    },
    {
      componentName: "SafeMetacharacterPatternExample",
      label: "pattern with metacharacters is not a semantic name",
      schema: {
        type: "object",
        patternProperties: {
          "^.*$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SafeNamedGroupPatternExample",
      label: "named regex group is not a semantic name",
      schema: {
        type: "object",
        patternProperties: {
          "^(?<id>.*)$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SafeCharacterClassPatternExample",
      label: "character class contents are not a semantic name",
      schema: {
        type: "object",
        patternProperties: {
          "^[token]$": {
            type: "string",
            example: "t",
          },
        },
      },
    },
    {
      componentName: "TrackingTokenWithSafeDefinition",
      label: "sensitive component does not contaminate a safe $defs schema",
      schema: {
        type: "object",
        $defs: {
          PublicStatus: {
            type: "string",
            example: "pending",
          },
        },
      },
    },
    {
      componentName: "TrackingTokenWithSafeDependentSchema",
      label: "sensitive component does not contaminate a safe dependent schema",
      schema: {
        type: "object",
        dependentSchemas: {
          status: {
            type: "string",
            example: "pending",
          },
        },
      },
    },
    {
      componentName: "SafeNestedLookaheadPublicStatusPatternExample",
      label: "nested positive lookahead reconstructing public_status pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=public_(?=status)status$).+$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
    {
      componentName: "SafeNestedLookaheadDisplayNamePatternExample",
      label: "nested positive lookahead reconstructing display_name pattern",
      schema: {
        type: "object",
        patternProperties: {
          "^(?=display_(?=name)name$).+$": {
            type: "string",
            example: "opaque-reference",
          },
        },
      },
    },
  ])("accepts safe nested examples at both boundaries: $label", ({
    componentName,
    schema,
  }) => {
    it.each([
      {
        boundary: "ContractRegistryBundle",
        exercise: () => {
          const registry = new ContractRegistryBundle()
          Reflect.apply(
            registry.registerComponent,
            registry,
            ["shared", "schemas", componentName, schema]
          )
        },
      },
      {
        boundary: "validateDocument",
        exercise: () => {
          const document = structuredClone(buildContracts()[0].document)
          Object.defineProperty(document.components.schemas, componentName, {
            configurable: true,
            enumerable: true,
            value: schema,
          })
          validateDocument("store", document)
        },
      },
    ])("accepts at $boundary", ({ exercise }) => {
      expect(exercise).not.toThrow()
    })
  })

  it("shares only direction-safe Zod schemas", () => {
    const registry = new ContractRegistryBundle()
    const shared = z.strictObject({ value: z.string() })
    const registered = registry.registerSharedSchema(
      "shared",
      "SharedSynthetic",
      shared
    )
    expect(registered.parse({ value: "safe" })).toEqual({ value: "safe" })

    const staticallyRejected = z.string().transform((value) => value.length)
    const staticBarrierProof: DirectionSafeSchema<
      typeof staticallyRejected
    > extends never
      ? true
      : false = true
    expect(staticBarrierProof).toBe(true)

    const transformed: ZodType = staticallyRejected
    expect(() =>
      registry.registerSchema("shared", "TransformedSynthetic", transformed, "shared")
    ).toThrow("cannot coerce, preprocess, transform, or default")
  })

  it("rejects transformed request and response schemas", () => {
    const transformedRequest: ZodType = z
      .string()
      .transform((value) => value.length)
    const transformedResponse: ZodType = z
      .string()
      .transform((value) => value.length)

    expect(() =>
      new ContractRegistryBundle().registerDirectionalSchemas(
        "shared",
        "SyntheticRequest",
        transformedRequest,
        "SyntheticResponse",
        z.number().int()
      )
    ).toThrow("cannot coerce, preprocess, transform, or default")

    expect(() =>
      new ContractRegistryBundle().registerDirectionalSchemas(
        "shared",
        "SyntheticRequest",
        z.string(),
        "SyntheticResponse",
        transformedResponse
      )
    ).toThrow("cannot coerce, preprocess, transform, or default")
  })

  it("accepts stable request and response schemas with distinct names", () => {
    const registry = new ContractRegistryBundle()
    const request = z.strictObject({ input: z.string() })
    const response = z.strictObject({ output: z.string() })

    const registered = registry.registerDirectionalSchemas(
      "shared",
      "SyntheticRequest",
      request,
      "SyntheticResponse",
      response
    )
    expect(registered.request.parse({ input: "abc" })).toEqual({ input: "abc" })
    expect(registered.response.parse({ output: "abc" })).toEqual({ output: "abc" })
    expect(
      Object.keys(buildContracts(registry)[0].document.components.schemas)
    ).toEqual(["SyntheticRequest", "SyntheticResponse"])
  })

  it("requires distinct names for directional schemas", () => {
    expect(() =>
      new ContractRegistryBundle().registerDirectionalSchemas(
        "shared",
        "Synthetic",
        z.string(),
        "Synthetic",
        z.string()
      )
    ).toThrow("distinct names")
  })

  it("rejects coercion, defaults, stripping, and nested unsafe schemas", () => {
    const unsafeSchemas: ZodType[] = [
      z.coerce.number(),
      z.string().default("fallback"),
      z.object({ value: z.string() }),
      z.strictObject({
        nested: z.string().transform((value) => value.length),
      }),
    ]

    for (const [index, schema] of unsafeSchemas.entries()) {
      expect(() =>
        new ContractRegistryBundle().registerSchema(
          "shared",
          `UnsafeSynthetic${index}`,
          schema,
          "request"
        )
      ).toThrow()
    }
  })

  it("imports only public zod-to-openapi entry points", () => {
    const registrySource = fs.readFileSync(
      path.join(__dirname, "..", "registry.ts"),
      "utf8"
    )
    const componentsSource = fs.readFileSync(
      path.join(__dirname, "..", "components", "index.ts"),
      "utf8"
    )

    expect(registrySource).toContain('from "@asteasolutions/zod-to-openapi"')
    expect(registrySource).toContain('OpenAPIRegistry["registerComponent"]')
    expect(`${registrySource}\n${componentsSource}`).not.toMatch(
      /@asteasolutions\/zod-to-openapi\//
    )
    expect(componentsSource).not.toContain(
      'from "@asteasolutions/zod-to-openapi"'
    )
  })

  it("serializes the same document to identical bytes twice", () => {
    const document = buildContracts(createFoundationRegistry())[0].document
    expect(serializeDocument(document)).toBe(serializeDocument(document))
  })

  it("requires an explicit valid generator surface", () => {
    expect(parseGenerateArguments(["--write", "--surface", "all"])).toBe("all")
    expect(() => parseGenerateArguments(["--write"])).toThrow(
      "--surface is required"
    )
    expect(() =>
      parseGenerateArguments(["--write", "--surface", "unknown"])
    ).toThrow("--surface must be")
  })
})
