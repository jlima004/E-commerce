import { createHash } from "crypto"
import fs from "fs"
import path from "path"
import type { OpenApiDocument } from "../contracts"
import { buildContracts } from "../generation/build-documents"
import { createFoundationRegistry } from "../registry"

const ADMIN_HEADER_REF = "#/components/headers/AdminXCorrelationId"
const ADMIN_PATH_METHODS = [
  "GET /admin/operational-alerts",
  "GET /admin/operational-alerts/{id}",
  "POST /admin/exchanges",
  "POST /admin/exchanges/{id}",
  "POST /admin/products",
  "POST /admin/products/{id}",
  "POST /admin/products/{id}/variants",
  "POST /admin/products/{id}/variants/{variant_id}",
  "POST /admin/refunds/request",
] as const
const NATIVE_PRODUCT_PATHS = new Set([
  "/admin/products",
  "/admin/products/{id}",
  "/admin/products/{id}/variants",
  "/admin/products/{id}/variants/{variant_id}",
])
const USER_ONLY_PATHS = new Set([
  "/admin/refunds/request",
  "/admin/exchanges",
  "/admin/exchanges/{id}",
  "/admin/operational-alerts",
  "/admin/operational-alerts/{id}",
])
const OPERATIONAL_METADATA_FIELDS = [
  "payment_attempt_id",
  "payment_intent_id",
  "checkout_completion_log_id",
  "webhook_event_log_id",
  "fulfillment_id",
  "order_id",
  "detector_code",
  "source_status",
  "operator_alert_code",
] as const
const FORBIDDEN_OPERATIONAL_METADATA_FIELDS = [
  "payload",
  "raw_payload",
  "body",
  "headers",
  "authorization",
  "cookie",
  "cookies",
  "token",
  "secret",
  "client_secret",
  "stripe_payload",
  "gelato_payload",
  "webhook_payload",
] as const
const GENERATED_STORE_SHA256 =
  "7b28ac8b3b8174b2e546f504fd1d9ee725c02d2aa2dbbe53e1dfecf3afc5329c"

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

type DocumentOperation = {
  security: Array<Record<string, string[]>>
  parameters?: Array<Record<string, unknown>>
  requestBody?: Record<string, unknown>
  responses: Record<string, Record<string, unknown>>
}

function documentOperations(
  paths: Record<string, Record<string, unknown>>
): Array<{ path: string; method: string; operation: DocumentOperation }> {
  const result: Array<{
    path: string
    method: string
    operation: DocumentOperation
  }> = []

  for (const [operationPath, pathItem] of Object.entries(paths)) {
    for (const [method, value] of Object.entries(pathItem)) {
      if (["get", "post", "put", "patch", "delete", "options", "head"].includes(method)) {
        result.push({
          path: operationPath,
          method: method.toUpperCase(),
          operation: value as DocumentOperation,
        })
      }
    }
  }
  return result
}

