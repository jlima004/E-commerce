import { MedusaService } from "@medusajs/framework/utils"
import type { Context } from "@medusajs/framework/types"
import GuestCartCapability from "./models/guest-cart-capability"
import {
  compareGuestCartCapabilityHash,
  generateGuestCartCapability,
  hashGuestCartCapability,
  performDummyGuestCartCapabilityHashComparison,
} from "./hash"
import {
  GUEST_CART_CAPABILITY_LOOKUP_INVALID,
  GUEST_CART_CAPABILITY_PLAINTEXT_FORBIDDEN,
  GUEST_CART_CAPABILITY_STATUS,
  type GuestCartCapabilityRecord,
  type GuestCartCapabilityStatus,
  type LookupGuestCartCapabilityOptions,
  type MintGuestCartCapabilityInput,
  type MintGuestCartCapabilityResult,
} from "./types"

export const GUEST_CART_CAPABILITY_TTL_ROLLING_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
export const GUEST_CART_CAPABILITY_TTL_MAX_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
export const GUEST_CART_CAPABILITY_ROLLING_TTL_MS = GUEST_CART_CAPABILITY_TTL_ROLLING_MS
export const GUEST_CART_CAPABILITY_ABSOLUTE_TTL_MS = GUEST_CART_CAPABILITY_TTL_MAX_MS

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
}) {
  /**
   * Mint a new guest cart capability.
   * Generates a CSPRNG token, persists its SHA-256 hash in PostgreSQL, and returns
   * the persisted record alongside the one-time plaintext token.
   */
  async mintGuestCartCapability(
    input: MintGuestCartCapabilityInput,
    sharedContext?: Context
  ): Promise<MintGuestCartCapabilityResult> {
    assertRecordHasNoPlaintext(input)

    if (!input.cart_id || typeof input.cart_id !== "string" || input.cart_id.trim() === "") {
      throw new Error("GUEST_CART_CAPABILITY_CART_ID_REQUIRED")
    }

    const now = input.now instanceof Date ? input.now : new Date()
    const plaintextToken = generateGuestCartCapability(input.randomBytesFn)
    const tokenHash = hashGuestCartCapability(plaintextToken)

    const initialExpiresAt = input.expires_at
      ? (typeof input.expires_at === "string" ? new Date(input.expires_at) : input.expires_at)
      : computeInitialExpiresAt(now)

    const created = await (this as any).createGuestCartCapabilities(
      {
        cart_id: input.cart_id,
        token_hash: tokenHash,
        status: GUEST_CART_CAPABILITY_STATUS.ACTIVE,
        expires_at: initialExpiresAt,
        consumed_at: null,
        revoked_at: null,
        last_used_at: null,
      },
      sharedContext
    )

    const record = Array.isArray(created) ? created[0] : created
    assertRecordHasNoPlaintext(record)

    return {
      record: record as GuestCartCapabilityRecord,
      plaintext_token: plaintextToken,
    }
  }

  /**
   * Look up a guest cart capability by exact presented token and perform rolling touch.
   * Validates exact string token (no trim normalization), constant-time hash comparison,
   * active status and unexpired check, then touches last_used_at and updates rolling expires_at
   * (capped at 30 days from created_at).
   */
  async lookupGuestCartCapabilityByPresentedToken(
    presentedToken: string,
    options?: LookupGuestCartCapabilityOptions,
    sharedContext?: Context
  ): Promise<GuestCartCapabilityRecord> {
    // Exact token semantics: no .trim() normalization, token is exact secret string
    if (typeof presentedToken !== "string" || presentedToken.length === 0) {
      performDummyGuestCartCapabilityHashComparison()
      throw new Error(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    }

    let presentedHash: string
    try {
      presentedHash = hashGuestCartCapability(presentedToken)
    } catch {
      performDummyGuestCartCapabilityHashComparison()
      throw new Error(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    }

    const now = options?.now instanceof Date ? options.now : new Date()
    const shouldTouch = options?.touch !== false

    const candidates = await (this as any).listGuestCartCapabilities(
      { token_hash: presentedHash },
      { take: 1 },
      sharedContext
    )

    const candidate = (candidates?.[0] ?? null) as GuestCartCapabilityRecord | null

    if (!candidate) {
      performDummyGuestCartCapabilityHashComparison()
      throw new Error(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    }

    const isMatch = compareGuestCartCapabilityHash(presentedHash, candidate.token_hash)
    if (!isMatch) {
      throw new Error(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    }

    if (candidate.status !== GUEST_CART_CAPABILITY_STATUS.ACTIVE) {
      throw new Error(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    }

    if (candidate.consumed_at || candidate.revoked_at) {
      throw new Error(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    }

    if (isGuestCartCapabilityExpired(candidate, now)) {
      await (this as any).updateGuestCartCapabilities(
        {
          id: candidate.id,
          status: GUEST_CART_CAPABILITY_STATUS.EXPIRED,
        },
        sharedContext
      )
      throw new Error(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    }

    if (!shouldTouch) {
      return candidate
    }

    // Touch: rolling 7d TTL capped at 30d from created_at
    const newExpiresAt = computeRollingExpiresAt(candidate.created_at, now)
    const updated = await (this as any).updateGuestCartCapabilities(
      {
        id: candidate.id,
        last_used_at: now,
        expires_at: newExpiresAt,
      },
      sharedContext
    )

    const touchedRecord = Array.isArray(updated) ? updated[0] : updated
    assertRecordHasNoPlaintext(touchedRecord)
    return touchedRecord as GuestCartCapabilityRecord
  }

  /**
   * Consume a capability (e.g. upon cart checkout or customer attachment).
   */
  async consumeGuestCartCapability(
    id: string,
    options?: { now?: Date },
    sharedContext?: Context
  ): Promise<GuestCartCapabilityRecord> {
    if (!id || typeof id !== "string") {
      throw new Error("GUEST_CART_CAPABILITY_ID_REQUIRED")
    }

    const now = options?.now instanceof Date ? options.now : new Date()
    const updated = await (this as any).updateGuestCartCapabilities(
      {
        id,
        status: GUEST_CART_CAPABILITY_STATUS.CONSUMED,
        consumed_at: now,
      },
      sharedContext
    )

    const record = Array.isArray(updated) ? updated[0] : updated
    assertRecordHasNoPlaintext(record)
    return record as GuestCartCapabilityRecord
  }

  /**
   * Revoke a capability.
   */
  async revokeGuestCartCapability(
    id: string,
    options?: { now?: Date },
    sharedContext?: Context
  ): Promise<GuestCartCapabilityRecord> {
    if (!id || typeof id !== "string") {
      throw new Error("GUEST_CART_CAPABILITY_ID_REQUIRED")
    }

    const now = options?.now instanceof Date ? options.now : new Date()
    const updated = await (this as any).updateGuestCartCapabilities(
      {
        id,
        status: GUEST_CART_CAPABILITY_STATUS.REVOKED,
        revoked_at: now,
      },
      sharedContext
    )

    const record = Array.isArray(updated) ? updated[0] : updated
    assertRecordHasNoPlaintext(record)
    return record as GuestCartCapabilityRecord
  }

  /**
   * Mark a capability as expired.
   */
  async expireGuestCartCapability(
    id: string,
    options?: { now?: Date },
    sharedContext?: Context
  ): Promise<GuestCartCapabilityRecord> {
    if (!id || typeof id !== "string") {
      throw new Error("GUEST_CART_CAPABILITY_ID_REQUIRED")
    }

    const updated = await (this as any).updateGuestCartCapabilities(
      {
        id,
        status: GUEST_CART_CAPABILITY_STATUS.EXPIRED,
      },
      sharedContext
    )

    const record = Array.isArray(updated) ? updated[0] : updated
    assertRecordHasNoPlaintext(record)
    return record as GuestCartCapabilityRecord
  }
}

export default GuestCartCapabilityModuleService
