import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { createStripeWebhookPostHandler } from "../../src/api/hooks/stripe/route"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { REFUND_REQUEST_MODULE } from "../../src/modules/refund-request"
import { resetOrderRefundReservationClaimsForTests } from "../../src/modules/refund-request/reservation-claim"
import {
  REFUND_REQUEST_STATUS,
  type RefundRequestRecord,
} from "../../src/modules/refund-request/types"
import { WEBHOOKS_MODULE } from "../../src/modules/webhooks"

const ORDER_ID = "order_inv09_refund_01"
const PAYMENT_INTENT_ID = "pi_inv09_refund_01"
const STRIPE_REFUND_ID = "re_inv09_refund_01"
const WEBHOOK_SECRET = "whsec_inv09_10_test_secret"

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
  metadata?: Record<string, unknown> | null
}

function buildPaymentAttempt(): PaymentAttemptRecord {
  return {
    id: "payatt_inv09_01",
    cart_id: "cart_inv09_01",
    payment_collection_id: "paycol_inv09_01",
    payment_session_id: "payses_inv09_01",
    provider: "stripe",
    provider_payment_intent_id: PAYMENT_INTENT_ID,
    provider_payment_session_id: "ps_inv09_01",
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: ORDER_ID,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-07-22T00:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
  }
}

