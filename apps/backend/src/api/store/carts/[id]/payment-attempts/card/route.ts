import { randomUUID } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createPaymentCollectionForCartWorkflowId } from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  PaymentSessionStatus,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import { rejectClientMoneyFields } from "../../../payment-attempts/validators"
import type { StoreCartPreOrderRecord } from "../../../serializers"
import {
  serializeCardPaymentAttemptResponse,
  STRIPE_CARD_INITIATION_LAYER,
  finalizeCardPaymentAttempt,
  initiateCardPaymentIntent,
  prepareCardPaymentAttempt,
  type PrepareCardPaymentAttemptResult,
  type StripeCardInitiationLayer,
} from "../../../../../../modules/payment-attempt/card"
import { assertPaymentStartEligible } from "../../../../../../modules/payment-attempt/eligibility"
import { resolveActiveCartIdentity } from "../../../../../../modules/checkout/active-cart"
import { PAYMENT_ATTEMPT_MODULE } from "../../../../../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../../../../../modules/payment-attempt/types"
import { assertNoPendingCartReview } from "../../../../../../modules/cart-merge/review-guard"
import {
  lockCartOrderAuthority,
  type PaymentAttemptSqlTransaction,
} from "../../../../../../modules/payment-attempt/transactional-authority"
import {
  STORE_RESOURCE_VERSION_MODULE,
  type StoreResourceVersionModuleService,
} from "../../../../../../modules/store-resource-version"
import type {
  KnexLike,
  SharedTransactionContext,
  TransactionalManagerLike,
} from "../../../../../../infrastructure/store-foundation-transaction-compatibility"
import { initializeCartResourceVersion } from "../../../concurrency"
import { resolvePaymentAttemptCartFingerprintFromStoreCart } from "../../../serializers"
import { findReusablePaymentAttempt } from "../../../../../../modules/payment-attempt/durable-initiation"
import { resolvePaymentCartCatalog } from "../../../payment-catalog"
import { withCartModuleTransaction } from "../../../../../../workflows/cart/cart-transaction-boundary"

type SessionCapableRequest = MedusaRequest & {
  auth_context?: {
    actor_id?: string
    actor_type?: string
  }
  session?: {
    id?: string
    active_cart_id?: string
  }
  params?: {
    id?: string
  }
}

type PaymentAttemptModuleLike = {
  listPaymentAttempts?: (
    filters?: { cart_id?: string },
    configOrContext?: unknown,
    sharedContext?: SharedTransactionContext
  ) => Promise<PaymentAttemptRecord[]>
  createPaymentAttempts?: (
    data: PaymentAttemptRecord | PaymentAttemptRecord[],
    sharedContext?: SharedTransactionContext
  ) => Promise<PaymentAttemptRecord[]>
  updatePaymentAttempts?: (
    data: PaymentAttemptRecord | PaymentAttemptRecord[],
    sharedContext?: SharedTransactionContext
  ) => Promise<PaymentAttemptRecord[]>
  resolveStripeCardInitiationLayer?: () =>
    Promise<StripeCardInitiationLayer | null>
}

type MedusaPaymentSessionRecord = {
  id?: string | null
  status?: string | null
  amount?: unknown
  currency_code?: string | null
  data?: Record<string, unknown> | null
}

type MedusaPaymentCollectionRecord = {
  id?: string | null
  payment_sessions?: MedusaPaymentSessionRecord[] | null
}

type PaymentModuleLike = {
  createPaymentSession?: (
    paymentCollectionId: string,
    data: {
      provider_id: string
      amount: number
      currency_code: string
      data?: Record<string, unknown>
      context?: Record<string, unknown>
      metadata?: Record<string, unknown>
    },
    sharedContext?: SharedTransactionContext
  ) => Promise<MedusaPaymentSessionRecord>
  updatePaymentSessions?: (
    data:
      | {
          id: string
          status?: string
          data?: Record<string, unknown>
        }
      | Array<{
          id: string
          status?: string
          data?: Record<string, unknown>
        }>,
    configOrContext?: unknown,
    sharedContext?: SharedTransactionContext
  ) => Promise<MedusaPaymentSessionRecord | MedusaPaymentSessionRecord[]>
}

type CartOwnedRetrieveConfig = {
  select: string[]
  relations: string[]
}

