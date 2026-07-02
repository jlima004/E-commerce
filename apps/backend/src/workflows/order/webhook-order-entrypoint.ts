import { completeCartWorkflow } from "@medusajs/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  buildCheckoutCompletionCompletedUpdate,
  buildCheckoutCompletionFailedUpdate,
  buildCheckoutCompletionIdempotencyKey,
  buildCheckoutCompletionLogRecord,
  resolveCheckoutCompletionClaimDecision,
  type CheckoutCompletionLogRecord,
} from "../../modules/checkout-completion/service"
import type { CreateCheckoutCompletionLogInput } from "../../modules/checkout-completion/types"
import { CHECKOUT_COMPLETION_MODULE } from "../../modules/checkout-completion"
import {
  linkPaymentAttemptToOrder,
} from "../../modules/payment-attempt/service"
import { PAYMENT_ATTEMPT_MODULE } from "../../modules/payment-attempt"
import { assertPaymentAttemptEligibleForOrderCreation } from "../../modules/payment-attempt/state-machine"
import type { PaymentAttemptRecord } from "../../modules/payment-attempt/types"
import {
  assertConfirmedAttemptCartMatchesPaymentAttempt,
  buildConfirmedOrderStateMetadata,
  getConfirmedOrderState,
  sanitizeOrderCreationFailure,
  type ConfirmedAttemptCartRecord,
} from "./steps/create-order-from-confirmed-attempt"
import {
  buildOrderLineItemGelatoSnapshots,
} from "./steps/build-order-line-item-gelato-snapshots"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../modules/analytics-event-log"
import {
  buildAnalyticsEventLogRecord,
  buildPurchaseCompletedIdempotencyKey,
  isPurchaseCompletedLocallyRecorded,
} from "../../modules/analytics-event-log/service"
import type { AnalyticsEventLogRecord } from "../../modules/analytics-event-log/types"
import { EMAIL_DELIVERY_LOG_MODULE } from "../../modules/email-delivery-log"
import {
  buildEmailDeliveryLogRecord,
  buildOrderConfirmationEmailIdempotencyKey,
  buildOrderConfirmationEmailPayload,
  isOrderConfirmationEmailLocallyRecorded,
  resolveOrderConfirmationSupportEmail,
} from "../../modules/email-delivery-log/service"
import type {
  EmailDeliveryLogRecord,
  OrderConfirmationEmailItemInput,
} from "../../modules/email-delivery-log/types"

export type CreateOrderFromConfirmedPaymentAttemptInput = {
  payment_attempt_id: string
  payment_intent_id: string
  stripe_event_id?: string | null
  correlation_id?: string | null
}

export type CreateOrderFromConfirmedPaymentAttemptResult = {
  status:
    | "created"
    | "reused_existing_order"
    | "already_processing"
    | "order_creation_unavailable"
  payment_attempt_id: string
  payment_intent_id: string
  order_id: string | null
  stripe_event_id: string | null
  correlation_id: string | null
  checkout_completion_status: "completed" | "processing"
  order_status: "confirmed" | null
  payment_status: "captured" | null
}

export class OrderCreationEntrypointError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "OrderCreationEntrypointError"
    this.code = code
  }
}

type PaymentAttemptModuleLike = {
  listPaymentAttempts?: (
    filters?: Record<string, unknown>
  ) => Promise<PaymentAttemptRecord[]>
  updatePaymentAttempts?: (
    data: PaymentAttemptRecord | PaymentAttemptRecord[]
  ) => Promise<PaymentAttemptRecord[]>
}

type CheckoutCompletionModuleLike = {
  listCheckoutCompletionLogs?: (
    filters?: Record<string, unknown>
  ) => Promise<CheckoutCompletionLogRecord[]>
  createCheckoutCompletionLogs?: (
    data: Record<string, unknown> | Record<string, unknown>[]
  ) => Promise<CheckoutCompletionLogRecord[] | CheckoutCompletionLogRecord>
  updateCheckoutCompletionLogs?: (
    data: Record<string, unknown> | Record<string, unknown>[]
  ) => Promise<CheckoutCompletionLogRecord[] | CheckoutCompletionLogRecord>
}

type QueryGraphLike = {
  graph: (input: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: Array<Record<string, unknown>> }>
}

type CartModuleLike = {
  updateLineItems?: (
    data: Array<{
      selector: { id: string }
      data: { metadata: Record<string, unknown> }
    }>
  ) => Promise<unknown>
}

