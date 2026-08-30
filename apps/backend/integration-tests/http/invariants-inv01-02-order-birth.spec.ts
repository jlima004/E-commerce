import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
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
    metadata: { cart_resource_version: 1 },
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

function createPaymentAttemptAuthorityConnection(
  paymentAttemptModule: ReturnType<typeof createPaymentAttemptModule>
) {
  const nullableString = (value: unknown): string | null =>
    value == null ? null : String(value)

  return {
    transaction: jest.fn(async (callback: (transaction: {
      raw: (sql: string, bindings?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
    }) => Promise<unknown>) =>
      callback({
        raw: jest.fn(async (sql: string, bindings: unknown[] = []) => {
          const attemptFor = (value: unknown) => {
            const normalizedValue = nullableString(value)
            return paymentAttemptModule.attempts.find(
              (attempt) =>
                attempt.id === normalizedValue ||
                attempt.provider_payment_intent_id === normalizedValue
            )
          }

          if (sql.includes("pg_advisory_xact_lock")) {
            return { rows: [] }
          }

          if (sql.includes("select cart_id from payment_attempt")) {
            const attempt = attemptFor(bindings[0])
            return { rows: attempt ? [{ cart_id: attempt.cart_id }] : [] }
          }

          if (sql.includes("update payment_attempt")) {
            const normalizedSql = sql.replace(/\s+/g, " ").trim()
            const setAndWhere = normalizedSql.match(
              /\bset\s+(.+?)\s+\bwhere\b(.+)$/i
            )
            if (!setAndWhere) {
              throw new Error(`Unexpected PaymentAttempt update SQL: ${sql}`)
            }

            const setColumns = [
              ...setAndWhere[1].matchAll(
                /\b(provider_payment_intent_id|provider_payment_session_id|status|failed_at|canceled_at|updated_at)\s*=/gi
              ),
            ].map((match) => match[1].toLowerCase())
            let bindingIndex = 0
            const setValues: Record<string, unknown> = {}
            for (const column of setColumns) {
              setValues[column] = bindings[bindingIndex++]
            }

            const whereBindings = [
              {
                column: "id",
                pattern: /\bid\s*=\s*\?/gi,
              },
              {
                column: "cart_id",
                pattern: /\bcart_id\s*=\s*\?/gi,
              },
              {
                column: "provider_payment_intent_id",
                pattern: /\bprovider_payment_intent_id\s*=\s*\?/gi,
              },
              {
                column: "status",
                pattern: /\bstatus\s*=\s*\?/gi,
              },
            ]
              .flatMap(({ column, pattern }) =>
                [...setAndWhere[2].matchAll(pattern)].map((match) => ({
                  column,
                  index: match.index ?? 0,
                }))
              )
              .sort((left, right) => left.index - right.index)

            if (whereBindings.length !== 4) {
              throw new Error(`Unexpected PaymentAttempt WHERE SQL: ${sql}`)
            }

            const whereValues: Record<string, unknown> = {}
            for (const { column } of whereBindings) {
              whereValues[column] = bindings[bindingIndex++]
            }

            const attempt = attemptFor(whereValues.id)
            if (
              !attempt ||
              attempt.cart_id !== String(whereValues.cart_id) ||
              attempt.order_id != null ||
              attempt.status !== whereValues.status ||
              (attempt.provider_payment_intent_id != null &&
                attempt.provider_payment_intent_id !==
                  String(whereValues.provider_payment_intent_id))
            ) {
              return { rows: [] }
            }

            const updated: PaymentAttemptRecord = {
              ...attempt,
              provider_payment_intent_id: nullableString(
                setValues.provider_payment_intent_id
              ),
              provider_payment_session_id:
                setValues.provider_payment_session_id == null
                  ? attempt.provider_payment_session_id
                  : String(setValues.provider_payment_session_id),
              status: String(setValues.status) as PaymentAttemptRecord["status"],
              updated_at:
                nullableString(setValues.updated_at) ?? attempt.updated_at,
              ...(Object.prototype.hasOwnProperty.call(setValues, "failed_at")
                ? { failed_at: nullableString(setValues.failed_at) }
                : {}),
              ...(Object.prototype.hasOwnProperty.call(setValues, "canceled_at")
                ? { canceled_at: nullableString(setValues.canceled_at) }
                : {}),
            }
            await paymentAttemptModule.updatePaymentAttempts(updated)
            return { rows: [{ ...updated }] }
          }

          if (sql.includes("from payment_attempt")) {
            const attempt = attemptFor(bindings[0])
            return attempt
              ? { rows: [{ ...attempt, metadata: attempt.metadata ?? { cart_resource_version: 1 } }] }
              : { rows: [] }
          }

          throw new Error(`Unexpected PaymentAttempt authority SQL: ${sql}`)
        }),
      })
    ),
  }
}

function createOrderBirthHarness(input: {
  attempts: PaymentAttemptRecord[]
  event: Record<string, unknown>
  runOrderEntrypoint?: jest.Mock
}) {
  const webhookService = createWebhookService()
  const paymentAttemptModule = createPaymentAttemptModule(input.attempts)
  const authorityConnection = createPaymentAttemptAuthorityConnection(
    paymentAttemptModule
  )
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
    if (key === ContainerRegistrationKeys.PG_CONNECTION) {
      return authorityConnection
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