type LockedCartLineItem = {
  id?: string
  quantity?: unknown
  title?: string | null
  product_title?: string | null
  variant_id?: string | null
  variant_title?: string | null
  unit_price?: unknown
}

type LockedCartRecord = {
  id: string
  email?: string | null
  currency_code?: string | null
  locale?: string | null
  total?: unknown
  subtotal?: unknown
  item_total?: unknown
  shipping_total?: unknown
  tax_total?: unknown
  discount_total?: unknown
  region_id?: string | null
  customer_id?: string | null
  created_at?: string | Date
  updated_at?: string | Date
  completed_at?: string | Date | null
  metadata?: Record<string, unknown> | null
  items?: LockedCartLineItem[] | null
  shipping_address?: StoreCartPreOrderRecord["shipping_address"]
}

type CartModuleForPaymentTransaction = {
  retrieveCart?: (
    cartId: string,
    config?: CartOwnedRetrieveConfig,
    sharedContext?: SharedTransactionContext
  ) => Promise<LockedCartRecord>
}

const CART_OWNED_RETRIEVE_CONFIG: CartOwnedRetrieveConfig = {
  select: [
    "id",
    "email",
    "currency_code",
    "locale",
    "total",
    "subtotal",
    "item_total",
    "shipping_total",
    "tax_total",
    "discount_total",
    "region_id",
    "customer_id",
    "created_at",
    "updated_at",
    "completed_at",
    "metadata",
  ],
  relations: ["items", "shipping_address"],
}

async function withCartPaymentTransaction<T>(
  req: SessionCapableRequest,
  callback: (sharedContext: SharedTransactionContext) => Promise<T>
): Promise<T> {
  try {
    return await withCartModuleTransaction(
      req.scope,
      (_transaction, _manager, sharedContext) => callback(sharedContext)
    )
  } catch (error) {
    // Narrow test-double compatibility only: real Medusa always exposes the
    // Cart module transaction boundary above. Do not fall back after a
    // transaction has started or after callback work has failed.
    if (
      !(error instanceof Error) ||
      error.message !== "CART_TRANSACTION_AUTHORITY_UNAVAILABLE"
    ) {
      throw error
    }

    const pgConnection = req.scope.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    ) as {
      transaction<TInner>(
        callback: (transaction: KnexLike) => Promise<TInner>
      ): Promise<TInner>
    }
    return pgConnection.transaction(async (transaction) => {
      const transactionManager: TransactionalManagerLike = {
        getTransactionContext: () => transaction,
      }
      return callback({
        __type: "MedusaContext",
        transactionManager,
        manager: transactionManager,
      })
    })
  }
}

const PAYMENT_ATTEMPT_LIST_ERROR_MESSAGE =
  "Falha ao consultar tentativas de pagamento."
const MEDUSA_STRIPE_PROVIDER_ID = "pp_stripe_deferred"
const PROCESSABLE_PAYMENT_SESSION_STATUSES = new Set<string>([
  PaymentSessionStatus.PENDING,
  PaymentSessionStatus.REQUIRES_MORE,
  PaymentSessionStatus.AUTHORIZED,
  PaymentSessionStatus.CAPTURED,
])

function isStripeCardInitiationLayer(
  value: unknown
): value is StripeCardInitiationLayer {
  return (
    Boolean(value) &&
    typeof (value as StripeCardInitiationLayer).createCardPaymentIntent ===
      "function"
  )
}

async function resolveStripeCardInitiationLayer(
  req: SessionCapableRequest
): Promise<StripeCardInitiationLayer> {
  let layer: unknown

  try {
    layer = req.scope.resolve(STRIPE_CARD_INITIATION_LAYER)
  } catch {
    try {
      const service = req.scope.resolve(
        PAYMENT_ATTEMPT_MODULE
      ) as PaymentAttemptModuleLike
      layer = await service.resolveStripeCardInitiationLayer?.()
    } catch {
      layer = null
    }
  }

  if (!isStripeCardInitiationLayer(layer)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Camada Stripe para cartao nao configurada."
    )
  }

  return layer
}

