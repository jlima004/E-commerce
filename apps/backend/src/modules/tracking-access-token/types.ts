export const TRACKING_ACCESS_TOKEN_STATUS = {
  ACTIVE: "active",
  EXPIRED: "expired",
  REVOKED: "revoked",
} as const

const TRACKING_ACCESS_TOKEN_STATUSES_VALUES = [
  TRACKING_ACCESS_TOKEN_STATUS.ACTIVE,
  TRACKING_ACCESS_TOKEN_STATUS.EXPIRED,
  TRACKING_ACCESS_TOKEN_STATUS.REVOKED,
] as const

export const TRACKING_ACCESS_TOKEN_STATUSES: TrackingAccessTokenStatus[] = [
  ...TRACKING_ACCESS_TOKEN_STATUSES_VALUES,
]

export const TRACKING_ACCESS_TOKEN_CREATED_FOR = {
  GUEST_TRACKING: "guest_tracking",
} as const

const TRACKING_ACCESS_TOKEN_CREATED_FOR_VALUES = [
  TRACKING_ACCESS_TOKEN_CREATED_FOR.GUEST_TRACKING,
] as const

export const TRACKING_ACCESS_TOKEN_CREATED_FOR_VALUES_LIST: TrackingAccessTokenCreatedFor[] =
  [...TRACKING_ACCESS_TOKEN_CREATED_FOR_VALUES]

export type TrackingAccessTokenStatus =
  (typeof TRACKING_ACCESS_TOKEN_STATUSES_VALUES)[number]

export type TrackingAccessTokenCreatedFor =
  (typeof TRACKING_ACCESS_TOKEN_CREATED_FOR_VALUES)[number]

export type TrackingAccessTokenRecord = {
  id: string
  order_id: string
  gelato_fulfillment_id: string
  token_hash: string
  status: TrackingAccessTokenStatus
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
  created_for: TrackingAccessTokenCreatedFor
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type CreateTrackingAccessTokenInput = {
  order_id: string
  gelato_fulfillment_id: string
  expires_at: Date | string
  created_for?: TrackingAccessTokenCreatedFor
}

export type MintTrackingAccessTokenResult = {
  record: TrackingAccessTokenRecord
  plaintext_token: string
}

export type TrackingAccessTokenMetadataValue =
  | string
  | number
  | boolean
  | null
  | TrackingAccessTokenMetadataValue[]

export type TrackingAccessTokenMetadata = Record<
  string,
  TrackingAccessTokenMetadataValue
>
