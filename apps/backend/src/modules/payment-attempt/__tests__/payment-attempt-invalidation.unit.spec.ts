import { resolvePaymentAttemptCartFingerprintFromStoreCart } from "../../../api/store/carts/serializers"
import { buildCompleteGuestCart } from "./fixtures/payment-start-cart"
import {
  assertInvalidatedAttemptCannotAdvanceToOrder,
  hasPaymentAttemptCartFingerprintChanged,
  invalidateActivePaymentAttemptForCartChange,
  PAYMENT_ATTEMPT_CART_FINGERPRINT_METADATA_KEY,
  readPaymentAttemptCartFingerprint,
  reconcileStalePaymentAttemptsForCartFingerprint,
  resolvePaymentAttemptCartFingerprint,
  withPaymentAttemptCartFingerprintMetadata,
} from "../cart-invalidation"
import {
  assertAtMostOneActiveAttemptPerCart,
  findActiveAttemptsForCart,
} from "../service"
import { isPaymentAttemptActive } from "../state-machine"
import type { PaymentAttemptRecord } from "../types"

const VALID_CPF = "52998224725"

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  const cart = buildCompleteGuestCart()
  const fingerprint = resolvePaymentAttemptCartFingerprintFromStoreCart(cart)

  return {
    id: "payatt_active_01",
    cart_id: cart.id,
    payment_collection_id: "paycol_01",
    payment_session_id: "payses_01",
    provider: "stripe_safe_layer",
    provider_payment_intent_id: "pi_active_01",
    provider_payment_session_id: "ps_active_01",
    payment_method_type: "card",
    status: "awaiting_pix_payment",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: withPaymentAttemptCartFingerprintMetadata(null, fingerprint),
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: null,
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-06-29T10:00:00.000Z",
    updated_at: "2026-06-29T10:00:00.000Z",
    ...overrides,
  }
}

describe("resolvePaymentAttemptCartFingerprint", () => {
  const baseCart = buildCompleteGuestCart()

  it("gera fingerprint estavel para cart sem mudanca", () => {
    const first = resolvePaymentAttemptCartFingerprintFromStoreCart(baseCart)
    const second = resolvePaymentAttemptCartFingerprintFromStoreCart({
      ...baseCart,
      updated_at: "2026-06-29T11:00:00.000Z",
    })

    expect(first).toBe(second)
  })

  it("muda fingerprint quando item/variant_id muda", () => {
    const original = resolvePaymentAttemptCartFingerprintFromStoreCart(baseCart)
    const changed = resolvePaymentAttemptCartFingerprintFromStoreCart({
      ...baseCart,
      items: [
        {
          ...baseCart.items![0],
          variant_id: "variant_other",
        },
      ],
    })

    expect(changed).not.toBe(original)
  })

  it("muda fingerprint quando quantidade muda", () => {
    const original = resolvePaymentAttemptCartFingerprintFromStoreCart(baseCart)
    const changed = resolvePaymentAttemptCartFingerprintFromStoreCart({
      ...baseCart,
      items: [
        {
          ...baseCart.items![0],
          quantity: 2,
        },
      ],
    })

    expect(changed).not.toBe(original)
  })

  it("muda fingerprint quando email muda", () => {
    const original = resolvePaymentAttemptCartFingerprintFromStoreCart(baseCart)
    const changed = resolvePaymentAttemptCartFingerprintFromStoreCart({
      ...baseCart,
      email: "outro@exemplo.com",
    })

    expect(changed).not.toBe(original)
  })

  it("muda fingerprint quando shipping address muda", () => {
    const original = resolvePaymentAttemptCartFingerprintFromStoreCart(baseCart)
    const changed = resolvePaymentAttemptCartFingerprintFromStoreCart({
      ...baseCart,
      shipping_address: {
        ...baseCart.shipping_address!,
        address_1: "Rua B, 200",
        city: "Campinas",
        postal_code: "13000000",
      },
    })

    expect(changed).not.toBe(original)
  })

  it("nao inclui address_1 cru no payload serializado", () => {
    const fingerprint = resolvePaymentAttemptCartFingerprint({
      actorType: "guest",
      email: "guest@exemplo.com",
      items: [{ variant_id: "variant_sellable", quantity: 1 }],
      shippingAddress: {
        full_name: "Maria Silva",
        address_1: "Rua A, 100",
        city: "Sao Paulo",
        province: "SP",
        postal_code: "01311000",
        country_code: "BR",
        federal_tax_id: VALID_CPF,
      },
    })

    expect(fingerprint).not.toContain("Rua A, 100")
    expect(fingerprint).toContain("01311000")
  })
})

