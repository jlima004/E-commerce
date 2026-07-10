import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { env } from "../../../../config/env"
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
  generateId: () => string
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

function defaultGenerateId(): string {
  return `refreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function parseCreateRefundRequestBody(body: unknown): CreateRefundRequestInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "REFUND_REQUEST_BODY_INVALID"
    )
  }

  const record = body as Record<string, unknown>

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
    requested_by_operator_id:
      typeof record.requested_by_operator_id === "string"
        ? record.requested_by_operator_id
        : null,
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

  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    sanitized.error_code
  )
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
    generateId: defaultGenerateId,
  }
): Promise<void> {
  if (!env.ADMIN_REFUND_REQUEST_ENABLED) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "ADMIN_REFUND_REQUEST_DISABLED"
    )
  }

  const orderModule = deps.resolveOrderModule(req)
  const paymentAttemptModule = deps.resolvePaymentAttemptModule(req)
  const refundRequestModule = deps.resolveRefundRequestModule(req)

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

  let requestInput: CreateRefundRequestInput

  try {
    requestInput = parseCreateRefundRequestBody(req.body)
  } catch (error) {
    mapRefundRequestError(error)
  }

  const order = await orderModule.retrieveOrder(requestInput.order_id)

  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "REFUND_REQUEST_ORDER_NOT_FOUND"
    )
  }

  const paymentAttempts = await paymentAttemptModule.listPaymentAttempts({
    order_id: order.id,
  })

  const paymentAttempt =
    paymentAttempts.find(
      (attempt) => attempt.status === "payment_confirmed_by_webhook"
    ) ?? null

  const claim =
    deps.withOrderRefundReservationClaim ?? withOrderRefundReservationClaim

  try {
    await claim(order.id, async () => {
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
        id: deps.generateId(),
      })

      let persisted = result.refund_request

      if (!result.reused_idempotency) {
        const created = await refundRequestModule.createRefundRequests!([
          result.refund_request,
        ])
        persisted = created[0] ?? result.refund_request
      }

      res.status(result.reused_idempotency ? 200 : 201).json(
        serializeRefundRequestResponse({
          refund_request: persisted,
          reused_idempotency: result.reused_idempotency,
          availability: result.availability,
        })
      )
    })
  } catch (error) {
    mapRefundRequestError(error)
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await handleAdminCreateRefundRequest(req, res)
}