type OrderModuleLike = {
  listOrders?: (
    selector: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<Array<Record<string, unknown>>>
  updateOrders?: (
    selector: Record<string, unknown>,
    update: Record<string, unknown>
  ) => Promise<Array<Record<string, unknown>>>
}

type AnalyticsEventLogModuleLike = {
  listAnalyticsEventLogs?: (
    filters?: Record<string, unknown>
  ) => Promise<AnalyticsEventLogRecord[]>
  createAnalyticsEventLogs?: (
    data: Record<string, unknown> | Record<string, unknown>[]
  ) => Promise<AnalyticsEventLogRecord[] | AnalyticsEventLogRecord>
}

type EmailDeliveryLogModuleLike = {
  listEmailDeliveryLogs?: (
    filters?: Record<string, unknown>
  ) => Promise<EmailDeliveryLogRecord[]>
  createEmailDeliveryLogs?: (
    data: Record<string, unknown> | Record<string, unknown>[]
  ) => Promise<EmailDeliveryLogRecord[] | EmailDeliveryLogRecord>
}

const ANALYTICS_EVENT_LOG_RUNTIME_KEYS = [
  "analytics_event_log",
  ANALYTICS_EVENT_LOG_MODULE,
] as const

const EMAIL_DELIVERY_LOG_RUNTIME_KEYS = [
  "email_delivery_log",
  EMAIL_DELIVERY_LOG_MODULE,
] as const

type WorkflowRuntimeOverrides = {
  now?: () => Date
  runCompleteCart?: (
    container: MedusaContainer,
    cartId: string
  ) => Promise<{ id: string }>
  getCart?: (
    container: MedusaContainer,
    cartId: string
  ) => Promise<ConfirmedAttemptCartRecord>
  persistCartSnapshots?: (
    container: MedusaContainer,
    patches: Array<{ id: string; metadata: Record<string, unknown> }>
  ) => Promise<void>
  persistOrderState?: (
    container: MedusaContainer,
    orderId: string
  ) => Promise<void>
}

const ORDER_CART_FIELDS = [
  "id",
  "total",
  "currency_code",
  "completed_at",
  "items.id",
  "items.quantity",
  "items.metadata",
  "items.variant.id",
  "items.variant.sku",
  "items.variant.metadata",
  "items.variant.prices.amount",
  "items.variant.prices.currency_code",
] as const

function requireNonEmpty(value: string | null | undefined, code: string): string {
  const normalized = value?.trim()

  if (!normalized) {
    throw new OrderCreationEntrypointError(code, code)
  }

  return normalized
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) {
    return []
  }

  return Array.isArray(value) ? value : [value]
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /duplicate key value|unique constraint/i.test(error.message)
  )
}

function getErrorCode(error: Error): string | null {
  const code = (error as { code?: unknown }).code

  return typeof code === "string" ? code : null
}

function resolvePaymentAttemptModule(
  container: MedusaContainer
): PaymentAttemptModuleLike {
  const module = container.resolve(
    PAYMENT_ATTEMPT_MODULE
  ) as PaymentAttemptModuleLike

  if (
    !module ||
    typeof module.listPaymentAttempts !== "function" ||
    typeof module.updatePaymentAttempts !== "function"
  ) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_PAYMENT_ATTEMPT_MODULE_UNAVAILABLE",
      "Modulo de tentativa de pagamento nao configurado."
    )
  }

  return module
}

function resolveCheckoutCompletionModule(
  container: MedusaContainer
): CheckoutCompletionModuleLike {
  const module = container.resolve(
    CHECKOUT_COMPLETION_MODULE
  ) as CheckoutCompletionModuleLike

  if (
    !module ||
    typeof module.listCheckoutCompletionLogs !== "function" ||
    typeof module.createCheckoutCompletionLogs !== "function" ||
    typeof module.updateCheckoutCompletionLogs !== "function"
  ) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_CHECKOUT_COMPLETION_MODULE_UNAVAILABLE",
      "Modulo de conclusao de checkout nao configurado."
    )
  }

  return module
}

function resolveQuery(container: MedusaContainer): QueryGraphLike {
  const query = container.resolve(
    ContainerRegistrationKeys.QUERY
  ) as QueryGraphLike

  if (!query || typeof query.graph !== "function") {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_QUERY_UNAVAILABLE",
      "Query graph nao configurado."
    )
  }

  return query
}

function resolveCartModule(container: MedusaContainer): CartModuleLike {
  const module = container.resolve(Modules.CART) as CartModuleLike

  if (!module || typeof module.updateLineItems !== "function") {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_CART_MODULE_UNAVAILABLE",
      "Modulo de cart nao configurado."
    )
  }

  return module
}

function resolveOrderModule(container: MedusaContainer): OrderModuleLike {
  const resolved = container.resolve(Modules.ORDER) as unknown

  if (
    !resolved ||
    typeof (resolved as OrderModuleLike).listOrders !== "function" ||
    typeof (resolved as OrderModuleLike).updateOrders !== "function"
  ) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_ORDER_MODULE_UNAVAILABLE",
      "Modulo de order nao configurado."
    )
  }

  return resolved as OrderModuleLike
}

