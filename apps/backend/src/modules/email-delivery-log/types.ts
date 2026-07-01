export const EMAIL_DELIVERY_LOG_EMAIL_TYPE = {
  ORDER_CONFIRMATION: "order_confirmation",
} as const

export const EMAIL_DELIVERY_LOG_TEMPLATE_KEY = {
  ORDER_CONFIRMATION_V1: "order_confirmation_v1",
} as const

export const EMAIL_DELIVERY_LOG_TEMPLATE_VERSION = 1 as const

export const EMAIL_DELIVERY_LOG_PROVIDER = {
  RESEND: "resend",
} as const

export const EMAIL_DELIVERY_LOG_STATUS = {
  RECORDED: "recorded",
  QUEUED: "queued",
  SENDING: "sending",
  SENT: "sent",
  FAILED: "failed",
  DEAD_LETTER: "dead_letter",
} as const

const EMAIL_DELIVERY_LOG_STATUSES_VALUES = [
  EMAIL_DELIVERY_LOG_STATUS.RECORDED,
  EMAIL_DELIVERY_LOG_STATUS.QUEUED,
  EMAIL_DELIVERY_LOG_STATUS.SENDING,
  EMAIL_DELIVERY_LOG_STATUS.SENT,
  EMAIL_DELIVERY_LOG_STATUS.FAILED,
  EMAIL_DELIVERY_LOG_STATUS.DEAD_LETTER,
] as const

export const EMAIL_DELIVERY_LOG_STATUSES = [
  ...EMAIL_DELIVERY_LOG_STATUSES_VALUES,
]

export type EmailDeliveryEmailType =
  (typeof EMAIL_DELIVERY_LOG_EMAIL_TYPE)[keyof typeof EMAIL_DELIVERY_LOG_EMAIL_TYPE]

export type EmailDeliveryTemplateKey =
  (typeof EMAIL_DELIVERY_LOG_TEMPLATE_KEY)[keyof typeof EMAIL_DELIVERY_LOG_TEMPLATE_KEY]

export type EmailDeliveryProvider =
  (typeof EMAIL_DELIVERY_LOG_PROVIDER)[keyof typeof EMAIL_DELIVERY_LOG_PROVIDER]

export type EmailDeliveryStatus =
  (typeof EMAIL_DELIVERY_LOG_STATUSES_VALUES)[number]

export type EmailDeliveryMetadataValue =
  | string
  | number
  | boolean
  | null
  | EmailDeliveryMetadataValue[]

export type EmailDeliveryMetadata = Record<string, EmailDeliveryMetadataValue>

export type OrderConfirmationEmailItemInput = {
  sku: string
  quantity: number
  unit_price: number
  subtotal: number
}

export type OrderConfirmationEmailPayloadInput = {
  email_type?: EmailDeliveryEmailType
  template_key?: EmailDeliveryTemplateKey
  template_version?: number
  provider?: EmailDeliveryProvider
  order_id: string
  order_reference: string
  amount: number
  currency_code: string
  item_count: number
  items: OrderConfirmationEmailItemInput[]
  support_email: string
}

export type OrderConfirmationEmailPayload = {
  order_id: string
  order_reference: string
  amount: number
  currency_code: string
  item_count: number
  items: OrderConfirmationEmailItemInput[]
  support_email: string
}

export type BuildOrderConfirmationEmailIdempotencyKeyInput = {
  order_id: string
}

export type CreateEmailDeliveryLogInput = {
  email_type?: EmailDeliveryEmailType
  template_key?: EmailDeliveryTemplateKey
  template_version?: number
  provider?: EmailDeliveryProvider
  idempotency_key?: string
  order_id?: string
  cart_id?: string
  payment_attempt_id?: string
  checkout_completion_log_id?: string
  analytics_event_log_id?: string
  payment_intent_id?: string
  status?: EmailDeliveryStatus
  recipient_email: string
  payload: OrderConfirmationEmailPayloadInput
  metadata?: EmailDeliveryMetadata | null
  provider_message_id?: string | null
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

export type EmailDeliveryAudit = {
  recipient_email_hash: string
  recipient_email_domain: string
}

export type EmailDeliveryLogRecord = {
  id: string
  email_type: EmailDeliveryEmailType
  template_key: EmailDeliveryTemplateKey
  template_version: typeof EMAIL_DELIVERY_LOG_TEMPLATE_VERSION
  provider: EmailDeliveryProvider
  idempotency_key: string
  order_id: string
  cart_id: string
  payment_attempt_id: string
  checkout_completion_log_id: string
  analytics_event_log_id: string
  payment_intent_id: string
  status: EmailDeliveryStatus
  recipient_email_hash: string
  recipient_email_domain: string
  payload: OrderConfirmationEmailPayload
  metadata: EmailDeliveryMetadata | null
  provider_message_id: string | null
  attempt_count: number
  last_error_code: string | null
  last_error_message: string | null
  next_retry_at: string | null
  recorded_at: string
  queued_at: string | null
  sending_started_at: string | null
  sent_at: string | null
  failed_at: string | null
  dead_lettered_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}
