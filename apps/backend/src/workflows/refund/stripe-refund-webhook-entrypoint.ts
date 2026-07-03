import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { PAYMENT_ATTEMPT_MODULE } from "../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../modules/payment-attempt/types"
import { resolveOrderCapturedAmountForFinancialRecomputation } from "../../modules/refund-request/captured-truth"
import { recomputeOrderFinancialState } from "../../modules/refund-request/financial-recomputation"
import { withOrderRefundReservationClaim } from "../../modules/refund-request/reservation-claim"
import { REFUND_REQUEST_MODULE } from "../../modules/refund-request"
import {
  applyNonFinalizingRefundWebhookLink,
  applyTerminalRefundWebhookToRefundRequest,
  extractStripePaymentIntentId,
  findRefundRequestForStripeRefund,
  isChargeRefundedWebhookEventType,
  isNonFinalizingRefundWebhook,
  isRefundWebhookEventType,
  isStripeRefundObject,
  RefundWebhookError,
  type StripeChargeRefundedWebhookObject,
  type StripeRefundWebhookObject,
} from "../../modules/refund-request/stripe-refund-webhook"
import type { RefundRequestRecord } from "../../modules/refund-request/types"

type RefundRequestModuleLike = {
  listRefundRequests?: (
    filters?: Record<string, unknown>
  ) => Promise<RefundRequestRecord[]>
  updateRefundRequests?: (
    data: RefundRequestRecord | RefundRequestRecord[]
  ) => Promise<RefundRequestRecord[]>
}

type PaymentAttemptModuleLike = {
  listPaymentAttempts?: (
    filters?: Record<string, unknown>
  ) => Promise<PaymentAttemptRecord[]>
}

type OrderModuleLike = {
  listOrders?: (filters?: Record<string, unknown>) => Promise<
    Array<{
      id: string
      metadata?: Record<string, unknown> | null
    }>
  >
  updateOrders?: (
    selector: Record<string, unknown>,
    update: Record<string, unknown>
  ) => Promise<unknown>
}

export type ProcessStripeRefundWebhookInput = {
  event_type: string
  refund?: StripeRefundWebhookObject | null
  charge?: StripeChargeRefundedWebhookObject | null
  stripe_event_id?: string | null
  correlation_id?: string | null
}

export type ProcessStripeRefundWebhookResult = {
  status:
    | "non_finalizing"
    | "confirmed"
    | "failed"
    | "canceled"
    | "informational"
    | "noop"
  refund_request_id: string | null
  order_id: string | null
  confirmed_refunded_amount: number | null
  payment_status: string | null
  order_status: string | null
}

export type ProcessStripeRefundWebhookOverrides = {
  now?: () => Date
  resolveRefundRequestModule?: (
    container: MedusaContainer
  ) => RefundRequestModuleLike
  resolvePaymentAttemptModule?: (
    container: MedusaContainer
  ) => PaymentAttemptModuleLike
  resolveOrderModule?: (container: MedusaContainer) => OrderModuleLike
  withOrderClaim?: typeof withOrderRefundReservationClaim
}

function resolveRefundRequestModule(
  container: MedusaContainer
): RefundRequestModuleLike {
  const module = container.resolve(
    REFUND_REQUEST_MODULE
  ) as unknown as RefundRequestModuleLike

  if (
    !module ||
    typeof module.listRefundRequests !== "function" ||
    typeof module.updateRefundRequests !== "function"
  ) {
    throw new RefundWebhookError(
      "REFUND_REQUEST_MODULE_UNAVAILABLE",
      "Modulo RefundRequest nao configurado."
    )
  }

  return module
}

function resolvePaymentAttemptModule(
  container: MedusaContainer
): PaymentAttemptModuleLike {
  const module = container.resolve(
    PAYMENT_ATTEMPT_MODULE
  ) as PaymentAttemptModuleLike

  if (!module || typeof module.listPaymentAttempts !== "function") {
    throw new RefundWebhookError(
      "PAYMENT_ATTEMPT_MODULE_UNAVAILABLE",
      "Modulo PaymentAttempt nao configurado."
    )
  }

  return module
}

function resolveOrderModule(container: MedusaContainer): OrderModuleLike {
  const module = container.resolve(Modules.ORDER) as OrderModuleLike

  if (
    !module ||
    typeof module.listOrders !== "function" ||
    typeof module.updateOrders !== "function"
  ) {
    throw new RefundWebhookError(
      "ORDER_MODULE_UNAVAILABLE",
      "Modulo Order nao configurado."
    )
  }

  return module
}

