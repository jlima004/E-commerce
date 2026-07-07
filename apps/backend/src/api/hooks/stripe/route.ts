import Stripe from "stripe"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { env, type AppEnv } from "../../../config/env"
import { PAYMENT_ATTEMPT_MODULE } from "../../../modules/payment-attempt"
import { WEBHOOKS_MODULE } from "../../../modules/webhooks"
import {
  sanitizeWebhookError,
  buildStripeDeduplicationKey,
  buildWebhookPayloadHash,
} from "../../../modules/webhooks/service"
import {
  PaymentAttemptWebhookError,
  applyStripePaymentIntentWebhookToAttempt,
  findPaymentAttemptForWebhook,
  type StripePaymentIntentWebhookObject,
  type SupportedStripePaymentIntentEventType,
} from "../../../modules/payment-attempt/service"
import type { PaymentAttemptRecord } from "../../../modules/payment-attempt/types"
import type {
  CreateWebhookEventLogInput,
  WebhookEntityType,
  WebhookEventLogStatus,
  WebhookMetadata,
} from "../../../modules/webhooks/types"
import {
  runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
  type CreateOrderFromConfirmedPaymentAttemptResult,
} from "../../../workflows/order/webhook-order-entrypoint"
import { RefundWebhookError } from "../../../modules/refund-request/stripe-refund-webhook"
import {
  augmentRefundWebhookEventInput,
  isStripeRefundRelatedEventType,
  processStripeRefundRelatedEvent,
  resolveRefundWebhookEntityContext,
} from "./refund-events"

const STRIPE_PROVIDER = "stripe"
const STRIPE_SIGNATURE_HEADER = "stripe-signature"
const PAYMENT_INTENT_EVENT_TYPES = new Set([
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
])
const REFUND_EVENT_TYPES = new Set([
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.refunded",
])
const SUPPORTED_EVENT_TYPES = new Set([
  ...PAYMENT_INTENT_EVENT_TYPES,
  ...REFUND_EVENT_TYPES,
])
const FINAL_WEBHOOK_STATUSES = new Set<WebhookEventLogStatus>([
  "processed",
  "ignored",
  "failed",
])

type RequestWithRawBody = MedusaRequest & {
  rawBody?: Buffer | string
  correlationId?: string
}

type StripeWebhookEvent = Pick<Stripe.Event, "id" | "type" | "account" | "livemode"> & {
  data?: {
    object?: unknown
  }
}

type StripeLike = {
  webhooks: {
    constructEvent: (
      payload: Buffer | string,
      header: string,
      secret: string
    ) => unknown
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
  error_code?: string | null
  error_message?: string | null
  processed_at?: string | null
  failed_at?: string | null
  ignored_at?: string | null
  metadata?: WebhookMetadata | null
}

type WebhooksModuleLike = {
  listWebhookEventLogs?: (
    filters?: Record<string, unknown>
  ) => Promise<WebhookEventLogRecord[]>
  createWebhookEventLogs?: (
    data: CreateWebhookEventLogInput | CreateWebhookEventLogInput[]
  ) => Promise<WebhookEventLogRecord[] | WebhookEventLogRecord>
  updateWebhookEventLogs?: (
    data: Record<string, unknown> | Array<Record<string, unknown>>
  ) => Promise<WebhookEventLogRecord[] | WebhookEventLogRecord>
}

type PaymentAttemptModuleLike = {
  listPaymentAttempts?: (
    filters?: Record<string, unknown>
  ) => Promise<PaymentAttemptRecord[]>
  updatePaymentAttempts?: (
    data: PaymentAttemptRecord | PaymentAttemptRecord[]
  ) => Promise<PaymentAttemptRecord[]>
}

type RouteDeps = {
  appEnv?: AppEnv
  now?: () => Date
  stripe?: StripeLike
  runOrderEntrypoint?: (
    scope: MedusaRequest["scope"],
    input: {
      payment_attempt_id: string
      payment_intent_id: string
      stripe_event_id?: string | null
      correlation_id?: string | null
    }
  ) => Promise<CreateOrderFromConfirmedPaymentAttemptResult>
}

const stripeClient = new Stripe("webhook_verifier_placeholder", {
  apiVersion: "2025-09-30.clover",
})

function readHeader(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }

  if (Array.isArray(value)) {
    const candidate = value.find(
      (entry) => typeof entry === "string" && entry.trim().length > 0
    )

    if (typeof candidate === "string") {
      return candidate.trim()
    }
  }

  return null
}

function resolveRawBody(req: RequestWithRawBody): Buffer | string | null {
  if (typeof req.rawBody === "string" && req.rawBody.length > 0) {
    return req.rawBody
  }

  if (Buffer.isBuffer(req.rawBody) && req.rawBody.length > 0) {
    return req.rawBody
  }

  return null
}

