import { createHash } from "node:crypto"

export const GUEST_CART_TEST_HARNESS_FORBIDDEN =
  "GUEST_CART_TEST_HARNESS_FORBIDDEN"
export const GUEST_CART_TOKEN_HEADER = "x-indicio-guest-cart-token"
export const X_INDICIO_GUEST_CART_TOKEN = "x-indicio-guest-cart-token"

export type DeterministicGuestCartClockInput = {
  seed: string
  startMs: number
}

export type DeterministicGuestCartClock = {
  readonly seed: string
  readonly startMs: number
  now(): Date
  nowMs(): number
  freeze(): void
  advance(milliseconds: number): void
  isFrozen(): boolean
}

export type DeterministicGuestCartEntropy = {
  bytes(): Buffer
  replace(bytes: Buffer): void
  randomBytesFn: (size?: number) => Buffer
}

export type SyntheticGuestCartCanary = {
  token: string
  tokenHash: string
  headerName: typeof GUEST_CART_TOKEN_HEADER
}

type GuestCartTestHarnessError = Error & { code: string }

function assertGuestCartTestHarnessAllowed(): void {
  if (process.env.NODE_ENV !== "test") {
    const error = new Error(
      GUEST_CART_TEST_HARNESS_FORBIDDEN
    ) as GuestCartTestHarnessError
    error.code = GUEST_CART_TEST_HARNESS_FORBIDDEN
    throw error
  }
}

assertGuestCartTestHarnessAllowed()

export function createDeterministicGuestCartClock(
  input: DeterministicGuestCartClockInput
): DeterministicGuestCartClock {
  assertGuestCartTestHarnessAllowed()
  let currentMs = input.startMs
  let frozen = true

  return {
    seed: input.seed,
    startMs: input.startMs,
    now(): Date {
      return new Date(currentMs)
    },
    nowMs(): number {
      return currentMs
    },
    freeze(): void {
      frozen = true
    },
    advance(milliseconds: number): void {
      currentMs += milliseconds
    },
    isFrozen(): boolean {
      return frozen
    },
  }
}

/**
 * Deterministic test entropy source that returns EXACTLY 32 bytes without
 * using HKDF, HMAC pepper, nonce, or customer-auth capabilities.
 */
export function createDeterministicGuestCartEntropy(
  seed: string
): DeterministicGuestCartEntropy {
  assertGuestCartTestHarnessAllowed()

  let counter = 0

  function deriveNext32Bytes(): Buffer {
    counter += 1
    return createHash("sha256")
      .update(`p15_guest_cart_entropy:${seed}:${counter}`, "utf8")
      .digest()
  }

  let current = deriveNext32Bytes()

  return {
    bytes(): Buffer {
      return Buffer.from(current)
    },
    replace(bytes: Buffer): void {
      if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
        throw new Error("GUEST_CART_TEST_ENTROPY_LENGTH_INVALID")
      }
      current = Buffer.from(bytes)
    },
    randomBytesFn(_size = 32): Buffer {
      const next = deriveNext32Bytes()
      current = next
      return Buffer.from(next)
    },
  }
}

export const SYNTHETIC_GUEST_CART_CANARY_TOKEN =
  "canary_guest_cart_token_p15w0_never_persist_plaintext_val"

export const SYNTHETIC_GUEST_CART_CANARY_TOKEN_HASH = createHash("sha256")
  .update(SYNTHETIC_GUEST_CART_CANARY_TOKEN, "utf8")
  .digest("hex")

export function createSyntheticGuestCartCanary(
  label = "default"
): SyntheticGuestCartCanary {
  assertGuestCartTestHarnessAllowed()
  const token = `canary_guest_cart_token_p15w0_${label}_never_persist`
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex")

  return {
    token,
    tokenHash,
    headerName: GUEST_CART_TOKEN_HEADER,
  }
}
