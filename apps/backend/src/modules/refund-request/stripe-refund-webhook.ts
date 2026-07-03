import {
  REFUND_REQUEST_RESERVATION_STATUSES,
  REFUND_REQUEST_STATUS,
  type RefundRequestRecord,
  type RefundRequestStatus,
} from "./types"

export const STRIPE_REFUND_WEBHOOK_EVENT = {
  REFUND_CREATED: "refund.created",
  REFUND_UPDATED: "refund.updated",
  REFUND_FAILED: "refund.failed",
  CHARGE_REFUNDED: "charge.refunded",
} as const

export const STRIPE_REFUND_TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "canceled",
])

export const STRIPE_REFUND_NON_FINALIZING_STATUSES = new Set([
  "pending",
  "requires_action",
])

export type StripeRefundWebhookObject = {
  id: string
  object: "refund"
  amount: number
  currency: string
  payment_intent: string | { id: string } | null
  status: string
  failure_reason?: string | null
}

export type StripeChargeRefundedWebhookObject = {
  id: string
  object: "charge"
  amount: number
  amount_refunded: number
  currency: string
  payment_intent: string | { id: string } | null
}

export type RefundWebhookDisposition = "processed" | "ignored" | "failed"

export class RefundWebhookError extends Error {
  readonly webhookDisposition: RefundWebhookDisposition
  readonly code: string

  constructor(
    code: string,
    message: string,
    webhookDisposition: RefundWebhookDisposition = "failed"
  ) {
    super(message)
    this.name = "RefundWebhookError"
    this.code = code
    this.webhookDisposition = webhookDisposition
  }
}

export function isStripeRefundObject(
  value: unknown
): value is StripeRefundWebhookObject {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { object?: unknown }).object === "refund" &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { amount?: unknown }).amount === "number"
  )
}

export function isStripeChargeObject(
  value: unknown
): value is StripeChargeRefundedWebhookObject {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { object?: unknown }).object === "charge" &&
    typeof (value as { id?: unknown }).id === "string"
  )
}

export function extractStripePaymentIntentId(
  value: string | { id: string } | null | undefined
): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }

  if (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    value.id.trim().length > 0
  ) {
    return value.id.trim()
  }

  return null
}

export function isRefundWebhookEventType(eventType: string): boolean {
  return (
    eventType === STRIPE_REFUND_WEBHOOK_EVENT.REFUND_CREATED ||
    eventType === STRIPE_REFUND_WEBHOOK_EVENT.REFUND_UPDATED ||
    eventType === STRIPE_REFUND_WEBHOOK_EVENT.REFUND_FAILED
  )
}

export function isChargeRefundedWebhookEventType(eventType: string): boolean {
  return eventType === STRIPE_REFUND_WEBHOOK_EVENT.CHARGE_REFUNDED
}

export function isNonFinalizingRefundWebhook(input: {
  event_type: string
  refund_status: string
}): boolean {
  if (input.event_type === STRIPE_REFUND_WEBHOOK_EVENT.REFUND_CREATED) {
    return true
  }

  return STRIPE_REFUND_NON_FINALIZING_STATUSES.has(input.refund_status)
}

export function findRefundRequestForStripeRefund(input: {
  refund_requests: RefundRequestRecord[]
  stripe_refund_id: string
  payment_intent_id: string
  refund_amount?: number | null
}): RefundRequestRecord | null {
  const byStripeRefundId = input.refund_requests.find(
    (request) => request.stripe_refund_id === input.stripe_refund_id
  )

  if (byStripeRefundId) {
    return byStripeRefundId
  }

  const linkable = input.refund_requests.filter((request) => {
    if (request.payment_intent_id !== input.payment_intent_id) {
      return false
    }

    if (request.stripe_refund_id && request.stripe_refund_id !== input.stripe_refund_id) {
      return false
    }

    return (
      request.stripe_refund_id == null ||
      (REFUND_REQUEST_RESERVATION_STATUSES as readonly string[]).includes(
        request.status
      )
    )
  })

  if (linkable.length === 0) {
    return null
  }

  if (typeof input.refund_amount === "number") {
    const amountMatches = linkable.filter(
      (request) => request.amount === input.refund_amount
    )

    if (amountMatches.length === 1) {
      return amountMatches[0] ?? null
    }
  }

  if (linkable.length === 1) {
    return linkable[0] ?? null
  }

  return null
}

