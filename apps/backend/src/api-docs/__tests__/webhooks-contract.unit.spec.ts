import { buildContracts } from "../generation/build-documents"
import { createFoundationRegistry } from "../registry"

const WEBHOOK_HEADER_REF = "#/components/headers/WebhookXCorrelationId"
const STRIPE_EVENTS = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.refunded",
] as const
const INTERNAL_SCHEMA_NAMES = [
  "WebhookEventLog",
  "CheckoutCompletionLog",
  "PaymentAttempt",
  "GelatoFulfillment",
  "RefundRequest",
] as const
const OTHER_SURFACE_SCHEMES = [
  "publishableApiKey",
  "customerBearer",
  "customerSession",
  "adminBearer",
  "adminSession",
  "adminApiKey",
] as const

type Schema = {
  type?: string | string[]
  enum?: unknown[]
  const?: unknown
  required?: string[]
  properties?: Record<string, Schema>
  oneOf?: Schema[]
  not?: Schema
  items?: Schema
  pattern?: string
  minLength?: number
  uniqueItems?: boolean
  title?: string
  description?: string
  "x-supported-event-types"?: string[]
}

type DocumentOperation = {
  operationId: string
  description: string
  security: Array<Record<string, string[]>>
  parameters?: Array<Record<string, unknown>>
  requestBody?: {
    description?: string
    content: {
      "application/json": {
        schema: { $ref: string }
      }
    }
  }
  responses: Record<string, Record<string, unknown>>
}

function postOperation(
  paths: Record<string, unknown>,
  operationPath: string
): DocumentOperation {
  return (paths[operationPath] as { post: DocumentOperation }).post
}

function collectConfiguredValues(
  value: unknown,
  result: unknown[] = []
): unknown[] {
  if (!value || typeof value !== "object") {
    return result
  }

  for (const [key, child] of Object.entries(value)) {
    if (["example", "examples", "default", "const", "enum"].includes(key)) {
      result.push(child)
    }
    collectConfiguredValues(child, result)
  }
  return result
}

