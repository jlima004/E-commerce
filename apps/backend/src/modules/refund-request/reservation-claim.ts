const orderReservationClaims = new Map<string, Promise<unknown>>()

/**
 * Serializes refund reservation work per order within the current process.
 * Cross-dyno/worker safety depends on Redis locking or DB invariants in later slices.
 */
export async function withOrderRefundReservationClaim<T>(
  orderId: string,
  fn: () => Promise<T>
): Promise<T> {
  const normalizedOrderId = orderId.trim()

  if (!normalizedOrderId) {
    throw new Error("REFUND_REQUEST_ORDER_ID_REQUIRED")
  }

  const previous = orderReservationClaims.get(normalizedOrderId) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(fn)

  orderReservationClaims.set(normalizedOrderId, run)

  try {
    return await run
  } finally {
    if (orderReservationClaims.get(normalizedOrderId) === run) {
      orderReservationClaims.delete(normalizedOrderId)
    }
  }
}

export function resetOrderRefundReservationClaimsForTests(): void {
  orderReservationClaims.clear()
}