function isPaymentIntentObject(value: unknown): value is StripePaymentIntentWebhookObject & {
  id: string
  object: "payment_intent"
} {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { object?: unknown }).object === "payment_intent" &&
    typeof (value as { id?: unknown }).id === "string"
  )
}

function buildWebhookMetadata(input: {
  correlationId?: string
  event: StripeWebhookEvent
  paymentIntentId: string | null
  status: WebhookEventLogStatus
}): WebhookMetadata {
  const metadata: WebhookMetadata = {
    provider: STRIPE_PROVIDER,
    external_event_id: input.event.id,
    event_type: input.event.type,
    status: input.status,
    stripe_livemode: input.event.livemode,
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

  return metadata
}

function buildWebhookEventInput(input: {
  req: RequestWithRawBody
  event: StripeWebhookEvent
  now: Date
}): CreateWebhookEventLogInput {
  const paymentIntentId = isPaymentIntentObject(input.event.data?.object)
    ? input.event.data?.object.id
    : null
  const payloadHash = buildWebhookPayloadHash(input.event)
  const status: WebhookEventLogStatus = SUPPORTED_EVENT_TYPES.has(input.event.type)
    ? "received"
    : "ignored"
  const entityType: WebhookEntityType = "unknown"

  const baseInput: CreateWebhookEventLogInput = {
    provider: STRIPE_PROVIDER,
    external_event_id: input.event.id,
    event_type: input.event.type,
    entity_type: entityType,
    entity_id: null,
    payload_hash: payloadHash,
    deduplication_key: buildStripeDeduplicationKey({
      external_event_id: input.event.id,
      payload_hash: payloadHash,
    }),
    status,
    metadata: buildWebhookMetadata({
      correlationId: input.req.correlationId,
      event: input.event,
      paymentIntentId,
      status,
    }),
    received_at: input.now.toISOString(),
    ignored_at: status === "ignored" ? input.now.toISOString() : null,
  }

  if (isStripeRefundRelatedEventType(input.event.type)) {
    return augmentRefundWebhookEventInput(baseInput, input.event)
  }

  return baseInput
}

function resolveWebhooksModule(req: RequestWithRawBody): WebhooksModuleLike {
  const service = req.scope.resolve(WEBHOOKS_MODULE) as WebhooksModuleLike

  if (
    !service ||
    typeof service.listWebhookEventLogs !== "function" ||
    typeof service.createWebhookEventLogs !== "function"
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Modulo de webhooks nao configurado."
    )
  }

  return service
}

function resolvePaymentAttemptModule(
  req: RequestWithRawBody
): PaymentAttemptModuleLike {
  const service = req.scope.resolve(PAYMENT_ATTEMPT_MODULE) as PaymentAttemptModuleLike

  if (
    !service ||
    typeof service.listPaymentAttempts !== "function" ||
    typeof service.updatePaymentAttempts !== "function"
  ) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_MODULE_UNAVAILABLE",
      "Modulo de tentativa de pagamento nao configurado."
    )
  }

  return service
}

function normalizeCreatedRecord(
  created: WebhookEventLogRecord[] | WebhookEventLogRecord
): WebhookEventLogRecord | null {
  if (Array.isArray(created)) {
    return created[0] ?? null
  }

  return created ?? null
}

function isDuplicateConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /duplicate|unique|conflict/i.test(message)
}

function buildProcessedMetadata(input: {
  record: WebhookEventLogRecord
  paymentIntentId: string
  paymentAttemptId: string
}): WebhookMetadata {
  return {
    ...(input.record.metadata ?? {}),
    payment_intent_id: input.paymentIntentId,
    payment_attempt_id: input.paymentAttemptId,
    status: "processed",
  }
}

function assertTerminalOrderEntrypointResult(
  result: CreateOrderFromConfirmedPaymentAttemptResult
): void {
  const orderId = result.order_id?.trim()
  const terminalStatus =
    result.status === "created" || result.status === "reused_existing_order"

  if (!terminalStatus || !orderId) {
    throw new PaymentAttemptWebhookError(
      "CHECKOUT_COMPLETION_NOT_TERMINAL",
      "CheckoutCompletionLog nao terminou com order_id; webhook Stripe nao pode ser marcado como processed."
    )
  }
}

function buildErroredMetadata(input: {
  record: WebhookEventLogRecord
  paymentIntentId: string | null
  status: "failed" | "ignored"
}): WebhookMetadata {
  const metadata: WebhookMetadata = {
    ...(input.record.metadata ?? {}),
    status: input.status,
  }

  if (input.paymentIntentId) {
    metadata.payment_intent_id = input.paymentIntentId
  }

  return metadata
}