function resolveAnalyticsEventLogModule(
  container: MedusaContainer
): AnalyticsEventLogModuleLike {
  const resolved = ANALYTICS_EVENT_LOG_RUNTIME_KEYS
    .map((key) => container.resolve(key) as AnalyticsEventLogModuleLike | undefined)
    .find((candidate) => {
      return (
        Boolean(candidate) &&
        typeof candidate?.listAnalyticsEventLogs === "function" &&
        typeof candidate?.createAnalyticsEventLogs === "function"
      )
    })

  if (
    !resolved ||
    typeof resolved.listAnalyticsEventLogs !== "function" ||
    typeof resolved.createAnalyticsEventLogs !== "function"
  ) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_ANALYTICS_EVENT_LOG_MODULE_UNAVAILABLE",
      "Modulo de analytics_event_log nao configurado."
    )
  }

  return resolved
}

function resolveEmailDeliveryLogModule(
  container: MedusaContainer
): EmailDeliveryLogModuleLike {
  const resolved = EMAIL_DELIVERY_LOG_RUNTIME_KEYS.map((key) =>
    container.resolve(key)
  )
    .find((candidate) => {
      return (
        Boolean(candidate) &&
        typeof (candidate as EmailDeliveryLogModuleLike)
          .listEmailDeliveryLogs === "function" &&
        typeof (candidate as EmailDeliveryLogModuleLike)
          .createEmailDeliveryLogs === "function"
      )
    }) as EmailDeliveryLogModuleLike | undefined

  if (
    !resolved ||
    typeof resolved.listEmailDeliveryLogs !== "function" ||
    typeof resolved.createEmailDeliveryLogs !== "function"
  ) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_EMAIL_DELIVERY_LOG_MODULE_UNAVAILABLE",
      "Modulo de email_delivery_log nao configurado."
    )
  }

  return resolved
}

export function validateCreateOrderFromConfirmedPaymentAttemptInput(
  input: CreateOrderFromConfirmedPaymentAttemptInput
): CreateOrderFromConfirmedPaymentAttemptInput {
  return {
    payment_attempt_id: requireNonEmpty(
      input.payment_attempt_id,
      "ORDER_ENTRYPOINT_PAYMENT_ATTEMPT_ID_REQUIRED"
    ),
    payment_intent_id: requireNonEmpty(
      input.payment_intent_id,
      "ORDER_ENTRYPOINT_PAYMENT_INTENT_ID_REQUIRED"
    ),
    stripe_event_id: input.stripe_event_id?.trim() || null,
    correlation_id: input.correlation_id?.trim() || null,
  }
}

async function loadPaymentAttemptById(
  container: MedusaContainer,
  paymentAttemptId: string
): Promise<PaymentAttemptRecord> {
  const module = resolvePaymentAttemptModule(container)
  const attempts = (await module.listPaymentAttempts?.({ id: paymentAttemptId })) ?? []
  const attempt = attempts.find((entry) => entry.id === paymentAttemptId)

  if (!attempt) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_PAYMENT_ATTEMPT_NOT_FOUND",
      "Tentativa nao encontrada."
    )
  }

  return attempt
}

async function loadCartForOrderCreation(
  container: MedusaContainer,
  cartId: string
): Promise<ConfirmedAttemptCartRecord> {
  const query = resolveQuery(container)
  const { data } = await query.graph({
    entity: "cart",
    fields: [...ORDER_CART_FIELDS],
    filters: { id: cartId },
  })
  const cart = data[0] as ConfirmedAttemptCartRecord | undefined

  if (!cart) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_CART_NOT_FOUND",
      "Carrinho confirmado nao encontrado."
    )
  }

  return cart
}

