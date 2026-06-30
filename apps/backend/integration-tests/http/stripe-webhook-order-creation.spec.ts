import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createStripeWebhookPostHandler } from "../../src/api/hooks/stripe/route"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { WEBHOOKS_MODULE } from "../../src/modules/webhooks"

type RequestWithRawBody = MedusaRequest & {
  rawBody?: Buffer | string
  correlationId?: string
}

type StoredWebhookRecord = {
  id: string
  provider: string
  external_event_id: string | null
  deduplication_key: string
  event_type: string
  status: string
  entity_type?: string
  entity_id?: string | null
  error_code?: string | null
  error_message?: string | null
  processed_at?: string | null
  failed_at?: string | null
  ignored_at?: string | null
  metadata?: Record<string, unknown> | null
}

const FORBIDDEN_STRINGS = [
  ["purchase", "completed"].join("_"),
  ["Analytics", "Event", "Log"].join(""),
  ["Email", "Delivery", "Log"].join(""),
  ["order", "gelatoapis", "com"].join("."),
  ["gelato", "order", "id"].join("_"),
  ["ref", "und"].join(""),
] as const

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_order_http_01",
    cart_id: "cart_order_http_01",
    payment_collection_id: "paycol_order_http_01",
    payment_session_id: "payses_order_http_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_order_http_123",
    provider_payment_session_id: "ps_order_http_123",
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-06-30T10:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-06-30T09:00:00.000Z",
    updated_at: "2026-06-30T09:00:00.000Z",
    ...overrides,
  }
}

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

function createStatefulWebhookService(records: StoredWebhookRecord[] = []) {
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
      const duplicate = records.find(
        (record) =>
          record.provider === row.provider &&
          record.deduplication_key === row.deduplication_key
      )

      if (duplicate) {
        throw new Error("duplicate key value violates unique constraint")
      }

      const created: StoredWebhookRecord = {
        id: `whlog_order_${records.length + 1}`,
        provider: row.provider,
        external_event_id: row.external_event_id ?? null,
        deduplication_key: row.deduplication_key,
        event_type: row.event_type,
        status: row.status ?? "received",
        entity_type: row.entity_type ?? "unknown",
        entity_id: row.entity_id ?? null,
        error_code: row.error_code ?? null,
        error_message: row.error_message ?? null,
        processed_at: row.processed_at ?? null,
        failed_at: row.failed_at ?? null,
        ignored_at: row.ignored_at ?? null,
        metadata: row.metadata ?? null,
      }
      records.push(created)
      return [created]
    }),
    updateWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = records.findIndex((record) => record.id === row.id)
      if (index < 0) {
        throw new Error("webhook record not found")
      }

      records[index] = {
        ...records[index],
        ...row,
      }

      return [records[index]]
    }),
    records,
  }
}

function createPaymentAttemptModule(attempts: PaymentAttemptRecord[] = []) {
  const store = [...attempts]

  return {
    listPaymentAttempts: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((attempt) => {
        if (filters?.id && attempt.id !== filters.id) {
          return false
        }
        if (
          filters?.provider_payment_intent_id &&
          attempt.provider_payment_intent_id !==
            filters.provider_payment_intent_id
        ) {
          return false
        }
        return true
      })
    }),
    updatePaymentAttempts: jest.fn(async (input) => {
      const rows = Array.isArray(input) ? input : [input]
      for (const row of rows) {
        const index = store.findIndex((attempt) => attempt.id === row.id)
        if (index >= 0) {
          store[index] = row
        }
      }
      return rows
    }),
    attempts: store,
  }
}

function createRequest(
  scopeResolve: jest.Mock,
  overrides: Partial<RequestWithRawBody> = {}
) {
  return {
    headers: {
      "stripe-signature": "t=1,v1=signature",
    },
    scope: {
      resolve: scopeResolve,
    },
    rawBody: Buffer.from('{"id":"evt_order_default","type":"payment_intent.succeeded"}'),
    correlationId: "corr_order_http_01",
    ...overrides,
  } as RequestWithRawBody
}

function createScopeResolve(input: {
  webhookService: ReturnType<typeof createStatefulWebhookService>
  paymentAttemptModule?: ReturnType<typeof createPaymentAttemptModule>
}) {
  return jest.fn((key: string) => {
    if (key === WEBHOOKS_MODULE) {
      return input.webhookService
    }

    if (key === PAYMENT_ATTEMPT_MODULE) {
      return input.paymentAttemptModule
    }

    return undefined
  })
}

function createHandler(
  event: Record<string, unknown>,
  runOrderEntrypoint: jest.Mock = jest.fn(async () => ({
    status: "created",
    payment_attempt_id: "payatt_order_http_01",
    payment_intent_id: "pi_order_http_123",
    order_id: "order_http_01",
    stripe_event_id: "evt_order_entrypoint",
    correlation_id: "corr_order_http_01",
    checkout_completion_status: "completed",
    order_status: "confirmed",
    payment_status: "captured",
  }))
) {
  return createStripeWebhookPostHandler({
    appEnv: {
      STRIPE_WEBHOOK_INGESTION_ENABLED: true,
      STRIPE_WEBHOOK_SECRET: "whsec_test_123",
    } as never,
    stripe: {
      webhooks: {
        constructEvent: jest.fn(() => event),
      },
    },
    now: () => new Date("2026-06-30T12:00:00.000Z"),
    runOrderEntrypoint,
  })
}

