import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto"

export const CAPABILITY_RANDOM_BYTES = 32 as const
export const CAPABILITY_PURPOSES = ["verification", "reset", "refresh"] as const
export type CapabilityPurpose = (typeof CAPABILITY_PURPOSES)[number]
export const CAPABILITY_KEY_RETENTION_MS = 8 * 24 * 60 * 60 * 1000

export type CapabilityKey = {
  version: number
  secret: string
}

export type CapabilityKeyring = {
  active: CapabilityKey
  previous: CapabilityKey[]
}

export type CapabilityMaterial = {
  hash: string
  nonce: string
  key_version: number
}

export type DerivedCustomerAuthCapability = {
  capability: string
  material: CapabilityMaterial
}

export type DeriveCustomerAuthCapabilityInput = {
  keyring: CapabilityKeyring
  purpose: CapabilityPurpose
  intentId: string
  lineageId?: string
  generation: number
  nonce: Buffer | string
  keyVersion?: number
}

function assertKeyVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("Invalid customer auth capability key version")
  }
}

function findKey(keyring: CapabilityKeyring, version: number): CapabilityKey {
  assertKeyVersion(version)
  const key = [keyring.active, ...keyring.previous].find(
    (candidate) => candidate.version === version
  )
  if (!key) {
    throw new Error("Customer auth capability key version unavailable")
  }
  return key
}

function nonceBytes(nonce: Buffer | string): Buffer {
  if (Buffer.isBuffer(nonce)) {
    return Buffer.from(nonce)
  }

  try {
    return Buffer.from(nonce, "base64url")
  } catch {
    throw new Error("Invalid customer auth capability nonce")
  }
}

export function generateCustomerAuthCapabilityNonce(
  randomBytesFn: (size: number) => Buffer = randomBytes
): Buffer {
  const nonce = randomBytesFn(CAPABILITY_RANDOM_BYTES)
  if (!Buffer.isBuffer(nonce) || nonce.length !== CAPABILITY_RANDOM_BYTES) {
    throw new Error("Invalid customer auth capability entropy")
  }
  return Buffer.from(nonce)
}

export function hashCustomerAuthCapability(capability: string): string {
  return createHash("sha256").update(capability, "utf8").digest("hex")
}

export function deriveCustomerAuthCapability(
  input: DeriveCustomerAuthCapabilityInput
): DerivedCustomerAuthCapability {
  if (!Number.isSafeInteger(input.generation) || input.generation < 1) {
    throw new Error("Invalid customer auth capability generation")
  }

  const keyVersion = input.keyVersion ?? input.keyring.active.version
  const key = findKey(input.keyring, keyVersion)
  const nonce = nonceBytes(input.nonce)
  if (nonce.length !== CAPABILITY_RANDOM_BYTES) {
    throw new Error("Invalid customer auth capability nonce")
  }

  const domain = [
    "customer-auth-capability",
    "v1",
    input.purpose,
    `key-version:${keyVersion}`,
    `intent:${input.intentId}`,
    `lineage:${input.lineageId ?? "none"}`,
    `generation:${input.generation}`,
    `nonce:${nonce.toString("base64url")}`,
  ].join("|")
  const versionedKey = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(key.secret, "utf8"),
      nonce,
      Buffer.from(`customer-auth-key:${keyVersion}:${input.purpose}`, "utf8"),
      32
    )
  )
  const capability = createHmac("sha256", versionedKey)
    .update(domain, "utf8")
    .digest("base64url")

  return {
    capability,
    material: {
      hash: hashCustomerAuthCapability(capability),
      nonce: nonce.toString("base64url"),
      key_version: keyVersion,
    },
  }
}

export function isCapabilityKeyRemovalAllowed(input: {
  pendingCount: number
  lastPendingExpiresAt: Date | null
  now: Date
}): boolean {
  if (input.pendingCount !== 0) {
    return false
  }
  if (!input.lastPendingExpiresAt) {
    return true
  }
  return (
    input.now.getTime() - input.lastPendingExpiresAt.getTime() >=
    CAPABILITY_KEY_RETENTION_MS
  )
}

function parseVersion(value: unknown, field: string): number {
  const version = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error(`Invalid ${field}: version must be a positive integer`)
  }
  return version
}

function parseSecret(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length < 32) {
    throw new Error(`Invalid ${field}: key material must be at least 32 characters`)
  }
  return value.trim()
}

export function parseCustomerAuthCapabilityKeyring(input: {
  enabled: boolean
  activeVersion?: string
  activeSecret?: string
  previousKeys?: string
}): CapabilityKeyring | undefined {
  if (!input.enabled) {
    return undefined
  }

  const active: CapabilityKey = {
    version: parseVersion(
      input.activeVersion,
      "CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY_VERSION"
    ),
    secret: parseSecret(
      input.activeSecret,
      "CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY"
    ),
  }
  let previous: unknown[] = []
  if (input.previousKeys?.trim()) {
    try {
      const parsed: unknown = JSON.parse(input.previousKeys)
      if (!Array.isArray(parsed)) {
        throw new Error("not an array")
      }
      previous = parsed
    } catch {
      throw new Error(
        "Invalid CUSTOMER_AUTH_CAPABILITY_PREVIOUS_KEYS: expected a JSON array"
      )
    }
  }

  const parsedPrevious = previous.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(
        `Invalid CUSTOMER_AUTH_CAPABILITY_PREVIOUS_KEYS entry ${index}`
      )
    }
    const value = entry as Record<string, unknown>
    return {
      version: parseVersion(
        value.version,
        `CUSTOMER_AUTH_CAPABILITY_PREVIOUS_KEYS[${index}]`
      ),
      secret: parseSecret(
        value.secret,
        `CUSTOMER_AUTH_CAPABILITY_PREVIOUS_KEYS[${index}]`
      ),
    }
  })

  const versions = [active.version, ...parsedPrevious.map((key) => key.version)]
  if (new Set(versions).size !== versions.length) {
    throw new Error("Invalid customer auth capability keyring: duplicate key version")
  }

  return { active, previous: parsedPrevious }
}
