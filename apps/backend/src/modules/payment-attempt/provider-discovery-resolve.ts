import { MedusaError } from "@medusajs/framework/utils"
import { RECONCILIATION_REASON_CODE } from "../../reconciliation/reason-codes"
import { readPersistedRequestAuthorityBlob } from "./pre-provider-arbitration"
import type { DurablePreProviderAuthority } from "./pre-provider-arbitration"
import {
  assertCompleteStripePaymentIntentCreateAuthorityV1,
} from "./provider-request-authority"
import type { StripeProviderDiscoveryResult } from "./card"
import type { StripePaymentIntentLike } from "./stripe-safe"
import type {
  ClaimProviderDiscoveryResult,
  SameOperationReplayEligibility,
} from "./transactional-authority"
import type { PaymentMethodType } from "./types"

export type ProviderDiscoveryStripeLayer = {
  discoverPaymentIntentsByPaymentAttemptId?: (
    paymentAttemptId: string
  ) => Promise<StripeProviderDiscoveryResult>
}

function throwReconciliationRequired(reasonCode: string): never {
  throw new MedusaError(MedusaError.Types.CONFLICT, reasonCode)
}

function readBoundProviderPaymentIntentId(
  authority: DurablePreProviderAuthority
): string | null {
  const boundId = authority.attempt.provider_payment_intent_id
  if (typeof boundId === "string" && boundId.trim().length > 0) {
    return boundId.trim()
  }
  return null
}

export function reconstructBoundStripePaymentIntentFromAuthority(
  authority: DurablePreProviderAuthority,
  providerPaymentIntentId: string,
  paymentMethodType: PaymentMethodType,
  options: { client_secret?: string | null } = {}
): StripePaymentIntentLike {
  const v1 = assertCompleteStripePaymentIntentCreateAuthorityV1(
    readPersistedRequestAuthorityBlob(authority.attempt.metadata)
  )
  const intent: StripePaymentIntentLike = {
    id: providerPaymentIntentId.trim(),
    amount: authority.amount_minor,
    currency: "brl",
    payment_method_types: [paymentMethodType],
    metadata: { ...v1.canonical_request.metadata },
  }
  const clientSecret =
    typeof options.client_secret === "string" &&
    options.client_secret.trim().length > 0
      ? options.client_secret.trim()
      : null
  if (clientSecret) {
    intent.client_secret = clientSecret
  }
  return intent
}

export type ResolveProviderDiscoveryAfterAuthorityClaimInput = {
  authority: DurablePreProviderAuthority
  paymentMethodType: PaymentMethodType
  stripeLayer: ProviderDiscoveryStripeLayer
  claimDiscovery: () => Promise<ClaimProviderDiscoveryResult>
  rereadAuthority: () => Promise<DurablePreProviderAuthority>
  isReplayEligible: () => Promise<SameOperationReplayEligibility>
  readClientSecretForBoundReuse?: () =>
    | string
    | null
    | undefined
    | Promise<string | null | undefined>
}

export type ResolveProviderDiscoveryAfterAuthorityClaimResult =
  | { outcome: "resolved"; payment_intent: StripePaymentIntentLike }
  | { outcome: "continue" }

export async function resolveProviderDiscoveryAfterAuthorityClaim(
  input: ResolveProviderDiscoveryAfterAuthorityClaimInput
): Promise<ResolveProviderDiscoveryAfterAuthorityClaimResult> {
  const claim = await input.claimDiscovery()

  if (!claim.claimed) {
    const reread = await input.rereadAuthority()
    const boundId = readBoundProviderPaymentIntentId(reread)
    if (boundId) {
      const clientSecret = input.readClientSecretForBoundReuse
        ? await Promise.resolve(input.readClientSecretForBoundReuse())
        : null
      return {
        outcome: "resolved",
        payment_intent: reconstructBoundStripePaymentIntentFromAuthority(
          reread,
          boundId,
          input.paymentMethodType,
          {
            client_secret: clientSecret ?? null,
          }
        ),
      }
    }
    throwReconciliationRequired(
      RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED
    )
  }

  const discovery =
    typeof input.stripeLayer.discoverPaymentIntentsByPaymentAttemptId ===
    "function"
      ? await input.stripeLayer.discoverPaymentIntentsByPaymentAttemptId(
          input.authority.attempt.id
        )
      : {
          matches: [],
          unresolved: true,
          reason: RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED,
        }

  if (
    discovery.reconciliation_required ||
    (Array.isArray(discovery.matches) && discovery.matches.length > 1)
  ) {
    throwReconciliationRequired("RECONCILIATION_REQUIRED")
  }

  if (discovery.matches.length === 1) {
    return {
      outcome: "resolved",
      payment_intent: discovery.matches[0],
    }
  }

  const replay = await input.isReplayEligible()
  if (!replay.eligible) {
    throwReconciliationRequired(
      RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED
    )
  }

  return { outcome: "continue" }
}
