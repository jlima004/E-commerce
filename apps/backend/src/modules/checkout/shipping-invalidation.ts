import {
  invalidateActivePaymentAttemptForCartChange,
} from "../payment-attempt/cart-invalidation"
import type { PaymentAttemptRecord } from "../payment-attempt/types"

export type PaymentAttemptModuleForCartInvalidation = {
  listPaymentAttempts?: (filters?: { cart_id?: string }) => Promise<PaymentAttemptRecord[]>
  updatePaymentAttempts?: (input: PaymentAttemptRecord) => Promise<unknown>
}

export type StructuralCartInvalidationDependencies = {
  paymentAttemptModule?: PaymentAttemptModuleForCartInvalidation
  invalidateActivePaymentAttemptForCartChange?: (
    cartId: string,
    at: Date
  ) => Promise<void> | void
  invalidateShippingQuote?: (cartId: string, at: Date) => Promise<void> | void
  invalidateShippingSelection?: (cartId: string, at: Date) => Promise<void> | void
}

async function persistPaymentAttemptInvalidation(
  paymentAttemptModule: PaymentAttemptModuleForCartInvalidation,
  cartId: string,
  at: Date
): Promise<void> {
  const attempts =
    (await paymentAttemptModule.listPaymentAttempts?.({ cart_id: cartId })) ?? []
  const result = invalidateActivePaymentAttemptForCartChange(attempts, cartId, at)

  if (result.invalidated.length > 0 && !paymentAttemptModule.updatePaymentAttempts) {
    throw new Error("PAYMENT_ATTEMPT_UPDATE_UNAVAILABLE")
  }

  for (const invalidated of result.invalidated) {
    await paymentAttemptModule.updatePaymentAttempts?.(invalidated)
  }
}

/**
 * Structural cart changes invalidate payment state and notify the future
 * shipping quote/selection owners. The latter two hooks intentionally remain
 * no-ops in Phase 15, but stay injectable so every mutation proves invocation.
 */
export async function applyStructuralCartInvalidation(
  cartId: string,
  at: Date = new Date(),
  dependencies: StructuralCartInvalidationDependencies = {}
): Promise<void> {
  if (dependencies.invalidateActivePaymentAttemptForCartChange) {
    await dependencies.invalidateActivePaymentAttemptForCartChange(cartId, at)
  } else if (dependencies.paymentAttemptModule) {
    await persistPaymentAttemptInvalidation(
      dependencies.paymentAttemptModule,
      cartId,
      at
    )
  } else {
    // Keep the real PaymentAttempt state transition as the default primitive;
    // without a module gateway there are simply no records to transition.
    invalidateActivePaymentAttemptForCartChange([], cartId, at)
  }

  await dependencies.invalidateShippingQuote?.(cartId, at)
  await dependencies.invalidateShippingSelection?.(cartId, at)
}
