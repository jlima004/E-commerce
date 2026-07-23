import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createStripeWebhookPostHandler } from "../../src/api/hooks/stripe/route"
import { OrderCreationEntrypointError } from "../../src/workflows/order/webhook-order-entrypoint"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { CHECKOUT_COMPLETION_MODULE } from "../../src/modules/checkout-completion"
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
  metadata?: Record<string, unknown> | null
}

type StoredCheckoutCompletionRecord = {
  id: string
  idempotency_key: string
  cart_id: string
  payment_intent_id: string
  payment_attempt_id: string
  order_id?: string | null
  status: string
}

const WEBHOOK_SECRET = "whsec_inv03_04_test_secret"

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_inv03_01",
    cart_id: "cart_inv03_01",
    payment_collection_id: "paycol_inv03_01",
    payment_session_id: "payses_inv03_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_inv03_123",
    provider_payment_session_id: "ps_inv03_123",
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-07-22T10:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-07-22T09:00:00.000Z",
    updated_at: "2026-07-22T09:00:00.000Z",
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

function createWebhookService(records: StoredWebhookRecord[] = []) {
  return {
    listWebhookEventLogs: jest.fn(async (filters?: Record<string, unknown>) =>
      records.filter((record) => {
        return (
          (!filters?.provider || record.provider === filters.provider) &&
          (!filters?.deduplication_key ||
            record.deduplication_key === filters.deduplication_key)
        )
      })
    ),
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
        id: `whlog_inv03_${records.length + 1}`,
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
        metadata: row.metadata ?? null,
      }
      records.push(created)
      return [created]
    }),
    updateWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = records.findIndex((record) => record.id === row.id)
      if (index >= 0) {
        records[index] = { ...records[index], ...row }
      }
      return index >= 0 ? [records[index]] : []
    }),
    records,
  }
}

function createPaymentAttemptModule(attempts: PaymentAttemptRecord[] = []) {
  const store = [...attempts]
  return {
    listPaymentAttempts: jest.fn(async () => store),
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

function createCheckoutCompletionModule(
  records: StoredCheckoutCompletionRecord[] = []
) {
  const store = [...records]
  return {
    listCheckoutCompletionLogs: jest.fn(async () => store),
    createCheckoutCompletionLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const created = {
        ...row,
        id: `chkcpl_inv03_${store.length + 1}`,
      }
      store.push(created)
      return [created]
    }),
    updateCheckoutCompletionLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = store.findIndex((record) => record.id === row.id)
      if (index >= 0) {
        store[index] = { ...store[index], ...row }
      }
      return index >= 0 ? [store[index]] : []
    }),
    store,
  }
}

function succeededEvent(eventId = "evt_inv03_canonical") {
  return {
    id: eventId,
    type: "payment_intent.succeeded",
    livemode: false,
    data: {
      object: {
        id: "pi_inv03_123",
        object: "payment_intent",
        amount: 9900,
        amount_received: 9900,
        currency: "brl",
        metadata: { cart_id: "cart_inv03_01" },
        payment_method_types: ["card"],
      },
    },
  }
}