async function claimCheckoutCompletionLog(
  container: MedusaContainer,
  attempt: PaymentAttemptRecord,
  input: CreateOrderFromConfirmedPaymentAttemptInput,
  now: Date
): Promise<{
  status: "claimed" | "completed" | "processing"
  log: CheckoutCompletionLogRecord
  order_id: string | null
}> {
  const module = resolveCheckoutCompletionModule(container)
  const idempotencyKey = buildCheckoutCompletionIdempotencyKey({
    payment_intent_id: input.payment_intent_id,
  })
  const nextInput: CreateCheckoutCompletionLogInput = {
    cart_id: attempt.cart_id,
    payment_intent_id: input.payment_intent_id,
    payment_attempt_id: attempt.id,
    idempotency_key: idempotencyKey,
    metadata: {
      stripe_event_id: input.stripe_event_id ?? null,
      correlation_id: input.correlation_id ?? null,
      payment_method_type: attempt.payment_method_type,
    },
  }

  const readExisting = async () => {
    const records =
      (await module.listCheckoutCompletionLogs?.({
        idempotency_key: idempotencyKey,
      })) ?? []

    return records[0] ?? null
  }

  const existing = await readExisting()
  const decision = resolveCheckoutCompletionClaimDecision({
    existing,
    next: nextInput,
    at: now,
  })

  if (decision.type === "reuse_completed") {
    return {
      status: "completed",
      log: decision.log,
      order_id: decision.order_id,
    }
  }

  if (decision.type === "already_processing") {
    return {
      status: "processing",
      log: decision.log,
      order_id: null,
    }
  }

  if (decision.type === "recover_created_order") {
    return {
      status: "completed",
      log: decision.log,
      order_id: decision.order_id,
    }
  }

  if (decision.type === "retry_failed") {
    const updated = asArray(
      await module.updateCheckoutCompletionLogs?.({
        id: decision.log.id,
        ...decision.update,
      })
    )[0] as CheckoutCompletionLogRecord

    return {
      status: "claimed",
      log: updated,
      order_id: null,
    }
  }

  try {
    const created = asArray(
      await module.createCheckoutCompletionLogs?.(
        buildCheckoutCompletionLogRecord(
          nextInput,
          "chkcpl_order_entrypoint_pending",
          now
        )
      )
    )[0] as CheckoutCompletionLogRecord

    return {
      status: "claimed",
      log: created,
      order_id: null,
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    const conflicted = await readExisting()

    if (!conflicted) {
      throw error
    }

    const afterConflict = resolveCheckoutCompletionClaimDecision({
      existing: conflicted,
      next: nextInput,
      at: now,
    })

    if (afterConflict.type === "reuse_completed") {
      return {
        status: "completed",
        log: afterConflict.log,
        order_id: afterConflict.order_id,
      }
    }

    if (afterConflict.type === "already_processing") {
      return {
        status: "processing",
        log: afterConflict.log,
        order_id: null,
      }
    }

    if (afterConflict.type === "recover_created_order") {
      return {
        status: "completed",
        log: afterConflict.log,
        order_id: afterConflict.order_id,
      }
    }

    throw error
  }
}

async function persistCartSnapshots(
  container: MedusaContainer,
  patches: Array<{ id: string; metadata: Record<string, unknown> }>
): Promise<void> {
  const cartModule = resolveCartModule(container)

  await cartModule.updateLineItems?.(
    patches.map((patch) => ({
      selector: { id: patch.id },
      data: {
        metadata: patch.metadata,
      },
    }))
  )
}

async function runCompleteCart(
  container: MedusaContainer,
  cartId: string
): Promise<{ id: string }> {
  const { result } = await completeCartWorkflow(container).run({
    input: {
      id: cartId,
    },
  })

  return result
}

async function persistConfirmedOrderState(
  container: MedusaContainer,
  orderId: string
): Promise<void> {
  const module = resolveOrderModule(container)
  const current = (await module.listOrders?.({ id: orderId }))?.[0] ?? null

  await module.updateOrders?.(
    { id: orderId },
    {
      metadata: buildConfirmedOrderStateMetadata(
        current?.metadata as Record<string, unknown> | null | undefined
      ),
    }
  )
}

function extractOrderId(order: Record<string, unknown> | null | undefined): string | null {
  const id = order?.id
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null
}

function normalizeLineItemUnitPrice(input: {
  item: ConfirmedAttemptCartRecord["items"][number]
  currencyCode: string
}): number {
  const matchingPrice = input.item.variant?.prices?.find((price) => {
    return price.currency_code?.toLowerCase() === input.currencyCode.toLowerCase()
  })

  const amount = matchingPrice?.amount

  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_ANALYTICS_UNIT_PRICE_INVALID",
      "Unit price invalido para o payload local de analytics."
    )
  }

  return amount
}

function buildPurchaseCompletedPayloadItems(
  cart: ConfirmedAttemptCartRecord
): AnalyticsEventLogRecord["payload"]["items"] {
  return cart.items.map((item) => {
    const variantId = item.variant?.id?.trim()

    if (!variantId) {
      throw new OrderCreationEntrypointError(
        "ORDER_ENTRYPOINT_ANALYTICS_VARIANT_ID_REQUIRED",
        "Variant obrigatoria para o payload local de analytics."
      )
    }

    const unitPrice = normalizeLineItemUnitPrice({
      item,
      currencyCode: cart.currency_code,
    })

    return {
      variant_id: variantId,
      sku: item.variant?.sku?.trim() || null,
      quantity: item.quantity,
      unit_price: unitPrice,
      subtotal: unitPrice * item.quantity,
    }
  })
}

async function readDurablePurchaseCompletedEvent(input: {
  module: AnalyticsEventLogModuleLike
  idempotencyKey: string
  orderId: string
}): Promise<AnalyticsEventLogRecord | null> {
  const byIdempotency =
    (await input.module.listAnalyticsEventLogs?.({
      idempotency_key: input.idempotencyKey,
    })) ?? []
  const reusableByIdempotency = byIdempotency.find((event) =>
    isPurchaseCompletedLocallyRecorded(event)
  )

  if (reusableByIdempotency) {
    return reusableByIdempotency
  }

  const byOrder =
    (await input.module.listAnalyticsEventLogs?.({
      order_id: input.orderId,
    })) ?? []

  return (
    byOrder.find((event) => isPurchaseCompletedLocallyRecorded(event)) ?? null
  )
}

