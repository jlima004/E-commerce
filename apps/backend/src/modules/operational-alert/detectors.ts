import {
  CHECKOUT_COMPLETION_STALE_AFTER_MS,
  isCheckoutCompletionLockedStale,
} from "../checkout-completion/staleness"
import type { UpsertAlertInput } from "./service"

export const PIX_EXPIRED_ALERT_STATUSES = [
  "awaiting_pix_payment",
  "awaiting_webhook_confirmation",
  "payment_instructions_displayed",
  "payment_client_confirmed",
  "client_action_required",
] as const

export type PixExpiredAlertStatus = (typeof PIX_EXPIRED_ALERT_STATUSES)[number]

export type FulfillmentAlertCandidate = {
  id: string
  status?: string | null
  order_id?: string | null
  requires_operator_attention?: boolean | null
  last_error_code?: string | null
  operator_alert_code?: string | null
}

export type PaymentAttemptAlertCandidate = {
  id: string
  status?: string | null
  order_id?: string | null
  payment_method_type?: string | null
  provider_payment_intent_id?: string | null
  expires_at?: Date | string | null
}

export type CheckoutCompletionAlertCandidate = {
  id: string
  status?: string | null
  order_id?: string | null
  payment_attempt_id?: string | null
  payment_intent_id?: string | null
  locked_at?: Date | string | null
}

export type WebhookEventAlertCandidate = {
  id: string
  provider?: string | null
  event_type?: string | null
  entity_type?: string | null
  entity_id?: string | null
  received_at?: Date | string | null
  metadata?: Record<string, unknown> | null
}

function parseTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    return Number.isFinite(parsed.getTime()) ? parsed : null
  }
  return null
}

function sanitizeCode(value: string | null | undefined, fallback: string): string {
  if (typeof value !== "string") {
    return fallback
  }
  const trimmed = value.trim().slice(0, 128)
  return trimmed.length > 0 ? trimmed : fallback
}

function isConfirmedWithoutOrder(
  paymentAttempt: PaymentAttemptAlertCandidate
): boolean {
  return (
    paymentAttempt.status === "payment_confirmed_by_webhook" &&
    (paymentAttempt.order_id === null || paymentAttempt.order_id === undefined)
  )
}

function findUnequivocalCanonicalWebhook(
  paymentAttempt: PaymentAttemptAlertCandidate,
  webhookCandidates: WebhookEventAlertCandidate[]
): WebhookEventAlertCandidate | null {
  const paymentIntentId =
    typeof paymentAttempt.provider_payment_intent_id === "string"
      ? paymentAttempt.provider_payment_intent_id.trim()
      : ""

  if (!paymentIntentId) {
    return null
  }

  const matches = webhookCandidates.filter((candidate) => {
    if (candidate.provider !== "stripe") {
      return false
    }
    if (candidate.event_type !== "payment_intent.succeeded") {
      return false
    }

    const metadataPaymentIntentId =
      typeof candidate.metadata?.payment_intent_id === "string"
        ? candidate.metadata.payment_intent_id.trim()
        : ""

    const entityMatchesAttempt =
      candidate.entity_type === "payment_attempt" &&
      candidate.entity_id === paymentAttempt.id

    const entityMatchesPaymentIntent = candidate.entity_id === paymentIntentId
    const metadataMatches = metadataPaymentIntentId === paymentIntentId

    return entityMatchesAttempt || entityMatchesPaymentIntent || metadataMatches
  })

  if (matches.length !== 1) {
    return null
  }

  return matches[0] ?? null
}

export function detectFulfillmentFailed(
  fulfillment: FulfillmentAlertCandidate,
  now: Date = new Date()
): UpsertAlertInput | null {
  const deadLetter = fulfillment.status === "dead_letter"
  const operatorAttention = fulfillment.requires_operator_attention === true

  if (!deadLetter && !operatorAttention) {
    return null
  }

  const severity = deadLetter ? "critical" : "high"
  const messageCode = deadLetter
    ? "FULFILLMENT_DEAD_LETTER"
    : "FULFILLMENT_OPERATOR_ATTENTION"
  const message = deadLetter
    ? "Gelato fulfillment entered dead_letter"
    : "Gelato fulfillment requires operator attention"
  const errorCode = deadLetter
    ? sanitizeCode(fulfillment.last_error_code, "GELATO_FULFILLMENT_FAILED")
    : sanitizeCode(
        fulfillment.operator_alert_code,
        "GELATO_OPERATOR_ATTENTION"
      )

  const metadata: NonNullable<UpsertAlertInput["metadata"]> = {
    fulfillment_id: fulfillment.id,
    detector_code: messageCode,
    source_status: String(fulfillment.status ?? "unknown"),
  }
  if (fulfillment.order_id) {
    metadata.order_id = fulfillment.order_id
  }
  if (fulfillment.operator_alert_code) {
    metadata.operator_alert_code = sanitizeCode(
      fulfillment.operator_alert_code,
      "GELATO_OPERATOR_ATTENTION"
    )
  }

  return {
    type: "fulfillment_failed",
    severity,
    entity_type: "fulfillment",
    entity_id: fulfillment.id,
    message_code: messageCode,
    message,
    error_code: errorCode,
    metadata,
    observed_at: now,
  }
}

