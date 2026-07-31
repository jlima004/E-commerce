import { buildContracts } from "../generation/build-documents"
import { createFoundationRegistry } from "../registry"

const X_CORRELATION_ID_HEADER_REF = "#/components/headers/XCorrelationId"
const WEBHOOK_X_CORRELATION_ID_HEADER_REF =
  "#/components/headers/WebhookXCorrelationId"

describe("OpenAPI Store security contract and surface isolation", () => {
  const registry = createFoundationRegistry()
  const storeOperations = registry.getOperations("store")
  const contracts = buildContracts(registry)
  const storeDocument = contracts.find(
    (contract) => contract.surface === "store"
  )?.document
  const adminDocument = contracts.find(
    (contract) => contract.surface === "admin"
  )?.document
  const webhooksDocument = contracts.find(
    (contract) => contract.surface === "webhooks"
  )?.document

  it("registers populated and isolated Store, Admin, and Webhooks surfaces", () => {
    expect(storeOperations).toHaveLength(10)
    expect(registry.getOperations("admin")).toHaveLength(9)
    expect(registry.getOperations("webhooks")).toHaveLength(2)

    expect(Object.keys(adminDocument?.paths ?? {})).toHaveLength(9)
    expect(Object.keys(webhooksDocument?.paths ?? {}).sort()).toEqual([
      "/hooks/gelato",
      "/hooks/stripe",
    ])
  })

  it("marks every Store operation non-interactive and preserves four candidates", () => {
    expect(storeOperations.every((operation) => operation.nonInteractive)).toBe(
      true
    )
    const candidates = storeOperations.filter(
      (operation) => operation.interactiveCandidate
    )
    expect(candidates.map((operation) => `${operation.method} ${operation.path}`).sort()).toEqual(
      [
        "GET /health/live",
        "GET /health/ready",
        "GET /store/products",
        "GET /store/products/{id}",
      ]
    )
  })

  it("documents health checks as public Infrastructure operations", () => {
    const health = storeOperations.filter((operation) =>
      operation.path.startsWith("/health/")
    )
    expect(health).toHaveLength(2)
    for (const operation of health) {
      expect(operation.tags).toEqual(["Infrastructure"])
      expect(operation.security).toEqual([])
    }
  })

  it("requires publishable API key on Store business routes", () => {
    const business = storeOperations.filter(
      (operation) => !operation.path.startsWith("/health/")
    )
    for (const operation of business) {
      expect(
        operation.security.some((requirement) =>
          Object.prototype.hasOwnProperty.call(requirement, "publishableApiKey")
        )
      ).toBe(true)
    }
  })

  it("requires customer auth alternatives only on cart attach", () => {
    const attach = storeOperations.find(
      (operation) => operation.path === "/store/customers/me/cart/attach"
    )
    expect(attach?.security).toEqual([
      { publishableApiKey: [], customerBearer: [] },
      { publishableApiKey: [], customerSession: [] },
    ])

    const optionalCustomer = storeOperations.filter((operation) =>
      [
        "/store/products",
        "/store/products/{id}",
        "/store/carts/active",
        "/store/carts/{id}/payment-attempts/card",
        "/store/carts/{id}/payment-attempts/pix",
      ].includes(operation.path)
    )
    for (const operation of optionalCustomer) {
      expect(operation.security).toEqual(
        expect.arrayContaining([{ publishableApiKey: [] }])
      )
      expect(operation.security.length).toBeGreaterThan(1)
    }
  })

  it("keeps tracking token out of path/query and omits usable token examples", () => {
    const tracking = storeOperations.find(
      (operation) => operation.path === "/store/tracking/lookup"
    )
    expect(tracking?.parameters).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ name: "token", in: "query" }),
        expect.objectContaining({ name: "token", in: "path" }),
      ])
    )
    expect(tracking?.requestBody).toEqual(
      expect.objectContaining({
        required: true,
      })
    )

    const serialized = JSON.stringify(storeDocument)
    expect(serialized).not.toMatch(/"token"\s*:\s*"[^"]{8,}"/)
    expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9._~-]{8,}/)
    expect(serialized).not.toMatch(/pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/)
  })

  it("keeps all security schemes surface-local", () => {
    expect(
      Object.keys(storeDocument?.components.securitySchemes ?? {}).sort()
    ).toEqual(["customerBearer", "customerSession", "publishableApiKey"])

    expect(
      Object.keys(adminDocument?.components.securitySchemes ?? {}).sort()
    ).toEqual(["adminApiKey", "adminBearer", "adminSession"])
    expect(
      Object.keys(webhooksDocument?.components.securitySchemes ?? {}).sort()
    ).toEqual(["gelatoWebhookSecret", "stripeSignature"])
    expect(storeDocument?.components.securitySchemes).not.toHaveProperty("adminBearer")
    expect(adminDocument?.components.securitySchemes).not.toHaveProperty("customerBearer")
    expect(storeDocument?.components.securitySchemes).not.toHaveProperty(
      "stripeSignature"
    )
    expect(adminDocument?.components.securitySchemes).not.toHaveProperty(
      "gelatoWebhookSecret"
    )
    expect(webhooksDocument?.components.securitySchemes).not.toHaveProperty(
      "publishableApiKey"
    )
    expect(webhooksDocument?.components.securitySchemes).not.toHaveProperty(
      "adminBearer"
    )
  })

  it("documents customerSession as the connect.sid cookie", () => {
    const customerSession =
      storeDocument?.components.securitySchemes?.customerSession
    expect(customerSession).toEqual(
      expect.objectContaining({
        type: "apiKey",
        in: "cookie",
        name: "connect.sid",
      })
    )
  })

  it("registers distinct Store, Admin, and Webhooks correlation response headers", () => {
    const storeHeaders = (
      storeDocument?.components as { headers?: Record<string, unknown> }
    ).headers
    expect(storeHeaders?.XCorrelationId).toEqual(
      expect.objectContaining({
        schema: { type: "string" },
        description: expect.stringMatching(/correlation/i),
      })
    )
    expect(storeHeaders?.XCorrelationId).not.toHaveProperty("example")
    expect(storeHeaders?.XCorrelationId).not.toHaveProperty("examples")

    const adminHeaders = (
      adminDocument?.components as { headers?: Record<string, unknown> }
    ).headers
    expect(adminHeaders?.AdminXCorrelationId).toEqual(
      expect.objectContaining({
        schema: { type: "string" },
        description: expect.stringMatching(/early framework responses.*omit/i),
      })
    )
    expect(adminHeaders?.XCorrelationId).toBeUndefined()
    expect(storeHeaders?.AdminXCorrelationId).toBeUndefined()
    const webhookHeaders = (
      webhooksDocument?.components as { headers?: Record<string, unknown> }
    ).headers
    expect(webhookHeaders?.WebhookXCorrelationId).toEqual(
      expect.objectContaining({
        schema: { type: "string" },
        description: expect.stringMatching(/post-correlation/i),
      })
    )
    expect(webhookHeaders?.XCorrelationId).toBeUndefined()
    expect(webhookHeaders?.AdminXCorrelationId).toBeUndefined()
    expect(storeHeaders?.WebhookXCorrelationId).toBeUndefined()
    expect(adminHeaders?.WebhookXCorrelationId).toBeUndefined()
  })

  it("makes both webhook operations explicit, secured, and non-interactive", () => {
    const metadata = registry.getOperations("webhooks")
    expect(metadata).toHaveLength(2)
    expect(metadata.every((operation) => operation.nonInteractive)).toBe(true)
    expect(metadata.every((operation) => !operation.interactiveCandidate)).toBe(
      true
    )
    expect(metadata.map((operation) => operation.security)).toEqual([
      [{ stripeSignature: [] }],
      [{ gelatoWebhookSecret: [] }],
    ])

    const configured = JSON.stringify(webhooksDocument)
    expect(configured).not.toMatch(/\bsk_(?:live|test)_[A-Za-z0-9_-]+/i)
    expect(configured).not.toMatch(/\bwhsec_[A-Za-z0-9_-]+/i)
    expect(configured).not.toMatch(/Bearer\s+[A-Za-z0-9._~-]{8,}/i)

    const stripePost = (
      webhooksDocument?.paths?.["/hooks/stripe"] as {
        post: { responses: Record<string, Record<string, unknown>> }
      }
    ).post
    const gelatoPost = (
      webhooksDocument?.paths?.["/hooks/gelato"] as {
        post: { responses: Record<string, Record<string, unknown>> }
      }
    ).post

    const correlationHeader = {
      "x-correlation-id": {
        $ref: WEBHOOK_X_CORRELATION_ID_HEADER_REF,
      },
    }

    const stripeMatrix: Record<string, boolean> = {
      "200": true,
      "400": true,
      "500": false,
      "503": true,
    }
    for (const [status, expectsHeader] of Object.entries(stripeMatrix)) {
      const response = stripePost.responses[status]
      if (expectsHeader) {
        expect(response).toEqual(
          expect.objectContaining({ headers: correlationHeader })
        )
      } else {
        expect(response).not.toHaveProperty("headers")
      }
    }

    const gelatoMatrix: Record<string, boolean> = {
      "200": true,
      "400": true,
      "401": true,
      "403": true,
      "500": false,
      "503": true,
    }
    for (const [status, expectsHeader] of Object.entries(gelatoMatrix)) {
      const response = gelatoPost.responses[status]
      if (expectsHeader) {
        expect(response).toEqual(
          expect.objectContaining({ headers: correlationHeader })
        )
      } else {
        expect(response).not.toHaveProperty("headers")
      }
    }
  })

  it("attaches x-correlation-id header $ref on every Store response", () => {
    const paths = storeDocument?.paths ?? {}
    let responseCount = 0

    for (const pathItem of Object.values(paths)) {
      for (const operation of Object.values(pathItem as Record<string, unknown>)) {
        if (!operation || typeof operation !== "object") {
          continue
        }
        const responses = (operation as { responses?: Record<string, unknown> })
          .responses
        if (!responses) {
          continue
        }
        for (const response of Object.values(responses)) {
          responseCount += 1
          expect(response).toEqual(
            expect.objectContaining({
              headers: {
                "x-correlation-id": {
                  $ref: X_CORRELATION_ID_HEADER_REF,
                },
              },
            })
          )
        }
      }
    }

    expect(responseCount).toBeGreaterThan(0)
  })

  it("omits concrete correlation id example values from the Store document", () => {
    const serialized = JSON.stringify(storeDocument)
    expect(serialized).not.toMatch(
      /"example"\s*:\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/i
    )
    expect(serialized).not.toMatch(
      /"x-correlation-id"[^}]*"example"\s*:\s*"[^"]+"/i
    )
  })
})
