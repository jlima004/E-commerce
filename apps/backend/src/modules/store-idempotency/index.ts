import { Module } from "@medusajs/framework/utils"
import StoreIdempotencyModuleService from "./service"

export const STORE_IDEMPOTENCY_MODULE = "store_idempotency"

export {
  STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_ADD,
  STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_UPDATE,
  STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_DELETE,
  STORE_IDEMPOTENCY_STORE_CART_LINE_ITEM_CLEAR,
  STORE_IDEMPOTENCY_CART_MERGE,
} from "./operations"
export type {
  StoreCartLineItemIdempotencyOperation,
  StoreIdempotencyOperation,
} from "./operations"

export {
  STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS,
  STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS,
  STORE_IDEMPOTENCY_MAX_RETRY_ATTEMPTS,
  STORE_IDEMPOTENCY_MAX_TERMINAL_RETENTION_MS,
  STORE_IDEMPOTENCY_MIN_TERMINAL_RETENTION_MS,
  STORE_IDEMPOTENCY_PHASE13_LOCAL_MUTATION,
  STORE_IDEMPOTENCY_PHASE13_UNCERTAIN_EFFECT,
  STORE_IDEMPOTENCY_STORE_CART_ACTIVE_CREATE,
  STORE_IDEMPOTENCY_RECONCILIATION_REVIEW_MS,
  STORE_IDEMPOTENCY_RECOVERY_HORIZON_MS,
  STORE_IDEMPOTENCY_RETRY_WINDOW_MS,
  STORE_IDEMPOTENCY_SAFE_METADATA_KEYS,
  STORE_IDEMPOTENCY_UNRESOLVED_RETENTION_MS,
  StoreIdempotencyModuleService,
  assertNoSensitiveStoreIdempotencyPersistence,
  assertValidRawIdempotencyKey,
  buildStoreIdempotencyRequestFingerprint,
  decodeStoreIdempotencyPepper,
  fingerprintsMatch,
  hashStoreIdempotencyKey,
  hashStoreIdempotencyScope,
  isStoreIdempotencyTerminalState,
  resolveTerminalRetentionMs,
  sanitizeStoreIdempotencySafeMetadata,
} from "./service"
export type {
  ClaimInput,
  ClaimResult,
  LifecycleClaimResult,
  StoreIdempotencyRecordRow,
  StoreIdempotencySafeMetadata,
} from "./service"
export {
  STORE_IDEMPOTENCY_HASH_VERSION,
  STORE_IDEMPOTENCY_PEPPER_VERSION,
  STORE_IDEMPOTENCY_STATES,
  STORE_IDEMPOTENCY_TERMINAL_STATES,
} from "./models/store-idempotency-record"
export type {
  StoreIdempotencyState,
  StoreIdempotencyTerminalState,
} from "./models/store-idempotency-record"

export default Module(STORE_IDEMPOTENCY_MODULE, {
  service: StoreIdempotencyModuleService,
})
