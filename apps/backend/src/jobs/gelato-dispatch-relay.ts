import { createHash } from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import { Modules } from "@medusajs/framework/utils"
import { ANALYTICS_EVENT_LOG_MODULE } from "../modules/analytics-event-log"
import type { AnalyticsEventLogRecord } from "../modules/analytics-event-log/types"
import { EMAIL_DELIVERY_LOG_MODULE } from "../modules/email-delivery-log"
import type { EmailDeliveryLogRecord } from "../modules/email-delivery-log/types"
import { GELATO_FULFILLMENT_MODULE } from "../modules/gelato-fulfillment"
import {
  buildCreateGelatoFulfillmentData,
  buildGelatoDispatchClaimUpdate,
  buildGelatoDispatchFailureUpdate,
  buildGelatoDispatchIdempotencyKey,
  buildGelatoDispatchPayload,
  buildGelatoDispatchRequestHash,
  buildGelatoDispatchSuccessUpdate,
  buildGelatoDispatchingUpdate,
  buildGelatoFulfillmentRequestSummary,
  buildGelatoStaleOperatorAttentionUpdate,
  evaluateAutomaticGelatoFulfillmentEligibility,
  isGelatoDispatchDue,
  resolveGelatoDispatchCandidateDecision,
  GELATO_DISPATCH_MAX_ATTEMPTS,
} from "../modules/gelato-fulfillment/service"
import type {
  GelatoDispatchClient,
  GelatoDispatchConfig,
  GelatoDispatchResult,
  GelatoFulfillmentRecord,
} from "../modules/gelato-fulfillment/types"

type AnalyticsEventLogModule = {
  listAnalyticsEventLogs: (
    filters?: Record<string, unknown>
  ) => Promise<AnalyticsEventLogRecord[]>
}

type EmailDeliveryLogModule = {
  listEmailDeliveryLogs: (
    filters?: Record<string, unknown>
  ) => Promise<EmailDeliveryLogRecord[]>
}

type GelatoFulfillmentModule = {
  listGelatoFulfillments: (
    filters?: Record<string, unknown>
  ) => Promise<GelatoFulfillmentRecord[]>
  createGelatoFulfillments: (
    input: Record<string, unknown> | Array<Record<string, unknown>>
  ) => Promise<GelatoFulfillmentRecord[] | GelatoFulfillmentRecord>
  updateGelatoFulfillments: (
    input: Record<string, unknown> | Array<Record<string, unknown>>
  ) => Promise<GelatoFulfillmentRecord[] | GelatoFulfillmentRecord>
}

type OrderRecord = {
  id: string
  display_id?: string | number | null
  cart_id?: string | null
  email?: string | null
  currency_code?: string | null
  metadata?: Record<string, unknown> | null
  shipping_address?: Record<string, unknown> | null
  items?: Array<{
    id?: string | null
    quantity?: number | null
    metadata?: Record<string, unknown> | null
  }> | null
}

type OrderModule = {
  listOrders: (
    selector?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<OrderRecord[]>
}

export type GelatoDispatchRelayResult = {
  processed: number
  submitted: number
  accepted: number
  failed: number
  dead_lettered: number
  skipped_missing_config: boolean
  skipped_disabled: boolean
  created_local_fulfillments: number
  reused_local_fulfillments: number
}

const DEFAULT_BATCH_SIZE = 25
const GELATO_ENDPOINT = "https://order.gelatoapis.com/v4/orders"

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("unique constraint")
  )
}

function isOrderConfirmed(order: OrderRecord): boolean {
  const metadata = order.metadata

  return (
    metadata?.order_status === "confirmed" && metadata?.payment_status === "captured"
  )
}

function buildLocalRequestHash(input: {
  orderId: string
  paymentAttemptId: string
  checkoutCompletionLogId: string
  analyticsEventLogId: string
  emailDeliveryLogId: string
  status: string
}): string {
  return `sha256:${createHash("sha256")
    .update(
      [
        input.orderId,
        input.paymentAttemptId,
        input.checkoutCompletionLogId,
        input.analyticsEventLogId,
        input.emailDeliveryLogId,
        input.status,
      ].join(":")
    )
    .digest("hex")}`
}

