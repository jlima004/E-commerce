import {
  RECONCILIATION_REASON_CODE,
  type ReconciliationReasonCode,
} from "../../reconciliation/reason-codes"
import { buildPaymentAttemptProviderIdempotencyKey } from "./durable-initiation"
import type { PaymentAttemptRecord, PaymentMethodType } from "./types"

const PRE_PROVIDER_CART_VERSION_UNBOUND = "PAYMENT_ATTEMPT_CART_VERSION_UNBOUND"

export const PRE_PROVIDER_ARBITRATION_DECISION = {
  NEW_ATTEMPT_ALLOWED: "NEW_ATTEMPT_ALLOWED",
  REUSE_SAME_OPERATION: "REUSE_SAME_OPERATION",
  DISCOVER_SAME_OPERATION: "DISCOVER_SAME_OPERATION",
  RECONCILIATION_REQUIRED: "RECONCILIATION_REQUIRED",
} as const

export type PreProviderArbitrationDecision =
  (typeof PRE_PROVIDER_ARBITRATION_DECISION)[keyof typeof PRE_PROVIDER_ARBITRATION_DECISION]

export const STRIPE_PAYMENT_INTENT_CREATE_METADATA_KEY =
  "stripe_payment_intent_create" as const
export const STRIPE_PAYMENT_INTENT_CREATE_SCHEMA =
  "stripe_payment_intent_create" as const
export const STRIPE_PAYMENT_INTENT_CREATE_VERSION = 1
export const PROVIDER_IDEMPOTENCY_KEY_METADATA_KEY = "provider_idempotency_key"

export type PreProviderRequestedOperation = {
  cart_id: string
  cart_resource_version: number
  payment_method_type: PaymentMethodType
  amount_minor: number
  currency_code: "brl"
  payment_attempt_id?: string
  idempotency_key?: string
  payment_collection_id?: string | null
  payment_session_id?: string | null
}

export type PersistPreProviderFinancialFreezeInput = PreProviderRequestedOperation & {
  payment_attempt_id: string
}

export type PreProviderArbitrationResult =
  | { decision: "NEW_ATTEMPT_ALLOWED" }
  | { decision: "REUSE_SAME_OPERATION"; attempt: PaymentAttemptRecord }
  | { decision: "DISCOVER_SAME_OPERATION"; attempt: PaymentAttemptRecord }
  | {
      decision: "RECONCILIATION_REQUIRED"
      reason_code: ReconciliationReasonCode
      frozen_attempt_ids: string[]
    }

export type DurablePreProviderAuthority = {
  attempt: PaymentAttemptRecord
  cart_resource_version: number
  amount_minor: number
  currency_code: "brl"
  payment_method_type: PaymentMethodType
  provider_idempotency_key: string
  financial_freeze_started_at: Date | string
  authority_created_at: string
  replay_deadline: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function assertValidPreProviderCartResourceVersion(
  value: unknown
): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value
  }
  throw new Error(PRE_PROVIDER_CART_VERSION_UNBOUND)
}

