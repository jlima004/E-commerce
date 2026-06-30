import Stripe from "stripe"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { env, type AppEnv } from "../../../config/env"
import { WEBHOOKS_MODULE } from "../../../modules/webhooks"
import {
  buildStripeDeduplicationKey,
  buildWebhookPayloadHash,
} from "../../../modules/webhooks/service"
import type {
  CreateWebhookEventLogInput,
  WebhookEntityType,
  WebhookEventLogStatus,
  WebhookMetadata,
} from "../../../modules/webhooks/types"

const STRIPE_PROVIDER = "stripe"
const STRIPE_SIGNATURE_HEADER = "stripe-signature"
const SUPPORTED_EVENT_TYPES = new Set([
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
])

type RequestWithRawBody = MedusaRequest & {
  rawBody?: Buffer | string
  correlationId?: string
}

type StripeWebhookEvent = Pick<Stripe.Event, "id" | "type" | "account" | "livemode"> & {
  data?: {
    object?: {
      id?: string
      object?: string
    }
  }
}

type StripeLike = {
  webhooks: {
    constructEvent: (
      payload: Buffer | string,
      header: string,
      secret: string
    ) => StripeWebhookEvent
  }
}

type WebhookEventLogRecord = {
  id?: string
  provider: string
  deduplication_key: string
  status: string
  event_type: string
  external_event_id?: string | null
}

type WebhooksModuleLike = {
  listWebhookEventLogs?: (
    filters?: Record<string, unknown>
  ) => Promise<WebhookEventLogRecord[]>
  createWebhookEventLogs?: (
    data: CreateWebhookEventLogInput | CreateWebhookEventLogInput[]
  ) => Promise<WebhookEventLogRecord[] | WebhookEventLogRecord>
}

type RouteDeps = {
  appEnv?: AppEnv
  now?: () => Date
  stripe?: StripeLike
}

const stripeClient = new Stripe("webhook_verifier_placeholder", {
  apiVersion: "2025-05-28.basil",
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

function isPaymentIntentObject(
  value: StripeWebhookEvent["data"] extends { object?: infer T } ? T : never
): value is { id: string; object: "payment_intent" } {
  return Boolean(value) && value?.object === "payment_intent" && typeof value.id === "string"
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

  return {
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
      )
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

    return respond(res, 200, {
      ok: true,
      duplicate,
      event_id: record.external_event_id ?? input.external_event_id ?? null,
      event_type: record.event_type,
      status: record.status,
    })
  }
}

export const POST = createStripeWebhookPostHandler()
