export const CHECKOUT_COMPLETION_STALE_AFTER_MS = 15 * 60_000

function parseTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }

  return null
}

export function isCheckoutCompletionLockedStale(
  lockedAt: unknown,
  now: Date,
  staleAfterMs: number = CHECKOUT_COMPLETION_STALE_AFTER_MS
): boolean {
  const locked = parseTimestamp(lockedAt)

  if (!locked) {
    return false
  }

  return now.getTime() - locked.getTime() >= staleAfterMs
}
