import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { env } from "../../../../config/env"
import { ADMIN_ACTION_LOG_MODULE } from "../../../../modules/admin-action-log"
import { PAYMENT_ATTEMPT_MODULE } from "../../../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../../../modules/payment-attempt/types"
import { REFUND_REQUEST_MODULE } from "../../../../modules/refund-request"
import { withOrderRefundReservationClaim } from "../../../../modules/refund-request/reservation-claim"
import {
  createAdminRefundRequest,
  sanitizeRefundRequestError,
} from "../../../../modules/refund-request/service"
import type {
  CreateRefundRequestInput,
  RefundRequestRecord,
} from "../../../../modules/refund-request/types"
import {
  auditAdminAction,
  type AdminActionLogAppendService,
  type SanitizedAuditLogger,
} from "../../_shared/audit-admin-action"
import { requireAdminActor } from "../../_shared/require-admin-actor"

type OrderModuleLike = {
  retrieveOrder?: (id: string) => Promise<{
    id: string
    metadata?: Record<string, unknown> | null
  } | null>
}

type PaymentAttemptModuleLike = {
  listPaymentAttempts?: (filters?: {
    order_id?: string
  }) => Promise<PaymentAttemptRecord[]>
}

type RefundRequestModuleLike = {
  listRefundRequests?: (filters?: {
    order_id?: string
    idempotency_key?: string
  }) => Promise<RefundRequestRecord[]>
  createRefundRequests?: (
    records: RefundRequestRecord[]
  ) => Promise<RefundRequestRecord[]>
}

type RouteDeps = {
  resolveOrderModule: (req: MedusaRequest) => OrderModuleLike | null
  resolvePaymentAttemptModule: (req: MedusaRequest) => PaymentAttemptModuleLike | null
  resolveRefundRequestModule: (req: MedusaRequest) => RefundRequestModuleLike | null
  resolveAdminActionLogModule: (
    req: MedusaRequest
  ) => AdminActionLogAppendService | null
  resolveLogger?: (req: MedusaRequest) => SanitizedAuditLogger | undefined
  generateId: () => string
  generateActionAttemptId?: () => string
  generateCorrelationId?: () => string
  withOrderRefundReservationClaim?: <T>(
    orderId: string,
    fn: () => Promise<T>
  ) => Promise<T>
}

function defaultResolveOrderModule(req: MedusaRequest): OrderModuleLike | null {
  try {
    return req.scope.resolve("order") as OrderModuleLike
  } catch {
    return null
  }
}

function defaultResolvePaymentAttemptModule(
  req: MedusaRequest
): PaymentAttemptModuleLike | null {
  try {
    return req.scope.resolve(PAYMENT_ATTEMPT_MODULE) as unknown as PaymentAttemptModuleLike
  } catch {
    return null
  }
}

function defaultResolveRefundRequestModule(
  req: MedusaRequest
): RefundRequestModuleLike | null {
  try {
    return req.scope.resolve(REFUND_REQUEST_MODULE) as unknown as RefundRequestModuleLike
  } catch {
    return null
  }
}

function defaultResolveAdminActionLogModule(
  req: MedusaRequest
): AdminActionLogAppendService | null {
  try {
    return req.scope.resolve(
      ADMIN_ACTION_LOG_MODULE
    ) as unknown as AdminActionLogAppendService
  } catch {
    return null
  }
}

function defaultResolveLogger(req: MedusaRequest): SanitizedAuditLogger | undefined {
  try {
    return req.scope.resolve("logger") as SanitizedAuditLogger
  } catch {
    return undefined
  }
}