async function recordWebhookEvent(
  service: WebhooksModuleLike,
  input: CreateWebhookEventLogInput
): Promise<{ record: WebhookEventLogRecord; duplicate: boolean }> {
  const existing = await service.listWebhookEventLogs?.({
    provider: input.provider,
    deduplication_key: input.deduplication_key,
  })

  if (existing?.[0]) {
    return {
      record: existing[0],
      duplicate: true,
    }
  }

  try {
    const created = await service.createWebhookEventLogs?.(input)
    const record = normalizeCreatedRecord(created ?? [])

    if (!record) {
      throw new Error("WEBHOOK_EVENT_LOG_CREATE_EMPTY")
    }

    return {
      record,
      duplicate: false,
    }
  } catch (error) {
    if (!isDuplicateConflict(error)) {
      throw error
    }

    const concurrent = await service.listWebhookEventLogs?.({
      provider: input.provider,
      deduplication_key: input.deduplication_key,
    })

    if (!concurrent?.[0]) {
      throw error
    }

    return {
      record: concurrent[0],
      duplicate: true,
    }
  }
}

async function updateWebhookRecord(
  service: WebhooksModuleLike,
  input: Record<string, unknown>
): Promise<void> {
  if (typeof service.updateWebhookEventLogs !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Modulo de webhooks sem suporte para atualizacao."
    )
  }

  await service.updateWebhookEventLogs(input)
}

function isFinalWebhookStatus(status: string): status is WebhookEventLogStatus {
  return FINAL_WEBHOOK_STATUSES.has(status as WebhookEventLogStatus)
}

async function markWebhookRecordIgnored(input: {
  service: WebhooksModuleLike
  record: WebhookEventLogRecord
  paymentIntentId: string | null
  now: Date
}): Promise<WebhookEventLogStatus> {
  if (input.record.status === "ignored") {
    return "ignored"
  }

  await updateWebhookRecord(input.service, {
    id: input.record.id,
    status: "ignored",
    entity_type: input.paymentIntentId ? "payment_attempt" : "unknown",
    entity_id: null,
    processed_at: null,
    failed_at: null,
    ignored_at: input.now.toISOString(),
    error_code: null,
    error_message: null,
    metadata: buildErroredMetadata({
      record: input.record,
      paymentIntentId: input.paymentIntentId,
      status: "ignored",
    }),
  })

  return "ignored"
}

async function processStripePaymentIntentEvent(input: {
  req: RequestWithRawBody
  event: StripeWebhookEvent
  record: WebhookEventLogRecord
  webhooksModule: WebhooksModuleLike
  now: Date
  runOrderEntrypoint: RouteDeps["runOrderEntrypoint"]
}): Promise<WebhookEventLogStatus> {
  if (!isPaymentIntentObject(input.event.data?.object)) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_INTENT_OBJECT_INVALID",
      "Evento sem PaymentIntent valido."
    )
  }

  const paymentIntent = input.event.data.object
  const paymentAttemptModule = resolvePaymentAttemptModule(input.req)
  const attempts =
    (await paymentAttemptModule.listPaymentAttempts?.({
      provider_payment_intent_id: paymentIntent.id,
    })) ?? []
  const attempt = findPaymentAttemptForWebhook(attempts, paymentIntent.id)
  const updatedAttempt = applyStripePaymentIntentWebhookToAttempt(
    attempt,
    paymentIntent,
    input.event.type as SupportedStripePaymentIntentEventType,
    input.now
  )

  await paymentAttemptModule.updatePaymentAttempts?.(updatedAttempt)

  const shouldInvokeOrderEntrypoint =
    input.event.type === "payment_intent.succeeded" &&
    updatedAttempt.status === "payment_confirmed_by_webhook" &&
    updatedAttempt.order_id == null

  if (shouldInvokeOrderEntrypoint && input.runOrderEntrypoint) {
    const orderEntrypointResult = await input.runOrderEntrypoint(input.req.scope, {
      payment_attempt_id: updatedAttempt.id,
      payment_intent_id: paymentIntent.id,
      stripe_event_id: input.event.id,
      correlation_id: input.req.correlationId,
    })

    assertTerminalOrderEntrypointResult(orderEntrypointResult)
  } else if (shouldInvokeOrderEntrypoint) {
    throw new PaymentAttemptWebhookError(
      "CHECKOUT_COMPLETION_ENTRYPOINT_UNAVAILABLE",
      "Entrypoint de criacao de Order indisponivel para webhook Stripe confirmado."
    )
  }

  await updateWebhookRecord(input.webhooksModule, {
    id: input.record.id,
    status: "processed",
    entity_type: "payment_attempt",
    entity_id: updatedAttempt.id,
    error_code: null,
    error_message: null,
    processed_at: input.now.toISOString(),
    failed_at: null,
    ignored_at: null,
    metadata: buildProcessedMetadata({
      record: input.record,
      paymentIntentId: paymentIntent.id,
      paymentAttemptId: updatedAttempt.id,
    }),
  })

  return "processed"
}

