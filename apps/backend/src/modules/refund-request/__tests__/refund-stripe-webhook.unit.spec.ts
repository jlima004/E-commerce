import type { PaymentAttemptRecord } from "../../payment-attempt/types"
import { Modules } from "@medusajs/framework/utils"
import { PAYMENT_ATTEMPT_MODULE } from "../../payment-attempt"
import { REFUND_REQUEST_MODULE } from "../index"
import {
  resolveOrderCapturedAmountForFinancialRecomputation,
} from "../captured-truth"
import {
  buildOrderFinancialStateMetadata,
  recomputeOrderFinancialPaymentStatus,
  recomputeOrderFinancialState,
} from "../financial-recomputation"
import { resetOrderRefundReservationClaimsForTests } from "../reservation-claim"
import {
  applyNonFinalizingRefundWebhookLink,
  applyTerminalRefundWebhookToRefundRequest,
  findRefundRequestForStripeRefund,
  isNonFinalizingRefundWebhook,
  linkRefundRequestToStripeRefund,
} from "../stripe-refund-webhook"
import {
  REFUND_REQUEST_STATUS,
  type RefundRequestRecord,
} from "../types"
import { runProcessStripeRefundWebhookEntrypoint } from "../../../workflows/refund/stripe-refund-webhook-entrypoint"

const ORDER_ID = "order_refund_webhook_01"
const PAYMENT_INTENT_ID = "pi_refund_webhook_01"
const STRIPE_REFUND_ID = "re_refund_webhook_01"
const AT = new Date("2026-07-03T12:00:00.000Z")

function buildPaymentAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_refund_webhook_01",
    cart_id: "cart_refund_webhook_01",
    payment_collection_id: "paycol_refund_webhook_01",
    payment_session_id: "payses_refund_webhook_01",
    provider: "stripe",
    provider_payment_intent_id: PAYMENT_INTENT_ID,
    provider_payment_session_id: "ps_refund_webhook_01",
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: ORDER_ID,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-07-01T00:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    ...overrides,
  }
}

function buildRefundRequest(
  overrides: Partial<RefundRequestRecord> = {}
): RefundRequestRecord {
  return {
    id: "refreq_webhook_01",
    order_id: ORDER_ID,
    payment_intent_id: PAYMENT_INTENT_ID,
    payment_attempt_id: "payatt_refund_webhook_01",
    stripe_refund_id: STRIPE_REFUND_ID,
    idempotency_key: "admin-refund/order_refund_webhook_01/1",
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
    created_at: "2026-07-03T10:00:00.000Z",
    updated_at: "2026-07-03T10:00:00.000Z",
    deleted_at: null,
    ...overrides,
  }
}

describe("Refund financial recomputation", () => {
  it("recomputes captured payment_status when no confirmed refunds exist", () => {
    expect(
      recomputeOrderFinancialPaymentStatus({
        captured_amount: 9900,
        confirmed_refunded_amount: 0,
      })
    ).toBe("captured")
  })

  it("recomputes partially_refunded payment_status for partial refund", () => {
    expect(
      recomputeOrderFinancialPaymentStatus({
        captured_amount: 9900,
        confirmed_refunded_amount: 2500,
      })
    ).toBe("partially_refunded")
  })

  it("recomputes refunded payment_status for total refund", () => {
    expect(
      recomputeOrderFinancialPaymentStatus({
        captured_amount: 9900,
        confirmed_refunded_amount: 9900,
      })
    ).toBe("refunded")
  })

  it("preserves order_status while updating payment_status metadata", () => {
    const result = recomputeOrderFinancialState({
      captured: {
        captured_amount: 9900,
        currency_code: "brl",
      },
      refund_requests: [
        buildRefundRequest({
          amount: 9900,
          status: REFUND_REQUEST_STATUS.CONFIRMED,
        }),
      ],
      current_metadata: {
        order_status: "confirmed",
        payment_status: "captured",
        gelato_note: "keep-me",
      },
    })

    expect(result.payment_status).toBe("refunded")
    expect(result.order_status).toBe("confirmed")
    expect(result.metadata).toEqual({
      order_status: "confirmed",
      payment_status: "refunded",
      gelato_note: "keep-me",
    })
    expect(buildOrderFinancialStateMetadata({
      current_metadata: { order_status: "confirmed", payment_status: "captured" },
      payment_status: "partially_refunded",
    })).toEqual({
      order_status: "confirmed",
      payment_status: "partially_refunded",
    })
  })

  it("allows financial recomputation when payment_status is partially_refunded", () => {
    const captured = resolveOrderCapturedAmountForFinancialRecomputation({
      order_id: ORDER_ID,
      order_metadata: {
        order_status: "confirmed",
        payment_status: "partially_refunded",
      },
      payment_attempt: buildPaymentAttempt(),
    })

    expect(captured.captured_amount).toBe(9900)
  })
})