function serializeProof(payload: unknown) {
  return JSON.stringify(payload)
}

describe("stripe webhook order creation integration", () => {
  it("webhook valido cria fluxo interno, completa correlacao e nao expande para efeitos da Phase 07", async () => {
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const runOrderEntrypoint = jest.fn(async () => ({
      status: "created" as const,
      payment_attempt_id: "payatt_order_http_01",
      payment_intent_id: "pi_order_http_123",
      order_id: "order_http_01",
      stripe_event_id: "evt_order_entrypoint",
      correlation_id: "corr_order_http_01",
      checkout_completion_status: "completed" as const,
      order_status: "confirmed" as const,
      payment_status: "captured" as const,
    }))
    const handler = createHandler(
      {
        id: "evt_order_entrypoint",
        type: "payment_intent.succeeded",
        livemode: false,
        data: {
          object: {
            id: "pi_order_http_123",
            object: "payment_intent",
            amount: 9900,
            amount_received: 9900,
            currency: "brl",
            metadata: {
              cart_id: "cart_order_http_01",
            },
            payment_method_types: ["card"],
          },
        },
      },
      runOrderEntrypoint
    )
    const res = createResponse()

    await handler(
      createRequest(
        createScopeResolve({
          webhookService,
          paymentAttemptModule,
        })
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(paymentAttemptModule.attempts[0]).toEqual(
      expect.objectContaining({
        status: "payment_confirmed_by_webhook",
        order_id: null,
      })
    )
    expect(runOrderEntrypoint).toHaveBeenCalledTimes(1)
    expect(runOrderEntrypoint).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        payment_attempt_id: "payatt_order_http_01",
        payment_intent_id: "pi_order_http_123",
        stripe_event_id: "evt_order_entrypoint",
        correlation_id: "corr_order_http_01",
      })
    )
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: false,
        status: "processed",
      })
    )

    const proof = serializeProof({
      body: res.json.mock.calls[0][0],
      attempts: paymentAttemptModule.attempts,
      entrypointCalls: runOrderEntrypoint.mock.calls,
    })
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(proof).not.toContain(forbidden)
    }
  })

  it("duplicate received com attempt confirmada respeita replay idempotente", async () => {
    const webhookService = createStatefulWebhookService([
      {
        id: "whlog_order_received_retry",
        provider: "stripe",
        external_event_id: "evt_order_received_retry",
        deduplication_key: "evt_order_received_retry",
        event_type: "payment_intent.succeeded",
        status: "received",
        entity_type: "unknown",
        entity_id: null,
        error_code: null,
        error_message: null,
        processed_at: null,
        failed_at: null,
        ignored_at: null,
        metadata: null,
      },
    ])
    const paymentAttemptModule = createPaymentAttemptModule([
      buildAttempt({ status: "payment_confirmed_by_webhook" }),
    ])
    const runOrderEntrypoint = jest.fn(async () => ({
      status: "reused_existing_order" as const,
      payment_attempt_id: "payatt_order_http_01",
      payment_intent_id: "pi_order_http_123",
      order_id: "order_http_existing",
      stripe_event_id: "evt_order_received_retry",
      correlation_id: "corr_order_http_01",
      checkout_completion_status: "completed" as const,
      order_status: "confirmed" as const,
      payment_status: "captured" as const,
    }))
    const handler = createHandler(
      {
        id: "evt_order_received_retry",
        type: "payment_intent.succeeded",
        livemode: false,
        data: {
          object: {
            id: "pi_order_http_123",
            object: "payment_intent",
            amount: 9900,
            amount_received: 9900,
            currency: "brl",
            metadata: {
              cart_id: "cart_order_http_01",
            },
            payment_method_types: ["card"],
          },
        },
      },
      runOrderEntrypoint
    )
    const res = createResponse()

    await handler(
      createRequest(
        createScopeResolve({
          webhookService,
          paymentAttemptModule,
        }),
        {
          rawBody: Buffer.from(
            '{"id":"evt_order_received_retry","type":"payment_intent.succeeded"}'
          ),
        }
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: true,
        status: "processed",
      })
    )
    expect(runOrderEntrypoint).toHaveBeenCalledTimes(1)
  })

  it("eventos de falha ou cancelamento nao chamam criacao de Order", async () => {
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const runOrderEntrypoint = jest.fn()
    const handler = createHandler(
      {
        id: "evt_order_failed",
        type: "payment_intent.payment_failed",
        livemode: false,
        data: {
          object: {
            id: "pi_order_http_123",
            object: "payment_intent",
            amount: 9900,
            currency: "brl",
            metadata: {
              cart_id: "cart_order_http_01",
            },
            payment_method_types: ["card"],
          },
        },
      },
      runOrderEntrypoint
    )
    const res = createResponse()

    await handler(
      createRequest(
        createScopeResolve({
          webhookService,
          paymentAttemptModule,
        }),
        {
          rawBody: Buffer.from(
            '{"id":"evt_order_failed","type":"payment_intent.payment_failed"}'
          ),
        }
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(paymentAttemptModule.attempts[0]?.status).toBe("payment_failed")
    expect(runOrderEntrypoint).not.toHaveBeenCalled()
  })
})
