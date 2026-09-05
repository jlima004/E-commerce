import { randomUUID } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  PaymentSessionStatus,
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
  PAYMENT_ATTEMPT_CART_VERSION_UNBOUND,
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE,
  arbitratePreProviderPaymentAttempt,
  bindProviderPaymentIntentInTransaction,
  claimProviderDiscoveryInTransaction,
  isSameOperationReplayEligibleInTransaction,
  listUnresolvedFrozenPaymentAttemptsForCart,
  lockCartOrderAuthority,
  persistPreProviderFinancialFreezeInTransaction,
  PRE_PROVIDER_ARBITRATION_DECISION,
  readCartResourceVersionForUpdate,
  readDurablePreProviderAuthority,
  type DurablePreProviderAuthority,
  type PaymentAttemptSqlTransaction,
  type PreProviderArbitrationResult,
} from "../../../../../../modules/payment-attempt/transactional-authority"
import { buildPaymentAttemptProviderIdempotencyKey } from "../../../../../../modules/payment-attempt/durable-initiation"
import { RECONCILIATION_REASON_CODE } from "../../../../../../reconciliation/reason-codes"
import type {
  KnexLike,
  SharedTransactionContext,
  TransactionalManagerLike,
} from "../../../../../../infrastructure/store-foundation-transaction-compatibility"
import { resolvePaymentCartCatalog } from "../../../payment-catalog"
import { withCartModuleTransaction } from "../../../../../../workflows/cart/cart-transaction-boundary"
import {
  asNonEmptyString,
  ensurePaymentCollectionForCart,
  fetchPaymentCollectionForCart,
  type MedusaPaymentCollectionRecord,
} from "../medusa-payment-collection"
import { resolveProviderDiscoveryAfterAuthorityClaim } from "../../../../../../modules/payment-attempt/provider-discovery-resolve"

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

function getPaymentAttemptSqlTransaction(
  sharedContext: SharedTransactionContext
): PaymentAttemptSqlTransaction {
  const transaction = sharedContext.transactionManager.getTransactionContext?.()
  if (!transaction) {
    throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
  }
  return transaction as unknown as PaymentAttemptSqlTransaction
}

async function readCartResourceVersionFailClosed(
  transaction: PaymentAttemptSqlTransaction,
  cartId: string
): Promise<number> {
  const version = await readCartResourceVersionForUpdate(transaction, cartId)
  if (
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version <= 0
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_CART_VERSION_UNBOUND
    )
  }
  return version
}

function throwReconciliationRequired(reasonCode: string): never {
  throw new MedusaError(MedusaError.Types.CONFLICT, reasonCode)
}

function readPersistedCardClientSecretFromMedusaSession(
  authority: DurablePreProviderAuthority,
  paymentCollection: MedusaPaymentCollectionRecord | null | undefined
): string | null {
  const sessionId = asNonEmptyString(authority.attempt.payment_session_id)
  if (!sessionId) {
    return null
  }

  const session = paymentCollection?.payment_sessions?.find(
    (item) => asNonEmptyString(item.id) === sessionId
  )
  const data = session?.data
  if (!data || typeof data !== "object") {
    return null
  }

  return asNonEmptyString(data.client_secret)
}

async function resolveProviderDiscoveryForCard(input: {
  request: SessionCapableRequest
  cartId: string
  authority: DurablePreProviderAuthority
  stripeLayer: StripeCardInitiationLayer
}): Promise<Awaited<ReturnType<typeof initiateCardPaymentIntent>> | null> {
  const discoveryResult = await resolveProviderDiscoveryAfterAuthorityClaim({
    authority: input.authority,
    paymentMethodType: "card",
    stripeLayer: input.stripeLayer,
    claimDiscovery: () =>
      withCartPaymentTransaction(input.request, async (sharedContext) => {
        const transaction = getPaymentAttemptSqlTransaction(sharedContext)
        return claimProviderDiscoveryInTransaction(
          transaction,
          input.authority.attempt.id
        )
      }),
    rereadAuthority: () =>
      withCartPaymentTransaction(input.request, async (sharedContext) => {
        const transaction = getPaymentAttemptSqlTransaction(sharedContext)
        return readDurablePreProviderAuthority(
          transaction,
          input.authority.attempt.id
        )
      }),
    isReplayEligible: () =>
      withCartPaymentTransaction(input.request, async (sharedContext) =>
        isSameOperationReplayEligibleInTransaction(
          getPaymentAttemptSqlTransaction(sharedContext),
          input.authority.attempt.id
        )
      ),
    readClientSecretForBoundReuse: async () => {
      const paymentCollection = await fetchPaymentCollectionForCart(
        input.request,
        input.cartId
      )
      return readPersistedCardClientSecretFromMedusaSession(
        input.authority,
        paymentCollection
      )
    },
  })

  if (discoveryResult.outcome === "resolved") {
    return discoveryResult.payment_intent
  }

  return null
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

function assertDurableAuthorityMatchesCardRequest(input: {
  authority: DurablePreProviderAuthority
  cartId: string
  amountMinor: number
  cartResourceVersion: number
  paymentAttemptId: string
}): DurablePreProviderAuthority {
  const { authority } = input
  if (
    authority.payment_method_type !== "card" ||
    authority.currency_code !== "brl" ||
    authority.amount_minor !== input.amountMinor ||
    authority.attempt.cart_id !== input.cartId ||
    authority.attempt.id !== input.paymentAttemptId ||
    authority.cart_resource_version !== input.cartResourceVersion ||
    authority.financial_freeze_started_at == null ||
    authority.provider_idempotency_key !==
      buildPaymentAttemptProviderIdempotencyKey("card", input.paymentAttemptId)
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE
    )
  }
  return authority
}

