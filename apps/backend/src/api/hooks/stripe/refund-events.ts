import type { MedusaRequest } from "@medusajs/framework/http"
import { REFUND_REQUEST_MODULE } from "../../../modules/refund-request"
import {
  extractStripePaymentIntentId,
  isChargeRefundedWebhookEventType,
  isRefundWebhookEventType,
  isStripeChargeObject,
  isStripeRefundObject,
  RefundWebhookError,
  type StripeChargeRefundedWebhookObject,
  type StripeRefundWebhookObject,
} from "../../../modules/refund-request/stripe-refund-webhook"
import type {
  CreateWebhookEventLogInput,
  WebhookEntityType,
  WebhookEventLogStatus,
  WebhookMetadata,
} from "../../../modules/webhooks/types"
import {
  runProcessStripeRefundWebhookEntrypoint,
  type ProcessStripeRefundWebhookResult,
} from "../../../workflows/refund/stripe-refund-webhook-entrypoint"

type RequestWithRawBody = MedusaRequest & {
  correlationId?: string
}

type StripeWebhookEvent = {
  id: string
  type: string
  account?: string | null
  livemode?: boolean
  data?: {
    object?: unknown
  }
}

type WebhookEventLogRecord = {
  id?: string
  provider: string
  deduplication_key: string
  status: string
  event_type: string
  external_event_id?: string | null
  entity_type?: string
  entity_id?: string | null
  metadata?: WebhookMetadata | null
}

type WebhooksModuleLike = {
  updateWebhookEventLogs?: (
    data: Record<string, unknown> | Array<Record<string, unknown>>
  ) => Promise<WebhookEventLogRecord[] | WebhookEventLogRecord>
}

function buildRefundWebhookMetadata(input: {
  correlationId?: string
  event: StripeWebhookEvent
  paymentIntentId: string | null
  stripeRefundId: string | null
  refundRequestId: string | null
  status: WebhookEventLogStatus
  resultStatus?: ProcessStripeRefundWebhookResult["status"] | null
}): WebhookMetadata {
  const metadata: WebhookMetadata = {
    provider: "stripe",
    external_event_id: input.event.id,
    event_type: input.event.type,
    status: input.status,
    stripe_livemode: input.event.livemode ?? false,
  }

  if (input.correlationId) {
    metadata.correlation_id = input.correlationId
  }

  if (input.event.account) {
    metadata.stripe_account = input.event.account
  }

  if (input.paymentIntentId) {
    metadata.payment_intent_id = input.paymentIntentId
  }

  if (input.stripeRefundId) {
    metadata.stripe_refund_id = input.stripeRefundId
  }

  if (input.refundRequestId) {
    metadata.refund_request_id = input.refundRequestId
  }

  if (input.resultStatus) {
    metadata.refund_webhook_result = input.resultStatus
  }

  return metadata
}

export function resolveRefundWebhookEntityContext(event: StripeWebhookEvent): {
  entityType: WebhookEntityType
  paymentIntentId: string | null
  stripeRefundId: string | null
} {
  if (isStripeRefundObject(event.data?.object)) {
    return {
      entityType: "refund",
      paymentIntentId: extractStripePaymentIntentId(event.data.object.payment_intent),
      stripeRefundId: event.data.object.id,
    }
  }

  if (isStripeChargeObject(event.data?.object)) {
    return {
      entityType: "refund",
      paymentIntentId: extractStripePaymentIntentId(event.data.object.payment_intent),
      stripeRefundId: null,
    }
  }

  return {
    entityType: "unknown",
    paymentIntentId: null,
    stripeRefundId: null,
  }
}

export function augmentRefundWebhookEventInput(
  input: CreateWebhookEventLogInput,
  event: StripeWebhookEvent
): CreateWebhookEventLogInput {
  const context = resolveRefundWebhookEntityContext(event)

  return {
    ...input,
    entity_type: context.entityType,
    entity_id: context.stripeRefundId,
    status: "received",
    ignored_at: null,
    metadata: buildRefundWebhookMetadata({
      event,
      paymentIntentId: context.paymentIntentId,
      stripeRefundId: context.stripeRefundId,
      refundRequestId: null,
      status: "received",
    }),
  }
}

export function isStripeRefundRelatedEventType(eventType: string): boolean {
  return isRefundWebhookEventType(eventType) || isChargeRefundedWebhookEventType(eventType)
}

async function updateWebhookRecord(
  service: WebhooksModuleLike,
  input: Record<string, unknown>
): Promise<void> {
  if (typeof service.updateWebhookEventLogs !== "function") {
    throw new RefundWebhookError(
      "WEBHOOK_MODULE_UPDATE_UNAVAILABLE",
      "Modulo de webhooks sem suporte para atualizacao."
    )
  }

  await service.updateWebhookEventLogs(input)
}

export async function processStripeRefundRelatedEvent(input: {
  req: RequestWithRawBody
  event: StripeWebhookEvent
  record: WebhookEventLogRecord
  webhooksModule: WebhooksModuleLike
  now: Date
  runRefundEntrypoint?: typeof runProcessStripeRefundWebhookEntrypoint
}): Promise<WebhookEventLogStatus> {
  const runEntrypoint =
    input.runRefundEntrypoint ?? runProcessStripeRefundWebhookEntrypoint
  const refundObject = isStripeRefundObject(input.event.data?.object)
    ? (input.event.data.object as StripeRefundWebhookObject)
    : null
  const chargeObject = isStripeChargeObject(input.event.data?.object)
    ? (input.event.data.object as StripeChargeRefundedWebhookObject)
    : null

  const result = await runEntrypoint(input.req.scope, {
    event_type: input.event.type,
    refund: refundObject,
    charge: chargeObject,
    stripe_event_id: input.event.id,
    correlation_id: input.req.correlationId ?? null,
  })

  const context = resolveRefundWebhookEntityContext(input.event)

  await updateWebhookRecord(input.webhooksModule, {
    id: input.record.id,
    status: "processed",
    entity_type: "refund",
    entity_id: result.refund_request_id ?? context.stripeRefundId,
    error_code: null,
    error_message: null,
    processed_at: input.now.toISOString(),
    failed_at: null,
    ignored_at: null,
    metadata: buildRefundWebhookMetadata({
      correlationId: input.req.correlationId,
      event: input.event,
      paymentIntentId: context.paymentIntentId,
      stripeRefundId: context.stripeRefundId,
      refundRequestId: result.refund_request_id,
      status: "processed",
      resultStatus: result.status,
    }),
  })

  return "processed"
}

export function resolveRefundRequestModuleFromRequest(req: RequestWithRawBody) {
  return req.scope.resolve(REFUND_REQUEST_MODULE)
}