describe("Stripe refund webhook object handling", () => {
  it("treats refund.created as non-finalizing", () => {
    expect(
      isNonFinalizingRefundWebhook({
        event_type: "refund.created",
        refund_status: "pending",
      })
    ).toBe(true)
  })

  it("treats pending refund.updated as non-finalizing", () => {
    expect(
      isNonFinalizingRefundWebhook({
        event_type: "refund.updated",
        refund_status: "pending",
      })
    ).toBe(true)
  })

  it("links stripe_refund_id without confirming financial truth on refund.created", () => {
    const linked = linkRefundRequestToStripeRefund({
      refund_request: buildRefundRequest({
        stripe_refund_id: null,
        status: REFUND_REQUEST_STATUS.REQUESTED,
      }),
      stripe_refund_id: STRIPE_REFUND_ID,
      at: AT,
    })

    expect(linked.stripe_refund_id).toBe(STRIPE_REFUND_ID)
    expect(linked.status).toBe(REFUND_REQUEST_STATUS.CONFIRMATION_PENDING)
    expect(linked.confirmed_at).toBeNull()
  })

  it("does not confirm refund request when refund.created carries status=succeeded", () => {
    const linked = applyNonFinalizingRefundWebhookLink({
      refund_request: buildRefundRequest({
        stripe_refund_id: null,
        status: REFUND_REQUEST_STATUS.REQUESTED,
      }),
      stripe_refund_id: STRIPE_REFUND_ID,
      at: AT,
    })

    expect(linked.finalizes_financial_state).toBe(false)
    expect(linked.refund_request.status).toBe(
      REFUND_REQUEST_STATUS.CONFIRMATION_PENDING
    )
    expect(linked.refund_request.confirmed_at).toBeNull()
    expect(linked.noop).toBe(false)
  })

  it("treats refund.created with status=succeeded as non-finalizing at event boundary", () => {
    expect(
      isNonFinalizingRefundWebhook({
        event_type: "refund.created",
        refund_status: "succeeded",
      })
    ).toBe(true)
  })

  it("confirms refund request on succeeded terminal refund.updated", () => {
    const confirmed = applyTerminalRefundWebhookToRefundRequest({
      refund_request: buildRefundRequest(),
      stripe_refund: {
        id: STRIPE_REFUND_ID,
        object: "refund",
        amount: 2500,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "succeeded",
      },
      at: AT,
    })

    expect(confirmed.finalizes_financial_state).toBe(true)
    expect(confirmed.refund_request.status).toBe(REFUND_REQUEST_STATUS.CONFIRMED)
    expect(confirmed.refund_request.confirmed_at).toBe(AT.toISOString())
  })

  it("marks failed refund without confirming amount", () => {
    const failed = applyTerminalRefundWebhookToRefundRequest({
      refund_request: buildRefundRequest(),
      stripe_refund: {
        id: STRIPE_REFUND_ID,
        object: "refund",
        amount: 2500,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "failed",
        failure_reason: "expired_or_canceled_charge",
      },
      at: AT,
    })

    expect(failed.finalizes_financial_state).toBe(false)
    expect(failed.refund_request.status).toBe(REFUND_REQUEST_STATUS.FAILED)
    expect(failed.refund_request.confirmed_at).toBeNull()
  })

  it("marks canceled refund without confirming amount", () => {
    const canceled = applyTerminalRefundWebhookToRefundRequest({
      refund_request: buildRefundRequest(),
      stripe_refund: {
        id: STRIPE_REFUND_ID,
        object: "refund",
        amount: 2500,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "canceled",
      },
      at: AT,
    })

    expect(canceled.finalizes_financial_state).toBe(false)
    expect(canceled.refund_request.status).toBe(REFUND_REQUEST_STATUS.CANCELED)
  })

  it("correlates refund request by stripe_refund_id and payment_intent", () => {
    const match = findRefundRequestForStripeRefund({
      refund_requests: [
        buildRefundRequest({ id: "refreq_a" }),
        buildRefundRequest({
          id: "refreq_b",
          stripe_refund_id: null,
          payment_intent_id: PAYMENT_INTENT_ID,
          amount: 2500,
          status: REFUND_REQUEST_STATUS.REQUESTED,
        }),
      ],
      stripe_refund_id: "re_new_refund",
      payment_intent_id: PAYMENT_INTENT_ID,
      refund_amount: 2500,
    })

    expect(match?.id).toBe("refreq_b")
  })

  it("returns noop when refund request is already confirmed", () => {
    const replay = applyTerminalRefundWebhookToRefundRequest({
      refund_request: buildRefundRequest({
        status: REFUND_REQUEST_STATUS.CONFIRMED,
        confirmed_at: AT.toISOString(),
      }),
      stripe_refund: {
        id: STRIPE_REFUND_ID,
        object: "refund",
        amount: 2500,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "succeeded",
      },
      at: AT,
    })

    expect(replay.noop).toBe(true)
    expect(replay.finalizes_financial_state).toBe(true)
  })
})

