import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PAYMENT_ATTEMPT_MODULE } from "../../../../modules/payment-attempt"
import { WEBHOOKS_MODULE } from "../../../../modules/webhooks"
import { createStripeWebhookPostHandler } from "../route"
import { OrderCreationEntrypointError } from "../../../../workflows/order/webhook-order-entrypoint"
import { RECONCILIATION_REASON_CODE } from "../../../../reconciliation/reason-codes"

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
  metadata?: Record<string, unknown> | null
  processed_at?: string | null
  failed_at?: string | null
}

const WEBHOOK_SECRET_PLACEHOLDER = "whsec_test_placeholder"

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
    records,
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
      const record: WebhookRecord = {
        id: `whlog_${records.length + 1}`,
        provider: row.provider,
        external_event_id: row.external_event_id ?? null,
        deduplication_key: row.deduplication_key,
        event_type: row.event_type,
        status: row.status ?? "received",
        metadata: row.metadata ?? null,
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

function createPaymentAttemptService() {
  const records = [
    {
      id: "payatt_w_01",
      cart_id: "cart_w_01",
      payment_collection_id: "paycol_w_01",
      payment_session_id: "payses_w_01",
      provider: "stripe",
      provider_payment_intent_id: "pi_w_123",
      provider_payment_session_id: "ps_w_123",
      payment_method_type: "card",
      status: "awaiting_webhook_confirmation",
      amount: 19900,
      currency_code: "brl",
      expires_at: null as string | null,
      order_id: null as string | null,
      metadata: null,
      client_confirmed_at: null as string | null,
      instructions_displayed_at: null as string | null,
      awaiting_webhook_since: "2026-07-07T10:00:00.000Z",
      superseded_at: null as string | null,
      invalidated_at: null as string | null,
      canceled_at: null as string | null,
      failed_at: null as string | null,
      expired_at: null as string | null,
      financial_freeze_started_at: "2026-07-07T10:00:00.000Z",
      provider_canceled_confirmed_at: null as string | null,
      reconciliation_reason_code: null as string | null,
      reconciliation_locked_at: null as string | null,
      last_reconciliation_at: null as string | null,
      created_at: "2026-07-07T09:00:00.000Z",
      updated_at: "2026-07-07T09:00:00.000Z",
    },
  ]

  return {
    records,
    listPaymentAttempts: jest.fn(async () => records),
    updatePaymentAttempts: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      records[0] = { ...records[0], ...row }
      return [records[0]]
    }),
  }
}

function createAuthorityConnection(
  paymentAttempts: ReturnType<typeof createPaymentAttemptService>,
  options: {
    failReconciliation?: boolean
    cclList?: Array<Record<string, unknown>>
  } = {}
) {
  const cclRecords = options.cclList ?? []

  return {
    transaction: async (
      callback: (trx: {
        raw: (sql: string, bindings?: unknown[]) => Promise<{ rows?: unknown[] }>
      }) => Promise<unknown>
    ) =>
      callback({
        raw: async (sql: string, bindings: unknown[] = []) => {
          const attempt = paymentAttempts.records[0]

          if (sql.includes("pg_advisory_xact_lock")) {
            return { rows: [] }
          }

          if (sql.includes("select cart_id from payment_attempt")) {
            return { rows: attempt ? [{ cart_id: attempt.cart_id }] : [] }
          }

          if (
            sql.includes("from payment_attempt") &&
            sql.trimStart().startsWith("select")
          ) {
            return { rows: attempt ? [attempt] : [] }
          }

          if (sql.includes("update payment_attempt")) {
            if (options.failReconciliation && sql.includes("reconciliation_reason_code =")) {
              throw new Error("Simulated reconciliation DB write failure")
            }
            if (attempt) {
              if (sql.includes("reconciliation_reason_code =")) {
                attempt.reconciliation_reason_code = String(bindings[1])
                attempt.last_reconciliation_at = "2026-07-07T12:00:00.000Z"
              } else {
                const statusIndex = sql.includes("provider_payment_intent_id") ? 2 : 0
                attempt.status = String(bindings[statusIndex])
              }
            }
            return { rows: attempt ? [attempt] : [] }
          }

          if (sql.includes("select id from checkout_completion_log")) {
            return { rows: cclRecords }
          }

          if (sql.includes("insert into checkout_completion_log")) {
            if (options.failReconciliation) {
              throw new Error("Simulated reconciliation DB write failure")
            }
            cclRecords.push({ id: bindings[0] })
            return { rows: [] }
          }

          if (sql.includes("update checkout_completion_log")) {
            if (options.failReconciliation) {
              throw new Error("Simulated reconciliation DB write failure")
            }
            return { rows: [] }
          }

          return { rows: [] }
        },
      }),
  }
}

