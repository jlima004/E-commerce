import { MedusaService } from "@medusajs/framework/utils"
import PaymentAttempt from "./models/payment-attempt"
import {
  assertNoSensitivePaymentAttemptMetadata,
  isPaymentAttemptActive,
  markPaymentAttemptInvalidatedByCartChange,
  markPaymentAttemptSuperseded,
} from "./state-machine"
import type {
  CreatePaymentAttemptInput,
  PaymentAttemptRecord,
  PaymentAttemptStatus,
} from "./types"

class PaymentAttemptModuleService extends MedusaService({
  PaymentAttempt,
}) {}

export default PaymentAttemptModuleService

export type SupersedeActiveAttemptsResult<T extends PaymentAttemptRecord> = {
  superseded: T[]
  remainingActiveCount: number
}

export function findActiveAttemptsForCart<T extends PaymentAttemptRecord>(
  attempts: T[],
  cartId: string
): T[] {
  return attempts.filter(
    (attempt) =>
      attempt.cart_id === cartId && isPaymentAttemptActive(attempt.status)
  )
}

export function assertAtMostOneActiveAttemptPerCart(
  attempts: PaymentAttemptRecord[],
  cartId: string
): void {
  const active = findActiveAttemptsForCart(attempts, cartId)

  if (active.length > 1) {
    throw new Error("PAYMENT_ATTEMPT_MULTIPLE_ACTIVE")
  }
}

export function supersedeActiveAttemptsForCart<T extends PaymentAttemptRecord>(
  attempts: T[],
  cartId: string,
  at: Date = new Date()
): SupersedeActiveAttemptsResult<T> {
  assertAtMostOneActiveAttemptPerCart(attempts, cartId)

  const active = findActiveAttemptsForCart(attempts, cartId)
  const superseded = active.map((attempt) =>
    markPaymentAttemptSuperseded(attempt, at)
  )

  return {
    superseded,
    remainingActiveCount: 0,
  }
}

export function buildNewPaymentAttemptRecord(
  input: CreatePaymentAttemptInput,
  id: string,
  at: Date = new Date()
): PaymentAttemptRecord {
  assertNoSensitivePaymentAttemptMetadata(input.metadata ?? null)

  return {
    id,
    cart_id: input.cart_id,
    payment_collection_id: input.payment_collection_id,
    payment_session_id: input.payment_session_id ?? null,
    provider: input.provider,
    provider_payment_intent_id: input.provider_payment_intent_id ?? null,
    provider_payment_session_id: input.provider_payment_session_id ?? null,
    payment_method_type: input.payment_method_type,
    status: "created",
    amount: input.amount,
    currency_code: input.currency_code.toLowerCase(),
    expires_at: input.expires_at ?? null,
    order_id: null,
    metadata: input.metadata ?? null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: null,
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
  }
}

export type CreateAttemptWithSupersedeResult = {
  supersededAttempts: PaymentAttemptRecord[]
  newAttempt: PaymentAttemptRecord
}

/**
 * Creates a fresh attempt for the cart, superseding any prior active attempt.
 * Historical attempts remain in the input array for auditability; callers persist
 * both superseded updates and the new row. Requires DB unique partial index
 * (see TBD-payment-attempt migration) before production use.
 */
export function createPaymentAttemptReplacingActive(
  existingAttempts: PaymentAttemptRecord[],
  input: CreatePaymentAttemptInput,
  newAttemptId: string,
  at: Date = new Date()
): CreateAttemptWithSupersedeResult {
  const { superseded } = supersedeActiveAttemptsForCart(
    existingAttempts,
    input.cart_id,
    at
  )

  const newAttempt = buildNewPaymentAttemptRecord(input, newAttemptId, at)

  const merged = [
    ...existingAttempts.map((attempt) => {
      const updated = superseded.find((item) => item.id === attempt.id)
      return updated ?? attempt
    }),
    newAttempt,
  ]

  assertAtMostOneActiveAttemptPerCart(merged, input.cart_id)

  return {
    supersededAttempts: superseded,
    newAttempt,
  }
}

export function invalidateActiveAttemptsForCartChange<
  T extends PaymentAttemptRecord,
>(attempts: T[], cartId: string, at: Date = new Date()): T[] {
  assertAtMostOneActiveAttemptPerCart(attempts, cartId)

  return attempts.map((attempt) => {
    if (attempt.cart_id !== cartId || !isPaymentAttemptActive(attempt.status)) {
      return attempt
    }

    return markPaymentAttemptInvalidatedByCartChange(attempt, at)
  })
}

export function assertAttemptEligibleForFutureOrder(
  attempt: PaymentAttemptRecord
): void {
  if (attempt.status === "invalidated_by_cart_change") {
    throw new Error("PAYMENT_ATTEMPT_INVALIDATED_BY_CART_CHANGE")
  }

  if (attempt.status === "superseded") {
    throw new Error("PAYMENT_ATTEMPT_SUPERSEDED")
  }
}

export function withPaymentAttemptStatus<T extends PaymentAttemptRecord>(
  attempt: T,
  status: PaymentAttemptStatus
): T {
  return {
    ...attempt,
    status,
    order_id: null,
  }
}
