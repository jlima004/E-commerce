import { buildPaymentAttemptProviderIdempotencyKey } from "../durable-initiation"
import {
  assertCompleteStripePaymentIntentCreateAuthorityV1,
  assertStripePaymentIntentMatchesAuthorityV1,
  buildCompleteStripePaymentIntentCreateAuthorityV1,
  buildStripeCanonicalPaymentIntentCreateRequest,
  digestStripeCanonicalPaymentIntentCreateRequest,
  parseCompleteStripePaymentIntentCreateAuthorityV1,
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE,
  PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE,
  stripePaymentIntentCreateAuthoritiesEqual,
} from "../provider-request-authority"
import { DEFAULT_PIX_EXPIRES_AFTER_SECONDS } from "../provider-request-authority"

const CREATED_AT = "2026-09-02T10:00:00.000Z"
const REPLAY_DEADLINE = "2026-09-03T09:00:00.000Z"

function cardAuthority(
  overrides: Partial<Parameters<typeof buildCompleteStripePaymentIntentCreateAuthorityV1>[0]> = {}
) {
  return buildCompleteStripePaymentIntentCreateAuthorityV1({
    payment_method_type: "card",
    amount_minor: 9900,
    cart_id: "cart_r1",
    cart_resource_version: 3,
    payment_attempt_id: "payatt_r1_001",
    payment_collection_id: "paycol_r1",
    payment_session_id: "payses_r1",
    authority_created_at: CREATED_AT,
    replay_deadline: REPLAY_DEADLINE,
    ...overrides,
  })
}

