import { applyStructuralCartInvalidation } from "../../checkout/shipping-invalidation"
import type { PaymentAttemptRecord } from "../types"

function activeAttempt(): PaymentAttemptRecord {
  return {
    id: "payatt_01",
    cart_id: "cart_01",
    payment_collection_id: "paycol_01",
    payment_session_id: "payses_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_01",
    provider_payment_session_id: null,
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: null,
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-08-21T11:00:00.000Z",
    updated_at: "2026-08-21T11:00:00.000Z",
  }
}

describe("cart M1 PaymentAttempt invalidation", () => {
  it("persiste a transição real e mantém os hooks SHP no-op injetáveis", async () => {
    const updatePaymentAttempts = jest.fn().mockResolvedValue(undefined)
    const quote = jest.fn().mockResolvedValue(undefined)
    const selection = jest.fn().mockResolvedValue(undefined)

    await applyStructuralCartInvalidation("cart_01", new Date("2026-08-21T12:00:00.000Z"), {
      paymentAttemptModule: {
        listPaymentAttempts: jest.fn().mockResolvedValue([activeAttempt()]),
        updatePaymentAttempts,
      },
      invalidateShippingQuote: quote,
      invalidateShippingSelection: selection,
    })

    expect(updatePaymentAttempts).toHaveBeenCalledTimes(1)
    expect(updatePaymentAttempts.mock.calls[0]?.[0].status).toBe(
      "invalidated_by_cart_change"
    )
    expect(quote).toHaveBeenCalledTimes(1)
    expect(selection).toHaveBeenCalledTimes(1)
  })
})
