import { assertPaymentAttemptEligibleForOrderCreation } from "../state-machine"
import {
  PAYMENT_ATTEMPT_STATUSES,
  type PaymentAttemptRecord,
} from "../types"

function buildEligibleAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_eligible_01",
    cart_id: "cart_01",
    payment_collection_id: "paycol_01",
    payment_session_id: "payses_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_eligible_123",
    provider_payment_session_id: "ps_123",
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
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
    ...overrides,
  }
}

describe("assertPaymentAttemptEligibleForOrderCreation", () => {
  it("aceita payment_confirmed_by_webhook com order_id null e shape Stripe/BRL valido", () => {
    expect(() =>
      assertPaymentAttemptEligibleForOrderCreation(buildEligibleAttempt())
    ).not.toThrow()
  })

  it("aceita currency_code em maiusculas normalizando para brl", () => {
    expect(() =>
      assertPaymentAttemptEligibleForOrderCreation(
        buildEligibleAttempt({ currency_code: "BRL" })
      )
    ).not.toThrow()
  })

  const rejectedStatuses = PAYMENT_ATTEMPT_STATUSES.filter(
    (status) => status !== "payment_confirmed_by_webhook"
  )

  it.each(rejectedStatuses)(
    "rejeita status %s sem elegibilidade para Order",
    (status) => {
      expect(() =>
        assertPaymentAttemptEligibleForOrderCreation(
          buildEligibleAttempt({ status })
        )
      ).toThrow("PAYMENT_ATTEMPT_NOT_ELIGIBLE_FOR_ORDER_STATUS")
    }
  )

  it("rejeita payment_confirmed_by_webhook com order_id existente", () => {
    expect(() =>
      assertPaymentAttemptEligibleForOrderCreation(
        buildEligibleAttempt({ order_id: "order_existing_01" })
      )
    ).toThrow("PAYMENT_ATTEMPT_ORDER_ID_ALREADY_LINKED")
  })

  it("rejeita provider diferente de stripe", () => {
    expect(() =>
      assertPaymentAttemptEligibleForOrderCreation(
        buildEligibleAttempt({ provider: "mercadopago" })
      )
    ).toThrow("PAYMENT_ATTEMPT_PROVIDER_NOT_ELIGIBLE")
  })

  it("rejeita provider_payment_intent_id ausente ou vazio", () => {
    for (const provider_payment_intent_id of [null, "", "   "]) {
      expect(() =>
        assertPaymentAttemptEligibleForOrderCreation(
          buildEligibleAttempt({ provider_payment_intent_id })
        )
      ).toThrow("PAYMENT_ATTEMPT_PAYMENT_INTENT_ID_REQUIRED")
    }
  })

  it("rejeita amount <= 0", () => {
    for (const amount of [0, -100]) {
      expect(() =>
        assertPaymentAttemptEligibleForOrderCreation(
          buildEligibleAttempt({ amount })
        )
      ).toThrow("PAYMENT_ATTEMPT_AMOUNT_INVALID")
    }
  })

  it("rejeita currency_code diferente de brl", () => {
    expect(() =>
      assertPaymentAttemptEligibleForOrderCreation(
        buildEligibleAttempt({ currency_code: "usd" })
      )
    ).toThrow("PAYMENT_ATTEMPT_CURRENCY_NOT_ELIGIBLE")
  })
})
