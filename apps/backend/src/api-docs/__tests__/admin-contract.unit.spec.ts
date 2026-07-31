import fs from "fs"
import path from "path"
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

  it("does not expose audit endpoints or internal model schemas", () => {
    for (const forbiddenPath of [
      "/admin/audit",
      "/admin/audits",
      "/admin/action-logs",
      "/admin/admin-action-logs",
    ]) {
      expect(admin.paths).not.toHaveProperty(forbiddenPath)
    }
    expect(admin.components.schemas).not.toHaveProperty("AdminActionLog")
    expect(admin.components.schemas).not.toHaveProperty("WebhookEventLog")
  })

  it("is deterministic and preserves committed Store/Webhooks bytes", () => {
    const second = buildContracts(createFoundationRegistry())
    expect(
      second.find((contract) => contract.surface === "admin")?.bytes
    ).toBe(adminContract.bytes)

    const generatedDir = path.resolve(__dirname, "..", "generated")
    expect(storeContract.bytes).toBe(
      fs.readFileSync(path.join(generatedDir, "store.openapi.json"), "utf8")
    )
    expect(webhooksContract.bytes).toBe(
      fs.readFileSync(path.join(generatedDir, "webhooks.openapi.json"), "utf8")
    )
  })
})
