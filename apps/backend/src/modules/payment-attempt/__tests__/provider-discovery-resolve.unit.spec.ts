import { RECONCILIATION_REASON_CODE } from "../../../reconciliation/reason-codes"
import { buildCompleteStripePaymentIntentCreateAuthorityV1 } from "../provider-request-authority"
import {
  reconstructBoundStripePaymentIntentFromAuthority,
  resolveProviderDiscoveryAfterAuthorityClaim,
} from "../provider-discovery-resolve"
import type { DurablePreProviderAuthority } from "../pre-provider-arbitration"
import type { StripePaymentIntentLike } from "../stripe-safe"
import type { PaymentAttemptRecord } from "../types"

const CREATED_AT = "2026-09-02T10:00:00.000Z"
const REPLAY_DEADLINE = "2026-09-03T09:00:00.000Z"

function buildAuthority(input: {
  method: "card" | "pix"
  paymentAttemptId?: string
  providerPaymentIntentId?: string | null
  paymentSessionId?: string | null
}): DurablePreProviderAuthority {
  const paymentAttemptId = input.paymentAttemptId ?? "payatt_r1_001"
  const v1 = buildCompleteStripePaymentIntentCreateAuthorityV1({
    payment_method_type: input.method,
    amount_minor: 9900,
    cart_id: "cart_r1",
    cart_resource_version: 3,
    payment_attempt_id: paymentAttemptId,
    payment_collection_id: "paycol_r1",
    payment_session_id:
      input.paymentSessionId === undefined
        ? input.method === "card"
          ? "payses_r1"
          : null
        : input.paymentSessionId,
    authority_created_at: CREATED_AT,
    replay_deadline: REPLAY_DEADLINE,
  })
  const attempt: PaymentAttemptRecord = {
    id: paymentAttemptId,
    cart_id: "cart_r1",
    payment_collection_id: "paycol_r1",
    payment_session_id:
      input.paymentSessionId === undefined
        ? input.method === "card"
          ? "payses_r1"
          : null
        : input.paymentSessionId,
    provider: "stripe",
    provider_payment_intent_id: input.providerPaymentIntentId ?? null,
    provider_payment_session_id: null,
    payment_method_type: input.method,
    status: "created",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: {
      cart_resource_version: 3,
      provider_idempotency_key: `payment-attempt:${input.method}:${paymentAttemptId}`,
      payment_attempt_id: paymentAttemptId,
      stripe_payment_intent_create: v1,
    },
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: null,
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    financial_freeze_started_at: CREATED_AT,
    provider_canceled_confirmed_at: null,
    provider_discovery_started_at: null,
    reconciliation_reason_code: null,
    reconciliation_locked_at: null,
    last_reconciliation_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  }
  return {
    attempt,
    amount_minor: 9900,
    currency_code: "brl",
    payment_method_type: input.method,
    cart_resource_version: 3,
    financial_freeze_started_at: CREATED_AT,
    provider_idempotency_key: `payment-attempt:${input.method}:${paymentAttemptId}`,
    payment_collection_id: "paycol_r1",
    payment_session_id:
      input.paymentSessionId === undefined
        ? input.method === "card"
          ? "payses_r1"
          : null
        : input.paymentSessionId,
  }
}

function matchingIntent(
  method: "card" | "pix",
  id: string
): StripePaymentIntentLike {
  const metadata: Record<string, string> = {
    payment_attempt_id: "payatt_r1_001",
    cart_id: "cart_r1",
  }
  if (method === "card") {
    metadata.session_id = "payses_r1"
  }
  return {
    id,
    amount: 9900,
    currency: "brl",
    payment_method_types: [method],
    metadata,
  }
}