function defaultGenerateId(): string {
  return `refreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function defaultGenerateActionAttemptId(): string {
  return `admatt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function defaultGenerateCorrelationId(): string {
  return `admcorr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function parseCreateRefundRequestBody(body: unknown): CreateRefundRequestInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "REFUND_REQUEST_BODY_INVALID"
    )
  }

  const record = body as Record<string, unknown>

  if (
    "requested_by_operator_id" in record ||
    "admin_id" in record ||
    "actor_id" in record ||
    "admin_email" in record
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "REFUND_REQUEST_BODY_INVALID"
    )
  }

  if (typeof record.order_id !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "REFUND_REQUEST_ORDER_ID_REQUIRED"
    )
  }

  if (typeof record.amount !== "number") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "REFUND_REQUEST_AMOUNT_INVALID"
    )
  }

  if (typeof record.currency_code !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "REFUND_REQUEST_CURRENCY_REQUIRED"
    )
  }

  if (typeof record.idempotency_key !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "REFUND_REQUEST_IDEMPOTENCY_KEY_REQUIRED"
    )
  }

  return {
    order_id: record.order_id,
    amount: record.amount,
    currency_code: record.currency_code,
    idempotency_key: record.idempotency_key,
    reason: typeof record.reason === "string" ? record.reason : null,
    operator_note:
      typeof record.operator_note === "string" ? record.operator_note : null,
    metadata:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? (record.metadata as CreateRefundRequestInput["metadata"])
        : null,
  }
}

function mapRefundRequestError(error: unknown): never {
  const message = error instanceof Error ? error.message : "REFUND_REQUEST_FAILED"
  const sanitized = sanitizeRefundRequestError({
    code: message,
    message,
  })

  if (
    message === "REFUND_REQUEST_ORDER_STATUS_NOT_ELIGIBLE" ||
    message === "REFUND_REQUEST_PAYMENT_STATUS_NOT_ELIGIBLE" ||
    message === "REFUND_REQUEST_PAYMENT_ATTEMPT_NOT_FOUND" ||
    message === "REFUND_REQUEST_PAYMENT_ATTEMPT_ORDER_MISMATCH"
  ) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      sanitized.error_code
    )
  }

  if (
    message === "REFUND_REQUEST_AMOUNT_INVALID" ||
    message === "REFUND_REQUEST_AMOUNT_EXCEEDS_AVAILABLE_CAPTURED" ||
    message === "REFUND_REQUEST_CURRENCY_MISMATCH" ||
    message === "REFUND_REQUEST_METADATA_FORBIDDEN" ||
    message === "REFUND_REQUEST_BODY_INVALID" ||
    message === "REFUND_REQUEST_ORDER_ID_REQUIRED" ||
    message === "REFUND_REQUEST_CURRENCY_REQUIRED" ||
    message === "REFUND_REQUEST_IDEMPOTENCY_KEY_REQUIRED"
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      sanitized.error_code
    )
  }

  if (error instanceof MedusaError) {
    throw error
  }

  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    sanitized.error_code
  )
}

function classifyRefundDomainError(error: unknown): "failed" | "blocked" {
  if (error instanceof MedusaError) {
    if (
      error.type === MedusaError.Types.INVALID_DATA ||
      error.type === MedusaError.Types.NOT_FOUND ||
      error.type === MedusaError.Types.NOT_ALLOWED
    ) {
      return "blocked"
    }
  }
  return "failed"
}

function serializeRefundRequestResponse(input: {
  refund_request: RefundRequestRecord
  reused_idempotency: boolean
  availability: {
    captured_amount: number
    confirmed_refunded_amount: number
    reserved_amount: number
    available_amount: number
    currency_code: string
  }
}) {
  return {
    refund_request: {
      id: input.refund_request.id,
      order_id: input.refund_request.order_id,
      payment_intent_id: input.refund_request.payment_intent_id,
      payment_attempt_id: input.refund_request.payment_attempt_id,
      stripe_refund_id: input.refund_request.stripe_refund_id,
      idempotency_key: input.refund_request.idempotency_key,
      amount: input.refund_request.amount,
      currency_code: input.refund_request.currency_code,
      reason: input.refund_request.reason,
      operator_note: input.refund_request.operator_note,
      status: input.refund_request.status,
      requested_by_operator_id: input.refund_request.requested_by_operator_id,
      metadata: input.refund_request.metadata,
      created_at: input.refund_request.created_at,
      updated_at: input.refund_request.updated_at,
    },
    reused_idempotency: input.reused_idempotency,
    availability: input.availability,
  }
}

export async function handleAdminCreateRefundRequest(
  req: MedusaRequest,
  res: MedusaResponse,
  deps: RouteDeps = {
    resolveOrderModule: defaultResolveOrderModule,
    resolvePaymentAttemptModule: defaultResolvePaymentAttemptModule,
    resolveRefundRequestModule: defaultResolveRefundRequestModule,
    resolveAdminActionLogModule: defaultResolveAdminActionLogModule,
    resolveLogger: defaultResolveLogger,
    generateId: defaultGenerateId,
  }
): Promise<void> {
  const logger = deps.resolveLogger?.(req) ?? defaultResolveLogger(req)
  const actor = requireAdminActor(
    req as MedusaRequest & {
      auth_context?: { actor_id?: unknown; actor_type?: unknown }
    },
    logger
  )

  if (!env.ADMIN_REFUND_REQUEST_ENABLED) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "ADMIN_REFUND_REQUEST_DISABLED"
    )
  }

  const orderModule = deps.resolveOrderModule(req)
  const paymentAttemptModule = deps.resolvePaymentAttemptModule(req)
  const refundRequestModule = deps.resolveRefundRequestModule(req)
  const audit = deps.resolveAdminActionLogModule(req)

  if (!orderModule?.retrieveOrder) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "REFUND_REQUEST_ORDER_MODULE_UNAVAILABLE"
    )
  }

  if (!paymentAttemptModule?.listPaymentAttempts) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "REFUND_REQUEST_PAYMENT_ATTEMPT_MODULE_UNAVAILABLE"
    )
  }

  if (
    !refundRequestModule?.listRefundRequests ||
    !refundRequestModule.createRefundRequests
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "REFUND_REQUEST_MODULE_UNAVAILABLE"
    )
  }

  if (!audit?.appendIntent || !audit.appendOutcome) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "ADMIN_ACTION_LOG_MODULE_UNAVAILABLE"
    )
  }

  let requestInput: CreateRefundRequestInput

  try {
    requestInput = parseCreateRefundRequestBody(req.body)
  } catch (error) {
    mapRefundRequestError(error)
  }

  const refundRequestId = deps.generateId()
  const actionAttemptId =
    deps.generateActionAttemptId?.() ?? defaultGenerateActionAttemptId()
  const correlationId =
    deps.generateCorrelationId?.() ?? defaultGenerateCorrelationId()

  // Pre-resolve replay so intent/outcome never index a generated unused id.
  // Authoritative lookup still runs again inside the reservation claim.
  const preResolvedByIdempotency = await refundRequestModule.listRefundRequests({
    idempotency_key: requestInput.idempotency_key,
  })
  const preResolvedRecord = preResolvedByIdempotency[0] ?? null
  const auditEntityId = preResolvedRecord?.id ?? refundRequestId

  const claim =
    deps.withOrderRefundReservationClaim ?? withOrderRefundReservationClaim

  const domainResult = await auditAdminAction({
    audit,
    logger,
    descriptor: {
      action_attempt_id: actionAttemptId,
      correlation_id: correlationId,
      idempotency_key: requestInput.idempotency_key,
      actor,
      action: "refund_order",
      entity_type: "refund_request",
      entity_id: auditEntityId,
      intent_previous_state: {},
      classifySuccess: (result) => ({
        result: "requested",
        previous_state: {},
        new_state: {
          status: result.refund_request.status,
          amount: result.refund_request.amount,
          currency_code: result.refund_request.currency_code,
        },
        metadata: {
          order_id: result.refund_request.order_id,
          request_id: result.refund_request.id,
          idempotency_key: result.refund_request.idempotency_key,
          reused_idempotency: result.reused_idempotency,
          actor_type: actor.actor_type,
        },
      }),
      classifyDomainError: classifyRefundDomainError,
      resolveOutcomeEntityId: (result) => result.refund_request.id,
    },
    executeDomain: async () => {
      try {
        return await claim(requestInput.order_id, async () => {
          const order = await orderModule.retrieveOrder!(requestInput.order_id)

          if (!order) {
            throw new MedusaError(
              MedusaError.Types.NOT_FOUND,
              "REFUND_REQUEST_ORDER_NOT_FOUND"
            )
          }

          const paymentAttempts = await paymentAttemptModule.listPaymentAttempts!({
            order_id: order.id,
          })

          const paymentAttempt =
            paymentAttempts.find(
              (attempt) => attempt.status === "payment_confirmed_by_webhook"
            ) ?? null

          const [existingByIdempotency, existingForOrder] = await Promise.all([
            refundRequestModule.listRefundRequests!({
              idempotency_key: requestInput.idempotency_key,
            }),
            refundRequestModule.listRefundRequests!({
              order_id: order.id,
            }),
          ])

          const existingRecord = existingByIdempotency[0] ?? null

          const result = createAdminRefundRequest({
            request: requestInput,
            order_metadata: order.metadata,
            payment_attempt: paymentAttempt,
            existing_refund_requests: existingForOrder,
            existing_by_idempotency_key: existingRecord,
            id: refundRequestId,
            requested_by_operator_id: actor.actor_id,
          })

          let persisted = result.refund_request

          if (!result.reused_idempotency) {
            const created = await refundRequestModule.createRefundRequests!([
              result.refund_request,
            ])
            persisted = created[0] ?? result.refund_request
          }

          return {
            refund_request: persisted,
            reused_idempotency: result.reused_idempotency,
            availability: result.availability,
          }
        })
      } catch (error) {
        mapRefundRequestError(error)
      }
    },
  })

  res.status(domainResult.reused_idempotency ? 200 : 201).json(
    serializeRefundRequestResponse(domainResult)
  )
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await handleAdminCreateRefundRequest(req, res)
}
