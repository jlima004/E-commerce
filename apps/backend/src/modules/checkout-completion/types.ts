import type { ReconciliationReasonCode } from "../../reconciliation/reason-codes"

export const CHECKOUT_COMPLETION_OPERATION = {
  COMPLETE_CHECKOUT_CREATE_ORDER: "complete_checkout_create_order",
} as const

export const CHECKOUT_COMPLETION_STATUS = {
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  RECONCILIATION_REQUIRED: "reconciliation_required",
} as const

export const CHECKOUT_COMPLETION_OPERATIONS = [
  CHECKOUT_COMPLETION_OPERATION.COMPLETE_CHECKOUT_CREATE_ORDER,
] as const

export const CHECKOUT_COMPLETION_STATUSES = [
  CHECKOUT_COMPLETION_STATUS.PROCESSING,
  CHECKOUT_COMPLETION_STATUS.COMPLETED,
  CHECKOUT_COMPLETION_STATUS.FAILED,
  CHECKOUT_COMPLETION_STATUS.RECONCILIATION_REQUIRED,
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
  execution_started_at?: Date | string | null
  last_reconciliation_at?: Date | string | null
  reconciliation_reason_code?: ReconciliationReasonCode | null
}

export type CheckoutCompletionOrderBirthAuthority = {
  id: string
  operation: CheckoutCompletionOperation
  idempotency_key: string
  cart_id: string
  payment_intent_id: string
  payment_attempt_id: string | null
  order_id: string | null
  status: CheckoutCompletionStatus
  execution_started_at: Date | string | null
  last_reconciliation_at: Date | string | null
  reconciliation_reason_code: ReconciliationReasonCode | null
  deleted_at: Date | string | null
  created_at?: Date | string | null
  updated_at: Date | string
}

export type BuildCheckoutCompletionIdempotencyKeyInput = {
  payment_intent_id: string
  cart_id?: string | null
  composite?: boolean
}

export type AcquireCheckoutOrderBirthAuthorityInput = {
  cart_id: string
  payment_attempt_id: string
  payment_intent_id: string
  idempotency_key?: string
  metadata?: CheckoutCompletionMetadata | null
  at?: Date
}

export type AcquireCheckoutOrderBirthAuthorityResult = {
  authority: CheckoutCompletionOrderBirthAuthority
  action: "created" | "reused"
}

export type MarkOrderBirthExecutionStartedInput = {
  id: string
  cart_id: string
  payment_intent_id: string
  payment_attempt_id: string
  at?: Date
}

export type MarkOrderBirthExecutionStartedResult = {
  won: boolean
  authority: CheckoutCompletionOrderBirthAuthority
}

export type BindRecoveredOrderInput = {
  id: string
  cart_id: string
  payment_intent_id: string
  payment_attempt_id?: string | null
  order_id: string
  at?: Date
}

export type MarkReconciliationRequiredInput = {
  id: string
  reason_code: ReconciliationReasonCode
  error_message?: string | null
  at?: Date
}

export type MarkCompletedInput = {
  id: string
  cart_id: string
  payment_intent_id: string
  payment_attempt_id?: string | null
  order_id: string
  at?: Date
}

export type ReadOrderBirthAuthorityFilters = {
  id?: string
  cart_id?: string
  payment_intent_id?: string
  payment_attempt_id?: string
  idempotency_key?: string
}

export type MarkFailedInput = {
  id: string
  error_code: string
  error_message: string
  metadata?: Record<string, unknown> | null
  at?: Date
}
