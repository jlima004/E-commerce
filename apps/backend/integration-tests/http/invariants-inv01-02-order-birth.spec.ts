import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createStripeWebhookPostHandler } from "../../src/api/hooks/stripe/route"
import { markCardClientConfirmed } from "../../src/modules/payment-attempt/card"
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
}

const WEBHOOK_SECRET = "whsec_inv01_02_test_secret"

const PIX_WAITING_STATUSES = [
  "pix_expired",
  "awaiting_pix_payment",
  "awaiting_webhook_confirmation",
  "payment_instructions_displayed",
  "payment_client_confirmed",
  "client_action_required",
] as const

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_inv01_01",
    cart_id: "cart_inv01_01",
    payment_collection_id: "paycol_inv01_01",
    payment_session_id: "payses_inv01_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_inv01_123",
    provider_payment_session_id: "ps_inv01_123",
    payment_method_type: "pix",
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
      const created: StoredWebhookRecord = {
        id: `whlog_inv01_${records.length + 1}`,
        provider: row.provider,
        external_event_id: row.external_event_id ?? null,
        deduplication_key: row.deduplication_key,
        event_type: row.event_type,
        status: row.status ?? "received",
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

function createOrderBirthHarness(input: {
  attempts: PaymentAttemptRecord[]
  event: Record<string, unknown>
  runOrderEntrypoint?: jest.Mock
}) {
  const webhookService = createWebhookService()
  const paymentAttemptModule = createPaymentAttemptModule(input.attempts)
  const ordersCreated: string[] = []
  const runOrderEntrypoint =
    input.runOrderEntrypoint ??
    jest.fn(async () => {
      const orderId = `order_inv01_${ordersCreated.length + 1}`
      ordersCreated.push(orderId)
      return {
        status: "created",
        payment_attempt_id: input.attempts[0]?.id ?? "payatt_inv01_01",
        payment_intent_id: "pi_inv01_123",
        order_id: orderId,
        stripe_event_id: String(input.event.id ?? "evt_inv01"),
        correlation_id: "corr_inv01_01",
        checkout_completion_status: "completed",
        order_status: "confirmed",
        payment_status: "captured",
      }
    })

  const scopeResolve = jest.fn((key: string) => {
    if (key === WEBHOOKS_MODULE) {
      return webhookService
    }
    if (key === PAYMENT_ATTEMPT_MODULE) {
      return paymentAttemptModule
    }
    return undefined
  })

  const handler = createStripeWebhookPostHandler({
    appEnv: {
      STRIPE_WEBHOOK_INGESTION_ENABLED: true,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    } as never,
    stripe: {
      webhooks: {
        constructEvent: jest.fn(() => input.event),
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
        scope: { resolve: scopeResolve },
        rawBody: Buffer.from(JSON.stringify(input.event)),
        correlationId: "corr_inv01_01",
      } as RequestWithRawBody,
      res
    )
    return { res, body: res.json.mock.calls.at(-1)?.[0] as Record<string, unknown> }
  }

  return {
    dispatch,
    webhookService,
    paymentAttemptModule,
    runOrderEntrypoint,
    get orderCount() {
      return ordersCreated.length
    },
  }
}

function paymentIntentEvent(
  type: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: `evt_inv01_${type.replace(/\./g, "_")}`,
    type,
    livemode: false,
    data: {
      object: {
        id: "pi_inv01_123",
        object: "payment_intent",
        amount: 9900,
        amount_received: type === "payment_intent.succeeded" ? 9900 : 0,
        currency: "brl",
        metadata: { cart_id: "cart_inv01_01" },
        payment_method_types: ["pix"],
        ...overrides,
      },
    },
  }
}

describe("INV-1 Order birth only after canonical webhook confirmation", () => {
  it("INV-1: checkout/client confirmation does not create Order and leaves order_id null", () => {
    const attempt = buildAttempt({
      payment_method_type: "card",
      status: "card_client_secret_created",
    })
    const confirmed = markCardClientConfirmed(
      attempt,
      new Date("2026-07-22T11:00:00.000Z")
    )

    expect(confirmed.status).toBe("payment_client_confirmed")
    expect(confirmed.order_id).toBeNull()
    expect(confirmed.client_confirmed_at).toBe("2026-07-22T11:00:00.000Z")
  })

  it("INV-1: webhook other than payment_intent.succeeded does not create Order or call entrypoint", async () => {
    const harness = createOrderBirthHarness({
      attempts: [buildAttempt()],
      event: paymentIntentEvent("payment_intent.payment_failed"),
    })

    const { res } = await harness.dispatch()

    expect(res.statusCode).toBe(200)
    expect(harness.runOrderEntrypoint).toHaveBeenCalledTimes(0)
    expect(harness.orderCount).toBe(0)
    expect(harness.paymentAttemptModule.attempts[0]?.order_id).toBeNull()
    expect(harness.paymentAttemptModule.attempts[0]?.status).toBe(
      "payment_failed"
    )
  })

  it("INV-1: validated payment_intent.succeeded reaches the canonical order entrypoint", async () => {
    const harness = createOrderBirthHarness({
      attempts: [buildAttempt({ status: "awaiting_webhook_confirmation" })],
      event: paymentIntentEvent("payment_intent.succeeded"),
    })

    const { res, body } = await harness.dispatch()

    expect(res.statusCode).toBe(200)
    expect(body.status).toBe("processed")
    expect(harness.runOrderEntrypoint).toHaveBeenCalledTimes(1)
    expect(harness.runOrderEntrypoint).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        payment_attempt_id: "payatt_inv01_01",
        payment_intent_id: "pi_inv01_123",
        stripe_event_id: "evt_inv01_payment_intent_succeeded",
      })
    )
    expect(harness.orderCount).toBe(1)
    expect(harness.paymentAttemptModule.attempts[0]?.status).toBe(
      "payment_confirmed_by_webhook"
    )
  })
})

describe("INV-2 Pix waiting states never create Order", () => {
  it.each(PIX_WAITING_STATUSES)(
    "INV-2: status %s leaves Order count = 0 and entrypoint calls = 0",
    async (status) => {
      const harness = createOrderBirthHarness({
        attempts: [
          buildAttempt({
            status,
            payment_method_type: "pix",
            order_id: null,
            expired_at:
              status === "pix_expired" ? "2026-07-22T11:00:00.000Z" : null,
          }),
        ],
        event: paymentIntentEvent("payment_intent.canceled"),
      })

      const { res } = await harness.dispatch()

      expect(res.statusCode).toBe(200)
      expect(harness.runOrderEntrypoint).toHaveBeenCalledTimes(0)
      expect(harness.orderCount).toBe(0)
      expect(harness.paymentAttemptModule.attempts[0]?.order_id).toBeNull()
    }
  )
})
