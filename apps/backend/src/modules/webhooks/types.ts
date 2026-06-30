export const WEBHOOK_PROVIDERS = ["stripe", "gelato"] as const

export const WEBHOOK_ENTITY_TYPES = [
  "payment_attempt",
  "order",
  "refund",
  "fulfillment",
  "unknown",
] as const

export const WEBHOOK_EVENT_LOG_STATUSES = [
  "received",
  "processing",
  "processed",
  "ignored",
  "failed",
] as const

export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number]
export type WebhookEntityType = (typeof WEBHOOK_ENTITY_TYPES)[number]
export type WebhookEventLogStatus =
  (typeof WEBHOOK_EVENT_LOG_STATUSES)[number]

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
