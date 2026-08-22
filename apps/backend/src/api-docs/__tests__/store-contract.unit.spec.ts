import { CLIENT_MONEY_BODY_FIELDS } from "../../api/store/carts/payment-attempts/validators"
import { AUTH_HTTP_CONTRACT } from "../../api/auth-surface/contracts"
import { verifyCoverage } from "../coverage/verify-coverage"
import { STORE_DOCUMENTATION_AUTH_OPERATIONS } from "../coverage/verify-coverage"
import { ROUTE_EXCLUSIONS } from "../coverage/exclusions"
import { buildContracts } from "../generation/build-documents"
import { STORE_CUSTOMER_CART_ATTACH_SUPPORT_SCHEMAS } from "../operations/store/schemas"
import { createFoundationRegistry } from "../registry"
import { assertSafeExamples } from "../safe-examples"

const LEGACY_STORE_DOCUMENTATION_KEYS = [
  "GET /health/live",
  "GET /health/ready",
  "GET /store/carts/active",
  "GET /store/products",
  "GET /store/products/{id}",
  "POST /store/carts/active",
  "POST /store/carts/{id}/line-items",
  "POST /store/carts/{id}/line-items/{line_id}",
  "DELETE /store/carts/{id}/line-items/{line_id}",
  "DELETE /store/carts/{id}/line-items",
  "POST /store/carts/{id}/payment-attempts/card",
  "POST /store/carts/{id}/payment-attempts/pix",
  "POST /store/tracking/lookup",
] as const

const PHASE14_STORE_DOCUMENTATION_KEYS = AUTH_HTTP_CONTRACT.map(
  (entry) => `${entry.method} ${entry.path}`
)

const STORE_DOCUMENTATION_OPERATION_KEYS = [
  ...LEGACY_STORE_DOCUMENTATION_KEYS,
  ...PHASE14_STORE_DOCUMENTATION_KEYS,
].sort()

const STORE_DOCUMENT_PATHS = [
  "/health/live",
  "/health/ready",
  "/store/carts/active",
  "/store/carts/{id}/line-items",
  "/store/carts/{id}/line-items/{line_id}",
  ...AUTH_HTTP_CONTRACT.map((entry) => entry.path),
].sort()

