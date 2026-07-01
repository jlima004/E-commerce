export const ANALYTICS_EVENT_NAME = {
  PURCHASE_COMPLETED: "purchase_completed",
} as const

export const ANALYTICS_EVENT_VERSION = 1 as const

export const ANALYTICS_EVENT_STATUS = {
  RECORDED: "recorded",
  QUEUED: "queued",
  SENDING: "sending",
  SENT: "sent",
  FAILED: "failed",
  DEAD_LETTER: "dead_letter",
} as const

export const ANALYTICS_EVENT_STATUSES = [
  ANALYTICS_EVENT_STATUS.RECORDED,
  ANALYTICS_EVENT_STATUS.QUEUED,
  ANALYTICS_EVENT_STATUS.SENDING,
  ANALYTICS_EVENT_STATUS.SENT,
  ANALYTICS_EVENT_STATUS.FAILED,
  ANALYTICS_EVENT_STATUS.DEAD_LETTER,
] as const

export type AnalyticsEventName =
  (typeof ANALYTICS_EVENT_NAME)[keyof typeof ANALYTICS_EVENT_NAME]

export type AnalyticsEventStatus =
  (typeof ANALYTICS_EVENT_STATUSES)[number]

export type AnalyticsEventMetadataValue =
  | string
  | number
  | boolean
  | null
  | AnalyticsEventMetadataValue[]

export type AnalyticsEventMetadata = Record<
  string,
  AnalyticsEventMetadataValue
>

export type PurchaseCompletedItemInput = {
  variant_id: string
  sku: string | null
  quantity: number
  unit_price: number
  subtotal: number
}

export type PurchaseCompletedPayloadInput = {
  event_name?: AnalyticsEventName
  event_version?: number
  occurred_at: Date | string
  order_id: string
  cart_id: string
  payment_attempt_id: string
  checkout_completion_log_id: string
  payment_intent_id: string
  payment_method_type: "card" | "pix"
  amount: number
  currency_code: string
  order_status: string
  payment_status: string
  item_count: number
  items: PurchaseCompletedItemInput[]
}

export type PurchaseCompletedPayload = {
  event_name: AnalyticsEventName
  event_version: typeof ANALYTICS_EVENT_VERSION
  occurred_at: string
  order_id: string
  cart_id: string
  payment_attempt_id: string
  checkout_completion_log_id: string
  payment_intent_id: string
  payment_method_type: "card" | "pix"
  amount: number
  currency_code: string
  order_status: string
  payment_status: string
  item_count: number
  items: PurchaseCompletedItemInput[]
}

export type BuildPurchaseCompletedIdempotencyKeyInput = {
  payment_intent_id: string
}

export type CreateAnalyticsEventLogInput = {
  event_name?: AnalyticsEventName
  event_version?: number
  idempotency_key?: string
  order_id?: string
  cart_id?: string
  payment_attempt_id?: string
  checkout_completion_log_id?: string
  payment_intent_id?: string
  status?: AnalyticsEventStatus
  payload: PurchaseCompletedPayloadInput
  metadata?: AnalyticsEventMetadata | null
  attempt_count?: number
  last_error_code?: string | null
  last_error_message?: string | null
  next_retry_at?: Date | string | null
  recorded_at?: Date | string | null
  queued_at?: Date | string | null
  sending_started_at?: Date | string | null
  sent_at?: Date | string | null
  failed_at?: Date | string | null
  dead_lettered_at?: Date | string | null
}