function resolveAnalyticsEventLogModule(
  container: MedusaContainer
): AnalyticsEventLogModule {
  const keys = [ANALYTICS_EVENT_LOG_MODULE, "analytics_event_log"]

  for (const key of keys) {
    const candidate = container.resolve(key) as AnalyticsEventLogModule | undefined

    if (candidate && typeof candidate.listAnalyticsEventLogs === "function") {
      return candidate
    }
  }

  throw new Error("GELATO_DISPATCH_ANALYTICS_EVENT_LOG_MODULE_UNAVAILABLE")
}

function resolveEmailDeliveryLogModule(
  container: MedusaContainer
): EmailDeliveryLogModule {
  const keys = [EMAIL_DELIVERY_LOG_MODULE, "email_delivery_log"]

  for (const key of keys) {
    const candidate = container.resolve(key) as EmailDeliveryLogModule | undefined

    if (candidate && typeof candidate.listEmailDeliveryLogs === "function") {
      return candidate
    }
  }

  throw new Error("GELATO_DISPATCH_EMAIL_DELIVERY_LOG_MODULE_UNAVAILABLE")
}

function resolveGelatoFulfillmentModule(
  container: MedusaContainer
): GelatoFulfillmentModule {
  const keys = [GELATO_FULFILLMENT_MODULE, "gelato_fulfillment"]

  for (const key of keys) {
    const candidate = container.resolve(key) as GelatoFulfillmentModule | undefined

    if (
      candidate &&
      typeof candidate.listGelatoFulfillments === "function" &&
      typeof candidate.createGelatoFulfillments === "function" &&
      typeof candidate.updateGelatoFulfillments === "function"
    ) {
      return candidate
    }
  }

  throw new Error("GELATO_DISPATCH_FULFILLMENT_MODULE_UNAVAILABLE")
}

function resolveOrderModule(container: MedusaContainer): OrderModule {
  const candidate = container.resolve(Modules.ORDER) as OrderModule | undefined

  if (candidate && typeof candidate.listOrders === "function") {
    return candidate
  }

  throw new Error("GELATO_DISPATCH_ORDER_MODULE_UNAVAILABLE")
}

export function isGelatoDispatchDisabled(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): boolean {
  return env.GELATO_DISPATCH_ENABLED?.trim() !== "true"
}

export function resolveGelatoDispatchRelayConfig(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): GelatoDispatchConfig | null {
  if (isGelatoDispatchDisabled(env)) {
    return null
  }

  const apiKey = env.GELATO_API_KEY?.trim()

  if (!apiKey) {
    return null
  }

  return {
    enabled: true,
    apiKey,
    shipmentMethodUid: env.GELATO_SHIPMENT_METHOD_UID?.trim() || undefined,
  }
}

function normalizeStatus(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().toLowerCase()
    : null
}

function mapProviderStatusToLocalStatus(providerStatus: string | null): "submitted" | "accepted" {
  return providerStatus === "accepted" ? "accepted" : "submitted"
}

function extractDispatchResult(payload: unknown): GelatoDispatchResult {
  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error("GELATO_DISPATCH_RESPONSE_INVALID"), {
      statusCode: 502,
    })
  }

  const record = payload as Record<string, unknown>
  const primaryOrderId =
    typeof record.orderId === "string"
      ? record.orderId
      : typeof record.id === "string"
        ? record.id
        : null

  if (!primaryOrderId) {
    throw Object.assign(new Error("GELATO_DISPATCH_ORDER_ID_MISSING"), {
      statusCode: 502,
    })
  }

  const providerStatus = normalizeStatus(
    record.fulfillmentStatus ?? record.status ?? null
  )
  const connectedOrderIds = Array.isArray(record.connectedOrderIds)
    ? record.connectedOrderIds.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0
      )
    : []

  return {
    status: mapProviderStatusToLocalStatus(providerStatus),
    gelato_primary_order_id: primaryOrderId,
    connected_order_ids: connectedOrderIds,
    provider_status: providerStatus,
    provider_reference_id:
      typeof record.orderReferenceId === "string" ? record.orderReferenceId : null,
  }
}

export function createGelatoDispatchClient(): GelatoDispatchClient {
  return {
    async createOrder({ payload, apiKey }) {
      if (typeof fetch !== "function") {
        throw new Error("GELATO_DISPATCH_FETCH_UNAVAILABLE")
      }

      const response = await fetch(GELATO_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify(payload),
      })

      const bodyText = await response.text()
      let parsed: unknown = null

      if (bodyText.trim()) {
        try {
          parsed = JSON.parse(bodyText)
        } catch {
          parsed = null
        }
      }

      if (!response.ok) {
        const error = Object.assign(
          new Error(`GELATO_DISPATCH_HTTP_${response.status}`),
          {
            statusCode: response.status,
            responseBody: bodyText || null,
          }
        )

        throw error
      }

      return extractDispatchResult(parsed)
    },
  }
}