export function detectPaymentStuckConfirmedWithoutOrder(input: {
  paymentAttempt: PaymentAttemptAlertCandidate
  checkoutCompletion: CheckoutCompletionAlertCandidate | null
  webhookCandidates?: WebhookEventAlertCandidate[]
  now: Date
}): UpsertAlertInput | null {
  const { paymentAttempt, checkoutCompletion, now } = input
  if (!isConfirmedWithoutOrder(paymentAttempt)) {
    return null
  }

  const baseMetadata: NonNullable<UpsertAlertInput["metadata"]> = {
    payment_attempt_id: paymentAttempt.id,
  }
  if (paymentAttempt.provider_payment_intent_id) {
    baseMetadata.payment_intent_id = paymentAttempt.provider_payment_intent_id
  }

  if (checkoutCompletion?.status === "failed") {
    return {
      type: "payment_stuck",
      severity: "high",
      entity_type: "payment_attempt",
      entity_id: paymentAttempt.id,
      message_code: "PAYMENT_CONFIRMED_CHECKOUT_FAILED",
      message: "Payment confirmed but checkout completion failed",
      error_code: "CHECKOUT_COMPLETION_FAILED",
      metadata: {
        ...baseMetadata,
        checkout_completion_log_id: checkoutCompletion.id,
        detector_code: "PAYMENT_CONFIRMED_CHECKOUT_FAILED",
        source_status: "failed",
      },
      observed_at: now,
    }
  }

  if (checkoutCompletion?.status === "processing") {
    if (!isCheckoutCompletionLockedStale(checkoutCompletion.locked_at, now)) {
      return null
    }

    return {
      type: "payment_stuck",
      severity: "high",
      entity_type: "payment_attempt",
      entity_id: paymentAttempt.id,
      message_code: "PAYMENT_CONFIRMED_CHECKOUT_STALE",
      message: "Payment confirmed with stale checkout processing",
      error_code: "CHECKOUT_COMPLETION_STALE_PROCESSING",
      metadata: {
        ...baseMetadata,
        checkout_completion_log_id: checkoutCompletion.id,
        detector_code: "PAYMENT_CONFIRMED_CHECKOUT_STALE",
        source_status: "processing",
      },
      observed_at: now,
    }
  }

  if (checkoutCompletion) {
    return null
  }

  const webhook = findUnequivocalCanonicalWebhook(
    paymentAttempt,
    input.webhookCandidates ?? []
  )
  if (!webhook) {
    return null
  }

  const receivedAt = parseTimestamp(webhook.received_at)
  if (!receivedAt) {
    return null
  }
  if (now.getTime() - receivedAt.getTime() < CHECKOUT_COMPLETION_STALE_AFTER_MS) {
    return null
  }

  return {
    type: "payment_stuck",
    severity: "high",
    entity_type: "payment_attempt",
    entity_id: paymentAttempt.id,
    message_code: "PAYMENT_CONFIRMED_CHECKOUT_MISSING",
    message: "Payment confirmed without checkout completion",
    error_code: "CHECKOUT_COMPLETION_MISSING",
    metadata: {
      ...baseMetadata,
      webhook_event_log_id: webhook.id,
      detector_code: "PAYMENT_CONFIRMED_CHECKOUT_MISSING",
      source_status: "missing_checkout_completion",
    },
    observed_at: now,
  }
}

export function detectPixExpiredWithoutOrder(
  paymentAttempt: PaymentAttemptAlertCandidate,
  now: Date = new Date()
): UpsertAlertInput | null {
  if (paymentAttempt.payment_method_type !== "pix") {
    return null
  }
  if (
    paymentAttempt.order_id !== null &&
    paymentAttempt.order_id !== undefined
  ) {
    return null
  }

  const expiresAt = parseTimestamp(paymentAttempt.expires_at)
  if (!expiresAt) {
    return null
  }
  if (now.getTime() <= expiresAt.getTime()) {
    return null
  }

  const status = paymentAttempt.status
  if (
    typeof status !== "string" ||
    !(PIX_EXPIRED_ALERT_STATUSES as readonly string[]).includes(status)
  ) {
    return null
  }

  return {
    type: "payment_stuck",
    severity: "high",
    entity_type: "payment_attempt",
    entity_id: paymentAttempt.id,
    message_code: "PIX_PAYMENT_EXPIRED_WITHOUT_ORDER",
    message: "Pix payment expired without order",
    error_code: "PIX_PAYMENT_EXPIRED",
    metadata: {
      payment_attempt_id: paymentAttempt.id,
      detector_code: "PIX_PAYMENT_EXPIRED_WITHOUT_ORDER",
      source_status: status,
    },
    observed_at: now,
  }
}

export function detectPaymentStuck(input: {
  paymentAttempt: PaymentAttemptAlertCandidate
  checkoutCompletion?: CheckoutCompletionAlertCandidate | null
  webhookCandidates?: WebhookEventAlertCandidate[]
  now: Date
}): UpsertAlertInput | null {
  const pix = detectPixExpiredWithoutOrder(input.paymentAttempt, input.now)
  if (pix) {
    return pix
  }

  return detectPaymentStuckConfirmedWithoutOrder({
    paymentAttempt: input.paymentAttempt,
    checkoutCompletion: input.checkoutCompletion ?? null,
    webhookCandidates: input.webhookCandidates,
    now: input.now,
  })
}