describe("invalidateActivePaymentAttemptForCartChange", () => {
  it("marca tentativa ativa como invalidated_by_cart_change", () => {
    const attempt = buildAttempt()
    const result = invalidateActivePaymentAttemptForCartChange(
      [attempt],
      attempt.cart_id
    )

    expect(result.invalidated).toHaveLength(1)
    expect(result.invalidated[0]?.status).toBe("invalidated_by_cart_change")
    expect(result.invalidated[0]?.order_id).toBeNull()
    expect(result.reason).toBe("invalidated_by_cart_change")
    expect(isPaymentAttemptActive(result.attempts[0]!.status)).toBe(false)
  })

  it("nao reativa tentativa invalidada", () => {
    const invalidated = buildAttempt({
      status: "invalidated_by_cart_change",
      invalidated_at: "2026-06-29T10:05:00.000Z",
    })

    expect(() =>
      assertInvalidatedAttemptCannotAdvanceToOrder(invalidated)
    ).toThrow("PAYMENT_ATTEMPT_INVALIDATED_BY_CART_CHANGE")
  })

  it("preserva historico superseded sem alterar", () => {
    const attempts = [
      buildAttempt({ status: "awaiting_pix_payment" }),
      buildAttempt({
        id: "payatt_history",
        status: "superseded",
        superseded_at: "2026-06-29T09:00:00.000Z",
      }),
    ]

    const result = invalidateActivePaymentAttemptForCartChange(
      attempts,
      attempts[0]!.cart_id
    )

    expect(result.attempts[1]?.status).toBe("superseded")
  })
})

describe("reconcileStalePaymentAttemptsForCartFingerprint", () => {
  it("invalida tentativa stale quando fingerprint mudou", () => {
    const cart = buildCompleteGuestCart()
    const staleFingerprint = resolvePaymentAttemptCartFingerprintFromStoreCart({
      ...cart,
      email: "stale@exemplo.com",
    })
    const currentFingerprint =
      resolvePaymentAttemptCartFingerprintFromStoreCart(cart)
    const attempt = buildAttempt({
      metadata: withPaymentAttemptCartFingerprintMetadata(null, staleFingerprint),
    })

    const result = reconcileStalePaymentAttemptsForCartFingerprint(
      [attempt],
      cart.id,
      currentFingerprint
    )

    expect(result.invalidated).toHaveLength(1)
    expect(result.invalidated[0]?.status).toBe("invalidated_by_cart_change")
    expect(findActiveAttemptsForCart(result.attempts, cart.id)).toHaveLength(0)
  })

  it("mantem tentativa ativa quando fingerprint nao mudou para supersede posterior", () => {
    const cart = buildCompleteGuestCart()
    const fingerprint = resolvePaymentAttemptCartFingerprintFromStoreCart(cart)
    const attempt = buildAttempt({
      metadata: withPaymentAttemptCartFingerprintMetadata(null, fingerprint),
    })

    const result = reconcileStalePaymentAttemptsForCartFingerprint(
      [attempt],
      cart.id,
      fingerprint
    )

    expect(result.invalidated).toHaveLength(0)
    expect(findActiveAttemptsForCart(result.attempts, cart.id)).toHaveLength(1)
  })

  it("hasPaymentAttemptCartFingerprintChanged retorna false sem fingerprint anterior", () => {
    expect(
      hasPaymentAttemptCartFingerprintChanged(null, "current-fingerprint")
    ).toBe(false)
  })

  it("readPaymentAttemptCartFingerprint le metadata segura", () => {
    const attempt = buildAttempt({
      metadata: {
        [PAYMENT_ATTEMPT_CART_FINGERPRINT_METADATA_KEY]: "fp_123",
      },
    })

    expect(readPaymentAttemptCartFingerprint(attempt)).toBe("fp_123")
  })

  it("garante no maximo uma tentativa ativa apos invalidacao stale", () => {
    const cart = buildCompleteGuestCart()
    const staleFingerprint = "stale"
    const currentFingerprint =
      resolvePaymentAttemptCartFingerprintFromStoreCart(cart)
    const attempt = buildAttempt({
      metadata: withPaymentAttemptCartFingerprintMetadata(null, staleFingerprint),
    })

    const result = reconcileStalePaymentAttemptsForCartFingerprint(
      [attempt],
      cart.id,
      currentFingerprint
    )

    expect(() =>
      assertAtMostOneActiveAttemptPerCart(result.attempts, cart.id)
    ).not.toThrow()
  })
})