function readLatestPurchaseCompleted(
  events: AnalyticsEventLogRecord[],
  orderId: string
): AnalyticsEventLogRecord | null {
  const matches = events
    .filter((event) => event.order_id === orderId)
    .filter((event) => event.event_name === "purchase_completed")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))

  return matches[0] ?? null
}

function readLatestOrderConfirmationEmail(
  logs: EmailDeliveryLogRecord[],
  orderId: string
): EmailDeliveryLogRecord | null {
  const matches = logs
    .filter((log) => log.order_id === orderId)
    .filter((log) => log.email_type === "order_confirmation")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))

  return matches[0] ?? null
}

async function readReusableGelatoFulfillment(
  module: GelatoFulfillmentModule,
  orderId: string
): Promise<GelatoFulfillmentRecord | null> {
  const idempotencyKey = buildGelatoDispatchIdempotencyKey({ order_id: orderId })
  const byIdempotency = await module.listGelatoFulfillments({
    idempotency_key: idempotencyKey,
  })
  const direct = byIdempotency.find((record) => record.order_id === orderId)

  if (direct) {
    return direct
  }

  const byOrder = await module.listGelatoFulfillments({
    order_id: orderId,
  })

  return byOrder.find((record) => record.order_id === orderId) ?? null
}

async function createOrReuseLocalFulfillment(input: {
  module: GelatoFulfillmentModule
  order: OrderRecord
  purchaseCompleted: AnalyticsEventLogRecord
  emailDeliveryLog: EmailDeliveryLogRecord
  now: Date
}): Promise<{ fulfillment: GelatoFulfillmentRecord; created: boolean }> {
  const existing = await readReusableGelatoFulfillment(input.module, input.order.id)

  if (existing) {
    return { fulfillment: existing, created: false }
  }

  const requestHash = buildLocalRequestHash({
    orderId: input.order.id,
    paymentAttemptId: input.emailDeliveryLog.payment_attempt_id,
    checkoutCompletionLogId: input.emailDeliveryLog.checkout_completion_log_id,
    analyticsEventLogId: input.purchaseCompleted.id,
    emailDeliveryLogId: input.emailDeliveryLog.id,
    status: "recorded",
  })
  const createData = buildCreateGelatoFulfillmentData(
    {
      order_id: input.order.id,
      cart_id:
        input.emailDeliveryLog.cart_id ||
        input.purchaseCompleted.cart_id ||
        input.order.cart_id ||
        "",
      payment_attempt_id: input.emailDeliveryLog.payment_attempt_id,
      checkout_completion_log_id: input.emailDeliveryLog.checkout_completion_log_id,
      analytics_event_log_id: input.purchaseCompleted.id,
      email_delivery_log_id: input.emailDeliveryLog.id,
      customer_reference_id: `order:${String(input.order.display_id ?? input.order.id)}`,
      status: "recorded",
      request_hash: requestHash,
      request_summary: buildGelatoFulfillmentRequestSummary({
        order_id: input.order.id,
        cart_id:
          input.emailDeliveryLog.cart_id ||
          input.purchaseCompleted.cart_id ||
          input.order.cart_id ||
          "",
        payment_attempt_id: input.emailDeliveryLog.payment_attempt_id,
        checkout_completion_log_id: input.emailDeliveryLog.checkout_completion_log_id,
        analytics_event_log_id: input.purchaseCompleted.id,
        email_delivery_log_id: input.emailDeliveryLog.id,
        idempotency_key: buildGelatoDispatchIdempotencyKey({
          order_id: input.order.id,
        }),
        request_hash: requestHash,
        item_count: input.order.items?.length ?? 0,
        currency_code: input.order.currency_code ?? "brl",
        status: "recorded",
      }),
      metadata: {
        source: "gelato_dispatch_relay",
      },
      recorded_at: input.now,
    },
    input.now
  )

  try {
    const created = asArray(await input.module.createGelatoFulfillments(createData))[0]

    if (!created) {
      throw new Error("GELATO_DISPATCH_LOCAL_CREATE_EMPTY")
    }

    return { fulfillment: created, created: true }
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    const reusable = await readReusableGelatoFulfillment(input.module, input.order.id)

    if (!reusable) {
      throw error
    }

    return { fulfillment: reusable, created: false }
  }
}

