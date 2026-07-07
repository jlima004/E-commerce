import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PAYMENT_ATTEMPT_MODULE } from "../../../../modules/payment-attempt"
import { WEBHOOKS_MODULE } from "../../../../modules/webhooks"
import { createStripeWebhookPostHandler } from "../route"

type RequestWithRawBody = MedusaRequest & {
  rawBody?: Buffer | string
  correlationId?: string
}

type WebhookRecord = {
  id: string
  provider: string
  external_event_id: string | null
  deduplication_key: string
  event_type: string
  status: string
  error_code?: string | null
  error_message?: string | null
}

const WEBHOOK_SECRET_PLACEHOLDER = ["webhook", "secret", "placeholder"].join("_")

function createResponse() {
  const response = {
    statusCode: 200,
    status: jest.fn(function status(code: number) {
      response.statusCode = code
      return response
    }),
    json: jest.fn(function json(body: unknown) {
      return body
    }),
  }

  return response as MedusaResponse & {
    statusCode: number
    status: jest.Mock
    json: jest.Mock
  }
}

function createWebhookService(records: WebhookRecord[] = []) {
  return {
    listWebhookEventLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return records.filter((record) => {
        return (
          (!filters?.provider || record.provider === filters.provider) &&
          (!filters?.deduplication_key ||
            record.deduplication_key === filters.deduplication_key)
        )
      })
    }),
    createWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const record = {
        id: `whlog_${records.length + 1}`,
        provider: row.provider,
        external_event_id: row.external_event_id ?? null,
        deduplication_key: row.deduplication_key,
        event_type: row.event_type,
        status: row.status ?? "received",
      }
      records.push(record)
      return [record]
    }),
    updateWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = records.findIndex((record) => record.id === row.id)

      if (index >= 0) {
        records[index] = {
          ...records[index],
          ...row,
        }
      }

      return index >= 0 ? [records[index]] : []
    }),
  }
}

function createPaymentAttemptService(orderId: string | null = null) {
  const records = [
    {
      id: "payatt_route_01",
      cart_id: "cart_route_01",
      payment_collection_id: "paycol_route_01",
      payment_session_id: "payses_route_01",
      provider: "stripe",
      provider_payment_intent_id: "pi_route_123",
      provider_payment_session_id: "ps_route_123",
      payment_method_type: "card",
      status: orderId
        ? "payment_confirmed_by_webhook"
        : "awaiting_webhook_confirmation",
      amount: 9900,
      currency_code: "brl",
      expires_at: null,
      order_id: orderId,
      metadata: null,
      client_confirmed_at: null,
      instructions_displayed_at: null,
      awaiting_webhook_since: "2026-07-07T10:00:00.000Z",
      superseded_at: null,
      invalidated_at: null,
      canceled_at: null,
      failed_at: null,
      expired_at: null,
      created_at: "2026-07-07T09:00:00.000Z",
      updated_at: "2026-07-07T09:00:00.000Z",
    },
  ]

  return {
    listPaymentAttempts: jest.fn(async () => records),
    updatePaymentAttempts: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      records[0] = {
        ...records[0],
        ...row,
      }
      return [records[0]]
    }),
    records,
  }
}

function createSucceededPaymentIntentEvent() {
  return {
    id: "evt_route_123",
    type: "payment_intent.succeeded",
    livemode: false,
    data: {
      object: {
        id: "pi_route_123",
        object: "payment_intent",
        amount: 9900,
        amount_received: 9900,
        currency: "brl",
        metadata: {
          cart_id: "cart_route_01",
        },
        payment_method_types: ["card"],
      },
    },
  }
}

function createRequest(overrides: Partial<RequestWithRawBody> = {}) {
  return {
    headers: {},
    scope: {
      resolve: jest.fn(),
    },
    rawBody: Buffer.from('{"id":"evt_test","type":"payment_intent.succeeded"}'),
    body: {
      id: "body_should_not_be_used",
    },
    ...overrides,
  } as RequestWithRawBody
}

