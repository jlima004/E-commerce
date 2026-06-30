export const CHECKOUT_COMPLETION_OPERATION = {
  COMPLETE_CHECKOUT_CREATE_ORDER: "complete_checkout_create_order",
} as const

export const CHECKOUT_COMPLETION_STATUS = {
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const

export const CHECKOUT_COMPLETION_OPERATIONS = [
  CHECKOUT_COMPLETION_OPERATION.COMPLETE_CHECKOUT_CREATE_ORDER,
] as const

export const CHECKOUT_COMPLETION_STATUSES = [
  CHECKOUT_COMPLETION_STATUS.PROCESSING,
  CHECKOUT_COMPLETION_STATUS.COMPLETED,
  CHECKOUT_COMPLETION_STATUS.FAILED,
] as const

export type CheckoutCompletionOperation =
  (typeof CHECKOUT_COMPLETION_OPERATIONS)[number]

export type CheckoutCompletionStatus =
  (typeof CHECKOUT_COMPLETION_STATUSES)[number]

export type CheckoutCompletionMetadataValue =
  | string
  | number
  | boolean
  | null
  | CheckoutCompletionMetadataValue[]

export type CheckoutCompletionMetadata = Record<
  string,
  CheckoutCompletionMetadataValue
>

export type CreateCheckoutCompletionLogInput = {
  operation?: CheckoutCompletionOperation
  idempotency_key?: string
  cart_id: string
  payment_intent_id: string
  payment_attempt_id?: string | null
  order_id?: string | null
  status?: CheckoutCompletionStatus
  error_code?: string | null
  error_message?: string | null
  metadata?: CheckoutCompletionMetadata | null
  locked_at?: Date | string | null
  completed_at?: Date | string | null
  failed_at?: Date | string | null
}

export type BuildCheckoutCompletionIdempotencyKeyInput = {
  payment_intent_id: string
  cart_id?: string | null
  composite?: boolean
}