async function ensurePurchaseCompletedRecorded(input: {
  container: MedusaContainer
  attempt: PaymentAttemptRecord
  checkoutCompletionLogId: string
  paymentIntentId: string
  orderId: string
  cart: ConfirmedAttemptCartRecord
  now: Date
  correlationId: string | null
  recoveryOrigin: string | null
}): Promise<AnalyticsEventLogRecord | null> {
  const idempotencyKey = buildPurchaseCompletedIdempotencyKey({
    payment_intent_id: input.paymentIntentId,
  })
  const existing = await readDurablePurchaseCompletedEvent({
    module: resolveAnalyticsEventLogModule(input.container),
    idempotencyKey,
    orderId: input.orderId,
  })

  if (existing) {
    return existing
  }

  const module = resolveAnalyticsEventLogModule(input.container)
  const payloadItems = buildPurchaseCompletedPayloadItems(input.cart)
  const event = buildAnalyticsEventLogRecord(
    {
      idempotency_key: idempotencyKey,
      order_id: input.orderId,
      cart_id: input.cart.id,
      payment_attempt_id: input.attempt.id,
      checkout_completion_log_id: input.checkoutCompletionLogId,
      payment_intent_id: input.paymentIntentId,
      status: "recorded",
      payload: {
        occurred_at: input.now,
        order_id: input.orderId,
        cart_id: input.cart.id,
        payment_attempt_id: input.attempt.id,
        checkout_completion_log_id: input.checkoutCompletionLogId,
        payment_intent_id: input.paymentIntentId,
        payment_method_type: input.attempt.payment_method_type,
        amount: input.attempt.amount,
        currency_code: input.attempt.currency_code,
        order_status: "confirmed",
        payment_status: "captured",
        item_count: payloadItems.length,
        items: payloadItems,
      },
      metadata: {
        source: "webhook_order_entrypoint",
        correlation_id: input.correlationId,
        recovery_origin: input.recoveryOrigin,
      },
    },
    "anlevt_order_entrypoint_pending",
    input.now
  )

  try {
    return asArray(await module.createAnalyticsEventLogs?.(event))[0] ?? null
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    return readDurablePurchaseCompletedEvent({
      module,
      idempotencyKey,
      orderId: input.orderId,
    })
  }
}

function buildOrderConfirmationEmailPayloadItems(
  cart: ConfirmedAttemptCartRecord
): OrderConfirmationEmailItemInput[] {
  return cart.items.map((item) => {
    const sku = item.variant?.sku?.trim()

    if (!sku) {
      throw new OrderCreationEntrypointError(
        "ORDER_ENTRYPOINT_EMAIL_ITEM_SKU_REQUIRED",
        "SKU obrigatoria para o payload local de e-mail."
      )
    }

    const unitPrice = normalizeLineItemUnitPrice({
      item,
      currencyCode: cart.currency_code,
    })

    return {
      sku,
      quantity: item.quantity,
      unit_price: unitPrice,
      subtotal: unitPrice * item.quantity,
    }
  })
}

function buildOrderReference(order: Record<string, unknown>): string {
  const displayId = order.display_id

  if (typeof displayId === "number" && Number.isFinite(displayId)) {
    return String(displayId)
  }

  if (typeof displayId === "string" && displayId.trim().length > 0) {
    return displayId.trim()
  }

  const orderId = order.id

  if (typeof orderId === "string" && orderId.trim().length > 0) {
    return orderId.trim()
  }

  throw new OrderCreationEntrypointError(
    "ORDER_ENTRYPOINT_ORDER_REFERENCE_UNAVAILABLE",
    "Referencia da Order indisponivel."
  )
}

async function loadOrderForEmailConfirmation(
  container: MedusaContainer,
  orderId: string
): Promise<Record<string, unknown>> {
  const orderModule = resolveOrderModule(container)
  const order = (await orderModule.listOrders?.({ id: orderId }))?.[0] ?? null

  if (!order) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_ORDER_NOT_FOUND",
      "Order nao encontrada para enqueue local de e-mail."
    )
  }

  return order
}

function extractCanonicalOrderEmail(order: Record<string, unknown>): string {
  const email = order.email

  if (typeof email !== "string" || email.trim().length === 0) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_ORDER_EMAIL_REQUIRED",
      "E-mail canonico da Order ausente."
    )
  }

  return email.trim()
}

