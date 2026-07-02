import {
  buildCreateGelatoFulfillmentData,
  evaluateAutomaticGelatoFulfillmentEligibility,
} from "../service"
import { GELATO_FULFILLMENT_STATUS } from "../types"

function buildCreateInput() {
  return {
    order_id: "order_gelato_01",
    cart_id: "cart_gelato_01",
    payment_attempt_id: "payatt_gelato_01",
    checkout_completion_log_id: "chkcpl_gelato_01",
    analytics_event_log_id: "anlevt_gelato_01",
    email_delivery_log_id: "emlog_gelato_01",
    status: GELATO_FULFILLMENT_STATUS.ELIGIBLE,
    request_hash: "sha256:test",
    request_summary: {
      order_id: "order_gelato_01",
      cart_id: "cart_gelato_01",
      payment_attempt_id: "payatt_gelato_01",
      checkout_completion_log_id: "chkcpl_gelato_01",
      analytics_event_log_id: "anlevt_gelato_01",
      email_delivery_log_id: "emlog_gelato_01",
      idempotency_key: "gelato-dispatch:order_gelato_01",
      request_hash: "sha256:test",
      item_count: 1,
      currency_code: "brl",
      status: GELATO_FULFILLMENT_STATUS.ELIGIBLE,
    },
    metadata: {
      source: "webhook_order_entrypoint",
      correlation_id: "corr_gelato_01",
      ignored: "drop-me",
    },
  } as const
}

describe("evaluateAutomaticGelatoFulfillmentEligibility", () => {
  it("bloqueia sem Order confirmada", () => {
    expect(
      evaluateAutomaticGelatoFulfillmentEligibility({
        order: {
          id: "order_gelato_01",
          order_status: "pending",
          payment_status: "captured",
        },
        has_local_purchase_completed: true,
        email_delivery_status: "sent",
        existing_fulfillment: null,
      })
    ).toEqual({
      eligible: false,
      reason: "order_not_confirmed",
    })
  })

  it("bloqueia sem purchase_completed local", () => {
    expect(
      evaluateAutomaticGelatoFulfillmentEligibility({
        order: {
          id: "order_gelato_01",
          order_status: "confirmed",
          payment_status: "captured",
        },
        has_local_purchase_completed: false,
        email_delivery_status: "sent",
        existing_fulfillment: null,
      })
    ).toEqual({
      eligible: false,
      reason: "purchase_completed_missing",
    })
  })

  it("bloqueia quando o email nao esta sent, inclusive dead_letter", () => {
    for (const status of [
      "recorded",
      "queued",
      "sending",
      "failed",
      "dead_letter",
      null,
    ]) {
      expect(
        evaluateAutomaticGelatoFulfillmentEligibility({
          order: {
            id: "order_gelato_01",
            order_status: "confirmed",
            payment_status: "captured",
          },
          has_local_purchase_completed: true,
          email_delivery_status: status,
          existing_fulfillment: null,
        })
      ).toEqual({
        eligible: false,
        reason: "email_not_sent",
      })
    }
  })

  it("bloqueia quando ja existe GelatoFulfillment para a Order", () => {
    expect(
      evaluateAutomaticGelatoFulfillmentEligibility({
        order: {
          id: "order_gelato_01",
          order_status: "confirmed",
          payment_status: "captured",
        },
        has_local_purchase_completed: true,
        email_delivery_status: "sent",
        existing_fulfillment: {
          order_id: "order_gelato_01",
          status: GELATO_FULFILLMENT_STATUS.QUEUED,
        },
      })
    ).toEqual({
      eligible: false,
      reason: "fulfillment_already_exists",
    })
  })

  it("aceita apenas quando todos os gates estao satisfeitos", () => {
    expect(
      evaluateAutomaticGelatoFulfillmentEligibility({
        order: {
          id: "order_gelato_01",
          order_status: "confirmed",
          payment_status: "captured",
        },
        has_local_purchase_completed: true,
        email_delivery_status: "sent",
        existing_fulfillment: null,
      })
    ).toEqual({
      eligible: true,
      reason: "eligible",
    })
  })
})

describe("buildCreateGelatoFulfillmentData", () => {
  it("omite campos gerados no create persistente real", () => {
    const createData = buildCreateGelatoFulfillmentData(
      buildCreateInput(),
      new Date("2026-07-02T12:00:00.000Z")
    ) as Record<string, unknown>

    expect(createData).not.toHaveProperty("id")
    expect(createData).not.toHaveProperty("created_at")
    expect(createData).not.toHaveProperty("updated_at")
    expect(createData).not.toHaveProperty("deleted_at")
    expect(createData).toEqual(
      expect.objectContaining({
        order_id: "order_gelato_01",
        status: GELATO_FULFILLMENT_STATUS.ELIGIBLE,
        order_reference_id: "order_gelato_01",
      })
    )
  })
})
