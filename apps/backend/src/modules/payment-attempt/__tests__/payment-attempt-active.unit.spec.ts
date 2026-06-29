import {
  assertAtMostOneActiveAttemptPerCart,
  buildNewPaymentAttemptRecord,
  createPaymentAttemptReplacingActive,
  findActiveAttemptsForCart,
  invalidateActiveAttemptsForCartChange,
  supersedeActiveAttemptsForCart,
} from "../service"
import type { CreatePaymentAttemptInput, PaymentAttemptRecord } from "../types"

const BASE_INPUT: CreatePaymentAttemptInput = {
  cart_id: "cart_01",
  payment_collection_id: "paycol_01",
  payment_session_id: "payses_01",
  provider: "stripe",
  provider_payment_intent_id: "pi_new",
  provider_payment_session_id: "ps_new",
  payment_method_type: "card",
  amount: 9900,
  currency_code: "BRL",
}

function buildExisting(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_old",
    cart_id: "cart_01",
    payment_collection_id: "paycol_old",
    payment_session_id: "payses_old",
    provider: "stripe",
    provider_payment_intent_id: "pi_old",
    provider_payment_session_id: "ps_old",
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 8800,
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
    created_at: "2026-06-29T10:00:00.000Z",
    ...overrides,
  }
}

describe("findActiveAttemptsForCart", () => {
  it("retorna apenas tentativas ativas do cart informado", () => {
    const attempts = [
      buildExisting({ id: "payatt_active", status: "awaiting_pix_payment" }),
      buildExisting({
        id: "payatt_history",
        status: "superseded",
        cart_id: "cart_01",
      }),
      buildExisting({ id: "payatt_other_cart", cart_id: "cart_02" }),
    ]

    const active = findActiveAttemptsForCart(attempts, "cart_01")

    expect(active.map((item) => item.id)).toEqual(["payatt_active"])
  })
})

describe("assertAtMostOneActiveAttemptPerCart", () => {
  it("falha se duas tentativas ativas coexistirem para o mesmo cart", () => {
    const attempts = [
      buildExisting({ id: "payatt_a", status: "awaiting_pix_payment" }),
      buildExisting({ id: "payatt_b", status: "created" }),
    ]

    expect(() =>
      assertAtMostOneActiveAttemptPerCart(attempts, "cart_01")
    ).toThrow("PAYMENT_ATTEMPT_MULTIPLE_ACTIVE")
  })
})

describe("supersedeActiveAttemptsForCart", () => {
  it("marca tentativa ativa anterior como superseded preservando historico", () => {
    const existing = buildExisting()
    const result = supersedeActiveAttemptsForCart([existing], "cart_01")

    expect(result.superseded).toHaveLength(1)
    expect(result.superseded[0]?.status).toBe("superseded")
    expect(result.superseded[0]?.superseded_at).toBeTruthy()
    expect(result.remainingActiveCount).toBe(0)
  })
})

describe("createPaymentAttemptReplacingActive", () => {
  it("cria nova tentativa sem reutilizar a anterior", () => {
    const existing = buildExisting()
    const result = createPaymentAttemptReplacingActive(
      [existing],
      BASE_INPUT,
      "payatt_new"
    )

    expect(result.newAttempt.id).toBe("payatt_new")
    expect(result.newAttempt.status).toBe("created")
    expect(result.newAttempt.order_id).toBeNull()
    expect(result.newAttempt.provider_payment_intent_id).toBe("pi_new")
    expect(result.supersededAttempts[0]?.id).toBe("payatt_old")
    expect(result.supersededAttempts[0]?.status).toBe("superseded")
  })

  it("mantem historico auditavel com tentativa antiga e nova", () => {
    const existing = buildExisting()
    const result = createPaymentAttemptReplacingActive(
      [existing],
      BASE_INPUT,
      "payatt_new"
    )

    const mergedIds = [
      ...result.supersededAttempts.map((item) => item.id),
      result.newAttempt.id,
    ]

    expect(mergedIds).toEqual(["payatt_old", "payatt_new"])
    expect(result.supersededAttempts[0]?.amount).toBe(8800)
    expect(result.newAttempt.amount).toBe(9900)
  })

  it("recalcula amount/currency apenas a partir do input server-side", () => {
    const result = createPaymentAttemptReplacingActive(
      [],
      { ...BASE_INPUT, amount: 12345, currency_code: "brl" },
      "payatt_new"
    )

    expect(result.newAttempt.amount).toBe(12345)
    expect(result.newAttempt.currency_code).toBe("brl")
  })
})

describe("buildNewPaymentAttemptRecord", () => {
  it("sempre inicia com order_id null", () => {
    const attempt = buildNewPaymentAttemptRecord(BASE_INPUT, "payatt_new")
    expect(attempt.order_id).toBeNull()
  })
})

describe("invalidateActiveAttemptsForCartChange", () => {
  it("invalida tentativa ativa quando cart muda", () => {
    const attempts = [
      buildExisting({ status: "awaiting_pix_payment" }),
      buildExisting({
        id: "payatt_history",
        status: "superseded",
      }),
    ]

    const updated = invalidateActiveAttemptsForCartChange(attempts, "cart_01")

    expect(updated[0]?.status).toBe("invalidated_by_cart_change")
    expect(updated[1]?.status).toBe("superseded")
  })
})
