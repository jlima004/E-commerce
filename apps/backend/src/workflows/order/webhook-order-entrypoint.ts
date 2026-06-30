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
  const module = container.resolve(Modules.ORDER) as OrderModuleLike

  if (
    !module ||
    typeof module.listOrders !== "function" ||
    typeof module.updateOrders !== "function"
  ) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_ORDER_MODULE_UNAVAILABLE",
      "Modulo de order nao configurado."
    )
  }

  return module
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
  const sanitized = sanitizeOrderCreationFailure({
    code:
      error instanceof Error && typeof (error as { code?: unknown }).code === "string"
        ? String((error as { code: string }).code)
        : "ORDER_ENTRYPOINT_FAILED",
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
    const cart = await (overrides.getCart ?? loadCartForOrderCreation)(
      container,
      attempt.cart_id
    )

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