describe("OpenAPI Admin contract", () => {
  const registry = createFoundationRegistry()
  const contracts = buildContracts(registry)
  const adminContract = contracts.find((contract) => contract.surface === "admin")!
  const storeContract = contracts.find((contract) => contract.surface === "store")!
  const webhooksContract = contracts.find(
    (contract) => contract.surface === "webhooks"
  )!
  const admin = adminContract.document
  const operations = documentOperations(admin.paths as Record<string, Record<string, unknown>>)

  it("registers exactly the nine approved Admin operations", () => {
    expect(registry.getOperations("admin")).toHaveLength(9)
    expect(
      operations.map(({ method, path: operationPath }) => `${method} ${operationPath}`).sort()
    ).toEqual([...ADMIN_PATH_METHODS])
    expect(admin.paths).not.toHaveProperty("/admin/custom")
  })

  it("marks all nine Admin operations non-interactive with zero candidates", () => {
    const metadata = registry.getOperations("admin")
    expect(metadata.filter((operation) => operation.nonInteractive)).toHaveLength(9)
    expect(metadata.filter((operation) => operation.interactiveCandidate)).toHaveLength(0)
  })

  it("uses native bearer/session/Basic API-key alternatives only for products", () => {
    const schemes = admin.components.securitySchemes as Record<
      string,
      Record<string, unknown>
    >
    expect(schemes.adminBearer).toEqual(
      expect.objectContaining({ type: "http", scheme: "bearer" })
    )
    expect(schemes.adminSession).toEqual(
      expect.objectContaining({ type: "apiKey", in: "cookie", name: "connect.sid" })
    )
    expect(schemes.adminApiKey).toEqual(
      expect.objectContaining({ type: "http", scheme: "basic" })
    )

    for (const { path: operationPath, operation } of operations) {
      if (NATIVE_PRODUCT_PATHS.has(operationPath)) {
        expect(operation.security).toEqual([
          { adminBearer: [] },
          { adminSession: [] },
          { adminApiKey: [] },
        ])
      }
      if (USER_ONLY_PATHS.has(operationPath)) {
        expect(operation.security).toEqual([
          { adminBearer: [] },
          { adminSession: [] },
        ])
        expect(operation.security).not.toEqual(
          expect.arrayContaining([{ adminApiKey: [] }])
        )
      }
    }
  })

  it("documents the optional correlation request header on all operations", () => {
    for (const { operation } of operations) {
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "x-correlation-id",
            in: "header",
            required: false,
          }),
        ])
      )
    }
  })

  it("documents optional string fields only on the four native product operations", () => {
    for (const { path: operationPath, operation } of operations) {
      const fields = (operation.parameters ?? []).filter(
        (parameter) => parameter.name === "fields"
      )

      if (NATIVE_PRODUCT_PATHS.has(operationPath)) {
        expect(fields).toEqual([
          expect.objectContaining({
            name: "fields",
            in: "query",
            required: false,
            schema: { type: "string" },
          }),
        ])
      } else {
        expect(fields).toHaveLength(0)
      }
    }
  })

  it("models the early framework 401 as AdminUnauthorized without a correlation header", () => {
    expect(admin.components.schemas.AdminUnauthorized).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["message"],
      properties: {
        message: { type: "string", const: "Unauthorized" },
      },
    })

    for (const { operation } of operations) {
      const unauthorized = operation.responses["401"]
      expect(unauthorized).toBeDefined()
      expect(unauthorized).not.toHaveProperty("headers")
      expect(unauthorized).toEqual(
        expect.objectContaining({
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AdminUnauthorized" },
            },
          },
        })
      )
    }
  })

  it("omits the correlation guarantee from mixed 500 responses", () => {
    for (const { operation } of operations) {
      expect(operation.responses["500"]).toBeDefined()
      expect(operation.responses["500"]).not.toHaveProperty("headers")
      expect(operation.responses["500"]).toEqual(
        expect.objectContaining({
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AdminError" },
            },
          },
        })
      )
    }
  })

  it("attaches AdminXCorrelationId only to evidenced post-correlation statuses", () => {
    for (const { operation } of operations) {
      for (const [status, response] of Object.entries(operation.responses)) {
        if (["401", "500"].includes(status)) {
          expect(response).not.toHaveProperty("headers")
        } else {
          expect(response).toEqual(
            expect.objectContaining({
              headers: {
                "x-correlation-id": { $ref: ADMIN_HEADER_REF },
              },
            })
          )
        }
      }
    }

    const header = admin.components.headers.AdminXCorrelationId as {
      description: string
    }
    expect(header.description).toMatch(/early framework responses.*omit/i)
    expect(header.description).not.toMatch(/every response|always present/i)
  })

  it("uses only the evidenced status matrix", () => {
    const statuses = Object.fromEntries(
      operations.map(({ method, path: operationPath, operation }) => [
        `${method} ${operationPath}`,
        Object.keys(operation.responses).sort(),
      ])
    )
    expect(statuses).toEqual({
      "POST /admin/products": ["200", "400", "401", "500"],
      "POST /admin/products/{id}": ["200", "400", "401", "404", "500"],
      "POST /admin/products/{id}/variants": ["200", "400", "401", "404", "500"],
      "POST /admin/products/{id}/variants/{variant_id}": ["200", "400", "401", "404", "500"],
      "POST /admin/refunds/request": ["200", "201", "400", "401", "404", "500"],
      "POST /admin/exchanges": ["201", "400", "401", "404", "500"],
      "POST /admin/exchanges/{id}": ["200", "400", "401", "404", "500"],
      "GET /admin/operational-alerts": ["200", "400", "401", "500"],
      "GET /admin/operational-alerts/{id}": ["200", "400", "401", "404", "500"],
    })
    expect(JSON.stringify(statuses)).not.toMatch(/403|409|422/)
  })

  it("documents refund idempotency and integer BRL minor units", () => {
    const refund = admin.paths["/admin/refunds/request"] as {
      post: DocumentOperation
    }
    expect(Object.keys(refund.post.responses)).toEqual(
      expect.arrayContaining(["200", "201"])
    )

    const amount = admin.components.schemas.AdminBrlMinorAmount as Record<
      string,
      unknown
    >
    expect(amount).toEqual(
      expect.objectContaining({
        type: "integer",
        minimum: 1,
        "x-money-unit": "brl-minor",
      })
    )
    expect(amount.type).not.toBe("number")
  })

  it("documents exchange create/update as POST with 201/200", () => {
    const create = admin.paths["/admin/exchanges"] as {
      post: DocumentOperation
      patch?: unknown
    }
    const update = admin.paths["/admin/exchanges/{id}"] as {
      post: DocumentOperation
      patch?: unknown
    }
    expect(create.post.responses["201"]).toBeDefined()
    expect(update.post.responses["200"]).toBeDefined()
    expect(create.patch).toBeUndefined()
    expect(update.patch).toBeUndefined()
  })

  it("accepts only affected items with an effective runtime contribution", () => {
    const schema = admin.components.schemas.AdminExchangeAffectedItemRequest as {
      type: string
      additionalProperties: boolean
      properties: Record<
        string,
        { description?: string; oneOf: Array<Record<string, unknown>> }
      >
      anyOf: Array<{
        required: string[]
        properties: Record<string, Record<string, unknown>>
      }>
    }

    expect(schema.type).toBe("object")
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.quantity.oneOf).toEqual([
      { type: "integer", minimum: 1 },
      { type: "null" },
    ])
    expect(schema.anyOf).toEqual([
      {
        required: ["line_item_id"],
        properties: { line_item_id: { type: "string", minLength: 1 } },
      },
      {
        required: ["product_title"],
        properties: { product_title: { type: "string", minLength: 1 } },
      },
      {
        required: ["variant_title"],
        properties: { variant_title: { type: "string", minLength: 1 } },
      },
      {
        required: ["quantity"],
        properties: { quantity: { type: "integer", minimum: 1 } },
      },
    ])
    expect(schema.anyOf).toHaveLength(4)

    for (const field of ["line_item_id", "product_title", "variant_title"]) {
      expect(schema.properties[field].description).toMatch(
        /non-string values are ignored/i
      )
      expect(schema.properties[field].oneOf).toEqual(
        expect.arrayContaining([
          { type: "number" },
          { type: "boolean" },
          { type: "object", additionalProperties: true },
          { type: "array", items: {} },
        ])
      )
    }
  })

  it("accepts only exchange updates retained by runtime normalization", () => {
    const schema = admin.components.schemas.AdminExchangeUpdateRequest as {
      type: string
      additionalProperties: boolean
      properties: Record<
        string,
        { description?: string; oneOf?: Array<Record<string, unknown>> }
      >
      anyOf: Array<{
        required: string[]
        properties: Record<string, Record<string, unknown>>
      }>
    }

    expect(schema.type).toBe("object")
    expect(schema.additionalProperties).toBe(false)
    expect(schema.anyOf).toHaveLength(7)
    expect(schema.anyOf.map((branch) => branch.required)).toEqual([
      ["status"],
      ["customer_visible_note"],
      ["operator_note"],
      ["reverse_tracking_code"],
      ["reverse_authorization_code"],
      ["reverse_label_reference"],
      ["reverse_logistics_provider"],
    ])

    const providerBranch = schema.anyOf.find(
      (branch) => branch.required[0] === "reverse_logistics_provider"
    )
    expect(providerBranch).toEqual({
      required: ["reverse_logistics_provider"],
      properties: {
        reverse_logistics_provider: {
          oneOf: [
            {
              type: "string",
              enum: ["correios_manual", "other_manual"],
            },
            { type: "null" },
          ],
        },
      },
    })
    expect(schema.properties.reverse_logistics_provider.description).toMatch(
      /non-string values are ignored/i
    )
    expect(schema.properties.reverse_logistics_provider.oneOf).toEqual(
      expect.arrayContaining([
        { type: "number" },
        { type: "boolean" },
        { type: "object", additionalProperties: true },
        { type: "array", items: {} },
      ])
    )
  })

  it("keeps variant additional_data limited to top-level variant routes", () => {
    const createProduct = admin.components.schemas.AdminProductCreateRequest as {
      properties: { variants: { items: { $ref: string } } }
    }
    const updateProduct = admin.components.schemas.AdminProductUpdateRequest as {
      properties: { variants: { items: { $ref: string } } }
    }
    const nestedCreate = admin.components.schemas.AdminProductVariantCreateInput as {
      properties: Record<string, unknown>
    }
    const nestedUpdate = admin.components.schemas.AdminProductVariantUpdateInput as {
      properties: Record<string, unknown>
    }
    const topLevelCreate = admin.components.schemas.AdminProductVariantCreateRequest as {
      properties: Record<string, unknown>
    }
    const topLevelUpdate = admin.components.schemas.AdminProductVariantUpdateRequest as {
      properties: Record<string, unknown>
    }

    expect(createProduct.properties.variants.items.$ref).toBe(
      "#/components/schemas/AdminProductVariantCreateInput"
    )
    expect(updateProduct.properties.variants.items.$ref).toBe(
      "#/components/schemas/AdminProductVariantUpdateInput"
    )
    expect(nestedCreate.properties).not.toHaveProperty("additional_data")
    expect(nestedUpdate.properties).not.toHaveProperty("additional_data")
    expect(topLevelCreate.properties).toHaveProperty("additional_data")
    expect(topLevelUpdate.properties).toHaveProperty("additional_data")
  })

  it("documents the exact operational-alert query allowlist and pagination", () => {
    const list = admin.paths["/admin/operational-alerts"] as {
      get: DocumentOperation
    }
    const query = (list.get.parameters ?? []).filter(
      (parameter) => parameter.in === "query"
    )
    expect(query.map((parameter) => parameter.name)).toEqual([
      "type",
      "status",
      "severity",
      "entity_type",
      "entity_id",
      "last_seen_at_from",
      "last_seen_at_to",
      "limit",
      "offset",
    ])
    expect(query.find((parameter) => parameter.name === "limit")?.schema).toEqual(
      expect.objectContaining({ default: 20, maximum: 100 })
    )
    expect(query.find((parameter) => parameter.name === "offset")?.schema).toEqual(
      expect.objectContaining({ default: 0, minimum: 0 })
    )
  })

  it("exposes exactly the sanitized operational metadata scalar allowlist", () => {
    const metadata = admin.components.schemas.AdminOperationalAlertMetadata as {
      type: string
      additionalProperties: boolean
      description: string
      properties: Record<string, { type: string[] }>
    }

    expect(metadata.type).toBe("object")
    expect(metadata.additionalProperties).toBe(false)
    expect(Object.keys(metadata.properties)).toEqual(OPERATIONAL_METADATA_FIELDS)
    expect(Object.keys(metadata.properties)).toHaveLength(9)
    expect(metadata.description).toMatch(/sanitized/i)
    expect(metadata.description).toMatch(/explicitly allowlisted/i)
    expect(metadata.description).toMatch(/scalar diagnostic references/i)
    expect(metadata.description).toMatch(/not a raw payload/i)
    expect(metadata.description).toMatch(/headers/i)
    expect(metadata.description).toMatch(/secret/i)
    expect(metadata.description).toMatch(/not.*webhook-log resource/i)

    for (const property of Object.values(metadata.properties)) {
      expect(property).toEqual({ type: ["string", "number", "boolean"] })
      expect(property.type).not.toContain("null")
      expect(property.type).not.toContain("object")
      expect(property.type).not.toContain("array")
    }
    for (const field of FORBIDDEN_OPERATIONAL_METADATA_FIELDS) {
      expect(metadata.properties).not.toHaveProperty(field)
    }
  })

  it("does not expose audit, webhook-log, or generic metadata resources", () => {
    for (const forbiddenPath of [
      "/admin/audit",
      "/admin/audits",
      "/admin/action-logs",
      "/admin/admin-action-logs",
      "/admin/webhook-event-logs",
      "/admin/webhook-logs",
      "/admin/operational-alert-metadata",
      "/admin/metadata",
    ]) {
      expect(admin.paths).not.toHaveProperty(forbiddenPath)
    }
    for (const operationPath of Object.keys(admin.paths)) {
      expect(operationPath).not.toMatch(
        /\/admin\/(?:.*audit|.*webhook.*log|(?:operational-alert-)?metadata)(?:\/|$)/i
      )
    }
    expect(admin.components.schemas).not.toHaveProperty("AdminActionLog")
    expect(admin.components.schemas).not.toHaveProperty("WebhookEventLog")
  })

  it("is deterministic, preserves Admin/Webhooks bytes, and records the Store generation boundary", () => {
    const second = buildContracts(createFoundationRegistry())
    expect(
      second.find((contract) => contract.surface === "admin")?.bytes
    ).toBe(adminContract.bytes)

    const generatedDir = path.resolve(__dirname, "..", "generated")
    const committedStore = fs.readFileSync(
      path.join(generatedDir, "store.openapi.json"),
      "utf8"
    )
    const committedStoreDocument = JSON.parse(committedStore) as Pick<
      OpenApiDocument,
      "paths"
    >
    expect(
      registry
        .getOperations("store")
        .map((operation) => `${operation.method} ${operation.path}`)
    ).toEqual(
      expect.arrayContaining([
        "POST /store/customers/me/cart/merge",
        "POST /store/carts/{id}/review/acknowledge",
      ])
    )
    expect(
      storeContract.document.paths["/store/customers/me/cart/merge"]?.post
    ).toBeDefined()
    expect(
      storeContract.document.paths["/store/carts/{id}/review/acknowledge"]?.post
    ).toBeDefined()
    for (const schemaName of [
      "CartMergeRequest",
      "CartMergeOutcome",
      "CartMergeRejectedItem",
      "CartReviewState",
      "CartMergeResponse",
      "CartReviewAcknowledgeRequest",
      "CartReviewAcknowledgeResponse",
    ]) {
      expect(storeContract.document.components.schemas[schemaName]).toBeDefined()
    }
    expect(
      committedStoreDocument.paths["/store/customers/me/cart/merge"]?.post
    ).toEqual(expect.objectContaining({ operationId: "mergeCustomerCart" }))
    expect(
      committedStoreDocument.paths["/store/carts/{id}/review/acknowledge"]?.post
    ).toEqual(
      expect.objectContaining({ operationId: "acknowledgeCartReview" })
    )
    expect(sha256(committedStore)).toBe(GENERATED_STORE_SHA256)
    expect(storeContract.bytes).toBe(committedStore)
    expect(
      fs.readFileSync(path.join(generatedDir, "admin.openapi.json"), "utf8")
    ).toBe(adminContract.bytes)
    expect(webhooksContract.bytes).toBe(
      fs.readFileSync(path.join(generatedDir, "webhooks.openapi.json"), "utf8")
    )
  })
})