describe("provider request authority v1", () => {
  it("builds an explicit complete card v1 with digest over canonical_request", () => {
    const authority = cardAuthority()
    expect(authority).toMatchObject({
      schema: "stripe_payment_intent_create",
      version: 1,
      operation: "stripe_payment_intent_create",
      provider: "stripe",
      payment_method_type: "card",
      amount_minor: 9900,
      currency_code: "brl",
      cart_id: "cart_r1",
      cart_resource_version: 3,
      payment_attempt_id: "payatt_r1_001",
      payment_collection_id: "paycol_r1",
      payment_session_id: "payses_r1",
      idempotency_key: "payment-attempt:card:payatt_r1_001",
      provider_payment_intent_id: null,
      replay_deadline: REPLAY_DEADLINE,
    })
    expect(authority.payment_method_options).toBeUndefined()
    expect(authority.canonical_request).toEqual({
      amount: 9900,
      currency: "brl",
      payment_method_types: ["card"],
      capture_method: "automatic",
      metadata: {
        cart_id: "cart_r1",
        payment_attempt_id: "payatt_r1_001",
        session_id: "payses_r1",
      },
    })
    expect(authority.canonical_request.metadata).not.toHaveProperty(
      "correlation_id"
    )
    expect(authority.request_digest).toBe(
      digestStripeCanonicalPaymentIntentCreateRequest(authority.canonical_request)
    )
    expect(authority.request_digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it("includes Pix expiry 86400 and omits invented Medusa session ids", () => {
    const authority = buildCompleteStripePaymentIntentCreateAuthorityV1({
      payment_method_type: "pix",
      amount_minor: 9900,
      cart_id: "cart_r1",
      cart_resource_version: 3,
      payment_attempt_id: "payatt_r1_001",
      payment_collection_id: "paycol_r1",
      payment_session_id: null,
      authority_created_at: CREATED_AT,
      replay_deadline: REPLAY_DEADLINE,
    })
    expect(authority.payment_session_id).toBeNull()
    expect(authority.payment_method_options).toEqual({
      pix: { expires_after_seconds: DEFAULT_PIX_EXPIRES_AFTER_SECONDS },
    })
    expect(authority.canonical_request.payment_method_options).toEqual({
      pix: { expires_after_seconds: 86_400 },
    })
    expect(authority.canonical_request.metadata.session_id).toBeUndefined()
    expect(authority.canonical_request.metadata).not.toHaveProperty(
      "correlation_id"
    )
    expect(authority.idempotency_key).toBe(
      buildPaymentAttemptProviderIdempotencyKey("pix", "payatt_r1_001")
    )
  })

  it("fails closed when v1 is only schema/version timestamps", () => {
    expect(
      parseCompleteStripePaymentIntentCreateAuthorityV1({
        schema: "stripe_payment_intent_create",
        version: 1,
        authority_created_at: CREATED_AT,
        replay_deadline: REPLAY_DEADLINE,
      })
    ).toBeNull()
    expect(() =>
      assertCompleteStripePaymentIntentCreateAuthorityV1({
        schema: "stripe_payment_intent_create",
        version: 1,
        authority_created_at: CREATED_AT,
        replay_deadline: REPLAY_DEADLINE,
      })
    ).toThrow(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  })

  it("exact equality is structural and digest-stable", () => {
    const left = cardAuthority()
    const right = cardAuthority()
    expect(stripePaymentIntentCreateAuthoritiesEqual(left, right)).toBe(true)
    expect(
      stripePaymentIntentCreateAuthoritiesEqual(left, {
        ...right,
        amount_minor: 8800,
      })
    ).toBe(false)
  })

  it("canonical request key order does not change the digest", () => {
    const canonical = buildStripeCanonicalPaymentIntentCreateRequest({
      payment_method_type: "card",
      amount_minor: 9900,
      cart_id: "cart_r1",
      payment_attempt_id: "payatt_r1_001",
      payment_session_id: "payses_r1",
    })
    const shuffled = {
      metadata: canonical.metadata,
      capture_method: canonical.capture_method,
      payment_method_types: canonical.payment_method_types,
      currency: canonical.currency,
      amount: canonical.amount,
    }
    expect(digestStripeCanonicalPaymentIntentCreateRequest(canonical)).toBe(
      digestStripeCanonicalPaymentIntentCreateRequest(shuffled as typeof canonical)
    )
  })

  it("validates a matching Stripe PaymentIntent against v1", () => {
    const authority = cardAuthority()
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(
        {
          id: "pi_A",
          amount: 9900,
          currency: "brl",
          payment_method_types: ["card"],
          metadata: {
            payment_attempt_id: "payatt_r1_001",
            cart_id: "cart_r1",
            session_id: "payses_r1",
          },
        },
        authority
      )
    ).not.toThrow()
  })

  it("card valid passes with exact amount, brl, card, payment_attempt_id, cart_id, session_id", () => {
    const authority = cardAuthority()
    const paymentIntent = {
      id: "pi_card_valid",
      amount: 9900,
      currency: "brl",
      payment_method_types: ["card"],
      metadata: {
        payment_attempt_id: "payatt_r1_001",
        cart_id: "cart_r1",
        session_id: "payses_r1",
      },
    }
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(paymentIntent, authority)
    ).not.toThrow()
  })

  it("card missing cart_id is rejected", () => {
    const authority = cardAuthority()
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(
        {
          id: "pi_A",
          amount: 9900,
          currency: "brl",
          payment_method_types: ["card"],
          metadata: {
            payment_attempt_id: "payatt_r1_001",
            session_id: "payses_r1",
          },
        },
        authority
      )
    ).toThrow(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  })

  it("card wrong cart_id is rejected", () => {
    const authority = cardAuthority()
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(
        {
          id: "pi_A",
          amount: 9900,
          currency: "brl",
          payment_method_types: ["card"],
          metadata: {
            payment_attempt_id: "payatt_r1_001",
            cart_id: "cart_other",
            session_id: "payses_r1",
          },
        },
        authority
      )
    ).toThrow(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  })

  it("card missing session_id when authority.payment_session_id is set is rejected", () => {
    const authority = cardAuthority()
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(
        {
          id: "pi_A",
          amount: 9900,
          currency: "brl",
          payment_method_types: ["card"],
          metadata: {
            payment_attempt_id: "payatt_r1_001",
            cart_id: "cart_r1",
          },
        },
        authority
      )
    ).toThrow(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  })

  it("card wrong session_id is rejected", () => {
    const authority = cardAuthority()
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(
        {
          id: "pi_A",
          amount: 9900,
          currency: "brl",
          payment_method_types: ["card"],
          metadata: {
            payment_attempt_id: "payatt_r1_001",
            cart_id: "cart_r1",
            session_id: "payses_other",
          },
        },
        authority
      )
    ).toThrow(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  })

  it("pix valid without session_id passes when authority session is null", () => {
    const authority = buildCompleteStripePaymentIntentCreateAuthorityV1({
      payment_method_type: "pix",
      amount_minor: 9900,
      cart_id: "cart_r1",
      cart_resource_version: 3,
      payment_attempt_id: "payatt_r1_001",
      payment_collection_id: "paycol_r1",
      payment_session_id: null,
      authority_created_at: CREATED_AT,
      replay_deadline: REPLAY_DEADLINE,
    })
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(
        {
          id: "pi_pix_valid",
          amount: 9900,
          currency: "brl",
          payment_method_types: ["pix"],
          metadata: {
            payment_attempt_id: "payatt_r1_001",
            cart_id: "cart_r1",
          },
        },
        authority
      )
    ).not.toThrow()
  })

  it("pix missing cart_id is rejected", () => {
    const authority = buildCompleteStripePaymentIntentCreateAuthorityV1({
      payment_method_type: "pix",
      amount_minor: 9900,
      cart_id: "cart_r1",
      cart_resource_version: 3,
      payment_attempt_id: "payatt_r1_001",
      payment_collection_id: "paycol_r1",
      payment_session_id: null,
      authority_created_at: CREATED_AT,
      replay_deadline: REPLAY_DEADLINE,
    })
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(
        {
          id: "pi_pix_missing_cart",
          amount: 9900,
          currency: "brl",
          payment_method_types: ["pix"],
          metadata: {
            payment_attempt_id: "payatt_r1_001",
          },
        },
        authority
      )
    ).toThrow(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  })

  it("rejects a PaymentIntent that disagrees on amount, method, or identity", () => {
    const authority = cardAuthority()
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(
        {
          id: "pi_A",
          amount: 1200,
          currency: "brl",
          payment_method_types: ["card"],
          metadata: { payment_attempt_id: "payatt_r1_001" },
        },
        authority
      )
    ).toThrow(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(
        {
          id: "pi_A",
          amount: 9900,
          currency: "brl",
          payment_method_types: ["pix"],
          metadata: { payment_attempt_id: "payatt_r1_001" },
        },
        authority
      )
    ).toThrow(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
    expect(() =>
      assertStripePaymentIntentMatchesAuthorityV1(
        {
          id: "pi_A",
          amount: 9900,
          currency: "brl",
          payment_method_types: ["card"],
          metadata: { payment_attempt_id: "payatt_other" },
        },
        authority
      )
    ).toThrow(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  })
})
