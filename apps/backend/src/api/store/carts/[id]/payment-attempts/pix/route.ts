import { randomUUID } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { rejectClientMoneyFields } from "../../../payment-attempts/validators"
import type { StoreCartPreOrderRecord } from "../../../serializers"
import {
  serializePixPaymentAttemptResponse,
  STRIPE_PIX_INITIATION_LAYER,
  finalizePixPaymentAttempt,
  initiatePixPaymentIntent,
  preparePixPaymentAttempt,
  type PreparePixPaymentAttemptResult,
  type StripePixInitiationLayer,
} from "../../../../../../modules/payment-attempt/pix"
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
  resolveStripePixInitiationLayer?: () =>
    Promise<StripePixInitiationLayer | null>
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

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
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

function isStripePixInitiationLayer(
  value: unknown
): value is StripePixInitiationLayer {
  return (
    Boolean(value) &&
    typeof (value as StripePixInitiationLayer).createPixPaymentIntent ===
      "function"
  )
}

async function resolveStripePixInitiationLayer(
  req: SessionCapableRequest
): Promise<StripePixInitiationLayer> {
  let layer: unknown

  try {
    layer = req.scope.resolve(STRIPE_PIX_INITIATION_LAYER)
  } catch {
    try {
      const service = req.scope.resolve(
        PAYMENT_ATTEMPT_MODULE
      ) as PaymentAttemptModuleLike
      layer = await service.resolveStripePixInitiationLayer?.()
    } catch {
      layer = null
    }
  }

  if (!isStripePixInitiationLayer(layer)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Camada Stripe para Pix nao configurada."
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

async function persistPixPaymentAttemptResult(
  req: SessionCapableRequest,
  result: Pick<
    PreparePixPaymentAttemptResult,
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

    if (sharedContext && service.createPaymentAttempts.length >= 2) {
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

async function updatePixPaymentAttemptResult(
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
 * Persist the provider binding before any later cross-module write. This
 * separate commit keeps a successful Pix initiation recoverable if the
 * PaymentAttempt finalization or another local operation fails afterwards.
 */
async function finalizePixPaymentAttemptInTransaction(input: {
  request: SessionCapableRequest
  cartId: string
  actor: ReturnType<typeof resolvePaymentStartActor>
  prepared: PreparePixPaymentAttemptResult
  rawIntent: Parameters<typeof finalizePixPaymentAttempt>[0]["rawIntent"]
  sharedContext: SharedTransactionContext
}): Promise<Awaited<ReturnType<typeof finalizePixPaymentAttempt>>> {
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
    paymentMethod: "pix",
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
      "Tentativa Pix nao esta mais disponivel."
    )
  }

  return finalizePixPaymentAttempt({
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
    assertPaymentStartEligible({
      cart,
      actor,
      paymentMethod: "pix",
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
    const stripeLayer = await resolveStripePixInitiationLayer(request)

    const prepared = preparePixPaymentAttempt({
      cart,
      actor,
      sessionActiveCartId: request.session?.active_cart_id,
      existingAttempts,
      generateId: () => `payatt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      cartResourceVersion,
      generatePaymentCollectionId: () =>
        `paycol_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      generatePaymentSessionId: () =>
        `payses_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    })

    if (!existingAttempts.some((attempt) => attempt.id === prepared.attempt.id)) {
      await persistPixPaymentAttemptResult(request, prepared, sharedContext)
    }
    return { cart, prepared, stripeLayer }
  })

  const rawIntent = await initiatePixPaymentIntent({
    prepared: preparedOperation.prepared,
    cart: preparedOperation.cart,
    actor,
    sessionActiveCartId: request.session?.active_cart_id,
    stripeLayer: preparedOperation.stripeLayer,
  })

  const result = await withCartPaymentTransaction(request, async (sharedContext) => {
    const paymentResult = await finalizePixPaymentAttemptInTransaction({
      request,
      cartId,
      actor,
      prepared: preparedOperation.prepared,
      rawIntent,
      sharedContext,
    })
    await updatePixPaymentAttemptResult(
      request,
      paymentResult.attempt,
      sharedContext
    )
    return paymentResult
  })

  res.status(201).json({
    payment_attempt: serializePixPaymentAttemptResponse(result.response),
  })
}