function createSucceededPaymentIntentEvent(id = "evt_w_123", piId = "pi_w_123") {
  return {
    id,
    type: "payment_intent.succeeded",
    livemode: false,
    data: {
      object: {
        id: piId,
        object: "payment_intent",
        amount: 19900,
        amount_received: 19900,
        currency: "brl",
        metadata: {
          cart_id: "cart_w_01",
        },
        payment_method_types: ["card"],
      },
    },
  }
}

function createRequest(
  event: ReturnType<typeof createSucceededPaymentIntentEvent>,
  scopeResolve: (key: string) => unknown
): RequestWithRawBody {
  return {
    headers: {
      "stripe-signature": "t=1,v1=valid_sig",
    },
    scope: {
      resolve: jest.fn(scopeResolve),
    },
    rawBody: Buffer.from(JSON.stringify(event)),
    body: {},
  } as unknown as RequestWithRawBody
}

describe("R4-HR01 Succeeded Webhook Terminality / Retry Seal Matrix (W1-W7)", () => {
  it("W1: normal succeeded -> Order succeeds -> WEL processed / HTTP 2xx", async () => {
    const webhooks = createWebhookService()
    const paymentAttempts = createPaymentAttemptService()
    const authority = createAuthorityConnection(paymentAttempts)

    const event = createSucceededPaymentIntentEvent()
    const req = createRequest(event, (key) => {
      if (key === WEBHOOKS_MODULE) return webhooks
      if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttempts
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return authority
      return undefined
    })

    const runOrderEntrypoint = jest.fn(async () => ({
      status: "created" as const,
      payment_attempt_id: "payatt_w_01",
      payment_intent_id: "pi_w_123",
      order_id: "order_w_01",
      stripe_event_id: event.id,
      correlation_id: null,
      checkout_completion_status: "completed" as const,
      order_status: "confirmed" as const,
      payment_status: "captured" as const,
    }))

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => event),
        },
      },
      now: () => new Date("2026-07-07T12:00:00.000Z"),
      runOrderEntrypoint,
    })

    const res = createResponse()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        status: "processed",
      })
    )
    expect(webhooks.records[0].status).toBe("processed")
  })

  it("W2: Order fails, durable reconciliation succeeds -> WEL processed / HTTP 2xx", async () => {
    const webhooks = createWebhookService()
    const paymentAttempts = createPaymentAttemptService()
    const cclRecords: Array<Record<string, unknown>> = []
    const authority = createAuthorityConnection(paymentAttempts, { cclList: cclRecords })

    const event = createSucceededPaymentIntentEvent()
    const req = createRequest(event, (key) => {
      if (key === WEBHOOKS_MODULE) return webhooks
      if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttempts
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return authority
      return undefined
    })

    const runOrderEntrypoint = jest.fn(async () => {
      throw new Error("Order creation crashed midway")
    })

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => event),
        },
      },
      now: () => new Date("2026-07-07T12:00:00.000Z"),
      runOrderEntrypoint,
    })

    const res = createResponse()
    await handler(req, res)

    // Per contract: durable reconciliation consequence exists -> WEL processed, HTTP 200
    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        status: "processed",
      })
    )
    expect(webhooks.records[0].status).toBe("processed")
    expect(webhooks.records[0].metadata?.reconciliation_required).toBe(true)
    expect(paymentAttempts.records[0].reconciliation_reason_code).toBe(
      RECONCILIATION_REASON_CODE.ORDER_BIRTH_EXECUTION_AMBIGUOUS
    )
    expect(cclRecords).toHaveLength(1)
  })

  it("W3: Order fails AND reconciliation fails -> non-2xx (500) -> WEL failed but NOT permanently terminal", async () => {
    const webhooks = createWebhookService()
    const paymentAttempts = createPaymentAttemptService()
    const authority = createAuthorityConnection(paymentAttempts, {
      failReconciliation: true,
    })

    const event = createSucceededPaymentIntentEvent()
    const req = createRequest(event, (key) => {
      if (key === WEBHOOKS_MODULE) return webhooks
      if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttempts
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return authority
      return undefined
    })

    const runOrderEntrypoint = jest.fn(async () => {
      throw new Error("Order creation crashed midway")
    })

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => event),
        },
      },
      now: () => new Date("2026-07-07T12:00:00.000Z"),
      runOrderEntrypoint,
    })

    const res = createResponse()
    await handler(req, res)

    // No durable consequence exists -> must return non-2xx (500)
    expect(res.statusCode).toBe(500)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        status: "failed",
      })
    )
    expect(webhooks.records[0].status).toBe("failed")
  })

  it("W4: duplicate retry after W3 failure -> re-enters processing and succeeds", async () => {
    const webhooks = createWebhookService()
    const paymentAttempts = createPaymentAttemptService()
    const cclRecords: Array<Record<string, unknown>> = []

    const event = createSucceededPaymentIntentEvent()

    // First attempt: reconciliation fails
    const failingAuthority = createAuthorityConnection(paymentAttempts, {
      failReconciliation: true,
    })
    const req1 = createRequest(event, (key) => {
      if (key === WEBHOOKS_MODULE) return webhooks
      if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttempts
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return failingAuthority
      return undefined
    })

    const runOrderEntrypoint = jest.fn(async () => {
      throw new Error("Order creation failed")
    })

    const handler1 = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => event),
        },
      },
      now: () => new Date("2026-07-07T12:00:00.000Z"),
      runOrderEntrypoint,
    })

    const res1 = createResponse()
    await handler1(req1, res1)
    expect(res1.statusCode).toBe(500)
    expect(webhooks.records[0].status).toBe("failed")

    // Second attempt (duplicate/retry): underlying DB issue resolved, reconciliation succeeds
    const workingAuthority = createAuthorityConnection(paymentAttempts, {
      failReconciliation: false,
      cclList: cclRecords,
    })
    const req2 = createRequest(event, (key) => {
      if (key === WEBHOOKS_MODULE) return webhooks
      if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttempts
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return workingAuthority
      return undefined
    })

    const handler2 = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => event),
        },
      },
      now: () => new Date("2026-07-07T12:05:00.000Z"),
      runOrderEntrypoint,
    })

    const res2 = createResponse()
    await handler2(req2, res2)

    // MUST NOT short-circuit with 200/failed! Must re-process and reach durable consequence.
    expect(res2.statusCode).toBe(200)
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        status: "processed",
      })
    )
    expect(webhooks.records[0].status).toBe("processed")
    expect(cclRecords).toHaveLength(1)
  })

  it("W5: duplicate after W2 processed reconciliation -> idempotent 200, no duplicate CCL", async () => {
    const webhooks = createWebhookService()
    const paymentAttempts = createPaymentAttemptService()
    const cclRecords: Array<Record<string, unknown>> = []
    const authority = createAuthorityConnection(paymentAttempts, { cclList: cclRecords })

    const event = createSucceededPaymentIntentEvent()
    const req = createRequest(event, (key) => {
      if (key === WEBHOOKS_MODULE) return webhooks
      if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttempts
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return authority
      return undefined
    })

    const runOrderEntrypoint = jest.fn(async () => {
      throw new Error("Order creation failed")
    })

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => event),
        },
      },
      now: () => new Date("2026-07-07T12:00:00.000Z"),
      runOrderEntrypoint,
    })

    // First dispatch: order fails, reconciliation succeeds -> processed
    const res1 = createResponse()
    await handler(req, res1)
    expect(res1.statusCode).toBe(200)
    expect(cclRecords).toHaveLength(1)

    // Second dispatch (duplicate): should short-circuit with 200 idempotent
    const res2 = createResponse()
    await handler(req, res2)
    expect(res2.statusCode).toBe(200)
    expect(res2.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        duplicate: true,
        status: "processed",
      })
    )
    // No duplicate CCL inserted!
    expect(cclRecords).toHaveLength(1)
    expect(runOrderEntrypoint).toHaveBeenCalledTimes(1)
  })

  it("W6 & W7: correlated succeeded + no Order + no reconciliation + terminal 2xx = 0 cases", async () => {
    // Prove that any unhandled failure or missing reconciliation never responds 2xx
    const webhooks = createWebhookService()
    const paymentAttempts = createPaymentAttemptService()
    const authority = createAuthorityConnection(paymentAttempts, {
      failReconciliation: true,
    })

    const event = createSucceededPaymentIntentEvent()
    const req = createRequest(event, (key) => {
      if (key === WEBHOOKS_MODULE) return webhooks
      if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttempts
      if (key === ContainerRegistrationKeys.PG_CONNECTION) return authority
      return undefined
    })

    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET_PLACEHOLDER,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => event),
        },
      },
      now: () => new Date("2026-07-07T12:00:00.000Z"),
      runOrderEntrypoint: jest.fn(async () => {
        throw new Error("Unrecoverable error")
      }),
    })

    const res = createResponse()
    await handler(req, res)

    // Terminal 2xx without durable consequence is 0:
    expect(res.statusCode).not.toBe(200)
    expect(res.statusCode).toBe(500)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        status: "failed",
      })
    )
  })
})
