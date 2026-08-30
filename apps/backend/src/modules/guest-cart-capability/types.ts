export const GUEST_CART_CAPABILITY_MODULE = "guest_cart_capability" as const

export const GUEST_CART_CAPABILITY_HEADER = "x-indicio-guest-cart-token" as const

export const GUEST_CART_CAPABILITY_RANDOM_BYTES = 32 as const

export const GUEST_CART_CAPABILITY_STATUS = {
  ACTIVE: "active",
  EXPIRED: "expired",
  REVOKED: "revoked",
  CONSUMED: "consumed",
} as const

const GUEST_CART_CAPABILITY_STATUS_VALUES = [
  GUEST_CART_CAPABILITY_STATUS.ACTIVE,
  GUEST_CART_CAPABILITY_STATUS.EXPIRED,
  GUEST_CART_CAPABILITY_STATUS.REVOKED,
  GUEST_CART_CAPABILITY_STATUS.CONSUMED,
] as const

export const GUEST_CART_CAPABILITY_STATUSES: GuestCartCapabilityStatus[] = [
  ...GUEST_CART_CAPABILITY_STATUS_VALUES,
]

export type GuestCartCapabilityStatus =
  (typeof GUEST_CART_CAPABILITY_STATUS_VALUES)[number]

export const GUEST_CART_CAPABILITY_PLAINTEXT_FORBIDDEN =
  "GUEST_CART_CAPABILITY_PLAINTEXT_FORBIDDEN" as const

export const GUEST_CART_CAPABILITY_LOOKUP_INVALID =
  "GUEST_CART_CAPABILITY_LOOKUP_INVALID" as const

export const GUEST_CART_CAPABILITY_TRANSACTION_REQUIRED =
  "GUEST_CART_CAPABILITY_TRANSACTION_REQUIRED" as const

export const GUEST_CART_CAPABILITY_LIFECYCLE_INVALID =
  "GUEST_CART_CAPABILITY_LIFECYCLE_INVALID" as const

export type GuestCartCapabilityRecord = {
  id: string
  cart_id: string
  token_hash: string
  status: GuestCartCapabilityStatus
  expires_at: string | Date
  consumed_at: string | Date | null
  revoked_at: string | Date | null
  last_used_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
  deleted_at: string | Date | null
}

export type MintGuestCartCapabilityInput = {
  cart_id: string
  expires_at?: Date | string
  now?: Date
  randomBytesFn?: (size: number) => Buffer
}

export type MintGuestCartCapabilityResult = {
  record: GuestCartCapabilityRecord
  plaintext_token: string
}

export type LookupGuestCartCapabilityOptions = {
  now?: Date
  touch?: boolean
  cart_id?: string
}

export type GuestCartCapabilitySqlTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
    | { rows?: Array<Record<string, unknown>> }
}

export type GuestCartCapabilityMutationContext = {
  __type: "MedusaContext"
  transactionManager: {
    getTransactionContext?: () =>
      | GuestCartCapabilitySqlTransaction
      | null
      | undefined
  }
  manager?: {
    getTransactionContext?: () =>
      | GuestCartCapabilitySqlTransaction
      | null
      | undefined
  }
}
