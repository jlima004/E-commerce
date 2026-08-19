import { MedusaService } from "@medusajs/framework/utils"
import GuestCartCapability from "./models/guest-cart-capability"
import {
  generateGuestCartCapability,
  hashGuestCartCapability,
} from "./hash"
import {
  GUEST_CART_CAPABILITY_PLAINTEXT_FORBIDDEN,
  GUEST_CART_CAPABILITY_STATUS,
  type GuestCartCapabilityRecord,
  type GuestCartCapabilityStatus,
  type MintGuestCartCapabilityInput,
  type MintGuestCartCapabilityResult,
} from "./types"

export const GUEST_CART_CAPABILITY_TTL_ROLLING_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const GUEST_CART_CAPABILITY_TTL_MAX_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

const FORBIDDEN_RECORD_KEYS = new Set([
  "plaintext_token",
  "plaintext",
  "token",
  "raw_token",
  "capability",
  "nonce",
  "jwt",
  "cookie",
  "secret",
  "pepper",
  "hkdf",
  "recovery_code",
])

export function assertRecordHasNoPlaintext(
  target: unknown
): void {
  if (!target || typeof target !== "object") {
    return
  }

  for (const key of Object.keys(target as Record<string, unknown>)) {
    const normalized = key.trim().toLowerCase()
    if (FORBIDDEN_RECORD_KEYS.has(normalized)) {
      throw new Error(GUEST_CART_CAPABILITY_PLAINTEXT_FORBIDDEN)
    }
  }
}

export function computeInitialExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + GUEST_CART_CAPABILITY_TTL_ROLLING_MS)
}

export function computeRollingExpiresAt(
  createdAt: Date | string,
  now: Date = new Date()
): Date {
  const createdDate = typeof createdAt === "string" ? new Date(createdAt) : createdAt
  const maxExpiresAt = new Date(createdDate.getTime() + GUEST_CART_CAPABILITY_TTL_MAX_MS)
  const rollingExpiresAt = new Date(now.getTime() + GUEST_CART_CAPABILITY_TTL_ROLLING_MS)

  if (rollingExpiresAt.getTime() > maxExpiresAt.getTime()) {
    return maxExpiresAt
  }

  return rollingExpiresAt
}

export function isGuestCartCapabilityExpired(
  record: Pick<GuestCartCapabilityRecord, "expires_at">,
  now: Date = new Date()
): boolean {
  const expiresAt = typeof record.expires_at === "string"
    ? new Date(record.expires_at)
    : record.expires_at

  if (Number.isNaN(expiresAt.getTime())) {
    return true
  }

  return expiresAt.getTime() <= now.getTime()
}

export function isGuestCartCapabilityActive(
  record: Pick<
    GuestCartCapabilityRecord,
    "status" | "expires_at" | "revoked_at" | "consumed_at"
  >,
  now: Date = new Date()
): boolean {
  if (record.status !== GUEST_CART_CAPABILITY_STATUS.ACTIVE) {
    return false
  }

  if (record.revoked_at || record.consumed_at) {
    return false
  }

  if (isGuestCartCapabilityExpired(record, now)) {
    return false
  }

  return true
}

export function buildGuestCartCapabilityRecord(
  input: {
    cart_id: string
    token_hash: string
    expires_at?: Date | string
  },
  id: string,
  now: Date = new Date()
): GuestCartCapabilityRecord {
  assertRecordHasNoPlaintext(input)

  if (!input.cart_id || typeof input.cart_id !== "string") {
    throw new Error("GUEST_CART_CAPABILITY_CART_ID_REQUIRED")
  }

  if (!input.token_hash || typeof input.token_hash !== "string") {
    throw new Error("GUEST_CART_CAPABILITY_TOKEN_HASH_REQUIRED")
  }

  const expiresAt = input.expires_at
    ? (typeof input.expires_at === "string" ? new Date(input.expires_at) : input.expires_at)
    : computeInitialExpiresAt(now)

  const record: GuestCartCapabilityRecord = {
    id,
    cart_id: input.cart_id,
    token_hash: input.token_hash,
    status: GUEST_CART_CAPABILITY_STATUS.ACTIVE,
    expires_at: expiresAt.toISOString(),
    consumed_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    deleted_at: null,
  }

  assertRecordHasNoPlaintext(record)
  return record
}

export function mintGuestCartCapabilityInMemory(
  input: MintGuestCartCapabilityInput,
  options: {
    id: string
    now?: Date
    randomBytesFn?: (size: number) => Buffer
  }
): MintGuestCartCapabilityResult {
  assertRecordHasNoPlaintext(input)

  const plaintextToken = generateGuestCartCapability(options.randomBytesFn)
  const tokenHash = hashGuestCartCapability(plaintextToken)

  const record = buildGuestCartCapabilityRecord(
    {
      cart_id: input.cart_id,
      token_hash: tokenHash,
      expires_at: input.expires_at,
    },
    options.id,
    options.now
  )

  return {
    record,
    plaintext_token: plaintextToken,
  }
}

export function buildGuestCartCapabilityExpiryUpdate(
  now: Date = new Date()
): Pick<GuestCartCapabilityRecord, "status" | "updated_at"> {
  return {
    status: GUEST_CART_CAPABILITY_STATUS.EXPIRED,
    updated_at: now.toISOString(),
  }
}

export function buildGuestCartCapabilityRevocationUpdate(
  now: Date = new Date()
): Pick<GuestCartCapabilityRecord, "status" | "revoked_at" | "updated_at"> {
  return {
    status: GUEST_CART_CAPABILITY_STATUS.REVOKED,
    revoked_at: now.toISOString(),
    updated_at: now.toISOString(),
  }
}

export function buildGuestCartCapabilityConsumptionUpdate(
  now: Date = new Date()
): Pick<GuestCartCapabilityRecord, "status" | "consumed_at" | "updated_at"> {
  return {
    status: GUEST_CART_CAPABILITY_STATUS.CONSUMED,
    consumed_at: now.toISOString(),
    updated_at: now.toISOString(),
  }
}

export function buildGuestCartCapabilityTouchRollingUpdate(
  createdAt: Date | string,
  now: Date = new Date()
): Pick<GuestCartCapabilityRecord, "expires_at" | "last_used_at" | "updated_at"> {
  const newExpiresAt = computeRollingExpiresAt(createdAt, now)
  return {
    expires_at: newExpiresAt.toISOString(),
    last_used_at: now.toISOString(),
    updated_at: now.toISOString(),
  }
}

export class GuestCartCapabilityModuleService extends MedusaService({
  GuestCartCapability,
}) {}

export default GuestCartCapabilityModuleService