async function updateFulfillment(
  module: GelatoFulfillmentModule,
  id: string,
  update: Record<string, unknown>
): Promise<GelatoFulfillmentRecord> {
  const row = asArray(await module.updateGelatoFulfillments({ id, ...update }))[0]

  if (!row) {
    throw new Error("GELATO_DISPATCH_UPDATE_EMPTY")
  }

  return row
}

function rebuildRequestSummary(
  fulfillment: GelatoFulfillmentRecord,
  requestHash: string,
  status: string,
  connectedOrderIds?: string[]
) {
  return buildGelatoFulfillmentRequestSummary({
    ...fulfillment.request_summary,
    request_hash: requestHash,
    status,
    connected_order_ids: connectedOrderIds ?? fulfillment.connected_order_ids,
  })
}

async function dispatchSingleFulfillment(input: {
  module: GelatoFulfillmentModule
  order: OrderRecord
  fulfillment: GelatoFulfillmentRecord
  client: GelatoDispatchClient
  config: GelatoDispatchConfig
  now: Date
  maxAttempts: number
}): Promise<"submitted" | "accepted" | "failed" | "dead_lettered"> {
  const payload = buildGelatoDispatchPayload({
    order: input.order,
    fulfillment: input.fulfillment,
    shipment_method_uid: input.config.shipmentMethodUid ?? null,
  })
  const requestHash = buildGelatoDispatchRequestHash(payload)

  await updateFulfillment(input.module, input.fulfillment.id, {
    ...buildGelatoDispatchClaimUpdate(input.now),
    request_hash: requestHash,
    request_summary: rebuildRequestSummary(input.fulfillment, requestHash, "queued"),
  })
  await updateFulfillment(input.module, input.fulfillment.id, {
    ...buildGelatoDispatchingUpdate(input.now),
    request_hash: requestHash,
    request_summary: rebuildRequestSummary(
      input.fulfillment,
      requestHash,
      "dispatching"
    ),
  })

  try {
    const result = await input.client.createOrder({
      payload,
      apiKey: input.config.apiKey ?? "",
    })
    const successUpdate = buildGelatoDispatchSuccessUpdate(result, input.now)

    await updateFulfillment(input.module, input.fulfillment.id, {
      ...successUpdate,
      request_hash: requestHash,
      request_summary: rebuildRequestSummary(
        input.fulfillment,
        requestHash,
        successUpdate.status,
        result.connected_order_ids
      ),
    })

    return successUpdate.status === "accepted" ? "accepted" : "submitted"
  } catch (error) {
    const failureUpdate = buildGelatoDispatchFailureUpdate(
      error,
      input.fulfillment.attempt_count,
      {
        maxAttempts: input.maxAttempts,
        at: input.now,
      }
    )

    await updateFulfillment(input.module, input.fulfillment.id, {
      ...failureUpdate,
      request_hash: requestHash,
      request_summary: rebuildRequestSummary(
        input.fulfillment,
        requestHash,
        failureUpdate.status
      ),
    })

    return failureUpdate.status === "dead_letter" ? "dead_lettered" : "failed"
  }
}

async function listEligibleOrders(
  container: MedusaContainer
): Promise<OrderRecord[]> {
  const orderModule = resolveOrderModule(container)
  const orders = await orderModule.listOrders()

  return orders.filter((order) => Boolean(order.id)).filter(isOrderConfirmed)
}

