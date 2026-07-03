export const REFUND_REQUEST_STATUS = {
  REQUESTED: "requested",
  REJECTED: "rejected",
  STRIPE_CREATE_PENDING: "stripe_create_pending",
  STRIPE_CREATED: "stripe_created",
  CONFIRMATION_PENDING: "confirmation_pending",
  CONFIRMED: "confirmed",
  FAILED: "failed",
  CANCELED: "canceled",
} as const

const REFUND_REQUEST_STATUSES_VALUES = [
  REFUND_REQUEST_STATUS.REQUESTED,
  REFUND_REQUEST_STATUS.REJECTED,
  REFUND_REQUEST_STATUS.STRIPE_CREATE_PENDING,
  REFUND_REQUEST_STATUS.STRIPE_CREATED,
  REFUND_REQUEST_STATUS.CONFIRMATION_PENDING,
  REFUND_REQUEST_STATUS.CONFIRMED,
  REFUND_REQUEST_STATUS.FAILED,
  REFUND_REQUEST_STATUS.CANCELED,
] as const

export const REFUND_REQUEST_STATUSES = [...REFUND_REQUEST_STATUSES_VALUES]

const REFUND_REQUEST_RESERVATION_STATUSES_VALUES = [
  REFUND_REQUEST_STATUS.REQUESTED,
  REFUND_REQUEST_STATUS.STRIPE_CREATE_PENDING,
  REFUND_REQUEST_STATUS.STRIPE_CREATED,
  REFUND_REQUEST_STATUS.CONFIRMATION_PENDING,
] as const

export const REFUND_REQUEST_RESERVATION_STATUSES = [
  ...REFUND_REQUEST_RESERVATION_STATUSES_VALUES,
]

const REFUND_REQUEST_CONFIRMED_STATUSES_VALUES = [
  REFUND_REQUEST_STATUS.CONFIRMED,
] as const

export const REFUND_REQUEST_CONFIRMED_STATUSES = [
  ...REFUND_REQUEST_CONFIRMED_STATUSES_VALUES,
]

export const REFUND_REQUEST_SLICE_ALLOWED_CREATE_STATUSES = [
  REFUND_REQUEST_STATUS.REQUESTED,
] as const

export type RefundRequestStatus =
  (typeof REFUND_REQUEST_STATUSES_VALUES)[number]

export type RefundRequestReservationStatus =
  (typeof REFUND_REQUEST_RESERVATION_STATUSES_VALUES)[number]

export type RefundRequestMetadataValue =
  | string
  | number
  | boolean
  | null
  | RefundRequestMetadataValue[]

export type RefundRequestMetadata = Record<
  string,
  RefundRequestMetadataValue
>

export type OrderCapturedPaymentTruth = {
  order_id: string
  payment_attempt_id: string
  payment_intent_id: string
  captured_amount: number
  currency_code: string
}

export type RefundableAvailability = {
  captured_amount: number
  confirmed_refunded_amount: number
  reserved_amount: number
  available_amount: number
  currency_code: string
}

export type CreateRefundRequestInput = {
  order_id: string
  amount: number
  currency_code: string
  idempotency_key: string
  reason?: string | null
  operator_note?: string | null
  requested_by_operator_id?: string | null
  metadata?: RefundRequestMetadata | null
}

export type RefundRequestRecord = {
  id: string
  order_id: string
  payment_intent_id: string
  payment_attempt_id: string
  stripe_refund_id: string | null
  idempotency_key: string
  amount: number
  currency_code: string
  reason: string | null
  operator_note: string | null
  status: RefundRequestStatus
  failure_code: string | null
  failure_message: string | null
  requested_by_operator_id: string | null
  confirmed_at: string | null
  failed_at: string | null
  canceled_at: string | null
  rejected_at: string | null
  metadata: RefundRequestMetadata | null
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}

export type AdminCreateRefundRequestResult = {
  refund_request: RefundRequestRecord
  reused_idempotency: boolean
  availability: RefundableAvailability
}