function buildRefundRequest(
  overrides: Partial<RefundRequestRecord> = {}
): RefundRequestRecord {
  return {
    id: "refreq_inv09_01",
    order_id: ORDER_ID,
    payment_intent_id: PAYMENT_INTENT_ID,
    payment_attempt_id: "payatt_inv09_01",
    stripe_refund_id: STRIPE_REFUND_ID,
    idempotency_key: "admin-refund/order_inv09_refund_01/1",
    amount: 2500,
    currency_code: "brl",
    reason: "customer_request",
    operator_note: null,
    status: REFUND_REQUEST_STATUS.CONFIRMATION_PENDING,
    failure_code: null,
    failure_message: null,
    requested_by_operator_id: "operator_01",
    confirmed_at: null,
    failed_at: null,
    canceled_at: null,
    rejected_at: null,
    metadata: null,
    created_at: "2026-07-22T10:00:00.000Z",
    updated_at: "2026-07-22T10:00:00.000Z",
    deleted_at: null,
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
        (record) => record.deduplication_key === row.deduplication_key
      )
      if (duplicate) {
        throw new Error("duplicate key value violates unique constraint")
      }
      const created: StoredWebhookRecord = {
        id: `whlog_inv09_${records.length + 1}`,
        provider: row.provider,
        external_event_id: row.external_event_id ?? null,
        deduplication_key: row.deduplication_key,
        event_type: row.event_type,
        status: row.status ?? "received",
        entity_type: row.entity_type ?? "unknown",
        entity_id: row.entity_id ?? null,
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

function createRefundHarness(initialRequests: RefundRequestRecord[] = []) {
  const webhookRecords: StoredWebhookRecord[] = []
  const webhookService = createWebhookService(webhookRecords)
  const orders = new Map([
    [
      ORDER_ID,
      {
        id: ORDER_ID,
        metadata: {
          order_status: "confirmed",
          payment_status: "captured",
        },
      },
    ],
  ])
  const refundRequests = [...initialRequests]
  const paymentAttempts = [buildPaymentAttempt()]
  let ordersCreated = 0
  let constructedEvent: Record<string, unknown> = {}

  const scope = {
    resolve: jest.fn((key: string) => {
      if (key === WEBHOOKS_MODULE) {
        return webhookService
      }
      if (key === REFUND_REQUEST_MODULE) {
        return {
          listRefundRequests: async (filters?: Record<string, unknown>) =>
            refundRequests.filter((request) => {
              if (
                filters?.stripe_refund_id &&
                request.stripe_refund_id !== filters.stripe_refund_id
              ) {
                return false
              }
              if (
                filters?.payment_intent_id &&
                request.payment_intent_id !== filters.payment_intent_id
              ) {
                return false
              }
              if (filters?.order_id && request.order_id !== filters.order_id) {
                return false
              }
              return true
            }),
          updateRefundRequests: async (
            input: RefundRequestRecord | RefundRequestRecord[]
          ) => {
            const rows = Array.isArray(input) ? input : [input]
            for (const row of rows) {
              const index = refundRequests.findIndex(
                (request) => request.id === row.id
              )
              if (index >= 0) {
                refundRequests[index] = row
              }
            }
            return rows
          },
        }
      }
      if (key === PAYMENT_ATTEMPT_MODULE) {
        return {
          listPaymentAttempts: async () => paymentAttempts,
          updatePaymentAttempts: async () => {
            throw new Error(
              "payment attempt update should not run in refund webhook tests"
            )
          },
        }
      }
      if (key === Modules.ORDER) {
        return {
          listOrders: async (filters?: { id?: string }) => {
            const order = filters?.id ? orders.get(filters.id) ?? null : null
            return order ? [order] : []
          },
          updateOrders: async (
            _selector: Record<string, unknown>,
            update: { metadata?: Record<string, unknown> }
          ) => {
            const current = orders.get(ORDER_ID)
            if (current && update.metadata) {
              orders.set(ORDER_ID, {
                ...current,
                metadata: update.metadata,
              })
            }
          },
          createOrders: async () => {
            ordersCreated += 1
            return [{ id: "order_should_not_be_created" }]
          },
        }
      }
      throw new Error(`unexpected resolve key: ${key}`)
    }),
  }

  const POST = createStripeWebhookPostHandler({
    appEnv: {
      STRIPE_WEBHOOK_INGESTION_ENABLED: true,
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    } as never,
    stripe: {
      webhooks: {
        constructEvent: (_payload, _header, _secret) => constructedEvent,
      },
    },
    runOrderEntrypoint: async () => {
      ordersCreated += 1
      return {
        status: "created_order_should_not_happen",
        payment_attempt_id: "blocked",
        payment_intent_id: PAYMENT_INTENT_ID,
        stripe_event_id: null,
        correlation_id: null,
        order_id: "blocked",
        checkout_completion_status: "blocked",
      }
    },
  })

  async function dispatch(input: {
    eventId: string
    eventType: string
    object: Record<string, unknown>
  }) {
    constructedEvent = {
      id: input.eventId,
      type: input.eventType,
      livemode: false,
      data: { object: input.object },
    }
    const req = {
      headers: { "stripe-signature": "sig_test_synthetic" },
      rawBody: Buffer.from(JSON.stringify(constructedEvent)),
      scope,
      correlationId: "corr_inv09_01",
    } as RequestWithRawBody
    const res = createResponse()
    await POST(req, res)
    return {
      res,
      body: res.json.mock.calls.at(-1)?.[0] as Record<string, unknown>,
    }
  }

  return {
    dispatch,
    webhookRecords,
    refundRequests,
    orders,
    get ordersCreated() {
      return ordersCreated
    },
  }
}

describe("INV-9 Refund financial truth", () => {
  const originalWebhookEnabled = process.env.STRIPE_WEBHOOK_INGESTION_ENABLED

  beforeEach(() => {
    resetOrderRefundReservationClaimsForTests()
    process.env.STRIPE_WEBHOOK_INGESTION_ENABLED = "true"
  })

  afterAll(() => {
    if (originalWebhookEnabled === undefined) {
      delete process.env.STRIPE_WEBHOOK_INGESTION_ENABLED
    } else {
      process.env.STRIPE_WEBHOOK_INGESTION_ENABLED = originalWebhookEnabled
    }
  })

  it("INV-9: refund.created does not confirm final financial truth", async () => {
    const harness = createRefundHarness([
      buildRefundRequest({
        stripe_refund_id: null,
        status: REFUND_REQUEST_STATUS.REQUESTED,
      }),
    ])

    await harness.dispatch({
      eventId: "evt_inv09_refund_created",
      eventType: "refund.created",
      object: {
        id: STRIPE_REFUND_ID,
        object: "refund",
        amount: 2500,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "succeeded",
      },
    })

    expect(harness.refundRequests[0]?.confirmed_at).toBeNull()
    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe("captured")
    expect(harness.ordersCreated).toBe(0)
  })

  it("INV-9: refund.updated/succeeded factual updates refund/payment once", async () => {
    const harness = createRefundHarness([buildRefundRequest()])

    await harness.dispatch({
      eventId: "evt_inv09_refund_updated",
      eventType: "refund.updated",
      object: {
        id: STRIPE_REFUND_ID,
        object: "refund",
        amount: 2500,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "succeeded",
      },
    })

    expect(harness.refundRequests[0]?.status).toBe(REFUND_REQUEST_STATUS.CONFIRMED)
    expect(harness.refundRequests[0]?.confirmed_at).not.toBeNull()
    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe(
      "partially_refunded"
    )
  })

  it("INV-9: replay does not duplicate the financial effect", async () => {
    const harness = createRefundHarness([buildRefundRequest()])

    await harness.dispatch({
      eventId: "evt_inv09_refund_replay",
      eventType: "refund.updated",
      object: {
        id: STRIPE_REFUND_ID,
        object: "refund",
        amount: 2500,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "succeeded",
      },
    })

    const afterFirst = harness.orders.get(ORDER_ID)?.metadata?.payment_status
    const confirmedAt = harness.refundRequests[0]?.confirmed_at

    await harness.dispatch({
      eventId: "evt_inv09_refund_replay",
      eventType: "refund.updated",
      object: {
        id: STRIPE_REFUND_ID,
        object: "refund",
        amount: 2500,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "succeeded",
      },
    })

    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe(afterFirst)
    expect(harness.refundRequests[0]?.confirmed_at).toBe(confirmedAt)
    expect(harness.webhookRecords).toHaveLength(1)
  })

  it("INV-9: charge.refunded remains informational/idempotent", async () => {
    const harness = createRefundHarness([buildRefundRequest()])

    await harness.dispatch({
      eventId: "evt_inv09_charge_refunded",
      eventType: "charge.refunded",
      object: {
        id: "ch_inv09_01",
        object: "charge",
        amount: 9900,
        amount_refunded: 2500,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
      },
    })

    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe("captured")
    expect(harness.refundRequests[0]?.confirmed_at).toBeNull()

    await harness.dispatch({
      eventId: "evt_inv09_refund_after_charge",
      eventType: "refund.updated",
      object: {
        id: STRIPE_REFUND_ID,
        object: "refund",
        amount: 2500,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "succeeded",
      },
    })

    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe(
      "partially_refunded"
    )
  })
})

describe("INV-10 Refund does not cancel Order", () => {
  const originalWebhookEnabled = process.env.STRIPE_WEBHOOK_INGESTION_ENABLED

  beforeEach(() => {
    resetOrderRefundReservationClaimsForTests()
    process.env.STRIPE_WEBHOOK_INGESTION_ENABLED = "true"
  })

  afterAll(() => {
    if (originalWebhookEnabled === undefined) {
      delete process.env.STRIPE_WEBHOOK_INGESTION_ENABLED
    } else {
      process.env.STRIPE_WEBHOOK_INGESTION_ENABLED = originalWebhookEnabled
    }
  })

  it("INV-10: refund alters only financial truth and never auto-cancels order_status", async () => {
    const harness = createRefundHarness([
      buildRefundRequest({ amount: 9900 }),
    ])

    await harness.dispatch({
      eventId: "evt_inv10_total_refund",
      eventType: "refund.updated",
      object: {
        id: STRIPE_REFUND_ID,
        object: "refund",
        amount: 9900,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "succeeded",
      },
    })

    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe("refunded")
    expect(harness.orders.get(ORDER_ID)?.metadata?.order_status).toBe("confirmed")
    expect(harness.orders.get(ORDER_ID)?.metadata?.order_status).not.toBe(
      "canceled"
    )
    expect(harness.ordersCreated).toBe(0)
  })
})
