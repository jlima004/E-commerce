export const WEBHOOK_PROVIDER = {
  STRIPE: "stripe",
  GELATO: "gelato",
} as const

export const WEBHOOK_ENTITY_TYPE = {
  PAYMENT_ATTEMPT: "payment_attempt",
  ORDER: "order",
  REFUND: "refund",
  FULFILLMENT: "fulfillment",
  UNKNOWN: "unknown",
} as const

export const WEBHOOK_EVENT_LOG_STATUS = {
  RECEIVED: "received",
  PROCESSING: "processing",
  PROCESSED: "processed",
  IGNORED: "ignored",
  FAILED: "failed",
} as const

export type WebhookProvider =
  (typeof WEBHOOK_PROVIDER)[keyof typeof WEBHOOK_PROVIDER]
export type WebhookEntityType =
  (typeof WEBHOOK_ENTITY_TYPE)[keyof typeof WEBHOOK_ENTITY_TYPE]
export type WebhookEventLogStatus =
  (typeof WEBHOOK_EVENT_LOG_STATUS)[keyof typeof WEBHOOK_EVENT_LOG_STATUS]

export type WebhookMetadataValue =
  | string
  | number
  | boolean
  | null
  | WebhookMetadataValue[]

export type WebhookMetadata = Record<string, WebhookMetadataValue>

export type CreateWebhookEventLogInput = {
  provider: WebhookProvider
  external_event_id?: string | null
  event_type: string
  entity_type: WebhookEntityType
  entity_id?: string | null
  payload_hash: string
  deduplication_key: string
  status?: WebhookEventLogStatus
  processing_attempts?: number
  error_code?: string | null
  error_message?: string | null
  metadata?: WebhookMetadata | null
  received_at?: Date | string
  processed_at?: Date | string | null
  ignored_at?: Date | string | null
  failed_at?: Date | string | null
}
