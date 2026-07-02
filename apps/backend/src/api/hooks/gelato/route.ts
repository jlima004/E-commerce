import { timingSafeEqual } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { env, type AppEnv } from "../../../config/env"
import { GELATO_FULFILLMENT_MODULE } from "../../../modules/gelato-fulfillment"
import {
  GelatoWebhookError,
  applyGelatoOrderStatusUpdatedWebhookToFulfillment,
  isGelatoWebhookSupportedEventType,
  parseGelatoOrderStatusUpdatedWebhookPayload,
  resolveGelatoFulfillmentForWebhook,
} from "../../../modules/gelato-fulfillment/service"
import type { GelatoFulfillmentRecord } from "../../../modules/gelato-fulfillment/types"
import { WEBHOOKS_MODULE } from "../../../modules/webhooks"
import {
  buildGelatoDeduplicationKey,
  buildWebhookPayloadHash,
  sanitizeWebhookError,
} from "../../../modules/webhooks/service"
import type {
  CreateWebhookEventLogInput,
  WebhookEntityType,
  WebhookEventLogStatus,
  WebhookMetadata,
} from "../../../modules/webhooks/types"

const GELATO_PROVIDER = "gelato"
const SUPPORTED_EVENT_TYPE = "order_status_updated"
const FINAL_WEBHOOK_STATUSES = new Set<WebhookEventLogStatus>([
  "processed",
  "ignored",
  "failed",
])

type RequestWithCorrelation = MedusaRequest & {
  correlationId?: string
}

