export const PAYMENT_ATTEMPT_STATUS = {
  CREATED: "created",
  PROVIDER_SESSION_CREATED: "provider_session_created",
  CLIENT_ACTION_REQUIRED: "client_action_required",
  CARD_CLIENT_SECRET_CREATED: "card_client_secret_created",
  PAYMENT_CLIENT_CONFIRMED: "payment_client_confirmed",
  PAYMENT_INSTRUCTIONS_DISPLAYED: "payment_instructions_displayed",
  AWAITING_PIX_PAYMENT: "awaiting_pix_payment",
  AWAITING_WEBHOOK_CONFIRMATION: "awaiting_webhook_confirmation",
  PIX_EXPIRED: "pix_expired",
  PAYMENT_FAILED: "payment_failed",
  PAYMENT_CANCELED: "payment_canceled",
  SUPERSEDED: "superseded",
  INVALIDATED_BY_CART_CHANGE: "invalidated_by_cart_change",
} as const

export const PAYMENT_ATTEMPT_STATUSES = [
  PAYMENT_ATTEMPT_STATUS.CREATED,
  PAYMENT_ATTEMPT_STATUS.PROVIDER_SESSION_CREATED,
  PAYMENT_ATTEMPT_STATUS.CLIENT_ACTION_REQUIRED,
  PAYMENT_ATTEMPT_STATUS.CARD_CLIENT_SECRET_CREATED,
  PAYMENT_ATTEMPT_STATUS.PAYMENT_CLIENT_CONFIRMED,
  PAYMENT_ATTEMPT_STATUS.PAYMENT_INSTRUCTIONS_DISPLAYED,
  PAYMENT_ATTEMPT_STATUS.AWAITING_PIX_PAYMENT,
  PAYMENT_ATTEMPT_STATUS.AWAITING_WEBHOOK_CONFIRMATION,
  PAYMENT_ATTEMPT_STATUS.PIX_EXPIRED,
  PAYMENT_ATTEMPT_STATUS.PAYMENT_FAILED,
  PAYMENT_ATTEMPT_STATUS.PAYMENT_CANCELED,
  PAYMENT_ATTEMPT_STATUS.SUPERSEDED,
  PAYMENT_ATTEMPT_STATUS.INVALIDATED_BY_CART_CHANGE,
] as const

export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number]

export const PROHIBITED_PAYMENT_ATTEMPT_STATUSES = [
  "paid",
  "succeeded",
  "captured",
  "confirmed_payment",
] as const

export type PaymentMethodType = "card" | "pix"

export type PaymentAttemptClientConfirmationState =
  | "pix_qr_displayed"
  | "awaiting_pix_payment"
  | "pix_expired"
  | "card_client_confirmed"
  | null

export type PaymentAttemptRecord = {
  id: string
  cart_id: string
  payment_collection_id: string
  payment_session_id: string
  provider: string
  provider_payment_intent_id: string | null
  provider_payment_session_id: string | null
  payment_method_type: PaymentMethodType
  status: PaymentAttemptStatus
  amount: number
  currency_code: string
  expires_at: Date | string | null
  order_id: string | null
  metadata: Record<string, unknown> | null
  client_confirmed_at: Date | string | null
  instructions_displayed_at: Date | string | null
  awaiting_webhook_since: Date | string | null
  superseded_at: Date | string | null
  invalidated_at: Date | string | null
  canceled_at: Date | string | null
  failed_at: Date | string | null
  expired_at: Date | string | null
  created_at?: Date | string
  updated_at?: Date | string
}

export type CreatePaymentAttemptInput = {
  cart_id: string
  payment_collection_id: string
  payment_session_id: string
  provider: string
  provider_payment_intent_id?: string | null
  provider_payment_session_id?: string | null
  payment_method_type: PaymentMethodType
  amount: number
  currency_code: string
  expires_at?: Date | string | null
  metadata?: Record<string, unknown> | null
}
