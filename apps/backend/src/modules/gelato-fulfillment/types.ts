export const GELATO_FULFILLMENT_PROVIDER = {
  GELATO: "gelato",
} as const

export const GELATO_FULFILLMENT_STATUS = {
  RECORDED: "recorded",
  ELIGIBLE: "eligible",
  QUEUED: "queued",
  DISPATCHING: "dispatching",
  SUBMITTED: "submitted",
  ACCEPTED: "accepted",
  IN_PRODUCTION: "in_production",
  PARTIALLY_SHIPPED: "partially_shipped",
  SHIPPED: "shipped",
  DELIVERED: "delivered",
  FAILED: "failed",
  DEAD_LETTER: "dead_letter",
  CANCELED: "canceled",
} as const

const GELATO_FULFILLMENT_STATUSES_VALUES = [
  GELATO_FULFILLMENT_STATUS.RECORDED,
  GELATO_FULFILLMENT_STATUS.ELIGIBLE,
  GELATO_FULFILLMENT_STATUS.QUEUED,
  GELATO_FULFILLMENT_STATUS.DISPATCHING,
  GELATO_FULFILLMENT_STATUS.SUBMITTED,
  GELATO_FULFILLMENT_STATUS.ACCEPTED,
  GELATO_FULFILLMENT_STATUS.IN_PRODUCTION,
  GELATO_FULFILLMENT_STATUS.PARTIALLY_SHIPPED,
  GELATO_FULFILLMENT_STATUS.SHIPPED,
  GELATO_FULFILLMENT_STATUS.DELIVERED,
  GELATO_FULFILLMENT_STATUS.FAILED,
  GELATO_FULFILLMENT_STATUS.DEAD_LETTER,
  GELATO_FULFILLMENT_STATUS.CANCELED,
] as const

const GELATO_FULFILLMENT_ACTIVE_STATUSES_VALUES = [
  GELATO_FULFILLMENT_STATUS.RECORDED,
  GELATO_FULFILLMENT_STATUS.ELIGIBLE,
  GELATO_FULFILLMENT_STATUS.QUEUED,
  GELATO_FULFILLMENT_STATUS.DISPATCHING,
  GELATO_FULFILLMENT_STATUS.SUBMITTED,
  GELATO_FULFILLMENT_STATUS.ACCEPTED,
  GELATO_FULFILLMENT_STATUS.IN_PRODUCTION,
  GELATO_FULFILLMENT_STATUS.PARTIALLY_SHIPPED,
  GELATO_FULFILLMENT_STATUS.SHIPPED,
] as const

const GELATO_FULFILLMENT_TERMINAL_STATUSES_VALUES = [
  GELATO_FULFILLMENT_STATUS.DELIVERED,
  GELATO_FULFILLMENT_STATUS.FAILED,
  GELATO_FULFILLMENT_STATUS.DEAD_LETTER,
  GELATO_FULFILLMENT_STATUS.CANCELED,
] as const

export const GELATO_FULFILLMENT_STATUSES: GelatoFulfillmentStatus[] = [
  ...GELATO_FULFILLMENT_STATUSES_VALUES,
]

export const GELATO_FULFILLMENT_ACTIVE_STATUSES: GelatoFulfillmentStatus[] = [
  ...GELATO_FULFILLMENT_ACTIVE_STATUSES_VALUES,
]

export const GELATO_FULFILLMENT_TERMINAL_STATUSES: GelatoFulfillmentStatus[] = [
  ...GELATO_FULFILLMENT_TERMINAL_STATUSES_VALUES,
]

export type GelatoFulfillmentProvider =
  (typeof GELATO_FULFILLMENT_PROVIDER)[keyof typeof GELATO_FULFILLMENT_PROVIDER]

export type GelatoFulfillmentStatus =
  (typeof GELATO_FULFILLMENT_STATUSES_VALUES)[number]

export type GelatoFulfillmentActiveStatus =
  (typeof GELATO_FULFILLMENT_ACTIVE_STATUSES_VALUES)[number]

export type GelatoFulfillmentTerminalStatus =
  (typeof GELATO_FULFILLMENT_TERMINAL_STATUSES_VALUES)[number]

export type GelatoFulfillmentMetadataValue =
  | string
  | number
  | boolean
  | null
  | GelatoFulfillmentMetadataValue[]

export type GelatoFulfillmentMetadata = Record<
  string,
  GelatoFulfillmentMetadataValue
>

export type BuildGelatoDispatchIdempotencyKeyInput = {
  order_id: string
}

export type GelatoFulfillmentAutomaticEligibilityReason =
  | "eligible"
  | "order_not_confirmed"
  | "purchase_completed_missing"
  | "email_not_sent"
  | "fulfillment_already_exists"

export type GelatoFulfillmentAutomaticEligibilityOrder = {
  id: string | null
  order_status: string | null
  payment_status: string | null
}