describe("stripe webhook route", () => {
  it("usa req.rawBody no constructEvent", async () => {
    const service = createWebhookService()
    const constructEvent = jest.fn(() => ({
      id: "evt_test",
      type: "payment_intent.succeeded",
      livemode: false,
      data: {
        object: {
          id: "pi_123",
          object: "payment_intent",
        },
      },
    }))
    const req = createRequest({
      headers: {
        "stripe-signature": "t=1,v1=signature",
      },
    })
    req.scope.resolve = jest.fn(() => service)

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent,
        },
      },
      now: () => new Date("2026-06-30T12:00:00.000Z"),
    })

    const res = createResponse()
    await handler(req, res)

    expect(constructEvent).toHaveBeenCalledWith(
      req.rawBody,
      "t=1,v1=signature",
      WEBHOOK_SECRET_PLACEHOLDER
    )
    expect(res.statusCode).toBe(200)
    expect(service.createWebhookEventLogs).toHaveBeenCalledTimes(1)
  })

  it("retorna 400 sem assinatura e nao toca o service", async () => {
    const service = createWebhookService()
    const req = createRequest()
    req.scope.resolve = jest.fn(() => service)

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
    })

    const res = createResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "stripe_signature_required",
      })
    )
    expect(service.listWebhookEventLogs).not.toHaveBeenCalled()
    expect(service.createWebhookEventLogs).not.toHaveBeenCalled()
  })

  it("retorna 400 para assinatura invalida e nao toca o service", async () => {
    const service = createWebhookService()
    const req = createRequest({
      headers: {
        "stripe-signature": "t=1,v1=invalid",
      },
    })
    req.scope.resolve = jest.fn(() => service)

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => {
            throw new Error("invalid signature")
          }),
        },
      },
    })

    const res = createResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "stripe_signature_invalid",
      })
    )
    expect(service.listWebhookEventLogs).not.toHaveBeenCalled()
    expect(service.createWebhookEventLogs).not.toHaveBeenCalled()
  })

  it("retorna 400 quando raw body esta ausente", async () => {
    const service = createWebhookService()
    const req = createRequest({
      rawBody: undefined,
      headers: {
        "stripe-signature": "t=1,v1=signature",
      },
    })
    req.scope.resolve = jest.fn(() => service)

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
    })

    const res = createResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "stripe_raw_body_required",
      })
    )
    expect(service.listWebhookEventLogs).not.toHaveBeenCalled()
    expect(service.createWebhookEventLogs).not.toHaveBeenCalled()
  })

  it("retorna 503 saneado quando ingestao esta desabilitada", async () => {
    const service = createWebhookService()
    const req = createRequest({
      headers: {
        "stripe-signature": "t=1,v1=signature",
      },
    })
    req.scope.resolve = jest.fn(() => service)

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: false,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
    })

    const res = createResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(503)
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      code: "stripe_webhook_ingestion_disabled",
    })
    expect(service.listWebhookEventLogs).not.toHaveBeenCalled()
    expect(service.createWebhookEventLogs).not.toHaveBeenCalled()
  })

  it("retorna 503 quando o secret do webhook nao esta configurado", async () => {
    const service = createWebhookService()
    const req = createRequest({
      headers: {
        "stripe-signature": "t=1,v1=signature",
      },
    })
    req.scope.resolve = jest.fn(() => service)

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: undefined,
      } as never,
    })

    const res = createResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(503)
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      code: "stripe_webhook_secret_not_configured",
    })
    expect(service.listWebhookEventLogs).not.toHaveBeenCalled()
    expect(service.createWebhookEventLogs).not.toHaveBeenCalled()
  })

  it("marca evento nao suportado como ignored", async () => {
    const service = createWebhookService()
    const unsupportedEventType = "customer.created"
    const req = createRequest({
      headers: {
        "stripe-signature": "t=1,v1=signature",
      },
    })
    req.scope.resolve = jest.fn(() => service)

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => ({
            id: "evt_ignored",
            type: unsupportedEventType,
            livemode: false,
            data: {
              object: {
                id: "ch_123",
                object: "charge",
              },
            },
          })),
        },
      },
    })

    const res = createResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(service.createWebhookEventLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ignored",
        event_type: unsupportedEventType,
      })
    )
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ignored",
      })
    )
  })

  it("nao marca payment_intent.succeeded como processed quando entrypoint nao retorna order_id", async () => {
    const webhooks = createWebhookService()
    const paymentAttempts = createPaymentAttemptService()
    const req = createRequest({
      headers: {
        "stripe-signature": "t=1,v1=signature",
      },
    })
    req.scope.resolve = jest.fn((key: string) => {
      if (key === WEBHOOKS_MODULE) {
        return webhooks
      }

      if (key === PAYMENT_ATTEMPT_MODULE) {
        return paymentAttempts
      }

      return undefined
    })
    const runOrderEntrypoint = jest.fn(async () => ({
      status: "already_processing" as const,
      payment_attempt_id: "payatt_route_01",
      payment_intent_id: "pi_route_123",
      order_id: null,
      stripe_event_id: "evt_route_123",
      correlation_id: null,
      checkout_completion_status: "processing" as const,
      order_status: null,
      payment_status: null,
    }))

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => createSucceededPaymentIntentEvent()),
        },
      },
      now: () => new Date("2026-07-07T12:00:00.000Z"),
      runOrderEntrypoint,
    })

    const res = createResponse()
    await handler(req, res)

    expect(runOrderEntrypoint).toHaveBeenCalledTimes(1)
    expect(webhooks.updateWebhookEventLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "failed",
        processed_at: null,
        error_code: "CHECKOUT_COMPLETION_NOT_TERMINAL",
      })
    )
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        status: "failed",
      })
    )
  })

  it("reusa PaymentAttempt.order_id existente sem invocar entrypoint nem criar Order duplicada", async () => {
    const webhooks = createWebhookService()
    const paymentAttempts = createPaymentAttemptService("order_route_existing")
    const req = createRequest({
      headers: {
        "stripe-signature": "t=1,v1=signature",
      },
    })
    req.scope.resolve = jest.fn((key: string) => {
      if (key === WEBHOOKS_MODULE) {
        return webhooks
      }

      if (key === PAYMENT_ATTEMPT_MODULE) {
        return paymentAttempts
      }

      return undefined
    })
    const runOrderEntrypoint = jest.fn()

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => createSucceededPaymentIntentEvent()),
        },
      },
      now: () => new Date("2026-07-07T12:00:00.000Z"),
      runOrderEntrypoint,
    })

    const res = createResponse()
    await handler(req, res)

    expect(runOrderEntrypoint).not.toHaveBeenCalled()
    expect(webhooks.updateWebhookEventLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "processed",
        processed_at: "2026-07-07T12:00:00.000Z",
      })
    )
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        status: "processed",
      })
    )
  })
})