type CartModuleForLockedRetrieve = CartModuleForPaymentTransaction & {
  retrieveCart: (
    cartId: string,
    config?: CartOwnedRetrieveConfig,
    sharedContext?: SharedTransactionContext
  ) => Promise<LockedCartRecord>
}

function resolveCartModuleForLockedRetrieve(
  req: SessionCapableRequest
): CartModuleForLockedRetrieve {
  let cartModule: CartModuleForPaymentTransaction | undefined

  try {
    cartModule = req.scope.resolve(
      Modules.CART
    ) as CartModuleForPaymentTransaction
  } catch {
    cartModule = undefined
  }

  if (typeof cartModule?.retrieveCart !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Autoridade transacional do cart indisponivel."
    )
  }

  return cartModule as CartModuleForLockedRetrieve
}

async function retrieveLockedCartInTransaction(
  req: SessionCapableRequest,
  cartId: string,
  sharedContext: SharedTransactionContext
): Promise<LockedCartRecord> {
  const cartModule = resolveCartModuleForLockedRetrieve(req)
  const cart = await cartModule.retrieveCart(
    cartId,
    CART_OWNED_RETRIEVE_CONFIG,
    sharedContext
  )

  if (!cart?.id) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Cart with id '${cartId}' not found`
    )
  }

  return cart
}

function projectLockedCartCustomer(
  cart: LockedCartRecord
): StoreCartPreOrderRecord["customer"] {
  const customerId = asNonEmptyString(cart.customer_id)
  if (!customerId) {
    return null
  }

  return {
    id: customerId,
    email: cart.email ?? undefined,
  }
}

type LockedCartMoneyAmount = number | null | undefined

async function adaptLockedCartForPaymentPipeline(
  req: SessionCapableRequest,
  lockedCart: LockedCartRecord
): Promise<StoreCartPreOrderRecord & { total?: number | null }> {
  const catalog = await resolvePaymentCartCatalog(req, lockedCart)

  const {
    total,
    subtotal,
    item_total,
    shipping_total,
    tax_total,
    discount_total,
    ...lockedCartRest
  } = lockedCart

  return {
    ...lockedCartRest,
    total: total as LockedCartMoneyAmount,
    subtotal: subtotal as LockedCartMoneyAmount,
    item_total: item_total as LockedCartMoneyAmount,
    shipping_total: shipping_total as LockedCartMoneyAmount,
    tax_total: tax_total as LockedCartMoneyAmount,
    discount_total: discount_total as LockedCartMoneyAmount,
    customer: projectLockedCartCustomer(lockedCart),
    region: catalog.region,
    items: (lockedCart.items ?? []).map((item) => {
      const variantId = asNonEmptyString(item.variant_id)

      return {
        id: item.id,
        quantity: item.quantity as number | null,
        title: item.title ?? null,
        product_title: item.product_title ?? null,
        variant_id: variantId,
        variant_title: item.variant_title ?? null,
        unit_price: item.unit_price as number | null,
        variant: variantId ? catalog.variantsById.get(variantId) ?? null : null,
      }
    }),
    shipping_address: lockedCart.shipping_address ?? null,
  }
}

async function readCartResourceVersion(
  req: SessionCapableRequest,
  cartId: string,
  sharedContext?: SharedTransactionContext
): Promise<number | null> {
  try {
    if (sharedContext) {
      const versionService = req.scope.resolve<StoreResourceVersionModuleService>(
        STORE_RESOURCE_VERSION_MODULE
      )
      const versionRow = await versionService.initialize(
        "cart",
        cartId,
        sharedContext
      )
      return versionRow.version
    }

    return await initializeCartResourceVersion(req, cartId)
  } catch {
    // A missing binding is safe only because Order authority rejects it
    // fail-closed. Production wiring supplies the resource-version module.
    return null
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

async function fetchPaymentCollectionForCart(
  req: SessionCapableRequest,
  cartId: string
): Promise<MedusaPaymentCollectionRecord | null> {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart_payment_collection",
    variables: {
      filters: {
        cart_id: cartId,
      },
    },
    fields: [
      "payment_collection.id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.amount",
      "payment_collection.payment_sessions.currency_code",
      "payment_collection.payment_sessions.data",
    ],
  })

  const [relation] = (await remoteQuery(queryObject)) as Array<{
    payment_collection?: MedusaPaymentCollectionRecord | null
  }>

  return relation?.payment_collection ?? null
}

async function ensurePaymentCollectionForCart(
  req: SessionCapableRequest,
  cartId: string,
  sharedContext?: SharedTransactionContext
): Promise<MedusaPaymentCollectionRecord & { id: string }> {
  const existing = await fetchPaymentCollectionForCart(req, cartId)
  const existingId = asNonEmptyString(existing?.id)

  if (existingId) {
    return {
      ...existing,
      id: existingId,
    }
  }

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE) as {
    run?: (
      workflowId: string,
      options: { input: { cart_id: string } },
      sharedContext?: SharedTransactionContext
    ) => Promise<unknown>
  }

  if (!workflowEngine || typeof workflowEngine.run !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao iniciar PaymentCollection Medusa."
    )
  }

  const workflowInput = {
    input: { cart_id: cartId },
  }
  if (sharedContext && workflowEngine.run.length >= 3) {
    await workflowEngine.run(
      createPaymentCollectionForCartWorkflowId,
      workflowInput,
      sharedContext
    )
  } else {
    await workflowEngine.run(createPaymentCollectionForCartWorkflowId, workflowInput)
  }

  const created = await fetchPaymentCollectionForCart(req, cartId)
  const createdId = asNonEmptyString(created?.id)

  if (!createdId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PaymentCollection Medusa nao foi associada ao cart."
    )
  }

  return {
    ...created,
    id: createdId,
  }
}

function resolvePaymentModule(req: SessionCapableRequest): PaymentModuleLike {
  try {
    return req.scope.resolve(Modules.PAYMENT) as PaymentModuleLike
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Modulo Payment Medusa indisponivel."
    )
  }
}

async function cancelProcessablePaymentSessions(
  paymentModule: PaymentModuleLike,
  paymentCollection: MedusaPaymentCollectionRecord,
  sharedContext?: SharedTransactionContext
): Promise<void> {
  const processableSessions = (paymentCollection.payment_sessions ?? []).filter(
    (session) => {
      const sessionId = asNonEmptyString(session.id)
      const status = asNonEmptyString(session.status)

      return (
        Boolean(sessionId) &&
        Boolean(status) &&
        PROCESSABLE_PAYMENT_SESSION_STATUSES.has(status as string)
      )
    }
  )

  if (!processableSessions.length) {
    return
  }

  if (typeof paymentModule.updatePaymentSessions !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao substituir PaymentSession Medusa anterior."
    )
  }

  const updates = processableSessions.map((session) => ({
    id: asNonEmptyString(session.id) as string,
    status: PaymentSessionStatus.CANCELED,
  }))
  if (sharedContext && paymentModule.updatePaymentSessions.length >= 3) {
    await paymentModule.updatePaymentSessions(updates, undefined, sharedContext)
  } else if (sharedContext && paymentModule.updatePaymentSessions.length >= 2) {
    await paymentModule.updatePaymentSessions(updates, sharedContext)
  } else {
    await paymentModule.updatePaymentSessions(updates)
  }
}

async function createMedusaCardPaymentSession(input: {
  req: SessionCapableRequest
  paymentCollection: MedusaPaymentCollectionRecord & { id: string }
  amountMajor: number
  currencyCode: "BRL"
  sharedContext?: SharedTransactionContext
}): Promise<{ payment_collection_id: string; payment_session_id: string }> {
  const paymentModule = resolvePaymentModule(input.req)

  if (typeof paymentModule.createPaymentSession !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao iniciar PaymentSession Medusa."
    )
  }

  await cancelProcessablePaymentSessions(
    paymentModule,
    input.paymentCollection,
    input.sharedContext
  )

  const sessionInput = {
    provider_id: MEDUSA_STRIPE_PROVIDER_ID,
    amount: input.amountMajor,
    currency_code: input.currencyCode.toLowerCase(),
    data: {},
  }
  const session =
    input.sharedContext && paymentModule.createPaymentSession.length >= 3
      ? await paymentModule.createPaymentSession(
          input.paymentCollection.id,
          sessionInput,
          input.sharedContext
        )
      : await paymentModule.createPaymentSession(
          input.paymentCollection.id,
          sessionInput
        )
  const sessionId = asNonEmptyString(session?.id)

  if (!sessionId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PaymentSession Medusa nao foi criada."
    )
  }

  return {
    payment_collection_id: input.paymentCollection.id,
    payment_session_id: sessionId,
  }
}

function buildSafeMedusaPaymentSessionData(
  result: {
    attempt: PaymentAttemptRecord
    paymentSessionData: Record<string, unknown>
  }
): Record<string, unknown> {
  const providerPaymentIntentId = result.attempt.provider_payment_intent_id

  if (!providerPaymentIntentId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PaymentIntent Stripe ausente na tentativa de pagamento."
    )
  }

  return {
    id: providerPaymentIntentId,
    ...result.paymentSessionData,
  }
}

async function updateMedusaPaymentSessionAfterStripeInitiation(
  req: SessionCapableRequest,
  result: {
    attempt: PaymentAttemptRecord
    paymentSessionData: Record<string, unknown>
  },
  sharedContext?: SharedTransactionContext
): Promise<void> {
  const paymentModule = resolvePaymentModule(req)

  if (typeof paymentModule.updatePaymentSessions !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao atualizar PaymentSession Medusa."
    )
  }

  const update = {
    id: result.attempt.payment_session_id as string,
    status: PaymentSessionStatus.PENDING,
    data: buildSafeMedusaPaymentSessionData(result),
  }
  try {
    if (sharedContext && paymentModule.updatePaymentSessions.length >= 3) {
      await paymentModule.updatePaymentSessions(update, undefined, sharedContext)
    } else if (sharedContext && paymentModule.updatePaymentSessions.length >= 2) {
      await paymentModule.updatePaymentSessions(update, sharedContext)
    } else {
      await paymentModule.updatePaymentSessions(update)
    }
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao finalizar tentativa de pagamento."
    )
  }
}

async function listExistingAttemptsForCart(
  req: SessionCapableRequest,
  cartId: string,
  sharedContext?: SharedTransactionContext
): Promise<PaymentAttemptRecord[]> {
  let service: PaymentAttemptModuleLike

  try {
    service = req.scope.resolve(
      PAYMENT_ATTEMPT_MODULE
    ) as PaymentAttemptModuleLike
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_LIST_ERROR_MESSAGE
    )
  }

  if (!service || typeof service.listPaymentAttempts !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_LIST_ERROR_MESSAGE
    )
  }

  try {
    const filters = { cart_id: cartId }
    if (sharedContext && service.listPaymentAttempts.length >= 3) {
      return (
        (await service.listPaymentAttempts(filters, undefined, sharedContext)) ??
        []
      )
    }
    if (sharedContext && service.listPaymentAttempts.length >= 2) {
      return (await service.listPaymentAttempts(filters, sharedContext)) ?? []
    }
    return (await service.listPaymentAttempts(filters)) ?? []
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_LIST_ERROR_MESSAGE
    )
  }
}

async function persistCardPaymentAttemptResult(
  req: SessionCapableRequest,
  result: Pick<
    PrepareCardPaymentAttemptResult,
    "invalidatedAttempts" | "supersededAttempts" | "attempt"
  >,
  sharedContext?: SharedTransactionContext
): Promise<void> {
  let service: PaymentAttemptModuleLike

  try {
    service = req.scope.resolve(PAYMENT_ATTEMPT_MODULE) as PaymentAttemptModuleLike
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao registrar tentativa de pagamento."
    )
  }

  if (!service || typeof service !== "object") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao registrar tentativa de pagamento."
    )
  }

  if (
    (result.supersededAttempts.length > 0 ||
      result.invalidatedAttempts.length > 0) &&
    typeof service.updatePaymentAttempts !== "function"
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao registrar tentativa de pagamento."
    )
  }

  if (typeof service.createPaymentAttempts !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao registrar tentativa de pagamento."
    )
  }

  try {
    for (const invalidated of result.invalidatedAttempts) {
      if (
        sharedContext &&
        service.updatePaymentAttempts &&
        service.updatePaymentAttempts.length >= 2
      ) {
        await service.updatePaymentAttempts(invalidated, sharedContext)
      } else {
        await service.updatePaymentAttempts?.(invalidated)
      }
    }

    for (const superseded of result.supersededAttempts) {
      if (
        sharedContext &&
        service.updatePaymentAttempts &&
        service.updatePaymentAttempts.length >= 2
      ) {
        await service.updatePaymentAttempts(superseded, sharedContext)
      } else {
        await service.updatePaymentAttempts?.(superseded)
      }
    }

    if (
      sharedContext &&
      service.createPaymentAttempts.length >= 2
    ) {
      await service.createPaymentAttempts(result.attempt, sharedContext)
    } else {
      await service.createPaymentAttempts(result.attempt)
    }
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao registrar tentativa de pagamento."
    )
  }
}

async function updateCardPaymentAttemptResult(
  req: SessionCapableRequest,
  attempt: PaymentAttemptRecord,
  sharedContext?: SharedTransactionContext
): Promise<void> {
  let service: PaymentAttemptModuleLike

  try {
    service = req.scope.resolve(PAYMENT_ATTEMPT_MODULE) as PaymentAttemptModuleLike
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao finalizar tentativa de pagamento."
    )
  }

  if (typeof service.updatePaymentAttempts !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao finalizar tentativa de pagamento."
    )
  }

  try {
    if (sharedContext && service.updatePaymentAttempts.length >= 2) {
      await service.updatePaymentAttempts(attempt, sharedContext)
    } else {
      await service.updatePaymentAttempts(attempt)
    }
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao finalizar tentativa de pagamento."
    )
  }
}

/**
 * Bind the provider object in its own committed local transaction. Payment
 * Session updates happen later and may involve another module; they must not
 * be able to roll back the only durable correlation between Stripe and this
 * PaymentAttempt.
 */
async function finalizeCardPaymentAttemptInTransaction(input: {
  request: SessionCapableRequest
  cartId: string
  actor: ReturnType<typeof resolvePaymentStartActor>
  prepared: PrepareCardPaymentAttemptResult
  rawIntent: Parameters<typeof finalizeCardPaymentAttempt>[0]["rawIntent"]
  sharedContext: SharedTransactionContext
}): Promise<Awaited<ReturnType<typeof finalizeCardPaymentAttempt>>> {
  const transaction = input.sharedContext.transactionManager.getTransactionContext?.()
  if (!transaction) {
    throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
  }

  await lockCartOrderAuthority(
    transaction as unknown as PaymentAttemptSqlTransaction,
    input.cartId
  )
  const lockedCart = await retrieveLockedCartInTransaction(
    input.request,
    input.cartId,
    input.sharedContext
  )
  const cart = await adaptLockedCartForPaymentPipeline(
    input.request,
    lockedCart
  )
  assertPostLockCartOwnership(
    cart,
    input.actor,
    input.request.session?.active_cart_id
  )
  await assertNoPendingCartReview(input.cartId, input.sharedContext)
  assertPaymentStartEligible({
    cart,
    actor: input.actor,
    paymentMethod: "card",
    sessionActiveCartId: input.request.session?.active_cart_id,
  })

  const currentAttempt = (await listExistingAttemptsForCart(
    input.request,
    input.cartId,
    input.sharedContext
  )).find((attempt) => attempt.id === input.prepared.attempt.id)
  if (!currentAttempt) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Tentativa de cartao nao esta mais disponivel."
    )
  }

  return finalizeCardPaymentAttempt({
    prepared: input.prepared,
    cart,
    actor: input.actor,
    sessionActiveCartId: input.request.session?.active_cart_id,
    currentAttempt,
    rawIntent: input.rawIntent,
  })
}

function resolvePaymentStartActor(req: SessionCapableRequest) {
  const identity = resolveActiveCartIdentity({
    auth_context: req.auth_context,
    session: req.session,
  })

  if (identity.actorType === "customer") {
    return {
      actorType: "customer" as const,
      actorId: identity.customerId,
      customerId: identity.customerId,
    }
  }

  return {
    actorType: "guest" as const,
    actorId: identity.sessionId ?? identity.actorId,
    sessionId: identity.sessionId,
  }
}

function assertPostLockCartOwnership(
  cart: StoreCartPreOrderRecord,
  actor: ReturnType<typeof resolvePaymentStartActor>,
  sessionActiveCartId?: string | null
): void {
  if (actor.actorType === "customer") {
    if (cart.customer?.id !== actor.customerId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Cart nao pertence ao cliente autenticado."
      )
    }
    return
  }

  if (cart.id !== sessionActiveCartId || Boolean(cart.customer?.id)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Cart nao pertence a sessao atual."
    )
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const request = req as SessionCapableRequest
  const cartId = request.params?.id

  if (!cartId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Cart id obrigatorio.")
  }

  rejectClientMoneyFields(request.body)

  const actor = resolvePaymentStartActor(request)
  const preparedOperation = await withCartPaymentTransaction(request, async (sharedContext) => {
    const transaction = sharedContext.transactionManager.getTransactionContext?.()
    if (!transaction) {
      throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
    }

    await lockCartOrderAuthority(
      transaction as unknown as PaymentAttemptSqlTransaction,
      cartId
    )
    const lockedCart = await retrieveLockedCartInTransaction(
      request,
      cartId,
      sharedContext
    )
    const cart = await adaptLockedCartForPaymentPipeline(
      request,
      lockedCart
    )
    assertPostLockCartOwnership(
      cart,
      actor,
      request.session?.active_cart_id
    )
    await assertNoPendingCartReview(cartId, sharedContext)
    const eligibility = assertPaymentStartEligible({
      cart,
      actor,
      paymentMethod: "card",
      sessionActiveCartId: request.session?.active_cart_id,
    })

    const existingAttempts = await listExistingAttemptsForCart(
      request,
      cartId,
      sharedContext
    )
    const cartResourceVersion = await readCartResourceVersion(
      request,
      cartId,
      sharedContext
    )
    const stripeLayer = await resolveStripeCardInitiationLayer(request)
    const cartFingerprint = resolvePaymentAttemptCartFingerprintFromStoreCart(cart)
    const reusableAttempt = findReusablePaymentAttempt(existingAttempts, {
      cartId,
      paymentMethodType: "card",
      cartFingerprint,
    })
    const paymentSession = reusableAttempt
      ? {
          payment_collection_id: reusableAttempt.payment_collection_id,
          payment_session_id: reusableAttempt.payment_session_id as string,
        }
      : await (async () => {
          const paymentCollection = await ensurePaymentCollectionForCart(
            request,
            cartId,
            sharedContext
          )
          return createMedusaCardPaymentSession({
            req: request,
            paymentCollection,
            amountMajor: eligibility.medusa_amount_major,
            currencyCode: eligibility.currency_code,
            sharedContext,
          })
        })()

    const prepared = prepareCardPaymentAttempt({
      cart,
      actor,
      sessionActiveCartId: request.session?.active_cart_id,
      existingAttempts,
      generateId: () => `payatt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      cartResourceVersion,
      paymentSession,
    })

    if (!existingAttempts.some((attempt) => attempt.id === prepared.attempt.id)) {
      await persistCardPaymentAttemptResult(request, prepared, sharedContext)
    }
    return { cart, prepared, stripeLayer }
  })

  const rawIntent = await initiateCardPaymentIntent({
    prepared: preparedOperation.prepared,
    cart: preparedOperation.cart,
    actor,
    sessionActiveCartId: request.session?.active_cart_id,
    stripeLayer: preparedOperation.stripeLayer,
  })

  await withCartPaymentTransaction(request, async (sharedContext) => {
    const paymentResult = await finalizeCardPaymentAttemptInTransaction({
      request,
      cartId,
      actor,
      prepared: preparedOperation.prepared,
      rawIntent,
      sharedContext,
    })
    await updateCardPaymentAttemptResult(
      request,
      paymentResult.attempt,
      sharedContext
    )
  })

  const result = await withCartPaymentTransaction(request, async (sharedContext) => {
    const paymentResult = await finalizeCardPaymentAttemptInTransaction({
      request,
      cartId,
      actor,
      prepared: preparedOperation.prepared,
      rawIntent,
      sharedContext,
    })
    await updateMedusaPaymentSessionAfterStripeInitiation(
      request,
      paymentResult,
      sharedContext
    )
    await updateCardPaymentAttemptResult(
      request,
      paymentResult.attempt,
      sharedContext
    )
    return paymentResult
  })

  res.status(201).json({
    payment_attempt: serializeCardPaymentAttemptResponse(result.response),
  })
}