export async function runGelatoDispatchRelay(
  container: MedusaContainer,
  deps: {
    now?: () => Date
    env?: Record<string, string | undefined>
    config?: GelatoDispatchConfig | null
    createClient?: (config: GelatoDispatchConfig) => GelatoDispatchClient
    maxAttempts?: number
    batchSize?: number
  } = {}
): Promise<GelatoDispatchRelayResult> {
  const now = deps.now?.() ?? new Date()
  const env = deps.env ?? (process.env as Record<string, string | undefined>)

  if (deps.config === undefined && isGelatoDispatchDisabled(env)) {
    return {
      processed: 0,
      submitted: 0,
      accepted: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: false,
      skipped_disabled: true,
      created_local_fulfillments: 0,
      reused_local_fulfillments: 0,
    }
  }

  const config =
    deps.config === undefined ? resolveGelatoDispatchRelayConfig(env) : deps.config

  if (!config?.enabled || !config.apiKey) {
    return {
      processed: 0,
      submitted: 0,
      accepted: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: true,
      skipped_disabled: false,
      created_local_fulfillments: 0,
      reused_local_fulfillments: 0,
    }
  }

  const analyticsModule = resolveAnalyticsEventLogModule(container)
  const emailModule = resolveEmailDeliveryLogModule(container)
  const fulfillmentModule = resolveGelatoFulfillmentModule(container)
  const orders = await listEligibleOrders(container)
  const [analyticsEvents, emailLogs] = await Promise.all([
    analyticsModule.listAnalyticsEventLogs(),
    emailModule.listEmailDeliveryLogs(),
  ])
  const createClient = deps.createClient ?? createGelatoDispatchClient
  const client = createClient(config)
  const maxAttempts = deps.maxAttempts ?? GELATO_DISPATCH_MAX_ATTEMPTS
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE

  let createdLocalFulfillments = 0
  let reusedLocalFulfillments = 0
  const candidates: Array<{ order: OrderRecord; fulfillment: GelatoFulfillmentRecord }> = []

  for (const order of orders) {
    const purchaseCompleted = readLatestPurchaseCompleted(analyticsEvents, order.id)
    const emailDeliveryLog = readLatestOrderConfirmationEmail(emailLogs, order.id)
    const existingFulfillment = await readReusableGelatoFulfillment(
      fulfillmentModule,
      order.id
    )
    const decision = evaluateAutomaticGelatoFulfillmentEligibility({
      order: {
        id: order.id,
        order_status: String(order.metadata?.order_status ?? ""),
        payment_status: String(order.metadata?.payment_status ?? ""),
      },
      has_local_purchase_completed: Boolean(purchaseCompleted),
      email_delivery_status: emailDeliveryLog?.status ?? null,
      existing_fulfillment: existingFulfillment,
    })

    if (!purchaseCompleted || !emailDeliveryLog) {
      continue
    }

    if (existingFulfillment) {
      reusedLocalFulfillments += 1
      candidates.push({
        order,
        fulfillment: existingFulfillment,
      })
      continue
    }

    if (!decision.eligible) {
      continue
    }

    const local = await createOrReuseLocalFulfillment({
      module: fulfillmentModule,
      order,
      purchaseCompleted,
      emailDeliveryLog,
      now,
    })

    if (local.created) {
      createdLocalFulfillments += 1
    } else {
      reusedLocalFulfillments += 1
    }

    candidates.push({
      order,
      fulfillment: local.fulfillment,
    })
  }

  const dueCandidates = candidates
    .filter(({ fulfillment }) => {
      return (
        fulfillment.status !== "failed" ||
        isGelatoDispatchDue(fulfillment.next_retry_at, now)
      )
    })
    .slice(0, batchSize)

  let submitted = 0
  let accepted = 0
  let failed = 0
  let deadLettered = 0

  for (const candidate of dueCandidates) {
    const latest =
      (await readReusableGelatoFulfillment(fulfillmentModule, candidate.order.id)) ??
      candidate.fulfillment
    const decision = resolveGelatoDispatchCandidateDecision(latest, now)

    if (decision.action === "skip") {
      continue
    }

    if (decision.action === "operator_attention") {
      await updateFulfillment(
        fulfillmentModule,
        latest.id,
        buildGelatoStaleOperatorAttentionUpdate(now)
      )
      deadLettered += 1
      continue
    }

    const outcome = await dispatchSingleFulfillment({
      module: fulfillmentModule,
      order: candidate.order,
      fulfillment: latest,
      client,
      config,
      now,
      maxAttempts,
    })

    if (outcome === "accepted") {
      accepted += 1
    } else if (outcome === "submitted") {
      submitted += 1
    } else if (outcome === "dead_lettered") {
      deadLettered += 1
    } else {
      failed += 1
    }
  }

  return {
    processed: dueCandidates.length,
    submitted,
    accepted,
    failed,
    dead_lettered: deadLettered,
    skipped_missing_config: false,
    skipped_disabled: false,
    created_local_fulfillments: createdLocalFulfillments,
    reused_local_fulfillments: reusedLocalFulfillments,
  }
}

export default async function gelatoDispatchRelayJob(container: MedusaContainer) {
  if (isReleaseMigrationMode()) {
    return
  }

  await runGelatoDispatchRelay(container)
}

export const config = {
  name: "gelato-dispatch-relay",
  schedule: "* * * * *",
}
