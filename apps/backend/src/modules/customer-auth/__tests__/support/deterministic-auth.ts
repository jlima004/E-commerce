import {
  createHash,
  createHmac,
  hkdfSync,
} from "node:crypto"

export const AUTH_TEST_HARNESS_FORBIDDEN = "AUTH_TEST_HARNESS_FORBIDDEN"

export type DeterministicAuthClockInput = {
  seed: string
  startMs: number
}

export type DeterministicAuthClock = {
  readonly seed: string
  readonly startMs: number
  now(): Date
  nowMs(): number
  freeze(): void
  advance(milliseconds: number): void
  isFrozen(): boolean
}

export type DeterministicAuthEntropy = {
  bytes(): Buffer
  replace(bytes: Buffer): void
}

export type DeriveSyntheticCapabilityInput = {
  secret: string
  keyVersion: number
  type: string
  intentId: string
  generation: number
  nonce: string
}

export type SyntheticCapabilityMaterial = {
  hash: string
  nonce: string
  key_version: number
}

export type SyntheticCapability = {
  capability: string
  material: SyntheticCapabilityMaterial
}

export type SyntheticIdempotencyKeyInput = {
  seed: string
  operation: string
}

type AuthTestHarnessError = Error & { code: string }

function assertAuthTestHarnessAllowed(): void {
  if (process.env.NODE_ENV !== "test") {
    const error = new Error(AUTH_TEST_HARNESS_FORBIDDEN) as AuthTestHarnessError
    error.code = AUTH_TEST_HARNESS_FORBIDDEN
    throw error
  }
}

assertAuthTestHarnessAllowed()

function deriveKeyedBytes(
  seed: string,
  salt: string,
  info: string,
  length = 32
): Buffer {
  return Buffer.from(hkdfSync("sha256", seed, salt, info, length))
}

export function createDeterministicAuthClock(
  input: DeterministicAuthClockInput
): DeterministicAuthClock {
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

export function createDeterministicAuthEntropy(
  seed: string
): DeterministicAuthEntropy {
  let current = deriveKeyedBytes(
    seed,
    "p14-auth-entropy",
    "deterministic-auth-entropy-v1",
    32
  )

  return {
    bytes(): Buffer {
      return Buffer.from(current)
    },
    replace(bytes: Buffer): void {
      if (!Buffer.isBuffer(bytes) || bytes.length !== 32) {
        throw new Error("AUTH_TEST_ENTROPY_LENGTH_INVALID")
      }
      current = Buffer.from(bytes)
    },
  }
}

export function deriveSyntheticCapability(
  input: DeriveSyntheticCapabilityInput
): SyntheticCapability {
  const info = `capability:${input.type}:${input.intentId}:${input.generation}`
  const versionedKey = Buffer.from(
    hkdfSync(
      "sha256",
      input.secret,
      input.nonce,
      `customer-auth-capability-v${input.keyVersion}:${info}`,
      32
    )
  )
  const capability = createHmac("sha256", versionedKey)
    .update(info)
    .digest("base64url")
  const hash = createHash("sha256").update(capability, "utf8").digest("hex")

  return {
    capability,
    material: {
      hash,
      nonce: input.nonce,
      key_version: input.keyVersion,
    },
  }
}

export function createSyntheticIdempotencyKey(
  input: SyntheticIdempotencyKeyInput
): string {
  const digest = createHmac("sha256", input.seed)
    .update(input.operation)
    .digest("hex")
  return `idem_p14w0_${digest}`
}