async function readReusableOrderConfirmationEmailLog(input: {
  module: EmailDeliveryLogModuleLike
  idempotencyKey: string
  orderId: string
}): Promise<EmailDeliveryLogRecord | null> {
  const byIdempotency =
    (await input.module.listEmailDeliveryLogs?.({
      idempotency_key: input.idempotencyKey,
    })) ?? []
  const reusableByIdempotency = byIdempotency.find((log) =>
    isOrderConfirmationEmailLocallyRecorded(log)
  )

  if (reusableByIdempotency) {
    return reusableByIdempotency
  }

  const byOrder =
    (await input.module.listEmailDeliveryLogs?.({
      order_id: input.orderId,
    })) ?? []

  return (
    byOrder.find((log) => isOrderConfirmationEmailLocallyRecorded(log)) ?? null
  )
}

async function ensureOrderConfirmationEmailRecorded(input: {
  container: MedusaContainer
  attempt: PaymentAttemptRecord
  checkoutCompletionLogId: string
  paymentIntentId: string
  orderId: string
  cart: ConfirmedAttemptCartRecord
  purchaseCompletedEvent: AnalyticsEventLogRecord | null
  now: Date
  correlationId: string | null
  recoveryOrigin: string | null
}): Promise<EmailDeliveryLogRecord | null> {
  if (
    !input.purchaseCompletedEvent ||
    !isPurchaseCompletedLocallyRecorded(input.purchaseCompletedEvent)
  ) {
    return null
  }

  const idempotencyKey = buildOrderConfirmationEmailIdempotencyKey({
    order_id: input.orderId,
  })
  const module = resolveEmailDeliveryLogModule(input.container)
  const existing = await readReusableOrderConfirmationEmailLog({
    module,
    idempotencyKey,
    orderId: input.orderId,
  })

  if (existing) {
    return existing
  }

  const order = await loadOrderForEmailConfirmation(input.container, input.orderId)
  const recipientEmail = extractCanonicalOrderEmail(order)
  const payloadItems = buildOrderConfirmationEmailPayloadItems(input.cart)
  const record = buildEmailDeliveryLogRecord(
    {
      email_type: "order_confirmation",
      template_key: "order_confirmation_v1",
      template_version: 1,
      provider: "resend",
      idempotency_key: idempotencyKey,
      order_id: input.orderId,
      cart_id: input.cart.id,
      payment_attempt_id: input.attempt.id,
      checkout_completion_log_id: input.checkoutCompletionLogId,
      analytics_event_log_id: input.purchaseCompletedEvent.id,
      payment_intent_id: input.paymentIntentId,
      status: "recorded",
      recipient_email: recipientEmail,
      payload: buildOrderConfirmationEmailPayload({
        order_id: input.orderId,
        order_reference: buildOrderReference(order),
        amount: input.attempt.amount,
        currency_code: input.attempt.currency_code,
        item_count: payloadItems.length,
        items: payloadItems,
        support_email: resolveOrderConfirmationSupportEmail(),
      }),
      metadata: {
        source: "webhook_order_entrypoint",
        correlation_id: input.correlationId,
        recovery_origin: input.recoveryOrigin,
      },
    },
    "emlog_order_entrypoint_pending",
    input.now
  )

  try {
    return asArray(await module.createEmailDeliveryLogs?.(record))[0] ?? null
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error
    }

    return readReusableOrderConfirmationEmailLog({
      module,
      idempotencyKey,
      orderId: input.orderId,
    })
  }
}

async function finalizePostOrderLocalRecords(input: {
  container: MedusaContainer
  attempt: PaymentAttemptRecord
  checkoutCompletionLogId: string
  paymentIntentId: string
  orderId: string
  cart: ConfirmedAttemptCartRecord
  now: Date
  correlationId: string | null
  recoveryOrigin: string | null
}): Promise<void> {
  const purchaseCompletedEvent = await ensurePurchaseCompletedRecorded(input)

  await ensureOrderConfirmationEmailRecorded({
    ...input,
    purchaseCompletedEvent,
  })
}

async function findExistingOrderForCart(
  container: MedusaContainer,
  cartId: string
): Promise<string | null> {
  const orderModule = resolveOrderModule(container)
  const orders = (await orderModule.listOrders?.({ cart_id: cartId })) ?? []
  const orderIds = orders
    .map((order) => extractOrderId(order))
    .filter((id): id is string => Boolean(id))

  if (orderIds.length > 1) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_EXISTING_ORDER_CONFLICT",
      "Mais de uma Order encontrada para o carrinho confirmado."
    )
  }

  return orderIds[0] ?? null
}

async function completeCheckoutCompletionLog(
  container: MedusaContainer,
  logId: string,
  orderId: string,
  now: Date
): Promise<void> {
  const module = resolveCheckoutCompletionModule(container)

  await module.updateCheckoutCompletionLogs?.(
    buildCheckoutCompletionCompletedUpdate({
      id: logId,
      order_id: orderId,
      at: now,
    })
  )
}