describe("INV-3 Webhook authenticity fail-closed before persistence", () => {
  it("INV-3: missing raw body fails before WebhookEventLog, CheckoutCompletionLog, workflow or Order", async () => {
    const webhookService = createWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const runOrderEntrypoint = jest.fn()
    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => succeededEvent()),
        },
      },
      runOrderEntrypoint,
    })
    const res = createResponse()

    await handler(
      {
        headers: { "stripe-signature": "t=1,v1=synthetic_test_signature" },
        scope: {
          resolve: jest.fn((key: string) => {
            if (key === WEBHOOKS_MODULE) return webhookService
            if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttemptModule
            if (key === CHECKOUT_COMPLETION_MODULE) return checkoutCompletionModule
            return undefined
          }),
        },
        rawBody: undefined,
        correlationId: "corr_inv03_raw",
      } as RequestWithRawBody,
      res
    )

    expect(res.statusCode).toBe(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "stripe_raw_body_required" })
    )
    expect(webhookService.listWebhookEventLogs).not.toHaveBeenCalled()
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(
      checkoutCompletionModule.createCheckoutCompletionLogs
    ).not.toHaveBeenCalled()
    expect(runOrderEntrypoint).not.toHaveBeenCalled()
  })

  it("INV-3: missing signature fails before WebhookEventLog, CheckoutCompletionLog, workflow or Order", async () => {
    const webhookService = createWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const runOrderEntrypoint = jest.fn()
    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      } as never,
      runOrderEntrypoint,
    })
    const res = createResponse()

    await handler(
      {
        headers: {},
        scope: {
          resolve: jest.fn((key: string) => {
            if (key === WEBHOOKS_MODULE) return webhookService
            if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttemptModule
            if (key === CHECKOUT_COMPLETION_MODULE) return checkoutCompletionModule
            return undefined
          }),
        },
        rawBody: Buffer.from(JSON.stringify(succeededEvent())),
        correlationId: "corr_inv03_sig_missing",
      } as RequestWithRawBody,
      res
    )

    expect(res.statusCode).toBe(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "stripe_signature_required" })
    )
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(
      checkoutCompletionModule.createCheckoutCompletionLogs
    ).not.toHaveBeenCalled()
    expect(runOrderEntrypoint).not.toHaveBeenCalled()
  })

  it("INV-3: invalid signature fails before WebhookEventLog, CheckoutCompletionLog, workflow or Order", async () => {
    const webhookService = createWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const runOrderEntrypoint = jest.fn()
    const constructEvent = jest.fn(() => {
      throw new Error("No signatures found matching the expected signature")
    })
    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      } as never,
      stripe: {
        webhooks: { constructEvent },
      },
      runOrderEntrypoint,
    })
    const res = createResponse()

    await handler(
      {
        headers: { "stripe-signature": "t=1,v1=invalid_synthetic_signature" },
        scope: {
          resolve: jest.fn((key: string) => {
            if (key === WEBHOOKS_MODULE) return webhookService
            if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttemptModule
            if (key === CHECKOUT_COMPLETION_MODULE) return checkoutCompletionModule
            return undefined
          }),
        },
        rawBody: Buffer.from(JSON.stringify(succeededEvent())),
        correlationId: "corr_inv03_sig_invalid",
      } as RequestWithRawBody,
      res
    )

    expect(res.statusCode).toBe(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "stripe_signature_invalid" })
    )
    expect(constructEvent).toHaveBeenCalledWith(
      expect.any(Buffer),
      "t=1,v1=invalid_synthetic_signature",
      WEBHOOK_SECRET
    )
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(
      checkoutCompletionModule.createCheckoutCompletionLogs
    ).not.toHaveBeenCalled()
    expect(runOrderEntrypoint).not.toHaveBeenCalled()
  })
})

