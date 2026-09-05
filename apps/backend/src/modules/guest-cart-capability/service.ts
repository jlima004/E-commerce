import { MedusaService } from "@medusajs/framework/utils"
import type { Context } from "@medusajs/framework/types"
import { lockCartOrderAuthority } from "../payment-attempt/transactional-authority"
import GuestCartCapability from "./models/guest-cart-capability"
import {
  compareGuestCartCapabilityHash,
  generateGuestCartCapability,
  hashGuestCartCapability,
  performDummyGuestCartCapabilityHashComparison,
} from "./hash"
import {
  GUEST_CART_CAPABILITY_LOOKUP_INVALID,
  GUEST_CART_CAPABILITY_LIFECYCLE_INVALID,
  GUEST_CART_CAPABILITY_PLAINTEXT_FORBIDDEN,
  GUEST_CART_CAPABILITY_TRANSACTION_REQUIRED,
  GUEST_CART_CAPABILITY_STATUS,
  type GuestCartCapabilityMutationContext,
  type GuestCartCapabilityRecord,
  type GuestCartCapabilitySqlTransaction,
  type GuestCartCapabilityStatus,
  type LookupGuestCartCapabilityOptions,
  type MintGuestCartCapabilityInput,
  type MintGuestCartCapabilityResult,
} from "./types"

const GUEST_CART_CAPABILITY_COLUMNS = [
  "id",
  "cart_id",
  "token_hash",
  "status",
  "expires_at",
  "consumed_at",
  "revoked_at",
  "last_used_at",
  "created_at",
  "updated_at",
  "deleted_at",
] as const

type CapabilityQueryResult = {
  rows?: Array<Record<string, unknown>>
}

function capabilityColumns(): string {
  return GUEST_CART_CAPABILITY_COLUMNS.join(", ")
}

async function capabilityRows(
  transaction: GuestCartCapabilitySqlTransaction,
  sql: string,
  bindings: unknown[] = []
): Promise<Array<Record<string, unknown>>> {
  const result = (await transaction.raw(sql, bindings)) as CapabilityQueryResult
  return result.rows ?? []
}

function requireCapabilityTransaction(
  sharedContext?: GuestCartCapabilityMutationContext
): GuestCartCapabilitySqlTransaction {
  const manager = sharedContext?.transactionManager
  if (
    sharedContext?.__type !== "MedusaContext" ||
    !manager
  ) {
    throw new Error(GUEST_CART_CAPABILITY_TRANSACTION_REQUIRED)
  }

  const transaction = manager.getTransactionContext?.()
  if (!transaction) {
    throw new Error(GUEST_CART_CAPABILITY_TRANSACTION_REQUIRED)
  }

  return transaction
}

function mapCapabilityRow(row: Record<string, unknown>): GuestCartCapabilityRecord {
  return {
    id: String(row.id),
    cart_id: String(row.cart_id),
    token_hash: String(row.token_hash),
    status: row.status as GuestCartCapabilityRecord["status"],
    expires_at: row.expires_at as string | Date,
    consumed_at: (row.consumed_at ?? null) as string | Date | null,
    revoked_at: (row.revoked_at ?? null) as string | Date | null,
    last_used_at: (row.last_used_at ?? null) as string | Date | null,
    created_at: row.created_at as string | Date,
    updated_at: row.updated_at as string | Date,
    deleted_at: (row.deleted_at ?? null) as string | Date | null,
  }
}