function respond(
  res: MedusaResponse,
  statusCode: number,
  body: Record<string, unknown>
) {
  res.status(statusCode)
  return res.json(body)
}

export function createStripeWebhookPostHandler(deps: RouteDeps = {}) {
  const routeEnv = deps.appEnv ?? env
  const now = deps.now ?? (() => new Date())
  const stripe = deps.stripe ?? stripeClient
  const runOrderEntrypoint =
    deps.runOrderEntrypoint ?? runCreateOrderFromConfirmedPaymentAttemptEntrypoint

  return async function POST(req: MedusaRequest, res: MedusaResponse) {
    const request = req as RequestWithRawBody

    if (!routeEnv.STRIPE_WEBHOOK_INGESTION_ENABLED) {
      return respond(res, 503, {
        ok: false,
        code: "stripe_webhook_ingestion_disabled",
      })
    }

    if (!routeEnv.STRIPE_WEBHOOK_SECRET) {
      return respond(res, 503, {
        ok: false,
        code: "stripe_webhook_secret_not_configured",
      })
    }

    const rawBody = resolveRawBody(request)
    if (!rawBody) {
      return respond(res, 400, {
        ok: false,
        code: "stripe_raw_body_required",
      })
    }

    const signature = readHeader(request.headers[STRIPE_SIGNATURE_HEADER])
    if (!signature) {
      return respond(res, 400, {
        ok: false,
        code: "stripe_signature_required",
      })
    }

    let event: StripeWebhookEvent

    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        routeEnv.STRIPE_WEBHOOK_SECRET
      ) as StripeWebhookEvent
    } catch {
      return respond(res, 400, {
        ok: false,
        code: "stripe_signature_invalid",
      })
    }

    const input = buildWebhookEventInput({
      req: request,
      event,
      now: now(),
    })
    const service = resolveWebhooksModule(request)
    const { record, duplicate } = await recordWebhookEvent(service, input)

    const paymentIntentId = isPaymentIntentObject(event.data?.object)
      ? event.data.object.id
      : null

    if (duplicate && isFinalWebhookStatus(record.status)) {
      return respond(res, 200, {
        ok: true,
        duplicate: true,
        event_id: record.external_event_id ?? input.external_event_id ?? null,
        event_type: record.event_type,
        status: record.status,
      })
    }

    if (!SUPPORTED_EVENT_TYPES.has(event.type)) {
      const ignoredStatus = duplicate
        ? await markWebhookRecordIgnored({
            service,
            record,
            paymentIntentId,
            now: now(),
          })
        : record.status

      return respond(res, 200, {
        ok: true,
        duplicate,
        event_id: record.external_event_id ?? input.external_event_id ?? null,
        event_type: record.event_type,
        status: ignoredStatus,
      })
    }

    let finalStatus: WebhookEventLogStatus = "received"
    const refundContext = isStripeRefundRelatedEventType(event.type)
      ? resolveRefundWebhookEntityContext(event)
      : null
    const erroredPaymentIntentId =
      paymentIntentId ?? refundContext?.paymentIntentId ?? null

    try {
      if (isStripeRefundRelatedEventType(event.type)) {
        finalStatus = await processStripeRefundRelatedEvent({
          req: request,
          event,
          record,
          webhooksModule: service,
          now: now(),
        })
      } else {
        finalStatus = await processStripePaymentIntentEvent({
          req: request,
          event,
          record,
          webhooksModule: service,
          now: now(),
          runOrderEntrypoint,
        })
      }
    } catch (error) {
      const rawDisposition =
        error instanceof PaymentAttemptWebhookError ||
        error instanceof RefundWebhookError
          ? error.webhookDisposition
          : "failed"
      const disposition: "failed" | "ignored" =
        rawDisposition === "ignored" ? "ignored" : "failed"
      const sanitized = sanitizeWebhookError(error)

      await updateWebhookRecord(service, {
        id: record.id,
        status: disposition,
        entity_type: erroredPaymentIntentId
          ? isStripeRefundRelatedEventType(event.type)
            ? "refund"
            : "payment_attempt"
          : "unknown",
        entity_id: null,
        processed_at: null,
        failed_at: disposition === "failed" ? now().toISOString() : null,
        ignored_at: disposition === "ignored" ? now().toISOString() : null,
        error_code: sanitized.error_code,
        error_message: sanitized.error_message,
        metadata: buildErroredMetadata({
          record,
          paymentIntentId: erroredPaymentIntentId,
          status: disposition,
        }),
      })

      finalStatus = disposition
    }

    return respond(res, 200, {
      ok: true,
      duplicate,
      event_id: record.external_event_id ?? input.external_event_id ?? null,
      event_type: record.event_type,
      status: finalStatus,
    })
  }
}

export const POST = createStripeWebhookPostHandler()