describe("INV-4 Webhook idempotency and recoverable intermediate failure", () => {
  function createIdempotentHarness(options?: {
    runOrderEntrypoint?: jest.Mock
  }) {
    const webhookService = createWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const orders: string[] = []
    const runOrderEntrypoint =
      options?.runOrderEntrypoint ??
      jest.fn(async () => {
        const orderId = `order_inv04_${orders.length + 1}`
        orders.push(orderId)
        return {
          status: "created",
          payment_attempt_id: "payatt_inv03_01",
          payment_intent_id: "pi_inv03_123",
          order_id: orderId,
          stripe_event_id: "evt_inv03_canonical",
          correlation_id: "corr_inv04_01",
          checkout_completion_status: "completed",
          order_status: "confirmed",
          payment_status: "captured",
        }
      })

    const event = succeededEvent()
    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => event),
        },
      },
      now: () => new Date("2026-07-22T12:00:00.000Z"),
      runOrderEntrypoint,
    })

    async function dispatch() {
      const res = createResponse()
      await handler(
        {
          headers: { "stripe-signature": "t=1,v1=synthetic_test_signature" },
          scope: {
            resolve: jest.fn((key: string) => {
              if (key === WEBHOOKS_MODULE) return webhookService
              if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttemptModule
              return undefined
            }),
          },
          rawBody: Buffer.from(JSON.stringify(event)),
          correlationId: "corr_inv04_01",
        } as RequestWithRawBody,
        res
      )
      return {
        res,
        body: res.json.mock.calls.at(-1)?.[0] as Record<string, unknown>,
      }
    }

    return {
      dispatch,
      webhookService,
      paymentAttemptModule,
      runOrderEntrypoint,
      get orderCount() {
        return orders.length
      },
    }
  }

  it("INV-4: replay of the same Stripe event returns duplicate and does not duplicate log/Order", async () => {
    const harness = createIdempotentHarness()

    const first = await harness.dispatch()
    const second = await harness.dispatch()

    expect(first.body.status).toBe("processed")
    expect(first.body.duplicate).toBe(false)
    expect(second.body.duplicate).toBe(true)
    expect(second.body.status).toBe("processed")
    expect(harness.webhookService.records).toHaveLength(1)
    expect(harness.runOrderEntrypoint).toHaveBeenCalledTimes(1)
    expect(harness.orderCount).toBe(1)
  })

  it("INV-4: replay of the same payment_intent keeps a single claim/Order effect", async () => {
    const harness = createIdempotentHarness()
    const first = await harness.dispatch()
    const second = await harness.dispatch()

    expect(first.body.duplicate).toBe(false)
    expect(second.body.duplicate).toBe(true)
    expect(harness.webhookService.records).toHaveLength(1)
    expect(harness.orderCount).toBe(1)
    expect(harness.runOrderEntrypoint).toHaveBeenCalledTimes(1)
    expect(harness.paymentAttemptModule.attempts[0]?.provider_payment_intent_id).toBe(
      "pi_inv03_123"
    )
  })

  it("INV-4: recoverable intermediate failure allows retry without duplicating Order", async () => {
    let calls = 0
    const orders: string[] = []
    const runOrderEntrypoint = jest.fn(async (_scope, input) => {
      calls += 1
      if (calls === 1) {
        throw new OrderCreationEntrypointError(
          "ORDER_ENTRYPOINT_COMPLETE_CART_FAILED",
          "completeCart rejected temporarily",
          {
            cause: new Error("transient"),
            details: {
              error_name: "Error",
              error_code: "ORDER_ENTRYPOINT_COMPLETE_CART_FAILED",
              error_message: "completeCart rejected temporarily",
              error_cause_message: "transient",
              error_type: "object",
              error_string: null,
            },
            context: {
              step: "create-order-from-confirmed-attempt",
              cart_id: "cart_inv03_01",
              payment_attempt_id: "payatt_inv03_01",
              payment_intent_id: "pi_inv03_123",
              checkout_completion_log_id: "chkcpl_inv03_01",
            },
          }
        )
      }

      const orderId = "order_inv04_recovered"
      orders.push(orderId)
      return {
        status: "created",
        payment_attempt_id: "payatt_inv03_01",
        payment_intent_id: "pi_inv03_123",
        order_id: orderId,
        stripe_event_id: input.stripe_event_id ?? "evt_inv03_retry",
        correlation_id: "corr_inv04_01",
        checkout_completion_status: "completed",
        order_status: "confirmed",
        payment_status: "captured",
      }
    })

    const webhookService = createWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])

    async function dispatch(eventId: string) {
      const event = succeededEvent(eventId)
      const handler = createStripeWebhookPostHandler({
        appEnv: {
          STRIPE_WEBHOOK_INGESTION_ENABLED: true,
          STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
        } as never,
        stripe: {
          webhooks: {
            constructEvent: jest.fn(() => event),
          },
        },
        now: () => new Date("2026-07-22T12:00:00.000Z"),
        runOrderEntrypoint,
      })
      const res = createResponse()
      await handler(
        {
          headers: { "stripe-signature": "t=1,v1=synthetic_test_signature" },
          scope: {
            resolve: jest.fn((key: string) => {
              if (key === WEBHOOKS_MODULE) return webhookService
              if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttemptModule
              return undefined
            }),
          },
          rawBody: Buffer.from(JSON.stringify(event)),
          correlationId: "corr_inv04_01",
        } as RequestWithRawBody,
        res
      )
      return {
        res,
        body: res.json.mock.calls.at(-1)?.[0] as Record<string, unknown>,
      }
    }

    const first = await dispatch("evt_inv03_fail_once")
    expect(first.body.status).toBe("failed")
    expect(orders).toHaveLength(0)
    expect(webhookService.records).toHaveLength(1)

    const second = await dispatch("evt_inv03_recover_same_pi")
    expect(second.body.status).toBe("processed")
    expect(runOrderEntrypoint).toHaveBeenCalledTimes(2)
    expect(orders).toEqual(["order_inv04_recovered"])
    expect(webhookService.records).toHaveLength(2)
    expect(
      new Set(webhookService.records.map((record) => record.deduplication_key)).size
    ).toBe(2)
  })
})