async function markCheckoutCompletionLogFailed(
  container: MedusaContainer,
  logId: string,
  error: unknown,
  now: Date
): Promise<void> {
  const module = resolveCheckoutCompletionModule(container)
  const errorCode = error instanceof Error ? getErrorCode(error) : null
  const sanitized = sanitizeOrderCreationFailure({
    code: errorCode ?? "ORDER_ENTRYPOINT_FAILED",
    message: error instanceof Error ? error.message : "Falha ao criar order.",
  })

  await module.updateCheckoutCompletionLogs?.(
    buildCheckoutCompletionFailedUpdate({
      id: logId,
      error_code: sanitized.error_code,
      error_message: sanitized.error_message,
      at: now,
    })
  )
}

async function correlatePaymentAttemptToOrder(
  container: MedusaContainer,
  attempt: PaymentAttemptRecord,
  orderId: string,
  now: Date
): Promise<void> {
  const module = resolvePaymentAttemptModule(container)
  const updated = linkPaymentAttemptToOrder(attempt, orderId, now)

  await module.updatePaymentAttempts?.(updated)
}

async function completeRecoveredOrderCorrelation(input: {
  container: MedusaContainer
  attempt: PaymentAttemptRecord
  logId: string
  orderId: string
  now: Date
  persistOrderState: (
    container: MedusaContainer,
    orderId: string
  ) => Promise<void>
}): Promise<void> {
  await input.persistOrderState(input.container, input.orderId)
  await completeCheckoutCompletionLog(
    input.container,
    input.logId,
    input.orderId,
    input.now
  )
  await correlatePaymentAttemptToOrder(
    input.container,
    input.attempt,
    input.orderId,
    input.now
  )
}

function buildResult(input: {
  status: CreateOrderFromConfirmedPaymentAttemptResult["status"]
  payment_attempt_id: string
  payment_intent_id: string
  stripe_event_id: string | null
  correlation_id: string | null
  order_id: string | null
  checkout_completion_status: "completed" | "processing"
}): CreateOrderFromConfirmedPaymentAttemptResult {
  const orderState =
    input.checkout_completion_status === "completed" && input.order_id
      ? getConfirmedOrderState()
      : { order_status: null, payment_status: null }

  return {
    ...input,
    order_status: orderState.order_status,
    payment_status: orderState.payment_status,
  }
}