export function applyNonFinalizingRefundWebhookLink(input: {
  refund_request: RefundRequestRecord
  stripe_refund_id: string
  at: Date
}): {
  refund_request: RefundRequestRecord
  noop: boolean
  finalizes_financial_state: false
} {
  const linked = linkRefundRequestToStripeRefund({
    refund_request: input.refund_request,
    stripe_refund_id: input.stripe_refund_id,
    at: input.at,
  })

  const noop =
    linked.stripe_refund_id === input.refund_request.stripe_refund_id &&
    linked.status === input.refund_request.status &&
    linked.updated_at === input.refund_request.updated_at

  return {
    refund_request: noop ? input.refund_request : linked,
    noop,
    finalizes_financial_state: false,
  }
}

export function linkRefundRequestToStripeRefund(input: {
  refund_request: RefundRequestRecord
  stripe_refund_id: string
  at: Date
}): RefundRequestRecord {
  if (
    input.refund_request.stripe_refund_id &&
    input.refund_request.stripe_refund_id !== input.stripe_refund_id
  ) {
    throw new RefundWebhookError(
      "REFUND_REQUEST_STRIPE_REFUND_ID_MISMATCH",
      "RefundRequest ja vinculado a outro stripe_refund_id."
    )
  }

  const nextStatus =
    input.refund_request.status === REFUND_REQUEST_STATUS.REQUESTED
      ? REFUND_REQUEST_STATUS.CONFIRMATION_PENDING
      : input.refund_request.status

  return {
    ...input.refund_request,
    stripe_refund_id: input.stripe_refund_id,
    status: nextStatus,
    updated_at: input.at.toISOString(),
  }
}

function mapTerminalRefundStatus(
  stripeStatus: string
): RefundRequestStatus | null {
  if (stripeStatus === "succeeded") {
    return REFUND_REQUEST_STATUS.CONFIRMED
  }

  if (stripeStatus === "failed") {
    return REFUND_REQUEST_STATUS.FAILED
  }

  if (stripeStatus === "canceled") {
    return REFUND_REQUEST_STATUS.CANCELED
  }

  return null
}

export function isRefundRequestTerminalNoop(input: {
  refund_request: RefundRequestRecord
  terminal_status: RefundRequestStatus
}): boolean {
  return input.refund_request.status === input.terminal_status
}

export function applyTerminalRefundWebhookToRefundRequest(input: {
  refund_request: RefundRequestRecord
  stripe_refund: StripeRefundWebhookObject
  at: Date
}): {
  refund_request: RefundRequestRecord
  noop: boolean
  finalizes_financial_state: boolean
} {
  const terminalStatus = mapTerminalRefundStatus(input.stripe_refund.status)

  if (!terminalStatus) {
    const linked = linkRefundRequestToStripeRefund({
      refund_request: input.refund_request,
      stripe_refund_id: input.stripe_refund.id,
      at: input.at,
    })

    return {
      refund_request: linked,
      noop: false,
      finalizes_financial_state: false,
    }
  }

  if (
    isRefundRequestTerminalNoop({
      refund_request: input.refund_request,
      terminal_status: terminalStatus,
    })
  ) {
    return {
      refund_request: input.refund_request,
      noop: true,
      finalizes_financial_state: terminalStatus === REFUND_REQUEST_STATUS.CONFIRMED,
    }
  }

  const linked = linkRefundRequestToStripeRefund({
    refund_request: input.refund_request,
    stripe_refund_id: input.stripe_refund.id,
    at: input.at,
  })

  if (terminalStatus === REFUND_REQUEST_STATUS.CONFIRMED) {
    return {
      refund_request: {
        ...linked,
        status: REFUND_REQUEST_STATUS.CONFIRMED,
        confirmed_at: linked.confirmed_at ?? input.at.toISOString(),
        failure_code: null,
        failure_message: null,
        failed_at: null,
        canceled_at: null,
        updated_at: input.at.toISOString(),
      },
      noop: false,
      finalizes_financial_state: true,
    }
  }

  if (terminalStatus === REFUND_REQUEST_STATUS.FAILED) {
    return {
      refund_request: {
        ...linked,
        status: REFUND_REQUEST_STATUS.FAILED,
        failed_at: linked.failed_at ?? input.at.toISOString(),
        failure_code: input.stripe_refund.failure_reason?.trim() || "stripe_refund_failed",
        failure_message: "Stripe refund failed.",
        updated_at: input.at.toISOString(),
      },
      noop: false,
      finalizes_financial_state: false,
    }
  }

  return {
    refund_request: {
      ...linked,
      status: REFUND_REQUEST_STATUS.CANCELED,
      canceled_at: linked.canceled_at ?? input.at.toISOString(),
      updated_at: input.at.toISOString(),
    },
    noop: false,
    finalizes_financial_state: false,
  }
}