function lookupInvalid(): never {
  throw new Error(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
}

function lifecycleInvalid(): never {
  throw new Error(GUEST_CART_CAPABILITY_LIFECYCLE_INVALID)
}

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
  private async withCapabilityTransaction<T>(
    sharedContext: GuestCartCapabilityMutationContext | undefined,
    callback: (transaction: GuestCartCapabilitySqlTransaction) => Promise<T>
  ): Promise<T> {
    if (sharedContext) {
      return callback(requireCapabilityTransaction(sharedContext))
    }

    const repository = (this as any).baseRepository_
    const transaction = repository?.transaction
    if (typeof transaction !== "function") {
      throw new Error(GUEST_CART_CAPABILITY_TRANSACTION_REQUIRED)
    }

    return transaction.call(repository, async (transactionManager: {
      getTransactionContext?: () => GuestCartCapabilitySqlTransaction | null
    }) => {
      const transactionContext = transactionManager.getTransactionContext?.()
      if (!transactionContext) {
        throw new Error(GUEST_CART_CAPABILITY_TRANSACTION_REQUIRED)
      }
      return callback(transactionContext)
    })
  }

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
    sharedContext?: GuestCartCapabilityMutationContext
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

    return this.withCapabilityTransaction(sharedContext, async (transaction) => {
      const unlocked = await capabilityRows(
        transaction,
        `select cart_id from guest_cart_capability where token_hash = ? and deleted_at is null`,
        [presentedHash]
      )

      if (unlocked.length !== 1) {
        performDummyGuestCartCapabilityHashComparison()
        return lookupInvalid()
      }

      const cartId = String(unlocked[0].cart_id)
      if (options?.cart_id && options.cart_id !== cartId) {
        performDummyGuestCartCapabilityHashComparison()
        return lookupInvalid()
      }

      // Every capability lifecycle path takes the cart authority advisory lock
      // before the capability row lock. This is the same order used by the
      // cart mutation and webhook authorities, preventing lock inversion.
      await lockCartOrderAuthority(transaction as never, cartId)

      const lockedRows = await capabilityRows(
        transaction,
        `select ${capabilityColumns()} from guest_cart_capability where token_hash = ? and deleted_at is null for update`,
        [presentedHash]
      )
      const candidate = lockedRows[0] ? mapCapabilityRow(lockedRows[0]) : null

      if (!candidate) {
        performDummyGuestCartCapabilityHashComparison()
        return lookupInvalid()
      }

      const isMatch = compareGuestCartCapabilityHash(presentedHash, candidate.token_hash)
      if (!isMatch) {
        return lookupInvalid()
      }

      if (
        candidate.status !== GUEST_CART_CAPABILITY_STATUS.ACTIVE ||
        candidate.consumed_at ||
        candidate.revoked_at
      ) {
        return lookupInvalid()
      }

      if (isGuestCartCapabilityExpired(candidate, now)) {
        await capabilityRows(
          transaction,
          `update guest_cart_capability
              set status = 'expired', updated_at = ?
            where id = ? and status = 'active'
              and consumed_at is null and revoked_at is null
              and expires_at <= ? and deleted_at is null
            returning ${capabilityColumns()}`,
          [now.toISOString(), candidate.id, now.toISOString()]
        )
        return lookupInvalid()
      }

      if (!shouldTouch) {
        assertRecordHasNoPlaintext(candidate)
        return candidate
      }

      // The authorization and rolling touch are one conditional write under
      // the capability row lock. A terminal lifecycle update cannot be
      // overwritten or extended by a stale lookup.
      const newExpiresAt = computeRollingExpiresAt(candidate.created_at, now)
      const touchedRows = await capabilityRows(
        transaction,
        `update guest_cart_capability
            set last_used_at = ?, expires_at = ?, updated_at = ?
          where id = ? and status = 'active'
            and consumed_at is null and revoked_at is null
            and expires_at > ? and deleted_at is null
          returning ${capabilityColumns()}`,
        [
          now.toISOString(),
          newExpiresAt.toISOString(),
          now.toISOString(),
          candidate.id,
          now.toISOString(),
        ]
      )
      if (touchedRows.length !== 1) {
        return lookupInvalid()
      }

      const touchedRecord = mapCapabilityRow(touchedRows[0])
      assertRecordHasNoPlaintext(touchedRecord)
      return touchedRecord
    })
  }

  /**
   * Owner-only transaction-bound read used to validate a CartMerge receipt.
   * It returns lifecycle state without exposing or re-deriving the presented
   * capability token and never joins another module's private table.
   */
  async retrieveGuestCartCapabilityForReplay(
    id: string,
    sharedContext: GuestCartCapabilityMutationContext
  ): Promise<GuestCartCapabilityRecord | null> {
    if (!sharedContext || typeof id !== "string" || id.trim().length === 0) {
      throw new Error(GUEST_CART_CAPABILITY_TRANSACTION_REQUIRED)
    }

    const rows = await capabilityRows(
      requireCapabilityTransaction(sharedContext),
      `select ${capabilityColumns()}
         from guest_cart_capability
        where id = ? and deleted_at is null`,
      [id]
    )
    return rows[0] ? mapCapabilityRow(rows[0]) : null
  }

  /**
   * Final Guest authorization for a cart mutation. The caller must provide
   * the mutation transaction; this prevents a preflight lookup from being
   * mistaken for authority after a concurrent revoke/consume/expire.
   */
  async authorizeGuestCartCapabilityForMutation(
    presentedToken: string,
    cartId: string,
    options?: { now?: Date },
    sharedContext?: GuestCartCapabilityMutationContext
  ): Promise<GuestCartCapabilityRecord> {
    if (!sharedContext) {
      throw new Error(GUEST_CART_CAPABILITY_TRANSACTION_REQUIRED)
    }

    return this.lookupGuestCartCapabilityByPresentedToken(
      presentedToken,
      { ...options, touch: true, cart_id: cartId },
      sharedContext
    )
  }

  /**
   * Consume a capability (e.g. upon cart checkout or customer attachment).
   */
  async consumeGuestCartCapability(
    id: string,
    options?: { now?: Date },
    sharedContext?: GuestCartCapabilityMutationContext
  ): Promise<GuestCartCapabilityRecord> {
    if (!id || typeof id !== "string") {
      throw new Error("GUEST_CART_CAPABILITY_ID_REQUIRED")
    }

    const now = options?.now instanceof Date ? options.now : new Date()
    return this.mutateActiveCapability(id, "consumed", now, sharedContext)
  }

  /**
   * Revoke a capability.
   */
  async revokeGuestCartCapability(
    id: string,
    options?: { now?: Date },
    sharedContext?: GuestCartCapabilityMutationContext
  ): Promise<GuestCartCapabilityRecord> {
    if (!id || typeof id !== "string") {
      throw new Error("GUEST_CART_CAPABILITY_ID_REQUIRED")
    }

    const now = options?.now instanceof Date ? options.now : new Date()
    return this.mutateActiveCapability(id, "revoked", now, sharedContext)
  }

  /**
   * Mark a capability as expired.
   */
  async expireGuestCartCapability(
    id: string,
    options?: { now?: Date },
    sharedContext?: GuestCartCapabilityMutationContext
  ): Promise<GuestCartCapabilityRecord> {
    if (!id || typeof id !== "string") {
      throw new Error("GUEST_CART_CAPABILITY_ID_REQUIRED")
    }

    const now = options?.now instanceof Date ? options.now : new Date()
    return this.mutateActiveCapability(id, "expired", now, sharedContext)
  }

  private async mutateActiveCapability(
    id: string,
    target: "consumed" | "revoked" | "expired",
    now: Date,
    sharedContext?: GuestCartCapabilityMutationContext
  ): Promise<GuestCartCapabilityRecord> {
    return this.withCapabilityTransaction(sharedContext, async (transaction) => {
      const unlocked = await capabilityRows(
        transaction,
        `select cart_id from guest_cart_capability where id = ? and deleted_at is null`,
        [id]
      )
      if (unlocked.length !== 1) {
        return lifecycleInvalid()
      }

      const cartId = String(unlocked[0].cart_id)
      await lockCartOrderAuthority(transaction as never, cartId)
      const lockedRows = await capabilityRows(
        transaction,
        `select ${capabilityColumns()} from guest_cart_capability where id = ? and deleted_at is null for update`,
        [id]
      )
      const current = lockedRows[0] ? mapCapabilityRow(lockedRows[0]) : null
      if (
        !current ||
        current.status !== GUEST_CART_CAPABILITY_STATUS.ACTIVE ||
        current.consumed_at ||
        current.revoked_at
      ) {
        return lifecycleInvalid()
      }

      if (
        target !== "expired" &&
        isGuestCartCapabilityExpired(current, now)
      ) {
        await capabilityRows(
          transaction,
          `update guest_cart_capability
              set status = 'expired', updated_at = ?
            where id = ? and status = 'active'
              and consumed_at is null and revoked_at is null
              and expires_at <= ? and deleted_at is null
            returning ${capabilityColumns()}`,
          [now.toISOString(), id, now.toISOString()]
        )
        return lifecycleInvalid()
      }

      const update =
        target === "consumed"
          ? {
              sql: `update guest_cart_capability
                       set status = 'consumed', consumed_at = ?, updated_at = ?
                     where id = ? and status = 'active'
                       and consumed_at is null and revoked_at is null
                       and expires_at > ? and deleted_at is null
                     returning ${capabilityColumns()}`,
              bindings: [now.toISOString(), now.toISOString(), id, now.toISOString()],
            }
          : target === "revoked"
            ? {
                sql: `update guest_cart_capability
                         set status = 'revoked', revoked_at = ?, updated_at = ?
                       where id = ? and status = 'active'
                         and consumed_at is null and revoked_at is null
                         and expires_at > ? and deleted_at is null
                       returning ${capabilityColumns()}`,
                bindings: [now.toISOString(), now.toISOString(), id, now.toISOString()],
              }
            : {
                sql: `update guest_cart_capability
                         set status = 'expired', updated_at = ?
                       where id = ? and status = 'active'
                         and consumed_at is null and revoked_at is null
                         and deleted_at is null
                       returning ${capabilityColumns()}`,
                bindings: [now.toISOString(), id],
              }

      const updatedRows = await capabilityRows(
        transaction,
        update.sql,
        update.bindings
      )
      if (updatedRows.length !== 1) {
        return lifecycleInvalid()
      }

      const record = mapCapabilityRow(updatedRows[0])
      assertRecordHasNoPlaintext(record)
      return record
    })
  }
}

export default GuestCartCapabilityModuleService