export async function runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
  container: MedusaContainer,
  input: CreateOrderFromConfirmedPaymentAttemptInput,
  overrides: WorkflowRuntimeOverrides = {}
): Promise<CreateOrderFromConfirmedPaymentAttemptResult> {
  const validated = validateCreateOrderFromConfirmedPaymentAttemptInput(input)
  const now = overrides.now?.() ?? new Date()
  const attempt = await loadPaymentAttemptById(
    container,
    validated.payment_attempt_id
  )

  if (attempt.id !== validated.payment_attempt_id) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_PAYMENT_ATTEMPT_MISMATCH",
      "PaymentAttempt nao corresponde ao identificador informado."
    )
  }

  if (attempt.provider_payment_intent_id !== validated.payment_intent_id) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_PAYMENT_INTENT_MISMATCH",
      "PaymentIntent nao corresponde a tentativa informada."
    )
  }

  assertPaymentAttemptEligibleForOrderCreation(attempt)
  resolveAnalyticsEventLogModule(container)
  resolveEmailDeliveryLogModule(container)

  let claim: Awaited<ReturnType<typeof claimCheckoutCompletionLog>>

  try {
    claim = await claimCheckoutCompletionLog(container, attempt, validated, now)
  } catch (error) {
    if (
      error instanceof OrderCreationEntrypointError &&
      error.code === "ORDER_ENTRYPOINT_CHECKOUT_COMPLETION_MODULE_UNAVAILABLE"
    ) {
      return buildResult({
        status: "order_creation_unavailable",
        payment_attempt_id: attempt.id,
        payment_intent_id: validated.payment_intent_id,
        stripe_event_id: validated.stripe_event_id ?? null,
        correlation_id: validated.correlation_id ?? null,
        order_id: null,
        checkout_completion_status: "processing",
      })
    }

    throw error
  }

  const persistOrderState = overrides.persistOrderState ?? persistConfirmedOrderState
  const loadCart =
    overrides.getCart ?? loadCartForOrderCreation

  if (claim.status === "processing") {
    const existingOrderId = await findExistingOrderForCart(container, attempt.cart_id)

    if (existingOrderId) {
      await completeRecoveredOrderCorrelation({
        container,
        attempt,
        logId: claim.log.id,
        orderId: existingOrderId,
        now,
        persistOrderState,
      })
      await finalizePostOrderLocalRecords({
        container,
        attempt,
        checkoutCompletionLogId: claim.log.id,
        paymentIntentId: validated.payment_intent_id,
        orderId: existingOrderId,
        cart: await loadCart(container, attempt.cart_id),
        now,
        correlationId: validated.correlation_id ?? null,
        recoveryOrigin: "existing_order_processing_recovery",
      })

      return buildResult({
        status: "reused_existing_order",
        payment_attempt_id: attempt.id,
        payment_intent_id: validated.payment_intent_id,
        stripe_event_id: validated.stripe_event_id ?? null,
        correlation_id: validated.correlation_id ?? null,
        order_id: existingOrderId,
        checkout_completion_status: "completed",
      })
    }

    return buildResult({
      status: "already_processing",
      payment_attempt_id: attempt.id,
      payment_intent_id: validated.payment_intent_id,
      stripe_event_id: validated.stripe_event_id ?? null,
      correlation_id: validated.correlation_id ?? null,
      order_id: null,
      checkout_completion_status: "processing",
    })
  }

  if (claim.status === "completed" && claim.order_id) {
    await persistOrderState(container, claim.order_id)
    await correlatePaymentAttemptToOrder(container, attempt, claim.order_id, now)
    await finalizePostOrderLocalRecords({
      container,
      attempt,
      checkoutCompletionLogId: claim.log.id,
      paymentIntentId: validated.payment_intent_id,
      orderId: claim.order_id,
      cart: await loadCart(container, attempt.cart_id),
      now,
      correlationId: validated.correlation_id ?? null,
      recoveryOrigin: "checkout_completion_reuse",
    })

    return buildResult({
      status: "reused_existing_order",
      payment_attempt_id: attempt.id,
      payment_intent_id: validated.payment_intent_id,
      stripe_event_id: validated.stripe_event_id ?? null,
      correlation_id: validated.correlation_id ?? null,
      order_id: claim.order_id,
      checkout_completion_status: "completed",
    })
  }

  const existingOrderId = await findExistingOrderForCart(container, attempt.cart_id)

  if (existingOrderId) {
    await completeRecoveredOrderCorrelation({
      container,
      attempt,
      logId: claim.log.id,
      orderId: existingOrderId,
      now,
      persistOrderState,
    })
    await finalizePostOrderLocalRecords({
      container,
      attempt,
      checkoutCompletionLogId: claim.log.id,
      paymentIntentId: validated.payment_intent_id,
      orderId: existingOrderId,
      cart: await loadCart(container, attempt.cart_id),
      now,
      correlationId: validated.correlation_id ?? null,
      recoveryOrigin: "existing_order_recovery",
    })

    return buildResult({
      status: "reused_existing_order",
      payment_attempt_id: attempt.id,
      payment_intent_id: validated.payment_intent_id,
      stripe_event_id: validated.stripe_event_id ?? null,
      correlation_id: validated.correlation_id ?? null,
      order_id: existingOrderId,
      checkout_completion_status: "completed",
    })
  }

  let completedOrderId: string | null = null

  try {
    const cart = await loadCart(container, attempt.cart_id)

    assertConfirmedAttemptCartMatchesPaymentAttempt(attempt, cart)

    const snapshotPatches = buildOrderLineItemGelatoSnapshots({
      items: cart.items,
      captured_at: now.toISOString(),
    })

    await (overrides.persistCartSnapshots ?? persistCartSnapshots)(
      container,
      snapshotPatches.map((patch) => ({
        id: patch.id,
        metadata: patch.metadata,
      }))
    )

    const completedOrder = await (overrides.runCompleteCart ?? runCompleteCart)(
      container,
      cart.id
    )
    completedOrderId = completedOrder.id

    await completeRecoveredOrderCorrelation({
      container,
      attempt,
      logId: claim.log.id,
      orderId: completedOrder.id,
      now,
      persistOrderState,
    })
    await finalizePostOrderLocalRecords({
      container,
      attempt,
      checkoutCompletionLogId: claim.log.id,
      paymentIntentId: validated.payment_intent_id,
      orderId: completedOrder.id,
      cart,
      now,
      correlationId: validated.correlation_id ?? null,
      recoveryOrigin: null,
    })

    return buildResult({
      status: "created",
      payment_attempt_id: attempt.id,
      payment_intent_id: validated.payment_intent_id,
      stripe_event_id: validated.stripe_event_id ?? null,
      correlation_id: validated.correlation_id ?? null,
      order_id: completedOrder.id,
      checkout_completion_status: "completed",
    })
  } catch (error) {
    if (completedOrderId) {
      throw error
    }

    await markCheckoutCompletionLogFailed(container, claim.log.id, error, now)
    throw error
  }
}

const createOrderFromConfirmedPaymentAttemptStep = createStep(
  "create-order-from-confirmed-payment-attempt",
  async (
    input: CreateOrderFromConfirmedPaymentAttemptInput,
    { container }
  ) => {
    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      container,
      input
    )

    return new StepResponse(result)
  }
)

export const createOrderFromConfirmedPaymentAttemptWorkflow = createWorkflow(
  "create-order-from-confirmed-payment-attempt",
  (input: CreateOrderFromConfirmedPaymentAttemptInput) => {
    const result = createOrderFromConfirmedPaymentAttemptStep(input)
    return new WorkflowResponse(result)
  }
)

export default createOrderFromConfirmedPaymentAttemptWorkflow