export function readPreProviderCartResourceVersion(
  attempt: Pick<PaymentAttemptRecord, "metadata">
): number | null {
  const value = attempt.metadata?.cart_resource_version
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

export function readPersistedRequestAuthorityBlob(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const value = metadata?.[STRIPE_PAYMENT_INTENT_CREATE_METADATA_KEY]
  if (value === undefined || value === null) {
    return null
  }
  return isRecord(value) ? value : {}
}

export function isStripePaymentIntentCreateAuthorityV1(
  blob: Record<string, unknown> | null
): boolean {
  if (!blob) {
    return false
  }
  const version = blob.version
  return (
    blob.schema === STRIPE_PAYMENT_INTENT_CREATE_SCHEMA &&
    (version === STRIPE_PAYMENT_INTENT_CREATE_VERSION || version === "1")
  )
}

export function readFrozenAttemptDurableIdempotencyKey(
  attempt: Pick<PaymentAttemptRecord, "id" | "payment_method_type" | "metadata">
): string | null {
  const stored = attempt.metadata?.[PROVIDER_IDEMPOTENCY_KEY_METADATA_KEY]
  const reconstructed = buildPaymentAttemptProviderIdempotencyKey(
    attempt.payment_method_type,
    attempt.id
  )
  if (typeof stored === "string" && stored.trim().length > 0) {
    const normalized = stored.trim()
    return normalized === reconstructed ? normalized : null
  }
  return reconstructed
}

export function resolveRequestedIdempotencyKey(
  requested: PreProviderRequestedOperation
): string | null {
  const derived =
    typeof requested.payment_attempt_id === "string" &&
    requested.payment_attempt_id.trim().length > 0
      ? buildPaymentAttemptProviderIdempotencyKey(
          requested.payment_method_type,
          requested.payment_attempt_id
        )
      : null
  const provided =
    typeof requested.idempotency_key === "string" &&
    requested.idempotency_key.trim().length > 0
      ? requested.idempotency_key.trim()
      : null

  if (provided && derived && provided !== derived) {
    return null
  }
  return provided ?? derived
}

export function persistedRequestAuthorityDisagrees(
  blob: Record<string, unknown> | null,
  requested: PreProviderRequestedOperation,
  requestedKey: string | null
): boolean {
  if (!blob) {
    return false
  }
  if (!isStripePaymentIntentCreateAuthorityV1(blob)) {
    return true
  }
  return blobIdentityDisagrees(blob, requested, requestedKey)
}

function blobIdentityDisagrees(
  blob: Record<string, unknown>,
  requested: PreProviderRequestedOperation,
  requestedKey: string | null
): boolean {
  const comparisons: Array<[string, unknown]> = [
    ["cart_id", requested.cart_id],
    ["payment_attempt_id", requested.payment_attempt_id],
    ["payment_method_type", requested.payment_method_type],
    ["currency_code", requested.currency_code],
    ["currency", requested.currency_code],
    ["amount_minor", requested.amount_minor],
    ["amount", requested.amount_minor],
    ["cart_resource_version", requested.cart_resource_version],
    ["provider_idempotency_key", requestedKey],
    ["idempotency_key", requestedKey],
    ["payment_collection_id", requested.payment_collection_id],
    ["payment_session_id", requested.payment_session_id],
  ]

  for (const [key, expected] of comparisons) {
    if (!Object.prototype.hasOwnProperty.call(blob, key)) {
      continue
    }
    if (expected === undefined || expected === null) {
      continue
    }
    if (blob[key] !== expected) {
      return true
    }
  }
  return false
}

function isProviderPaymentIntentBound(
  attempt: Pick<PaymentAttemptRecord, "provider_payment_intent_id">
): boolean {
  return (
    typeof attempt.provider_payment_intent_id === "string" &&
    attempt.provider_payment_intent_id.trim().length > 0
  )
}

function frozenAttemptIds(frozen: PaymentAttemptRecord[]): string[] {
  return frozen.map((attempt) => attempt.id)
}

function reconciliation(
  reason_code: ReconciliationReasonCode,
  frozen: PaymentAttemptRecord[]
): PreProviderArbitrationResult {
  return {
    decision: PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED,
    reason_code,
    frozen_attempt_ids: frozenAttemptIds(frozen),
  }
}

export function isExactSamePreProviderOperation(
  frozen: PaymentAttemptRecord,
  requested: PreProviderRequestedOperation
): boolean {
  const requestedKey = resolveRequestedIdempotencyKey(requested)
  const frozenKey = readFrozenAttemptDurableIdempotencyKey(frozen)
  const frozenVersion = readPreProviderCartResourceVersion(frozen)
  const reconstructedFrozenKey = buildPaymentAttemptProviderIdempotencyKey(
    frozen.payment_method_type,
    frozen.id
  )

  if (
    typeof requested.payment_attempt_id === "string" &&
    requested.payment_attempt_id.trim().length > 0 &&
    requested.payment_attempt_id !== frozen.id
  ) {
    return false
  }

  if (
    typeof requested.payment_collection_id === "string" &&
    requested.payment_collection_id.trim().length > 0 &&
    requested.payment_collection_id !== frozen.payment_collection_id
  ) {
    return false
  }

  if (
    typeof requested.payment_session_id === "string" &&
    requested.payment_session_id.trim().length > 0 &&
    requested.payment_session_id !== frozen.payment_session_id
  ) {
    return false
  }

  return (
    requested.cart_id === frozen.cart_id &&
    requested.payment_method_type === frozen.payment_method_type &&
    requested.amount_minor === frozen.amount &&
    frozen.currency_code === requested.currency_code &&
    frozenVersion !== null &&
    frozenVersion === requested.cart_resource_version &&
    frozenKey !== null &&
    frozenKey === reconstructedFrozenKey &&
    (requestedKey === null || requestedKey === frozenKey)
  )
}

/**
 * Pure pre-provider arbitration. No Stripe. No clock.
 */
export function arbitratePreProviderPaymentAttempt(
  frozen: PaymentAttemptRecord[],
  requested: PreProviderRequestedOperation
): PreProviderArbitrationResult {
  assertValidPreProviderCartResourceVersion(requested.cart_resource_version)

  if (frozen.length === 0) {
    return { decision: PRE_PROVIDER_ARBITRATION_DECISION.NEW_ATTEMPT_ALLOWED }
  }

  if (frozen.length > 1) {
    return reconciliation(
      RECONCILIATION_REASON_CODE.MULTIPLE_FROZEN_PAYMENT_ATTEMPTS,
      frozen
    )
  }

  const attempt = frozen[0]
  const blob = readPersistedRequestAuthorityBlob(attempt.metadata)
  const requestedKey = resolveRequestedIdempotencyKey(requested)
  const sameOperation = isExactSamePreProviderOperation(attempt, requested)
  const validV1 = isStripePaymentIntentCreateAuthorityV1(blob)
  const legacyUnknown =
    attempt.reconciliation_reason_code ===
    RECONCILIATION_REASON_CODE.LEGACY_PROVIDER_DISPATCH_UNKNOWN

  if (blob && (!validV1 || blobIdentityDisagrees(blob, requested, requestedKey))) {
    return reconciliation(
      RECONCILIATION_REASON_CODE.PROVIDER_REQUEST_AUTHORITY_MISMATCH,
      frozen
    )
  }

  if (!validV1 || legacyUnknown || !sameOperation) {
    return reconciliation(
      RECONCILIATION_REASON_CODE.FROZEN_PAYMENT_AUTHORITY_MISMATCH,
      frozen
    )
  }

  if (isProviderPaymentIntentBound(attempt)) {
    return {
      decision: PRE_PROVIDER_ARBITRATION_DECISION.REUSE_SAME_OPERATION,
      attempt,
    }
  }

  return {
    decision: PRE_PROVIDER_ARBITRATION_DECISION.DISCOVER_SAME_OPERATION,
    attempt,
  }
}