async function resolveCardPaymentIntentAfterAuthority(input: {
  request: SessionCapableRequest
  cartId: string
  cart: StoreCartPreOrderRecord & { total?: number | null }
  actor: ReturnType<typeof resolvePaymentStartActor>
  prepared: PrepareCardPaymentAttemptResult
  authority: DurablePreProviderAuthority
  stripeLayer: StripeCardInitiationLayer
  decision: PreProviderArbitrationResult["decision"]
}): Promise<Awaited<ReturnType<typeof initiateCardPaymentIntent>>> {
  if (input.decision === PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED) {
    throwReconciliationRequired(
      RECONCILIATION_REASON_CODE.FROZEN_PAYMENT_AUTHORITY_MISMATCH
    )
  }

  if (
    input.decision === PRE_PROVIDER_ARBITRATION_DECISION.DISCOVER_SAME_OPERATION
  ) {
    const resolved = await resolveProviderDiscoveryForCard({
      request: input.request,
      cartId: input.cartId,
      authority: input.authority,
      stripeLayer: input.stripeLayer,
    })
    if (resolved) {
      return resolved
    }
  }

  if (input.decision === PRE_PROVIDER_ARBITRATION_DECISION.REUSE_SAME_OPERATION) {
    const replay = await withCartPaymentTransaction(
      input.request,
      async (sharedContext) =>
        isSameOperationReplayEligibleInTransaction(
          getPaymentAttemptSqlTransaction(sharedContext),
          input.authority.attempt.id
        )
    )
    if (!replay.eligible) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "REPLAY_DEADLINE_ELAPSED"
      )
    }
  }

  return initiateCardPaymentIntent({
    prepared: input.prepared,
    authority: input.authority,
    cart: input.cart,
    actor: input.actor,
    sessionActiveCartId: input.request.session?.active_cart_id,
    stripeLayer: input.stripeLayer,
  })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const request = req as SessionCapableRequest
  const cartId = request.params?.id

  if (!cartId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Cart id obrigatorio.")
  }

  rejectClientMoneyFields(request.body)

  const actor = resolvePaymentStartActor(request)
  const requestedAttemptId = asNonEmptyString(
    (request.body as { payment_attempt_id?: unknown } | undefined)
      ?.payment_attempt_id
  )

  const preparedOperation = await withCartPaymentTransaction(
    request,
    async (sharedContext) => {
      const transaction = getPaymentAttemptSqlTransaction(sharedContext)

      await lockCartOrderAuthority(transaction, cartId)
      const lockedCart = await retrieveLockedCartInTransaction(
        request,
        cartId,
        sharedContext
      )
      const cart = await adaptLockedCartForPaymentPipeline(request, lockedCart)
      assertPostLockCartOwnership(cart, actor, request.session?.active_cart_id)
      await assertNoPendingCartReview(cartId, sharedContext)
      const eligibility = assertPaymentStartEligible({
        cart,
        actor,
        paymentMethod: "card",
        sessionActiveCartId: request.session?.active_cart_id,
      })

      const cartResourceVersion = await readCartResourceVersionFailClosed(
        transaction,
        cartId
      )
      const frozen = await listUnresolvedFrozenPaymentAttemptsForCart(
        transaction,
        cartId
      )
      const arbitration = arbitratePreProviderPaymentAttempt(frozen, {
        cart_id: cartId,
        cart_resource_version: cartResourceVersion,
        payment_method_type: "card",
        amount_minor: eligibility.provider_amount_minor,
        currency_code: "brl",
        ...(requestedAttemptId
          ? { payment_attempt_id: requestedAttemptId }
          : {}),
      })

      if (
        arbitration.decision ===
        PRE_PROVIDER_ARBITRATION_DECISION.RECONCILIATION_REQUIRED
      ) {
        throwReconciliationRequired(arbitration.reason_code)
      }

      const stripeLayer = await resolveStripeCardInitiationLayer(request)

      if (
        arbitration.decision ===
          PRE_PROVIDER_ARBITRATION_DECISION.REUSE_SAME_OPERATION ||
        arbitration.decision ===
          PRE_PROVIDER_ARBITRATION_DECISION.DISCOVER_SAME_OPERATION
      ) {
        return {
          cart,
          eligibility,
          stripeLayer,
          decision: arbitration.decision,
          cartResourceVersion,
          prepared: {
            invalidatedAttempts: [],
            supersededAttempts: [],
            attempt: arbitration.attempt,
            idempotencyKey: buildPaymentAttemptProviderIdempotencyKey(
              "card",
              arbitration.attempt.id
            ),
          } satisfies PrepareCardPaymentAttemptResult,
        }
      }

      const existingAttempts = await listExistingAttemptsForCart(
        request,
        cartId,
        sharedContext
      )
      const paymentCollection = await ensurePaymentCollectionForCart(
        request,
        cartId,
        sharedContext
      )
      const paymentSession = await createMedusaCardPaymentSession({
        req: request,
        paymentCollection,
        amountMajor: eligibility.medusa_amount_major,
        currencyCode: eligibility.currency_code,
        sharedContext,
      })
      const prepared = prepareCardPaymentAttempt({
        cart,
        actor,
        sessionActiveCartId: request.session?.active_cart_id,
        existingAttempts,
        generateId: () => `payatt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        cartResourceVersion,
        paymentSession,
      })
      await persistCardPaymentAttemptResult(request, prepared, sharedContext)
      await persistPreProviderFinancialFreezeInTransaction(transaction, {
        cart_id: cartId,
        cart_resource_version: cartResourceVersion,
        payment_method_type: "card",
        amount_minor: eligibility.provider_amount_minor,
        currency_code: "brl",
        payment_attempt_id: prepared.attempt.id,
        payment_collection_id: paymentSession.payment_collection_id,
        payment_session_id: paymentSession.payment_session_id,
        idempotency_key: prepared.idempotencyKey,
      })

      return {
        cart,
        eligibility,
        stripeLayer,
        decision: arbitration.decision,
        cartResourceVersion,
        prepared,
      }
    }
  )

  const authority = await withCartPaymentTransaction(
    request,
    async (sharedContext) => {
      const transaction = getPaymentAttemptSqlTransaction(sharedContext)
      return readDurablePreProviderAuthority(
        transaction,
        preparedOperation.prepared.attempt.id
      )
    }
  )
  const durableAuthority = assertDurableAuthorityMatchesCardRequest({
    authority,
    cartId,
    amountMinor: preparedOperation.eligibility.provider_amount_minor,
    cartResourceVersion: preparedOperation.cartResourceVersion,
    paymentAttemptId: preparedOperation.prepared.attempt.id,
  })
  const preparedFromAuthority: PrepareCardPaymentAttemptResult = {
    ...preparedOperation.prepared,
    attempt: durableAuthority.attempt,
    idempotencyKey: durableAuthority.provider_idempotency_key,
  }

  const rawIntent = await resolveCardPaymentIntentAfterAuthority({
    request,
    cartId,
    cart: preparedOperation.cart,
    actor,
    prepared: preparedFromAuthority,
    authority: durableAuthority,
    stripeLayer: preparedOperation.stripeLayer,
    decision: preparedOperation.decision,
  })

  const result = await withCartPaymentTransaction(
    request,
    async (sharedContext) => {
      const transaction = getPaymentAttemptSqlTransaction(sharedContext)
      await bindProviderPaymentIntentInTransaction(transaction, {
        payment_attempt_id: durableAuthority.attempt.id,
        cart_id: cartId,
        cart_resource_version: durableAuthority.cart_resource_version,
        amount_minor: durableAuthority.amount_minor,
        currency_code: "brl",
        payment_method_type: "card",
        provider_payment_intent_id: String(rawIntent.id ?? ""),
        provider_payment_session_id:
          preparedFromAuthority.attempt.payment_session_id,
        idempotency_key: durableAuthority.provider_idempotency_key,
        payment_intent: rawIntent,
      })
      const paymentResult = await finalizeCardPaymentAttemptInTransaction({
        request,
        cartId,
        actor,
        prepared: preparedFromAuthority,
        rawIntent,
        sharedContext,
      })
      await updateCardPaymentAttemptResult(
        request,
        paymentResult.attempt,
        sharedContext
      )
      return paymentResult
    }
  )

  await withCartPaymentTransaction(request, async (sharedContext) => {
    await updateMedusaPaymentSessionAfterStripeInitiation(
      request,
      result,
      sharedContext
    )
  })

  res.status(201).json({
    payment_attempt: serializeCardPaymentAttemptResponse(result.response),
  })
}
