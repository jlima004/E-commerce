import {
  assertNoSensitivePaymentAttemptMetadata,
  assertPaymentAttemptTransition,
  assertValidPaymentAttemptStatus,
  isPaymentAttemptActive,
  markPaymentAttemptInvalidatedByCartChange,
  markPaymentAttemptSuperseded,
  paymentClientConfirmedIsNonFinancial,
} from "../state-machine"
import {
  PAYMENT_ATTEMPT_STATUSES,
  PROHIBITED_PAYMENT_ATTEMPT_STATUSES,
  type PaymentAttemptRecord,
} from "../types"

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_01",
    cart_id: "cart_01",
    payment_collection_id: "paycol_01",
    payment_session_id: "payses_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_123",
    provider_payment_session_id: "ps_123",
    payment_method_type: "card",
    status: "created",
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
    ...overrides,
  }
}

describe("PaymentAttempt status vocabulary", () => {
  it("nao inclui labels financeiros finais proibidos", () => {
    for (const prohibited of PROHIBITED_PAYMENT_ATTEMPT_STATUSES) {
      expect(PAYMENT_ATTEMPT_STATUSES).not.toContain(prohibited)
    }
  })

  it("rejeita status proibidos em runtime", () => {
    expect(() => assertValidPaymentAttemptStatus("paid")).toThrow(
      "PAYMENT_ATTEMPT_STATUS_PROHIBITED"
    )
    expect(() => assertValidPaymentAttemptStatus("succeeded")).toThrow(
      "PAYMENT_ATTEMPT_STATUS_PROHIBITED"
    )
  })
})

describe("isPaymentAttemptActive", () => {
  it("trata estados operacionais como ativos", () => {
    expect(isPaymentAttemptActive("awaiting_pix_payment")).toBe(true)
    expect(isPaymentAttemptActive("awaiting_webhook_confirmation")).toBe(true)
  })

  it("trata estados terminais como inativos", () => {
    expect(isPaymentAttemptActive("superseded")).toBe(false)
    expect(isPaymentAttemptActive("invalidated_by_cart_change")).toBe(false)
    expect(isPaymentAttemptActive("payment_failed")).toBe(false)
    expect(isPaymentAttemptActive("payment_canceled")).toBe(false)
    expect(isPaymentAttemptActive("pix_expired")).toBe(false)
  })
})

describe("assertPaymentAttemptTransition", () => {
  it("permite fluxo local de cartao ate aguardar webhook", () => {
    expect(() =>
      assertPaymentAttemptTransition("created", "provider_session_created")
    ).not.toThrow()
    expect(() =>
      assertPaymentAttemptTransition(
        "card_client_secret_created",
        "payment_client_confirmed"
      )
    ).not.toThrow()
    expect(() =>
      assertPaymentAttemptTransition(
        "payment_client_confirmed",
        "awaiting_webhook_confirmation"
      )
    ).not.toThrow()
  })

  it("permite fluxo local de Pix", () => {
    expect(() =>
      assertPaymentAttemptTransition(
        "payment_instructions_displayed",
        "awaiting_pix_payment"
      )
    ).not.toThrow()
    expect(() =>
      assertPaymentAttemptTransition("awaiting_pix_payment", "pix_expired")
    ).not.toThrow()
  })

  it("bloqueia transicao invalida", () => {
    expect(() =>
      assertPaymentAttemptTransition("pix_expired", "awaiting_webhook_confirmation")
    ).toThrow("PAYMENT_ATTEMPT_TRANSITION_INVALID")
  })
})

describe("order_id permanece null na Phase 04", () => {
  it.each([
    "awaiting_pix_payment",
    "pix_expired",
    "payment_failed",
    "payment_canceled",
  ] as const)("status %s nunca carrega order_id", (status) => {
    const attempt = buildAttempt({ status, order_id: null })
    expect(attempt.order_id).toBeNull()
  })

  it("supersede preserva order_id null", () => {
    const superseded = markPaymentAttemptSuperseded(
      buildAttempt({ status: "awaiting_pix_payment" })
    )
    expect(superseded.order_id).toBeNull()
    expect(superseded.status).toBe("superseded")
  })
})

describe("payment_client_confirmed", () => {
  it("documenta confirmacao client/provider, nunca financeira", () => {
    expect(paymentClientConfirmedIsNonFinancial()).toBe(true)
    expect(() =>
      assertPaymentAttemptTransition(
        "card_client_secret_created",
        "payment_client_confirmed"
      )
    ).not.toThrow()
  })
})

describe("assertNoSensitivePaymentAttemptMetadata", () => {
  it("bloqueia client_secret e payload Pix integral", () => {
    expect(() =>
      assertNoSensitivePaymentAttemptMetadata({ client_secret: "sec_123" })
    ).toThrow("PAYMENT_ATTEMPT_METADATA_SENSITIVE_KEY")

    expect(() =>
      assertNoSensitivePaymentAttemptMetadata({
        pix_display_qr_code: "00020101021226880014br.gov.bcb",
      })
    ).toThrow("PAYMENT_ATTEMPT_METADATA_SENSITIVE_KEY")
  })

  it("bloqueia CPF/CNPJ cru em metadata", () => {
    expect(() =>
      assertNoSensitivePaymentAttemptMetadata({ cpf: "123.456.789-09" })
    ).toThrow("PAYMENT_ATTEMPT_METADATA_SENSITIVE_KEY")
  })

  it("permite metadata operacional allowlist", () => {
    expect(() =>
      assertNoSensitivePaymentAttemptMetadata({
        correlation_id: "corr_01",
        stripe_event_hint: "requires_action",
      })
    ).not.toThrow()
  })
})

describe("invalidacao por mudanca de cart", () => {
  it("marca tentativa ativa como invalidated_by_cart_change", () => {
    const invalidated = markPaymentAttemptInvalidatedByCartChange(
      buildAttempt({ status: "awaiting_pix_payment" })
    )

    expect(invalidated.status).toBe("invalidated_by_cart_change")
    expect(invalidated.invalidated_at).toBeTruthy()
    expect(invalidated.order_id).toBeNull()
  })
})