async function loadRefundRequestsForCorrelation(input: {
  module: RefundRequestModuleLike
  stripe_refund_id: string
  payment_intent_id: string
}): Promise<RefundRequestRecord[]> {
  const byStripeRefundId =
    (await input.module.listRefundRequests?.({
      stripe_refund_id: input.stripe_refund_id,
    })) ?? []
  const byPaymentIntent =
    (await input.module.listRefundRequests?.({
      payment_intent_id: input.payment_intent_id,
    })) ?? []

  const merged = new Map<string, RefundRequestRecord>()

  for (const request of [...byStripeRefundId, ...byPaymentIntent]) {
    merged.set(request.id, request)
  }

  return [...merged.values()]
}

async function persistRefundFinancialRecomputation(input: {
  orderModule: OrderModuleLike
  refundRequestModule: RefundRequestModuleLike
  paymentAttemptModule: PaymentAttemptModuleLike
  orderId: string
  updatedRefundRequest: RefundRequestRecord
  at: Date
}): Promise<{
  confirmed_refunded_amount: number
  payment_status: string
  order_status: string | null
}> {
  await input.refundRequestModule.updateRefundRequests?.(
    input.updatedRefundRequest
  )

  const order =
    (await input.orderModule.listOrders?.({ id: input.orderId }))?.[0] ?? null

  if (!order) {
    throw new RefundWebhookError(
      "REFUND_WEBHOOK_ORDER_NOT_FOUND",
      "Order nao encontrada para recomputacao financeira."
    )
  }

  const paymentAttempt =
    (
      await input.paymentAttemptModule.listPaymentAttempts?.({
        order_id: input.orderId,
      })
    )?.[0] ?? null

  const captured = resolveOrderCapturedAmountForFinancialRecomputation({
    order_id: input.orderId,
    order_metadata: order.metadata,
    payment_attempt: paymentAttempt,
  })

  const refundRequests =
    (await input.refundRequestModule.listRefundRequests?.({
      order_id: input.orderId,
    })) ?? []

  const financialState = recomputeOrderFinancialState({
    captured,
    refund_requests: refundRequests,
    current_metadata: order.metadata,
  })

  await input.orderModule.updateOrders?.(
    { id: input.orderId },
    {
      metadata: financialState.metadata,
    }
  )

  return {
    confirmed_refunded_amount: financialState.confirmed_refunded_amount,
    payment_status: financialState.payment_status,
    order_status: financialState.order_status,
  }
}

