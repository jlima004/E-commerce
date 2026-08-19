import {
  compareGuestCartCapabilityHash,
  hashGuestCartCapability,
  performDummyGuestCartCapabilityHashComparison,
} from "./hash"
import {
  isGuestCartCapabilityActive,
} from "./service"
import {
  GUEST_CART_CAPABILITY_LOOKUP_INVALID,
  type GuestCartCapabilityRecord,
} from "./types"

export class GuestCartCapabilityLookupInvalidError extends Error {
  readonly code = GUEST_CART_CAPABILITY_LOOKUP_INVALID

  constructor(message = GUEST_CART_CAPABILITY_LOOKUP_INVALID) {
    super(message)
    this.name = "GuestCartCapabilityLookupInvalidError"
  }
}

export function throwGuestCartCapabilityLookupInvalidError(): never {
  throw new GuestCartCapabilityLookupInvalidError()
}

export type LookupGuestCartCapabilityDeps = {
  listByHash: (tokenHash: string) => Promise<GuestCartCapabilityRecord | null>
  now?: Date
}

export async function lookupGuestCartCapabilityByPresentedToken(
  presentedToken: string,
  deps: LookupGuestCartCapabilityDeps
): Promise<GuestCartCapabilityRecord> {
  const now = deps.now ?? new Date()

  if (typeof presentedToken !== "string" || presentedToken.trim().length === 0) {
    performDummyGuestCartCapabilityHashComparison()
    throwGuestCartCapabilityLookupInvalidError()
  }

  let candidateHash: string
  try {
    candidateHash = hashGuestCartCapability(presentedToken.trim())
  } catch {
    performDummyGuestCartCapabilityHashComparison()
    throwGuestCartCapabilityLookupInvalidError()
  }

  const record = await deps.listByHash(candidateHash)

  if (!record) {
    performDummyGuestCartCapabilityHashComparison()
    throwGuestCartCapabilityLookupInvalidError()
  }

  if (!isGuestCartCapabilityActive(record, now)) {
    compareGuestCartCapabilityHash(record.token_hash, candidateHash)
    throwGuestCartCapabilityLookupInvalidError()
  }

  const matches = compareGuestCartCapabilityHash(record.token_hash, candidateHash)
  if (!matches) {
    throwGuestCartCapabilityLookupInvalidError()
  }

  return record
}