describe("Stripe refund webhook entrypoint", () => {
  beforeEach(() => {
    resetOrderRefundReservationClaimsForTests()
  })

  function createHarness(initialRequests: RefundRequestRecord[] = []) {
    const orders = new Map<string, { id: string; metadata: Record<string, unknown> }>([
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

    const container = {
      resolve: jest.fn((key: string) => {
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
            listPaymentAttempts: async (filters?: { order_id?: string }) =>
              paymentAttempts.filter(
                (attempt) => attempt.order_id === filters?.order_id
              ),
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
          }
        }

        throw new Error(`unexpected resolve key: ${key}`)
      }),
    }

    return {
      container,
      orders,
      refundRequests,
    }
  }

  it("does not finalize financial state on refund.created", async () => {
    const harness = createHarness([
      buildRefundRequest({
        stripe_refund_id: null,
        status: REFUND_REQUEST_STATUS.REQUESTED,
      }),
    ])

    const result = await runProcessStripeRefundWebhookEntrypoint(
      harness.container as never,
      {
        event_type: "refund.created",
        refund: {
          id: STRIPE_REFUND_ID,
          object: "refund",
          amount: 2500,
          currency: "brl",
          payment_intent: PAYMENT_INTENT_ID,
          status: "pending",
        },
      },
      { now: () => AT }
    )

    expect(result.status).toBe("non_finalizing")
    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe("captured")
    expect(harness.refundRequests[0]?.confirmed_at).toBeNull()
  })

  it("does not finalize financial state on refund.created even when status is succeeded", async () => {
    const harness = createHarness([
      buildRefundRequest({
        stripe_refund_id: null,
        status: REFUND_REQUEST_STATUS.REQUESTED,
      }),
    ])

    const result = await runProcessStripeRefundWebhookEntrypoint(
      harness.container as never,
      {
        event_type: "refund.created",
        refund: {
          id: STRIPE_REFUND_ID,
          object: "refund",
          amount: 2500,
          currency: "brl",
          payment_intent: PAYMENT_INTENT_ID,
          status: "succeeded",
        },
      },
      { now: () => AT }
    )

    expect(result.status).toBe("non_finalizing")
    expect(result.confirmed_refunded_amount).toBeNull()
    expect(harness.refundRequests[0]?.status).toBe(
      REFUND_REQUEST_STATUS.CONFIRMATION_PENDING
    )
    expect(harness.refundRequests[0]?.confirmed_at).toBeNull()
    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe("captured")
    expect(harness.orders.get(ORDER_ID)?.metadata?.order_status).toBe("confirmed")
  })

  it("confirms partial refund and recomputes payment_status", async () => {
    const harness = createHarness([buildRefundRequest()])

    const result = await runProcessStripeRefundWebhookEntrypoint(
      harness.container as never,
      {
        event_type: "refund.updated",
        refund: {
          id: STRIPE_REFUND_ID,
          object: "refund",
          amount: 2500,
          currency: "brl",
          payment_intent: PAYMENT_INTENT_ID,
          status: "succeeded",
        },
      },
      { now: () => AT }
    )

    expect(result.status).toBe("confirmed")
    expect(result.confirmed_refunded_amount).toBe(2500)
    expect(result.payment_status).toBe("partially_refunded")
    expect(result.order_status).toBe("confirmed")
    expect(harness.orders.get(ORDER_ID)?.metadata?.order_status).toBe("confirmed")
    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe(
      "partially_refunded"
    )
  })

  it("confirms total refund without changing order_status to canceled", async () => {
    const harness = createHarness([
      buildRefundRequest({
        amount: 9900,
      }),
    ])

    const result = await runProcessStripeRefundWebhookEntrypoint(
      harness.container as never,
      {
        event_type: "refund.updated",
        refund: {
          id: STRIPE_REFUND_ID,
          object: "refund",
          amount: 9900,
          currency: "brl",
          payment_intent: PAYMENT_INTENT_ID,
          status: "succeeded",
        },
      },
      { now: () => AT }
    )

    expect(result.payment_status).toBe("refunded")
    expect(result.order_status).toBe("confirmed")
    expect(harness.orders.get(ORDER_ID)?.metadata?.order_status).toBe("confirmed")
    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe("refunded")
  })

  it("does not confirm amount on failed refund webhook", async () => {
    const harness = createHarness([buildRefundRequest()])

    const result = await runProcessStripeRefundWebhookEntrypoint(
      harness.container as never,
      {
        event_type: "refund.updated",
        refund: {
          id: STRIPE_REFUND_ID,
          object: "refund",
          amount: 2500,
          currency: "brl",
          payment_intent: PAYMENT_INTENT_ID,
          status: "failed",
        },
      },
      { now: () => AT }
    )

    expect(result.status).toBe("failed")
    expect(result.confirmed_refunded_amount).toBeNull()
    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe("captured")
  })

  it("is noop on replay of confirmed refund webhook", async () => {
    const harness = createHarness([
      buildRefundRequest({
        status: REFUND_REQUEST_STATUS.CONFIRMED,
        confirmed_at: AT.toISOString(),
      }),
    ])

    harness.orders.set(ORDER_ID, {
      id: ORDER_ID,
      metadata: {
        order_status: "confirmed",
        payment_status: "partially_refunded",
      },
    })

    const result = await runProcessStripeRefundWebhookEntrypoint(
      harness.container as never,
      {
        event_type: "refund.updated",
        refund: {
          id: STRIPE_REFUND_ID,
          object: "refund",
          amount: 2500,
          currency: "brl",
          payment_intent: PAYMENT_INTENT_ID,
          status: "succeeded",
        },
      },
      { now: () => AT }
    )

    expect(result.status).toBe("noop")
    expect(result.confirmed_refunded_amount).toBe(2500)
  })

  it("treats charge.refunded as informational without financial mutation", async () => {
    const harness = createHarness([buildRefundRequest()])

    const result = await runProcessStripeRefundWebhookEntrypoint(
      harness.container as never,
      {
        event_type: "charge.refunded",
        charge: {
          id: "ch_refund_webhook_01",
          object: "charge",
          amount: 9900,
          amount_refunded: 2500,
          currency: "brl",
          payment_intent: PAYMENT_INTENT_ID,
        },
      },
      { now: () => AT }
    )

    expect(result.status).toBe("informational")
    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe("captured")
    expect(harness.refundRequests[0]?.status).toBe(
      REFUND_REQUEST_STATUS.CONFIRMATION_PENDING
    )
  })

  it("serializes concurrent deliveries of the same succeeded refund without duplicating amount", async () => {
    const harness = createHarness([
      buildRefundRequest({
        amount: 6000,
      }),
    ])

    const payload = {
      event_type: "refund.updated" as const,
      refund: {
        id: STRIPE_REFUND_ID,
        object: "refund" as const,
        amount: 6000,
        currency: "brl",
        payment_intent: PAYMENT_INTENT_ID,
        status: "succeeded",
      },
    }

    const [first, second] = await Promise.all([
      runProcessStripeRefundWebhookEntrypoint(
        harness.container as never,
        payload,
        { now: () => AT }
      ),
      runProcessStripeRefundWebhookEntrypoint(
        harness.container as never,
        payload,
        { now: () => new Date("2026-07-03T12:00:00.010Z") }
      ),
    ])

    const statuses = [first.status, second.status]
    expect(statuses).toContain("confirmed")
    expect(statuses).toContain("noop")

    const confirmedAmounts = [first, second]
      .map((result) => result.confirmed_refunded_amount)
      .filter((value): value is number => typeof value === "number")

    expect(Math.max(...confirmedAmounts)).toBe(6000)
    expect(harness.orders.get(ORDER_ID)?.metadata?.payment_status).toBe(
      "partially_refunded"
    )
  })
})