async function processRefundObjectWebhook(input: {
  container: MedusaContainer
  event_type: string
  refund: StripeRefundWebhookObject
  at: Date
  overrides: ProcessStripeRefundWebhookOverrides
}): Promise<ProcessStripeRefundWebhookResult> {
  const paymentIntentId = extractStripePaymentIntentId(input.refund.payment_intent)

  if (!paymentIntentId) {
    throw new RefundWebhookError(
      "REFUND_WEBHOOK_PAYMENT_INTENT_REQUIRED",
      "Refund sem payment_intent valido."
    )
  }

  const refundRequestModule =
    input.overrides.resolveRefundRequestModule?.(input.container) ??
    resolveRefundRequestModule(input.container)
  const paymentAttemptModule =
    input.overrides.resolvePaymentAttemptModule?.(input.container) ??
    resolvePaymentAttemptModule(input.container)
  const orderModule =
    input.overrides.resolveOrderModule?.(input.container) ??
    resolveOrderModule(input.container)
  const withOrderClaim =
    input.overrides.withOrderClaim ?? withOrderRefundReservationClaim

  const refundRequests = await loadRefundRequestsForCorrelation({
    module: refundRequestModule,
    stripe_refund_id: input.refund.id,
    payment_intent_id: paymentIntentId,
  })
  const refundRequest = findRefundRequestForStripeRefund({
    refund_requests: refundRequests,
    stripe_refund_id: input.refund.id,
    payment_intent_id: paymentIntentId,
    refund_amount: input.refund.amount,
  })

  if (!refundRequest) {
    throw new RefundWebhookError(
      "REFUND_WEBHOOK_REQUEST_NOT_FOUND",
      "RefundRequest local nao encontrado para correlacao.",
      "ignored"
    )
  }

  if (
    isNonFinalizingRefundWebhook({
      event_type: input.event_type,
      refund_status: input.refund.status,
    })
  ) {
    const linked = applyNonFinalizingRefundWebhookLink({
      refund_request: refundRequest,
      stripe_refund_id: input.refund.id,
      at: input.at,
    })

    if (!linked.noop) {
      await refundRequestModule.updateRefundRequests?.(linked.refund_request)
    }

    const order =
      (await orderModule.listOrders?.({ id: refundRequest.order_id }))?.[0] ??
      null

    return {
      status: "non_finalizing",
      refund_request_id: refundRequest.id,
      order_id: refundRequest.order_id,
      confirmed_refunded_amount: null,
      payment_status:
        typeof order?.metadata?.payment_status === "string"
          ? order.metadata.payment_status
          : null,
      order_status:
        typeof order?.metadata?.order_status === "string"
          ? order.metadata.order_status
          : null,
    }
  }

  return withOrderClaim(refundRequest.order_id, async () => {
    const freshRequests = await loadRefundRequestsForCorrelation({
      module: refundRequestModule,
      stripe_refund_id: input.refund.id,
      payment_intent_id: paymentIntentId,
    })
    const freshRequest =
      findRefundRequestForStripeRefund({
        refund_requests: freshRequests,
        stripe_refund_id: input.refund.id,
        payment_intent_id: paymentIntentId,
        refund_amount: input.refund.amount,
      }) ?? refundRequest

    const applied = applyTerminalRefundWebhookToRefundRequest({
      refund_request: freshRequest,
      stripe_refund: input.refund,
      at: input.at,
    })

    if (applied.noop) {
      const order =
        (await orderModule.listOrders?.({ id: freshRequest.order_id }))?.[0] ??
        null
      const paymentAttempt =
        (
          await paymentAttemptModule.listPaymentAttempts?.({
            order_id: freshRequest.order_id,
          })
        )?.[0] ?? null

      let confirmedRefundedAmount: number | null = null
      let paymentStatus: string | null =
        typeof order?.metadata?.payment_status === "string"
          ? order.metadata.payment_status
          : null

      if (paymentAttempt && order) {
        try {
          const captured = resolveOrderCapturedAmountForFinancialRecomputation({
            order_id: freshRequest.order_id,
            order_metadata: order.metadata,
            payment_attempt: paymentAttempt,
          })
          const allRequests =
            (await refundRequestModule.listRefundRequests?.({
              order_id: freshRequest.order_id,
            })) ?? []
          const financialState = recomputeOrderFinancialState({
            captured,
            refund_requests: allRequests,
            current_metadata: order.metadata,
          })
          confirmedRefundedAmount = financialState.confirmed_refunded_amount
          paymentStatus = financialState.payment_status
        } catch {
          confirmedRefundedAmount = null
        }
      }

      return {
        status: "noop",
        refund_request_id: freshRequest.id,
        order_id: freshRequest.order_id,
        confirmed_refunded_amount: confirmedRefundedAmount,
        payment_status: paymentStatus,
        order_status:
          typeof order?.metadata?.order_status === "string"
            ? order.metadata.order_status
            : null,
      }
    }

    if (!applied.finalizes_financial_state) {
      await refundRequestModule.updateRefundRequests?.(applied.refund_request)

      const order =
        (await orderModule.listOrders?.({ id: freshRequest.order_id }))?.[0] ??
        null

      const terminalStatus =
        applied.refund_request.status === "failed"
          ? ("failed" as const)
          : ("canceled" as const)

      return {
        status: terminalStatus,
        refund_request_id: applied.refund_request.id,
        order_id: applied.refund_request.order_id,
        confirmed_refunded_amount: null,
        payment_status:
          typeof order?.metadata?.payment_status === "string"
            ? order.metadata.payment_status
            : null,
        order_status:
          typeof order?.metadata?.order_status === "string"
            ? order.metadata.order_status
            : null,
      }
    }

    const financial = await persistRefundFinancialRecomputation({
      orderModule,
      refundRequestModule,
      paymentAttemptModule,
      orderId: applied.refund_request.order_id,
      updatedRefundRequest: applied.refund_request,
      at: input.at,
    })

    return {
      status: "confirmed",
      refund_request_id: applied.refund_request.id,
      order_id: applied.refund_request.order_id,
      confirmed_refunded_amount: financial.confirmed_refunded_amount,
      payment_status: financial.payment_status,
      order_status: financial.order_status,
    }
  })
}

export async function runProcessStripeRefundWebhookEntrypoint(
  container: MedusaContainer,
  input: ProcessStripeRefundWebhookInput,
  overrides: ProcessStripeRefundWebhookOverrides = {}
): Promise<ProcessStripeRefundWebhookResult> {
  const at = overrides.now?.() ?? new Date()

  if (isChargeRefundedWebhookEventType(input.event_type)) {
    return {
      status: "informational",
      refund_request_id: null,
      order_id: null,
      confirmed_refunded_amount: null,
      payment_status: null,
      order_status: null,
    }
  }

  if (!isRefundWebhookEventType(input.event_type)) {
    throw new RefundWebhookError(
      "REFUND_WEBHOOK_EVENT_UNSUPPORTED",
      "Tipo de evento de refund nao suportado.",
      "ignored"
    )
  }

  if (!input.refund || !isStripeRefundObject(input.refund)) {
    throw new RefundWebhookError(
      "REFUND_WEBHOOK_OBJECT_INVALID",
      "Evento sem objeto refund valido."
    )
  }

  return processRefundObjectWebhook({
    container,
    event_type: input.event_type,
    refund: input.refund,
    at,
    overrides,
  })
}