describe("OpenAPI Store contract wave", () => {
  const registry = createFoundationRegistry()
  const storeOperations = registry.getOperations("store")
  const contracts = buildContracts(registry)
  const store = contracts.find((contract) => contract.surface === "store")

  it("covers every included Store route and both native catalog extensions", () => {
    expect(() => verifyCoverage("store", registry)).not.toThrow()
    expect(storeOperations).toHaveLength(25)
    expect(
      storeOperations.map((operation) => `${operation.method} ${operation.path}`).sort()
    ).toEqual(STORE_DOCUMENTATION_OPERATION_KEYS)
    expect(
      storeOperations.filter((operation) => operation.path.startsWith("/auth/"))
        .map((operation) => `${operation.method} ${operation.path}`)
        .sort()
    ).toEqual([...STORE_DOCUMENTATION_AUTH_OPERATIONS].sort())
    expect(
      storeOperations.some(
        (operation) =>
          operation.method === "POST" &&
          operation.path === "/store/customers/me/cart/attach"
      )
    ).toBe(false)
    expect(Object.keys(store?.document.paths ?? {}).sort()).toEqual(
      STORE_DOCUMENT_PATHS
    )
    expect(storeOperations.some((operation) => operation.path.startsWith("/store/")))
      .toBe(true)
  })

  it("documents exactly the six executable Cart M1 operations", () => {
    const cartM1 = storeOperations.filter((operation) =>
      [
        "GET /store/carts/active",
        "POST /store/carts/active",
        "POST /store/carts/{id}/line-items",
        "POST /store/carts/{id}/line-items/{line_id}",
        "DELETE /store/carts/{id}/line-items/{line_id}",
        "DELETE /store/carts/{id}/line-items",
      ].includes(`${operation.method} ${operation.path}`)
    )

    expect(cartM1).toHaveLength(6)
    expect(cartM1.map((operation) => operation.operationId).sort()).toEqual([
      "addCartLineItem",
      "clearCartLineItems",
      "createActiveStoreCart",
      "getActiveStoreCart",
      "removeCartLineItem",
      "updateCartLineItem",
    ])
    expect(cartM1.every((operation) => operation.interactiveCandidate === false)).toBe(
      true
    )
    expect(cartM1.every((operation) => operation.nonInteractive === true)).toBe(true)
  })

  it("requires BFF authority on every Cart M1 security alternative", () => {
    const cartM1Keys = new Set([
      "GET /store/carts/active",
      "POST /store/carts/active",
      "POST /store/carts/{id}/line-items",
      "POST /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items",
    ])
    const cartM1 = storeOperations.filter((operation) =>
      cartM1Keys.has(`${operation.method} ${operation.path}`)
    )
    const expectedSecurity = [
      { bffServiceCredential: [], publishableApiKey: [] },
      {
        bffServiceCredential: [],
        publishableApiKey: [],
        customerBearer: [],
      },
      {
        bffServiceCredential: [],
        publishableApiKey: [],
        customerSession: [],
      },
    ]

    expect(cartM1).toHaveLength(6)
    for (const operation of cartM1) {
      expect(operation.security).toHaveLength(3)
      expect(operation.security).toEqual(expectedSecurity)

      for (const requirement of operation.security) {
        expect(requirement).toHaveProperty("bffServiceCredential")
        expect(requirement).toHaveProperty("publishableApiKey")
        expect(
          Object.prototype.hasOwnProperty.call(
            requirement,
            "publishableApiKey"
          ) &&
            !Object.prototype.hasOwnProperty.call(
              requirement,
              "bffServiceCredential"
            )
        ).toBe(false)
        expect(
          Object.prototype.hasOwnProperty.call(requirement, "customerBearer") &&
            Object.prototype.hasOwnProperty.call(requirement, "customerSession")
        ).toBe(false)
      }
    }

    expect(cartM1[0]?.security[0]).toEqual({
      bffServiceCredential: [],
      publishableApiKey: [],
    })
    expect(cartM1[0]?.security[0]).not.toEqual(
      expect.objectContaining({
        customerBearer: expect.anything(),
        customerSession: expect.anything(),
      })
    )
    expect(cartM1[0]?.security[1]).toEqual({
      bffServiceCredential: [],
      publishableApiKey: [],
      customerBearer: [],
    })
    expect(cartM1[0]?.security[2]).toEqual({
      bffServiceCredential: [],
      publishableApiKey: [],
      customerSession: [],
    })
  })

  it("requires the optional guest capability request header on every Cart M1 operation", () => {
    const cartM1Keys = new Set([
      "GET /store/carts/active",
      "POST /store/carts/active",
      "POST /store/carts/{id}/line-items",
      "POST /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items",
    ])
    const cartM1 = storeOperations.filter((operation) =>
      cartM1Keys.has(`${operation.method} ${operation.path}`)
    )
    const guestParameterRef = {
      $ref: "#/components/parameters/XIndicioGuestCartToken",
    }

    expect(cartM1).toHaveLength(6)
    for (const operation of cartM1) {
      expect(operation.parameters).toEqual(
        expect.arrayContaining([guestParameterRef])
      )
    }

    const parameter = store?.document.components.parameters
      .XIndicioGuestCartToken as Record<string, unknown>
    expect(parameter).toEqual(
      expect.objectContaining({
        name: "x-indicio-guest-cart-token",
        in: "header",
        required: false,
        "x-bff-only": true,
        "x-not-browser-credential": true,
        "x-sensitive": true,
      })
    )
    expect(parameter).not.toHaveProperty("example")
    expect(parameter).not.toHaveProperty("examples")
  })

  it("emits the capability response header only for guest mint 201", () => {
    const activeGet = storeOperations.find(
      (operation) => operation.method === "GET" && operation.path === "/store/carts/active"
    )
    const activePost = storeOperations.find(
      (operation) => operation.method === "POST" && operation.path === "/store/carts/active"
    )
    const mutations = storeOperations.filter((operation) =>
      [
        "/store/carts/{id}/line-items",
        "/store/carts/{id}/line-items/{line_id}",
      ].includes(operation.path)
    )
    const capabilityHeader = "x-indicio-guest-cart-token"

    expect(activePost?.responses["201"]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          [capabilityHeader]: expect.any(Object),
        }),
      })
    )
    expect(activePost?.responses["200"]).not.toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ [capabilityHeader]: expect.anything() }),
      })
    )
    expect(activeGet?.responses["200"]).not.toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ [capabilityHeader]: expect.anything() }),
      })
    )
    for (const operation of mutations) {
      for (const response of Object.values(operation.responses)) {
        expect(response).not.toEqual(
          expect.objectContaining({
            headers: expect.objectContaining({ [capabilityHeader]: expect.anything() }),
          })
        )
      }
    }
  })

  it("documents mutation preconditions and the approved cart snapshot on 412", () => {
    const mutations = storeOperations.filter((operation) =>
      [
        "POST /store/carts/{id}/line-items",
        "POST /store/carts/{id}/line-items/{line_id}",
        "DELETE /store/carts/{id}/line-items/{line_id}",
        "DELETE /store/carts/{id}/line-items",
      ].includes(`${operation.method} ${operation.path}`)
    )

    for (const operation of mutations) {
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          { $ref: "#/components/parameters/IfMatch" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ])
      )
      expect(operation.responses["412"]).toEqual(
        expect.objectContaining({
          description: expect.stringMatching(/CART_VERSION_MISMATCH/),
          headers: {
            "x-correlation-id": {
              $ref: "#/components/headers/XCorrelationId",
            },
            ETag: {
              $ref: "#/components/headers/ETag",
            },
          },
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StoreErrorResponse" },
            },
          },
        })
      )
    }

    expect(store?.document.components.schemas.StoreErrorResponse).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          cart: expect.objectContaining({
            $ref: "#/components/schemas/PublicStoreCartPreOrder",
          }),
        }),
      })
    )
  })

  it("documents the active-cart 409 categories as public CONFLICT", () => {
    const activePost = storeOperations.find(
      (operation) =>
        operation.method === "POST" && operation.path === "/store/carts/active"
    )
    const conflict = activePost?.responses["409"]

    expect(conflict).toEqual(
      expect.objectContaining({
        description: expect.stringMatching(
          /CONFLICT.*semantic Idempotency-Key conflict.*operation currently in progress.*terminal replay\/reconciliation conflict/i
        ),
        headers: {
          "x-correlation-id": {
            $ref: "#/components/headers/XCorrelationId",
          },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/StoreErrorResponse" },
          },
        },
      })
    )
    expect(JSON.stringify(conflict)).not.toMatch(
      /IDEMPOTENCY_KEY_REUSE_CONFLICT|IDEMPOTENCY_KEY_IN_PROGRESS/
    )
  })

  it("passes the sensitive example walker without capability or token examples", () => {
    expect(() =>
      assertSafeExamples(store?.document, {
        isUnsafeExampleValue: (value) => /token|capability|pix|credential/i.test(value),
        errorMessage: "Sensitive OpenAPI example detected",
        rootLocation: "document",
      })
    ).not.toThrow()
  })

  it("omits ambiguous object and recursive catalog query parameters", () => {
    const catalog = storeOperations.filter((operation) =>
      ["/store/products", "/store/products/{id}"].includes(operation.path)
    )
    const omittedNames = [
      "created_at",
      "updated_at",
      "deleted_at",
      "variants",
      "$and",
      "$or",
      "variants[$and]",
      "variants[$or]",
    ]

    expect(catalog).toHaveLength(2)
    for (const operation of catalog) {
      const queryNames = (operation.parameters ?? [])
        .filter(
          (parameter): parameter is { name: string; in: string } =>
            typeof parameter === "object" &&
            parameter !== null &&
            "name" in parameter &&
            "in" in parameter &&
            (parameter as { in: string }).in === "query"
        )
        .map((parameter) => parameter.name)

      for (const omittedName of omittedNames) {
        expect(queryNames).not.toContain(omittedName)
      }
    }
  })

  it("documents explicit bracket leaves on both catalog operations", () => {
    const requiredLeaves = [
      "created_at[$gte]",
      "updated_at[$lte]",
      "deleted_at[$eq]",
      "variants[sku]",
      "variants[options][value]",
      "variants[created_at][$gte]",
      "variants[updated_at][$lte]",
      "variants[deleted_at][$eq]",
    ]

    for (const path of ["/store/products", "/store/products/{id}"]) {
      const operation = storeOperations.find((candidate) => candidate.path === path)
      const queryNames = (operation?.parameters ?? [])
        .filter(
          (parameter): parameter is { name: string; in: string } =>
            typeof parameter === "object" &&
            parameter !== null &&
            "name" in parameter &&
            "in" in parameter &&
            (parameter as { in: string }).in === "query"
        )
        .map((parameter) => parameter.name)

      expect(queryNames).toEqual(expect.arrayContaining(requiredLeaves))
    }
  })

  it("keeps explicitly excluded routes valid and undocumented", () => {
    expect(
      ROUTE_EXCLUSIONS.map((entry) => `${entry.method} ${entry.path}`).sort()
    ).toEqual(
      [
        "GET /admin/custom",
        "GET /store/custom",
        "POST /store/carts/{id}/complete",
        "POST /store/customers/me/cart/attach",
      ].sort()
    )
    expect(
      storeOperations.some(
        (operation) =>
          operation.path === "/store/custom" ||
          operation.path === "/admin/custom" ||
          operation.path === "/store/carts/{id}/complete" ||
          operation.path === "/store/customers/me/cart/attach"
      )
    ).toBe(false)
  })

  it("registers complete provenance metadata on every Store operation", () => {
    for (const operation of storeOperations) {
      expect(operation.operationId).toMatch(
        /^(?:store[A-Z].*|getActiveStoreCart|createActiveStoreCart|addCartLineItem|updateCartLineItem|removeCartLineItem|clearCartLineItems)$/
      )
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

  it("publishes the closed Store 1.1 transversal component foundation", () => {
    const document = store?.document
    const schemas = document?.components.schemas ?? {}
    const parameters = document?.components.parameters ?? {}
    const headers = document?.components.headers ?? {}
    const securitySchemes = document?.components.securitySchemes ?? {}

    expect(document?.info.version).toBe("1.1.0")
    expect(schemas.StoreErrorResponse).toEqual(
      expect.objectContaining({
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "retryable"],
      })
    )
    expect(parameters).toEqual(
      expect.objectContaining({
        IdempotencyKey: expect.objectContaining({ name: "Idempotency-Key" }),
        IfMatch: expect.objectContaining({ name: "If-Match" }),
        XCorrelationId: expect.objectContaining({ name: "x-correlation-id" }),
      })
    )
    expect(headers).toEqual(
      expect.objectContaining({
        ETag: expect.any(Object),
        XCorrelationId: expect.any(Object),
        RetryAfter: expect.any(Object),
      })
    )
    expect(schemas.StoreMajorMoney).toEqual(
      expect.objectContaining({ additionalProperties: false })
    )
    expect(schemas.StoreMinorMoney).toEqual(
      expect.objectContaining({ additionalProperties: false })
    )
    expect(JSON.stringify(schemas.StoreMajorMoney)).toMatch(/BRL.*major/)
    expect(JSON.stringify(schemas.StoreMinorMoney)).toMatch(/BRL.*minor/)

    for (const scheme of Object.values(securitySchemes) as Array<{
      description?: string
    }>) {
      expect(scheme.description).toMatch(/BFF|server-to-server/i)
      expect(scheme.description).toMatch(/browser/i)
    }
  })

  it("describes Idempotency-Key as retry identity and never as authority", () => {
    const parameter = store?.document.components.parameters.IdempotencyKey as {
      description?: string
    }
    expect(parameter.description).toMatch(/retry identity/i)
    expect(parameter.description).toMatch(/not authentication/i)
    expect(parameter.description).toMatch(/not authorization/i)
    expect(parameter.description).toMatch(/not ownership/i)
    expect(parameter.description).toMatch(/not (?:a )?capability/i)
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
    expect(CLIENT_MONEY_BODY_FIELDS).toEqual(
      expect.arrayContaining(["amount", "currency_code"])
    )
    expect(new Set(CLIENT_MONEY_BODY_FIELDS).size).toBe(
      CLIENT_MONEY_BODY_FIELDS.length
    )
  })

  it("retains attach support schemas without publishing attach path+method", () => {
    expect(store?.document.paths?.["/store/customers/me/cart/attach"]).toBeUndefined()
    expect(
      store?.document.components.schemas.StoreCustomerCartAttachRequest
    ).toBeUndefined()

    const attachSchema =
      STORE_CUSTOMER_CART_ATTACH_SUPPORT_SCHEMAS.StoreCustomerCartAttachRequest
    expect(
      (attachSchema as { additionalProperties?: boolean }).additionalProperties
    ).not.toBe(false)
    expect(
      (attachSchema as { required?: string[] }).required
    ).toBeUndefined()
    expect(attachSchema.properties.cart_id.type).toBe("string")
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

  it("maps cart access denial to 400 (not 403) on card and pix payment attempts", () => {
    const paymentAttemptPaths = [
      "/store/carts/{id}/payment-attempts/card",
      "/store/carts/{id}/payment-attempts/pix",
    ] as const

    for (const path of paymentAttemptPaths) {
      const operation = storeOperations.find(
        (candidate) =>
          candidate.method === "POST" && candidate.path === path
      )
      expect(operation).toBeDefined()

      const responseKeys = Object.keys(operation?.responses ?? {})
      expect(responseKeys).toEqual(
        expect.arrayContaining(["201", "400", "401", "404", "500"])
      )
      expect(responseKeys).not.toContain("403")
      expect(operation?.responses["400"]).toBeDefined()
      expect(operation?.responses["403"]).toBeUndefined()

      const registered400 = operation?.responses["400"] as {
        description?: string
      }
      expect(registered400?.description).toMatch(
        /access denied|ownership|access/i
      )

      expect(store?.document.paths?.[path]).toBeUndefined()
    }
  })

  it("documents StoreCatalogPrice.amount as integer", () => {
    const price = store?.document.components.schemas.StoreCatalogPrice as {
      properties?: {
        amount?: { type?: string; "x-money-unit"?: string }
      }
    }

    expect(price?.properties?.amount?.type).toBe("integer")
    expect(price?.properties?.amount?.["x-money-unit"]).toBe("brl-major")
  })
})