type GelatoWebhookPayload = {
  id?: string | null
  event?: string | null
  orderId?: string | null
  orderReferenceId?: string | null
  fulfillmentStatus?: string | null
  connectedOrderIds?: string[] | null
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

type GelatoFulfillmentModuleLike = {
  listGelatoFulfillments?: (
    filters?: Record<string, unknown>
  ) => Promise<GelatoFulfillmentRecord[]>
  updateGelatoFulfillments?: (
    data: GelatoFulfillmentRecord | GelatoFulfillmentRecord[]
  ) => Promise<GelatoFulfillmentRecord[]>
}

type RouteDeps = {
  appEnv?: AppEnv
  now?: () => Date
}

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

function secureCompare(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

function resolveRequestPayload(req: MedusaRequest): unknown {
  if (req.body !== undefined && req.body !== null) {
    return req.body
  }

  return null
}

function readEventType(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const event = (payload as GelatoWebhookPayload).event

  return typeof event === "string" && event.trim().length > 0
    ? event.trim()
    : null
}

function buildWebhookMetadata(input: {
  correlationId?: string
  payload: GelatoWebhookPayload
  status: WebhookEventLogStatus
}): WebhookMetadata {
  const metadata: WebhookMetadata = {
    provider: GELATO_PROVIDER,
    external_event_id:
      typeof input.payload.id === "string" ? input.payload.id : null,
    event_type:
      typeof input.payload.event === "string" ? input.payload.event : null,
    status: input.status,
  }

  if (input.correlationId) {
    metadata.correlation_id = input.correlationId
  }

  if (typeof input.payload.orderId === "string") {
    metadata.gelato_order_id = input.payload.orderId
  }

  if (typeof input.payload.orderReferenceId === "string") {
    metadata.order_reference_id = input.payload.orderReferenceId
  }

  if (typeof input.payload.fulfillmentStatus === "string") {
    metadata.provider_status = input.payload.fulfillmentStatus
  }

  return metadata
}

function buildWebhookEventInput(input: {
  req: RequestWithCorrelation
  payload: GelatoWebhookPayload
  now: Date
}): CreateWebhookEventLogInput {
  const payloadHash = buildWebhookPayloadHash(input.payload)
  const externalEventId =
    typeof input.payload.id === "string" ? input.payload.id : null
  const eventType = readEventType(input.payload) ?? SUPPORTED_EVENT_TYPE

  return {
    provider: GELATO_PROVIDER,
    external_event_id: externalEventId,
    event_type: eventType,
    entity_type: "fulfillment",
    entity_id: null,
    payload_hash: payloadHash,
    deduplication_key: buildGelatoDeduplicationKey({
      external_event_id: externalEventId,
      payload_hash: payloadHash,
    }),
    status: "received",
    metadata: buildWebhookMetadata({
      correlationId: input.req.correlationId,
      payload: input.payload,
      status: "received",
    }),
    received_at: input.now.toISOString(),
  }
}

function resolveWebhooksModule(req: RequestWithCorrelation): WebhooksModuleLike {
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

function resolveGelatoFulfillmentModule(
  req: RequestWithCorrelation
): GelatoFulfillmentModuleLike {
  const keys = [GELATO_FULFILLMENT_MODULE, "gelato_fulfillment"]

  for (const key of keys) {
    const candidate = req.scope.resolve(key) as GelatoFulfillmentModuleLike

    if (
      candidate &&
      typeof candidate.listGelatoFulfillments === "function" &&
      typeof candidate.updateGelatoFulfillments === "function"
    ) {
      return candidate
    }
  }

  throw new GelatoWebhookError(
    "GELATO_FULFILLMENT_MODULE_UNAVAILABLE",
    "Modulo de fulfillment Gelato nao configurado."
  )
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

function buildProcessedMetadata(input: {
  record: WebhookEventLogRecord
  fulfillmentId: string
  payload: GelatoWebhookPayload
}): WebhookMetadata {
  return {
    ...(input.record.metadata ?? {}),
    fulfillment_id: input.fulfillmentId,
    gelato_order_id:
      typeof input.payload.orderId === "string" ? input.payload.orderId : null,
    order_reference_id:
      typeof input.payload.orderReferenceId === "string"
        ? input.payload.orderReferenceId
        : null,
    provider_status:
      typeof input.payload.fulfillmentStatus === "string"
        ? input.payload.fulfillmentStatus
        : null,
    status: "processed",
  }
}

function buildErroredMetadata(input: {
  record: WebhookEventLogRecord
  payload: GelatoWebhookPayload
  status: "failed" | "ignored"
}): WebhookMetadata {
  return {
    ...(input.record.metadata ?? {}),
    gelato_order_id:
      typeof input.payload.orderId === "string" ? input.payload.orderId : null,
    order_reference_id:
      typeof input.payload.orderReferenceId === "string"
        ? input.payload.orderReferenceId
        : null,
    provider_status:
      typeof input.payload.fulfillmentStatus === "string"
        ? input.payload.fulfillmentStatus
        : null,
    status: input.status,
  }
}

async function processGelatoOrderStatusUpdatedEvent(input: {
  req: RequestWithCorrelation
  payload: GelatoWebhookPayload
  record: WebhookEventLogRecord
  webhooksModule: WebhooksModuleLike
  now: Date
}): Promise<WebhookEventLogStatus> {
  const parsedPayload = parseGelatoOrderStatusUpdatedWebhookPayload(input.payload)
  const fulfillmentModule = resolveGelatoFulfillmentModule(input.req)
  const fulfillments =
    (await fulfillmentModule.listGelatoFulfillments?.({
      order_id: parsedPayload.orderReferenceId,
    })) ?? []
  const fulfillment = resolveGelatoFulfillmentForWebhook(
    fulfillments,
    parsedPayload
  )

  if (!fulfillment) {
    throw new GelatoWebhookError(
      "GELATO_FULFILLMENT_NOT_FOUND",
      "Fulfillment local nao encontrado para webhook Gelato.",
      "ignored"
    )
  }

  const updatedFulfillment = applyGelatoOrderStatusUpdatedWebhookToFulfillment({
    fulfillment,
    payload: parsedPayload,
    at: input.now,
  })

  await fulfillmentModule.updateGelatoFulfillments?.(updatedFulfillment)

  await updateWebhookRecord(input.webhooksModule, {
    id: input.record.id,
    status: "processed",
    entity_type: "fulfillment",
    entity_id: updatedFulfillment.id,
    error_code: null,
    error_message: null,
    processed_at: input.now.toISOString(),
    failed_at: null,
    ignored_at: null,
    metadata: buildProcessedMetadata({
      record: input.record,
      fulfillmentId: updatedFulfillment.id,
      payload: input.payload,
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

function verifyGelatoWebhookAuthHeader(input: {
  req: MedusaRequest
  appEnv: AppEnv
}): { ok: true } | { ok: false; statusCode: number; code: string } {
  if (!input.appEnv.GELATO_WEBHOOK_SECRET) {
    return {
      ok: false,
      statusCode: 503,
      code: "gelato_webhook_secret_not_configured",
    }
  }

  const headerName = input.appEnv.GELATO_WEBHOOK_AUTH_HEADER_NAME.toLowerCase()
  const receivedHeader = readHeader(
    input.req.headers[input.appEnv.GELATO_WEBHOOK_AUTH_HEADER_NAME] ??
      input.req.headers[headerName]
  )

  if (!receivedHeader) {
    return {
      ok: false,
      statusCode: 401,
      code: "gelato_webhook_auth_header_required",
    }
  }

  if (!secureCompare(input.appEnv.GELATO_WEBHOOK_SECRET, receivedHeader)) {
    return {
      ok: false,
      statusCode: 403,
      code: "gelato_webhook_auth_header_invalid",
    }
  }

  return { ok: true }
}

export function createGelatoWebhookPostHandler(deps: RouteDeps = {}) {
  const routeEnv = deps.appEnv ?? env
  const now = deps.now ?? (() => new Date())

  return async function POST(req: MedusaRequest, res: MedusaResponse) {
    const request = req as RequestWithCorrelation
    const authResult = verifyGelatoWebhookAuthHeader({
      req,
      appEnv: routeEnv,
    })

    if (!authResult.ok) {
      return respond(res, authResult.statusCode, {
        ok: false,
        code: authResult.code,
      })
    }

    const rawPayload = resolveRequestPayload(req)

    if (!rawPayload || typeof rawPayload !== "object") {
      return respond(res, 400, {
        ok: false,
        code: "gelato_webhook_payload_invalid",
      })
    }

    const payload = rawPayload as GelatoWebhookPayload
    const eventType = readEventType(payload)

    if (!eventType || !isGelatoWebhookSupportedEventType(eventType)) {
      return respond(res, 200, {
        ok: true,
        duplicate: false,
        status: "ignored",
        event_type: eventType,
        code: "gelato_webhook_event_unsupported",
      })
    }

    let parsedPayload: ReturnType<typeof parseGelatoOrderStatusUpdatedWebhookPayload>

    try {
      parsedPayload = parseGelatoOrderStatusUpdatedWebhookPayload(payload)
    } catch (error) {
      if (
        error instanceof GelatoWebhookError &&
        error.code === "GELATO_WEBHOOK_EVENT_UNSUPPORTED"
      ) {
        return respond(res, 200, {
          ok: true,
          duplicate: false,
          status: "ignored",
          event_type: eventType,
          code: "gelato_webhook_event_unsupported",
        })
      }

      return respond(res, 400, {
        ok: false,
        code:
          error instanceof GelatoWebhookError
            ? error.code.toLowerCase()
            : "gelato_webhook_payload_invalid",
      })
    }

    const webhookInput = buildWebhookEventInput({
      req: request,
      payload: parsedPayload,
      now: now(),
    })
    const service = resolveWebhooksModule(request)
    const { record, duplicate } = await recordWebhookEvent(service, webhookInput)

    if (duplicate && isFinalWebhookStatus(record.status)) {
      return respond(res, 200, {
        ok: true,
        duplicate: true,
        event_id: record.external_event_id ?? webhookInput.external_event_id ?? null,
        event_type: record.event_type,
        status: record.status,
      })
    }

    let finalStatus: WebhookEventLogStatus = "received"

    try {
      finalStatus = await processGelatoOrderStatusUpdatedEvent({
        req: request,
        payload: parsedPayload,
        record,
        webhooksModule: service,
        now: now(),
      })
    } catch (error) {
      const disposition =
        error instanceof GelatoWebhookError ? error.webhookDisposition : "failed"
      const sanitized = sanitizeWebhookError(error)

      await updateWebhookRecord(service, {
        id: record.id,
        status: disposition,
        entity_type: "fulfillment" satisfies WebhookEntityType,
        entity_id: null,
        processed_at: null,
        failed_at: disposition === "failed" ? now().toISOString() : null,
        ignored_at: disposition === "ignored" ? now().toISOString() : null,
        error_code: sanitized.error_code,
        error_message: sanitized.error_message,
        metadata: buildErroredMetadata({
          record,
          payload: parsedPayload,
          status: disposition,
        }),
      })

      finalStatus = disposition
    }

    return respond(res, 200, {
      ok: true,
      duplicate,
      event_id: record.external_event_id ?? webhookInput.external_event_id ?? null,
      event_type: record.event_type,
      status: finalStatus,
    })
  }
}

export const POST = createGelatoWebhookPostHandler()
