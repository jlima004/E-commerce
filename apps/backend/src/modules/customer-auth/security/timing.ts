import { createHmac, randomInt } from "node:crypto"
import type { AuthRateLimitKeyring, AuthRateLimitOperation } from "./rate-limit"

export const AUTH_TIMING_FLOOR_MS = 350
export const AUTH_TIMING_MAX_JITTER_MS = 50

export function runAuthDummyWork(
  keyring: AuthRateLimitKeyring,
  operation: AuthRateLimitOperation,
  preDigest: string
): string {
  return createHmac("sha256", keyring.active.secret)
    .update(
      `auth-timing-dummy|key-version:${keyring.active.version}|operation:${operation}|pre-digest:${preDigest}`,
      "utf8"
    )
    .digest("hex")
}

export async function applyAuthTimingEnvelope(input: {
  startedAtMs: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  randomInt?: (minimum: number, maximum: number) => number
}): Promise<number> {
  const now = input.now ?? Date.now
  const sleep = input.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
  const random = input.randomInt ?? randomInt
  const target = AUTH_TIMING_FLOOR_MS + random(0, AUTH_TIMING_MAX_JITTER_MS + 1)
  const remaining = Math.max(0, target - (now() - input.startedAtMs))
  if (remaining > 0) await sleep(remaining)
  return now() - input.startedAtMs
}