export type EvaluateGelatoFulfillmentAutomaticEligibilityInput = {
  order: GelatoFulfillmentAutomaticEligibilityOrder | null
  has_local_purchase_completed: boolean
  email_delivery_status: string | null
  existing_fulfillment:
    | Pick<GelatoFulfillmentRecord, "order_id" | "status">
    | null
    | undefined
}

export type GelatoFulfillmentAutomaticEligibilityDecision = {
  eligible: boolean
  reason: GelatoFulfillmentAutomaticEligibilityReason
}

export type GelatoFulfillmentRequestSummaryInput = {
  order_id: string
  cart_id: string
  payment_attempt_id: string
  checkout_completion_log_id: string
  analytics_event_log_id: string
  email_delivery_log_id: string
  idempotency_key: string
  request_hash: string
  item_count: number
  currency_code: string
  status: GelatoFulfillmentStatus | string
  connected_order_ids?: string[] | null
}

export type GelatoFulfillmentRequestSummary = {
  order_id: string
  cart_id: string
  payment_attempt_id: string
  checkout_completion_log_id: string
  analytics_event_log_id: string
  email_delivery_log_id: string
  idempotency_key: string
  request_hash: string
  item_count: number
  currency_code: string
  status: GelatoFulfillmentStatus
  connected_order_ids: string[]
}

export type GelatoFulfillmentResponseSummaryInput = {
  provider: GelatoFulfillmentProvider | string
  status: GelatoFulfillmentStatus | string
  connected_order_ids?: string[] | null
  gelato_primary_order_id?: string | null
  provider_status?: string | null
  provider_reference_id?: string | null
}

export type GelatoFulfillmentResponseSummary = {
  provider: GelatoFulfillmentProvider
  status: GelatoFulfillmentStatus
  connected_order_ids: string[]
  gelato_primary_order_id: string | null
  provider_status: string | null
  provider_reference_id: string | null
}

export type GelatoFulfillmentTrackingSummaryInput = {
  status: GelatoFulfillmentStatus | string
  tracking_status?: string | null
  connected_order_ids?: string[] | null
}

export type GelatoFulfillmentTrackingSummary = {
  status: GelatoFulfillmentStatus
  tracking_status: string | null
  connected_order_ids: string[]
}

export type CreateGelatoFulfillmentInput = {
  order_id: string
  cart_id: string
  payment_attempt_id: string
  checkout_completion_log_id: string
  analytics_event_log_id: string
  email_delivery_log_id: string
  customer_reference_id?: string | null
  status?: GelatoFulfillmentStatus
  gelato_primary_order_id?: string | null
  connected_order_ids?: string[] | null
  request_hash: string
  request_summary: GelatoFulfillmentRequestSummaryInput
  response_summary?: GelatoFulfillmentResponseSummaryInput | null
  tracking_summary?: GelatoFulfillmentTrackingSummaryInput | null
  metadata?: GelatoFulfillmentMetadata | null
  attempt_count?: number
  last_error_code?: string | null
  last_error_message?: string | null
  next_retry_at?: Date | string | null
  requires_operator_attention?: boolean
  operator_alert_code?: string | null
  operator_alert_message?: string | null
  operator_alerted_at?: Date | string | null
  recorded_at?: Date | string | null
  queued_at?: Date | string | null
  dispatching_started_at?: Date | string | null
  submitted_at?: Date | string | null
  accepted_at?: Date | string | null
  failed_at?: Date | string | null
  dead_lettered_at?: Date | string | null
}

export type GelatoFulfillmentRecord = {
  id: string
  order_id: string
  cart_id: string
  payment_attempt_id: string
  checkout_completion_log_id: string
  analytics_event_log_id: string
  email_delivery_log_id: string
  idempotency_key: string
  order_reference_id: string
  customer_reference_id: string | null
  status: GelatoFulfillmentStatus
  gelato_primary_order_id: string | null
  connected_order_ids: string[]
  request_hash: string
  request_summary: GelatoFulfillmentRequestSummary
  response_summary: GelatoFulfillmentResponseSummary | null
  tracking_summary: GelatoFulfillmentTrackingSummary | null
  metadata: GelatoFulfillmentMetadata | null
  attempt_count: number
  last_error_code: string | null
  last_error_message: string | null
  next_retry_at: string | null
  requires_operator_attention: boolean
  operator_alert_code: string | null
  operator_alert_message: string | null
  operator_alerted_at: string | null
  recorded_at: string
  queued_at: string | null
  dispatching_started_at: string | null
  submitted_at: string | null
  accepted_at: string | null
  failed_at: string | null
  dead_lettered_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type CreateGelatoFulfillmentData = Omit<
  GelatoFulfillmentRecord,
  "id" | "created_at" | "updated_at" | "deleted_at"
>