describe("provider discovery ownership resolve", () => {
  for (const method of ["card", "pix"] as const) {
    describe(method, () => {
      it("D1 first claimant claims discovery and searches Stripe once", async () => {
        const authority = buildAuthority({ method })
        const search = jest.fn(async () => ({
          matches: [matchingIntent(method, "pi_owner")],
          unresolved: false,
        }))
        const result = await resolveProviderDiscoveryAfterAuthorityClaim({
          authority,
          paymentMethodType: method,
          stripeLayer: {
            discoverPaymentIntentsByPaymentAttemptId: search,
          },
          claimDiscovery: async () => ({ claimed: true, attempt: authority.attempt }),
          rereadAuthority: async () => authority,
          isReplayEligible: async () => ({ eligible: true }),
        })

        expect(result).toEqual({
          outcome: "resolved",
          payment_intent: matchingIntent(method, "pi_owner"),
        })
        expect(search).toHaveBeenCalledTimes(1)
        expect(search).toHaveBeenCalledWith("payatt_r1_001")
      })

      it("D2 second claimant does not search Stripe when discovery already started", async () => {
        const authority = buildAuthority({ method })
        const search = jest.fn()
        await expect(
          resolveProviderDiscoveryAfterAuthorityClaim({
            authority,
            paymentMethodType: method,
            stripeLayer: {
              discoverPaymentIntentsByPaymentAttemptId: search,
            },
            claimDiscovery: async () => ({
              claimed: false,
              attempt: authority.attempt,
            }),
            rereadAuthority: async () => authority,
            isReplayEligible: async () => ({ eligible: true }),
          })
        ).rejects.toThrow(
          RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED
        )
        expect(search).not.toHaveBeenCalled()
      })

      it("D3 second claimant reuses bound PI without search or create", async () => {
        const authority = buildAuthority({
          method,
          providerPaymentIntentId: "pi_bound",
        })
        const search = jest.fn()
        const result = await resolveProviderDiscoveryAfterAuthorityClaim({
          authority,
          paymentMethodType: method,
          stripeLayer: {
            discoverPaymentIntentsByPaymentAttemptId: search,
          },
          claimDiscovery: async () => ({
            claimed: false,
            attempt: authority.attempt,
          }),
          rereadAuthority: async () => authority,
          isReplayEligible: async () => ({ eligible: true }),
        })

        expect(result.outcome).toBe("resolved")
        if (result.outcome === "resolved") {
          expect(result.payment_intent).toEqual(
            reconstructBoundStripePaymentIntentFromAuthority(
              authority,
              "pi_bound",
              method
            )
          )
        }
        expect(search).not.toHaveBeenCalled()
      })

      it("D4 second claimant unbound remains frozen with PROVIDER_DISCOVERY_UNRESOLVED", async () => {
        const authority = buildAuthority({ method })
        const search = jest.fn()
        await expect(
          resolveProviderDiscoveryAfterAuthorityClaim({
            authority,
            paymentMethodType: method,
            stripeLayer: {
              discoverPaymentIntentsByPaymentAttemptId: search,
            },
            claimDiscovery: async () => ({
              claimed: false,
              attempt: authority.attempt,
            }),
            rereadAuthority: async () => authority,
            isReplayEligible: async () => ({ eligible: false }),
          })
        ).rejects.toThrow(
          RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED
        )
        expect(search).not.toHaveBeenCalled()
      })
    })
  }

  it("owner zero-match with replay eligible continues without search failure", async () => {
    const authority = buildAuthority({ method: "card" })
    const search = jest.fn(async () => ({
      matches: [],
      unresolved: true,
      reason: RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED,
    }))
    const result = await resolveProviderDiscoveryAfterAuthorityClaim({
      authority,
      paymentMethodType: "card",
      stripeLayer: {
        discoverPaymentIntentsByPaymentAttemptId: search,
      },
      claimDiscovery: async () => ({ claimed: true, attempt: authority.attempt }),
      rereadAuthority: async () => authority,
      isReplayEligible: async () => ({ eligible: true }),
    })
    expect(result).toEqual({ outcome: "continue" })
    expect(search).toHaveBeenCalledTimes(1)
  })
})