describe("OpenAPI Webhooks contract", () => {
  const registry = createFoundationRegistry()
  const contracts = buildContracts(registry)
  const webhooks = contracts.find(
    (contract) => contract.surface === "webhooks"
  )!.document
  const store = contracts.find((contract) => contract.surface === "store")!.document
  const admin = contracts.find((contract) => contract.surface === "admin")!.document
  const stripe = postOperation(webhooks.paths, "/hooks/stripe")
  const gelato = postOperation(webhooks.paths, "/hooks/gelato")
  const schemas = webhooks.components.schemas as Record<string, Schema>

  it("registers exactly two non-interactive webhook operations", () => {
    expect(registry.getOperations("webhooks")).toHaveLength(2)
    expect(Object.keys(webhooks.paths).sort()).toEqual([
      "/hooks/gelato",
      "/hooks/stripe",
    ])
    expect(stripe.operationId).toBe("webhookStripeReceive")
    expect(gelato.operationId).toBe("webhookGelatoReceive")

    const metadata = registry.getOperations("webhooks")
    expect(metadata.filter((operation) => operation.nonInteractive)).toHaveLength(2)
    expect(metadata.filter((operation) => operation.interactiveCandidate)).toHaveLength(0)
  })

  it("documents Stripe signature verification over the exact raw bytes", () => {
    expect(stripe.security).toEqual([{ stripeSignature: [] }])
    expect(webhooks.components.securitySchemes.stripeSignature).toEqual(
      expect.objectContaining({
        type: "apiKey",
        in: "header",
        name: "stripe-signature",
      })
    )
    expect(stripe.parameters ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "stripe-signature", in: "header" }),
      ])
    )

    const rawBodyDescription = stripe.requestBody?.description ?? ""
    expect(rawBodyDescription).toMatch(/exact preserved request bytes/i)
    expect(rawBodyDescription).toMatch(/signature verification/i)
    expect(rawBodyDescription).toMatch(/before provider event processing/i)
    expect(rawBodyDescription).toMatch(
      /parsed or reserialized JSON is not a substitute/i
    )
  })

  it("documents the exact Stripe event set and terminal-only replay short-circuit", () => {
    const request = schemas.StripeWebhookEventRequest
    expect(request.required).toEqual(["id", "type"])
    expect(request.required).not.toContain("data")
    expect(request.properties?.data?.required).toBeUndefined()
    expect(request.properties?.type["x-supported-event-types"]).toEqual([
      ...STRIPE_EVENTS,
    ])
    expect(stripe.description).toMatch(/verified unsupported event.*ignored/i)
    expect(stripe.description).toMatch(
      /payment_intent\.succeeded triggers the order-creation entrypoint after the payment-confirmation path/i
    )
    expect(stripe.description).toMatch(/charge\.refunded is informational/i)
    expect(stripe.description).toMatch(/not.*final source of financial truth/i)
    expect(stripe.description).toMatch(/terminal event replays.*stored status/i)
    expect(stripe.description).toMatch(
      /nonterminal or concurrent duplicate.*may continue processing/i
    )
    expect(stripe.description).not.toMatch(/all duplicates.*no-op/i)
  })

  it("documents Gelato canonical auth, timing behavior, and override exposure caveat", () => {
    expect(gelato.security).toEqual([{ gelatoWebhookSecret: [] }])
    expect(webhooks.components.securitySchemes.gelatoWebhookSecret).toEqual(
      expect.objectContaining({
        type: "apiKey",
        in: "header",
        name: "x-gelato-webhook-secret",
      })
    )
    expect(gelato.parameters ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "x-gelato-webhook-secret",
          in: "header",
        }),
      ])
    )
    expect(gelato.description).toMatch(/equal-length.*timingSafeEqual/i)
    expect(gelato.description).toMatch(/length mismatch rejects immediately/i)
    expect(gelato.description).toMatch(
      /entire rejection path is not claimed to be constant-time/i
    )
    expect(gelato.description).toContain("GELATO_WEBHOOK_AUTH_HEADER_NAME")
    expect(gelato.description).toContain(
      "The committed OpenAPI contract documents the canonical default header name. Future runtime exposure of this document must remain disabled when a configured header-name override would make the committed contract inaccurate."
    )
  })

  it("models only order_status_updated as the supported Gelato variant", () => {
    const request = schemas.GelatoWebhookRequest
    const supported = request.oneOf?.[0]
    const unsupported = request.oneOf?.[1]
    const eventPattern = "^\\s*order_status_updated\\s*$"
    const trimFieldNames = [
      "id",
      "orderId",
      "orderReferenceId",
      "fulfillmentStatus",
    ] as const

    expect(supported?.required).toEqual([
      "id",
      "event",
      "orderId",
      "orderReferenceId",
      "fulfillmentStatus",
    ])

    const supportedEvent = supported?.properties?.event
    expect(supportedEvent?.type).toBe("string")
    expect(supportedEvent?.pattern).toBe(eventPattern)
    expect(supportedEvent?.const).toBeUndefined()

    const unsupportedEvent = unsupported?.not?.properties?.event
    expect(unsupportedEvent?.type).toBe("string")
    expect(unsupportedEvent?.pattern).toBe(eventPattern)
    expect(unsupportedEvent?.const).toBeUndefined()
    expect(supportedEvent?.pattern).toBe(unsupportedEvent?.pattern)

    for (const field of trimFieldNames) {
      const property = supported?.properties?.[field]
      expect(property?.type).toBe("string")
      expect(property?.pattern).toBe("\\S")
      expect(property?.minLength).toBe(1)
    }

    const connectedOrderIds = supported?.properties?.connectedOrderIds
    expect(connectedOrderIds?.oneOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "null" }),
        expect.objectContaining({
          type: "array",
          items: expect.objectContaining({
            oneOf: expect.arrayContaining([
              expect.objectContaining({
                type: "string",
                pattern: "\\S",
              }),
              expect.objectContaining({
                not: { type: "string" },
              }),
            ]),
          }),
        }),
      ])
    )
    expect(connectedOrderIds?.uniqueItems).toBeUndefined()

    expect(request.properties?.id?.type).toBeUndefined()
    expect(request.properties?.connectedOrderIds?.oneOf).toBeUndefined()
    expect(request.properties?.connectedOrderIds?.type).toBeUndefined()

    expect(request.description).toMatch(/missing or unsupported event/i)
    expect(request.description).toMatch(/ignored without persistence/i)
    expect(request.description).toMatch(/null/i)
    expect(gelato.description).toMatch(/supports only order_status_updated/i)
    expect(gelato.description).toMatch(/final event replay.*without a new fulfillment update/i)
    expect(gelato.description).toMatch(/non-final duplicate.*may continue processing/i)
  })

  it("matches Gelato supported event pattern with optional surrounding whitespace", () => {
    const eventPattern = new RegExp(
      schemas.GelatoWebhookRequest.oneOf?.[0]?.properties?.event?.pattern ?? ""
    )

    for (const value of [
      "order_status_updated",
      " order_status_updated",
      "order_status_updated ",
      "\torder_status_updated\n",
    ]) {
      expect(eventPattern.test(value)).toBe(true)
    }

    for (const value of ["other_event", "", " ", "\t\n"]) {
      expect(eventPattern.test(value)).toBe(false)
    }
  })

  it("matches Gelato required trim field pattern for non-whitespace strings", () => {
    const trimPattern = new RegExp("\\S")
    const supported = schemas.GelatoWebhookRequest.oneOf?.[0]

    for (const field of ["id", "orderId", "orderReferenceId", "fulfillmentStatus"]) {
      const pattern = supported?.properties?.[field]?.pattern
      expect(pattern).toBe("\\S")
      expect(new RegExp(pattern ?? "").test("value")).toBe(true)
      expect(new RegExp(pattern ?? "").test(" value ")).toBe(true)
      expect(new RegExp(pattern ?? "").test("")).toBe(false)
      expect(new RegExp(pattern ?? "").test(" ")).toBe(false)
      expect(new RegExp(pattern ?? "").test("\t\n")).toBe(false)
    }

    expect(trimPattern.test("value")).toBe(true)
    expect(trimPattern.test(" value ")).toBe(true)
    expect(trimPattern.test("")).toBe(false)
    expect(trimPattern.test(" ")).toBe(false)
    expect(trimPattern.test("\t\n")).toBe(false)
  })

  it("matches Gelato connectedOrderIds string item pattern for non-whitespace strings", () => {
    const connectedOrderIds =
      schemas.GelatoWebhookRequest.oneOf?.[0]?.properties?.connectedOrderIds
    const stringBranch = connectedOrderIds?.oneOf?.[0]?.items?.oneOf?.[0]
    const pattern = new RegExp(stringBranch?.pattern ?? "")

    expect(stringBranch?.type).toBe("string")
    expect(stringBranch?.pattern).toBe("\\S")
    expect(pattern.test("value")).toBe(true)
    expect(pattern.test(" value ")).toBe(true)
    expect(pattern.test("")).toBe(false)
    expect(pattern.test(" ")).toBe(false)
    expect(pattern.test("\t\n")).toBe(false)
  })

  it("uses only the evidenced response statuses and webhook error envelopes", () => {
    expect(Object.keys(stripe.responses).sort()).toEqual(["200", "400", "500", "503"])
    expect(Object.keys(gelato.responses).sort()).toEqual([
      "200",
      "400",
      "401",
      "403",
      "500",
      "503",
    ])

    expect(schemas.WebhookErrorResponse).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["ok", "code"],
      properties: {
        ok: { type: "boolean", const: false },
        code: {
          type: "string",
          description: "Stable machine-readable webhook rejection code.",
        },
      },
    })
    expect(schemas.WebhookErrorResponse.properties).not.toHaveProperty("message")

    expect(schemas.WebhookFrameworkError).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["type", "message"],
      properties: {
        type: {
          type: "string",
          description: "Medusa or project error type code.",
        },
        message: {
          type: "string",
          description: "Human-readable sanitized error message.",
        },
        code: {
          type: ["string", "null"],
          description: "Optional machine-readable error code when present.",
        },
      },
    })
    expect(schemas.WebhookFrameworkError.properties).not.toHaveProperty("stack")
    expect(schemas.WebhookFrameworkError.properties).not.toHaveProperty("details")

    const stripe400Schema =
      stripe.responses["400"].content?.["application/json"]?.schema
    expect(stripe400Schema?.oneOf).toEqual([
      { $ref: "#/components/schemas/WebhookErrorResponse" },
      { $ref: "#/components/schemas/WebhookFrameworkError" },
    ])

    const gelato400Schema =
      gelato.responses["400"].content?.["application/json"]?.schema
    expect(gelato400Schema?.oneOf).toEqual([
      { $ref: "#/components/schemas/WebhookErrorResponse" },
      { $ref: "#/components/schemas/WebhookFrameworkError" },
    ])

    expect(stripe.responses["500"].content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/WebhookFrameworkError",
    })
    expect(stripe.responses["500"]).not.toHaveProperty("headers")

    expect(gelato.responses["500"].content?.["application/json"]?.schema).toEqual({
      $ref: "#/components/schemas/WebhookFrameworkError",
    })
    expect(gelato.responses["500"]).not.toHaveProperty("headers")
  })

  it("models acknowledgement status, duplicate, and Gelato ignored event_id omission", () => {
    for (const schemaName of [
      "StripeWebhookAcknowledgementResponse",
      "GelatoWebhookAcknowledgementResponse",
    ]) {
      const acknowledgement = schemas[schemaName]
      expect(acknowledgement.required).toEqual([
        "ok",
        "duplicate",
        "event_id",
        "event_type",
        "status",
      ])
      expect(acknowledgement.properties?.duplicate.type).toBe("boolean")
      expect(acknowledgement.properties?.event_id.type).toEqual([
        "string",
        "null",
      ])
      expect(acknowledgement.properties?.status.enum).toEqual([
        "processed",
        "ignored",
        "failed",
      ])
    }

    const ignored = schemas.GelatoWebhookIgnoredResponse
    expect(ignored.required).not.toContain("event_id")
    expect(ignored.properties).not.toHaveProperty("event_id")
    expect(ignored.properties?.duplicate.const).toBe(false)
    expect(ignored.properties?.status.const).toBe("ignored")
    expect(ignored.properties?.code.const).toBe(
      "gelato_webhook_event_unsupported"
    )
  })

  it("documents Stripe account as optional nullable string", () => {
    const request = schemas.StripeWebhookEventRequest
    expect(request.properties?.account?.type).toEqual(["string", "null"])
    expect(request.required).not.toContain("account")
  })

  it("attaches the webhook correlation header per documented response matrix", () => {
    expect(webhooks.components.headers.WebhookXCorrelationId).toEqual(
      expect.objectContaining({
        schema: { type: "string" },
        description: expect.stringMatching(/post-correlation/i),
      })
    )

    const correlationHeader = {
      "x-correlation-id": { $ref: WEBHOOK_HEADER_REF },
    }

    const stripeMatrix: Record<string, boolean> = {
      "200": true,
      "400": true,
      "500": false,
      "503": true,
    }
    for (const [status, expectsHeader] of Object.entries(stripeMatrix)) {
      const response = stripe.responses[status]
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
      const response = gelato.responses[status]
      if (expectsHeader) {
        expect(response).toEqual(
          expect.objectContaining({ headers: correlationHeader })
        )
      } else {
        expect(response).not.toHaveProperty("headers")
      }
    }
  })

  it("includes order-creation integration test in Stripe webhook testEvidence", () => {
    const stripeMetadata = registry
      .getOperations("webhooks")
      .find((operation) => operation.path === "/hooks/stripe")
    expect(stripeMetadata?.testEvidence).toContain(
      "apps/backend/integration-tests/http/stripe-webhook-order-creation.spec.ts"
    )
  })

  it("contains no usable secret or signature examples in configured values", () => {
    const configured = JSON.stringify(collectConfiguredValues(webhooks))
    expect(configured).not.toMatch(/\bsk_(?:live|test)_[A-Za-z0-9_-]+/i)
    expect(configured).not.toMatch(/\bwhsec_[A-Za-z0-9_-]+/i)
    expect(configured).not.toMatch(/\bBearer\s+[A-Za-z0-9._~-]+/i)
    expect(configured).not.toMatch(/pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/i)
    expect(JSON.stringify(webhooks)).not.toMatch(/"(?:example|examples)"\s*:/i)
  })

  it("does not expose internal persistence models or leak other surfaces", () => {
    for (const name of INTERNAL_SCHEMA_NAMES) {
      expect(webhooks.components.schemas).not.toHaveProperty(name)
    }
    expect(Object.keys(webhooks.paths).every((path) => path.startsWith("/hooks/"))).toBe(true)
    expect(Object.keys(store.paths).some((path) => path.startsWith("/hooks/"))).toBe(false)
    expect(Object.keys(admin.paths).some((path) => path.startsWith("/hooks/"))).toBe(false)

    for (const scheme of OTHER_SURFACE_SCHEMES) {
      expect(webhooks.components.securitySchemes).not.toHaveProperty(scheme)
    }
    expect(store.components.securitySchemes).not.toHaveProperty("stripeSignature")
    expect(store.components.securitySchemes).not.toHaveProperty("gelatoWebhookSecret")
    expect(admin.components.securitySchemes).not.toHaveProperty("stripeSignature")
    expect(admin.components.securitySchemes).not.toHaveProperty("gelatoWebhookSecret")
  })
})
