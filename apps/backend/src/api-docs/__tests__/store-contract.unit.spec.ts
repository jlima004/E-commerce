import Ajv from "ajv"
import { CLIENT_MONEY_BODY_FIELDS } from "../../api/store/carts/payment-attempts/validators"
import { verifyCoverage } from "../coverage/verify-coverage"
import { ROUTE_EXCLUSIONS } from "../coverage/exclusions"
import { buildContracts } from "../generation/build-documents"
import { createFoundationRegistry } from "../registry"

describe("OpenAPI Store contract wave", () => {
  const registry = createFoundationRegistry()
  const storeOperations = registry.getOperations("store")
  const contracts = buildContracts(registry)
  const store = contracts.find((contract) => contract.surface === "store")

  it("covers every included Store route and both native catalog extensions", () => {
    expect(() => verifyCoverage("store", registry)).not.toThrow()
    expect(
      storeOperations.map((operation) => `${operation.method} ${operation.path}`).sort()
    ).toEqual(
      [
        "GET /health/live",
        "GET /health/ready",
        "GET /store/carts/active",
        "GET /store/products",
        "GET /store/products/{id}",
        "POST /store/carts/active",
        "POST /store/carts/{id}/payment-attempts/card",
        "POST /store/carts/{id}/payment-attempts/pix",
        "POST /store/customers/me/cart/attach",
        "POST /store/tracking/lookup",
      ].sort()
    )
  })

  it("keeps the two scaffold exclusions valid and undocumented", () => {
    expect(
      ROUTE_EXCLUSIONS.map((entry) => `${entry.method} ${entry.path}`).sort()
    ).toEqual(["GET /admin/custom", "GET /store/custom"])
    expect(
      storeOperations.some(
        (operation) =>
          operation.path === "/store/custom" || operation.path === "/admin/custom"
      )
    ).toBe(false)
  })

  it("registers complete provenance metadata on every Store operation", () => {
    for (const operation of storeOperations) {
      expect(operation.operationId).toMatch(/^store[A-Z]/)
      expect(operation.summary.trim().length).toBeGreaterThan(0)
      expect(operation.tags.length).toBeGreaterThan(0)
      expect(operation.sourceFiles.length).toBeGreaterThan(0)
      expect(operation.testEvidence.length).toBeGreaterThan(0)
      expect(operation.officialReference.trim().length).toBeGreaterThan(0)
      expect(operation.inclusionReason.trim().length).toBeGreaterThan(0)
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0)
      expect(operation.nonInteractive).toBe(true)
    }
  })

  it("classifies native Store catalog extensions correctly", () => {
    const native = storeOperations.filter((operation) =>
      ["/store/products", "/store/products/{id}"].includes(operation.path)
    )
    expect(native).toHaveLength(2)
    expect(
      native.every(
        (operation) => operation.sourceClassification === "project-extension"
      )
    ).toBe(true)
    expect(
      native.every((operation) =>
        operation.officialReference.includes(
          "github.com/medusajs/medusa/blob/v2.16.0/"
        )
      )
    ).toBe(true)
  })

  it("documents path and query parameters for catalog and payment routes", () => {
    const list = storeOperations.find(
      (operation) => operation.path === "/store/products"
    )
    const retrieve = storeOperations.find(
      (operation) => operation.path === "/store/products/{id}"
    )
    const card = storeOperations.find(
      (operation) =>
        operation.path === "/store/carts/{id}/payment-attempts/card"
    )

    expect(list?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "limit", in: "query" }),
        expect.objectContaining({ name: "offset", in: "query" }),
      ])
    )
    expect(retrieve?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", required: true }),
      ])
    )
    expect(card?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", required: true }),
      ])
    )
  })

  it("documents evidenced success status codes for carts, payments, and health", () => {
    const activePost = storeOperations.find(
      (operation) =>
        operation.method === "POST" && operation.path === "/store/carts/active"
    )
    const card = storeOperations.find(
      (operation) =>
        operation.path === "/store/carts/{id}/payment-attempts/card"
    )
    const ready = storeOperations.find(
      (operation) => operation.path === "/health/ready"
    )

    expect(Object.keys(activePost?.responses ?? {}).sort()).toEqual(
      expect.arrayContaining(["200", "201"])
    )
    expect(Object.keys(card?.responses ?? {})).toContain("201")
    expect(Object.keys(ready?.responses ?? {}).sort()).toEqual(
      expect.arrayContaining(["200", "503"])
    )
  })

  it("generates deterministic Store bytes without absolute paths or secrets", () => {
    const again = buildContracts(registry).find(
      (contract) => contract.surface === "store"
    )
    expect(store?.bytes).toBe(again?.bytes)
    expect(store?.bytes).not.toMatch(/\/home\/|\/Users\/|\\/)
    expect(store?.bytes).not.toMatch(/sk_(?:live|test)_|whsec_|Bearer\s+\w{8,}/)
    expect(store?.document.components.schemas.PublicStoreCatalogProduct).toBeDefined()
    expect(store?.document.components.schemas.PublicStoreCartPreOrder).toBeDefined()
    expect(
      store?.document.components.schemas.StorePaymentAttemptAmountMinor
    ).toBeDefined()
  })

  it("does not register Admin or Webhook operations in the Store registry", () => {
    expect(
      storeOperations.some(
        (operation) =>
          operation.path.startsWith("/admin/") ||
          operation.path.startsWith("/hooks/")
      )
    ).toBe(false)
    expect(Object.keys(store?.document.paths ?? {}).some((path) =>
      path.startsWith("/admin/")
    )).toBe(false)
    expect(Object.keys(store?.document.paths ?? {}).some((path) =>
      path.startsWith("/hooks/")
    )).toBe(false)
  })

  it("documents optional shared request bodies for card and pix payment starts", () => {
    const card = storeOperations.find(
      (operation) =>
        operation.path === "/store/carts/{id}/payment-attempts/card"
    )
    const pix = storeOperations.find(
      (operation) =>
        operation.path === "/store/carts/{id}/payment-attempts/pix"
    )
    const startSchema = store?.document.components.schemas
      .StorePaymentAttemptStartRequest as {
      type?: string
      description?: string
      additionalProperties?: boolean
      propertyNames?: { not?: { enum?: string[] } }
      properties?: Record<string, unknown>
      required?: string[]
    }

    expect(card?.requestBody).not.toBeNull()
    expect(pix?.requestBody).not.toBeNull()
    expect(card?.requestBody).toEqual(
      expect.objectContaining({
        required: false,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/StorePaymentAttemptStartRequest",
            },
          },
        },
      })
    )
    expect(pix?.requestBody).toEqual(
      expect.objectContaining({
        required: false,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/StorePaymentAttemptStartRequest",
            },
          },
        },
      })
    )

    expect(startSchema?.type).toBe("object")
    expect(startSchema?.additionalProperties).toBe(true)
    expect(startSchema?.required).toBeUndefined()
    expect(startSchema?.properties).toBeUndefined()
    expect(startSchema?.description).toMatch(
      /client money|rejectClientMoneyFields/i
    )
    expect(startSchema?.propertyNames?.not?.enum).toEqual([
      ...CLIENT_MONEY_BODY_FIELDS,
    ])

    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile({
      type: startSchema?.type,
      propertyNames: startSchema?.propertyNames,
      additionalProperties: startSchema?.additionalProperties,
    })

    expect(validate({})).toBe(true)
    expect(validate({ arbitrary_non_money_field: true })).toBe(true)

    for (const field of CLIENT_MONEY_BODY_FIELDS) {
      expect(validate({ [field]: 1 })).toBe(false)
    }
    expect(validate({ amount: 1090 })).toBe(false)
    expect(validate({ currency_code: "BRL" })).toBe(false)
  })

  it("keeps attach request cart_id optional without additionalProperties:false", () => {
    const attachSchema = store?.document.components.schemas
      .StoreCustomerCartAttachRequest as {
      additionalProperties?: boolean
      properties?: { cart_id?: { type?: string } }
      required?: string[]
    }

    expect(attachSchema?.additionalProperties).not.toBe(false)
    expect(attachSchema?.required).toBeUndefined()
    expect(attachSchema?.properties?.cart_id?.type).toBe("string")
  })

  it("documents synchronous PaymentAttempt status consts for card and pix", () => {
    const card = store?.document.components.schemas
      .StoreCardPaymentAttemptResponse as {
      properties?: { status?: { const?: string; enum?: string[] } }
    }
    const pix = store?.document.components.schemas
      .StorePixPaymentAttemptResponse as {
      properties?: { status?: { const?: string; enum?: string[] } }
    }

    expect(card?.properties?.status).toEqual({
      type: "string",
      const: "card_client_secret_created",
    })
    expect(pix?.properties?.status).toEqual({
      type: "string",
      const: "awaiting_pix_payment",
    })
  })

  it("documents StoreCatalogPrice.amount as integer", () => {
    const price = store?.document.components.schemas.StoreCatalogPrice as {
      properties?: { amount?: { type?: string } }
    }

    expect(price?.properties?.amount?.type).toBe("integer")
  })
})
