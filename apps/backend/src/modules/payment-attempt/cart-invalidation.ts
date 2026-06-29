import {
  normalizeBrazilPostalCode,
  normalizeBrazilProvince,
  normalizeCheckoutEmail,
  validateBrazilShippingAddress,
  type BrazilShippingAddressInput,
} from "../checkout/checkout-data"
import {
  isPaymentAttemptActive,
  markPaymentAttemptInvalidatedByCartChange,
} from "./state-machine"
import type { PaymentAttemptRecord } from "./types"

function findActiveAttemptsForCartLocal<T extends PaymentAttemptRecord>(
  attempts: T[],
  cartId: string
): T[] {
  return attempts.filter(
    (attempt) =>
      attempt.cart_id === cartId && isPaymentAttemptActive(attempt.status)
  )
}

function assertAttemptEligibleForFutureOrderLocal(
  attempt: PaymentAttemptRecord
): void {
  if (attempt.status === "invalidated_by_cart_change") {
    throw new Error("PAYMENT_ATTEMPT_INVALIDATED_BY_CART_CHANGE")
  }

  if (attempt.status === "superseded") {
    throw new Error("PAYMENT_ATTEMPT_SUPERSEDED")
  }
}

export type PaymentAttemptInvalidationReason = "invalidated_by_cart_change"

export const PAYMENT_ATTEMPT_CART_FINGERPRINT_METADATA_KEY = "cart_fingerprint"

export type PaymentAttemptCartFingerprintSource = {
  actorType: "guest" | "customer"
  email?: string | null
  customerEmail?: string | null
  items?: Array<{
    variant_id?: string | null
    quantity?: number | null
  }> | null
  shippingAddress?: BrazilShippingAddressInput | null
}

type PaymentAttemptCartFingerprintPayload = {
  email: string
  items: Array<{ variant_id: string; quantity: number }>
  shipping: {
    postal_code: string
    province: string
    city: string
  } | null
}

function resolveCheckoutEmailForFingerprint(
  source: PaymentAttemptCartFingerprintSource
): string {
  const normalized = normalizeCheckoutEmail({
    actorType: source.actorType,
    guestEmail: source.email,
    customerEmail: source.customerEmail,
  })

  return normalized.email ?? ""
}

function resolveShippingFingerprint(
  shippingAddress: BrazilShippingAddressInput | null | undefined
): PaymentAttemptCartFingerprintPayload["shipping"] {
  if (!shippingAddress) {
    return null
  }

  const validated = validateBrazilShippingAddress(shippingAddress)

  if (!validated.ok) {
    return null
  }

  return {
    postal_code: validated.normalized.postal_code,
    province: validated.normalized.province,
    city: validated.normalized.city,
  }
}

function buildFingerprintPayload(
  source: PaymentAttemptCartFingerprintSource
): PaymentAttemptCartFingerprintPayload {
  const items = (source.items ?? [])
    .map((item) => ({
      variant_id: String(item.variant_id ?? ""),
      quantity: typeof item.quantity === "number" ? item.quantity : 0,
    }))
    .sort((left, right) => left.variant_id.localeCompare(right.variant_id))

  return {
    email: resolveCheckoutEmailForFingerprint(source),
    items,
    shipping: resolveShippingFingerprint(source.shippingAddress),
  }
}

export function resolvePaymentAttemptCartFingerprint(
  source: PaymentAttemptCartFingerprintSource
): string {
  return JSON.stringify(buildFingerprintPayload(source))
}

export function readPaymentAttemptCartFingerprint(
  attempt: Pick<PaymentAttemptRecord, "metadata">
): string | null {
  const fingerprint = attempt.metadata?.[PAYMENT_ATTEMPT_CART_FINGERPRINT_METADATA_KEY]

  return typeof fingerprint === "string" && fingerprint.length > 0
    ? fingerprint
    : null
}

export function withPaymentAttemptCartFingerprintMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fingerprint: string
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    [PAYMENT_ATTEMPT_CART_FINGERPRINT_METADATA_KEY]: fingerprint,
  }
}

export function hasPaymentAttemptCartFingerprintChanged(
  previousFingerprint: string | null | undefined,
  currentFingerprint: string
): boolean {
  if (!previousFingerprint) {
    return false
  }

  return previousFingerprint !== currentFingerprint
}

export type InvalidateActivePaymentAttemptForCartChangeResult<
  T extends PaymentAttemptRecord,
> = {
  attempts: T[]
  invalidated: T[]
  reason: PaymentAttemptInvalidationReason | null
}

export function invalidateActivePaymentAttemptForCartChange<
  T extends PaymentAttemptRecord,
>(
  attempts: T[],
  cartId: string,
  at: Date = new Date()
): InvalidateActivePaymentAttemptForCartChangeResult<T> {
  const active = findActiveAttemptsForCartLocal(attempts, cartId)
  const invalidated: T[] = []

  const nextAttempts = attempts.map((attempt) => {
    if (attempt.cart_id !== cartId || !active.some((item) => item.id === attempt.id)) {
      return attempt
    }

    const updated = markPaymentAttemptInvalidatedByCartChange(attempt, at)
    invalidated.push(updated)
    return updated
  })

  return {
    attempts: nextAttempts,
    invalidated,
    reason: invalidated.length > 0 ? "invalidated_by_cart_change" : null,
  }
}

export type ReconcileStalePaymentAttemptsResult<T extends PaymentAttemptRecord> = {
  attempts: T[]
  invalidated: T[]
}

/**
 * Invalidates active attempts whose stored cart fingerprint no longer matches
 * the current cart. Retry on an unchanged cart keeps the active attempt for supersede.
 */
export function reconcileStalePaymentAttemptsForCartFingerprint<
  T extends PaymentAttemptRecord,
>(
  attempts: T[],
  cartId: string,
  currentFingerprint: string,
  at: Date = new Date()
): ReconcileStalePaymentAttemptsResult<T> {
  const active = findActiveAttemptsForCartLocal(attempts, cartId)
  const staleActive = active.filter((attempt) =>
    hasPaymentAttemptCartFingerprintChanged(
      readPaymentAttemptCartFingerprint(attempt),
      currentFingerprint
    )
  )

  if (staleActive.length === 0) {
    return {
      attempts,
      invalidated: [],
    }
  }

  const staleIds = new Set(staleActive.map((attempt) => attempt.id))
  const invalidated: T[] = []

  const nextAttempts = attempts.map((attempt) => {
    if (!staleIds.has(attempt.id)) {
      return attempt
    }

    const updated = markPaymentAttemptInvalidatedByCartChange(attempt, at)
    invalidated.push(updated)
    return updated
  })

  return {
    attempts: nextAttempts,
    invalidated,
  }
}

export function assertInvalidatedAttemptCannotAdvanceToOrder(
  attempt: PaymentAttemptRecord
): void {
  assertAttemptEligibleForFutureOrderLocal(attempt)
}

export function fingerprintShippingAddressFields(
  shippingAddress: BrazilShippingAddressInput
): {
  postal_code: string | null
  province: string | null
} {
  return {
    postal_code: normalizeBrazilPostalCode(shippingAddress.postal_code),
    province: normalizeBrazilProvince(
      shippingAddress.province ?? shippingAddress.state
    ),
  }
}
