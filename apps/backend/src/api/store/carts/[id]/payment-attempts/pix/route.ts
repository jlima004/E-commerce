import { randomUUID } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { rejectClientMoneyFields } from "../../../payment-attempts/validators"
import type { StoreCartPreOrderRecord } from "../../../serializers"
import type { CatalogVariantInput } from "../../../../../../modules/catalog/types"
import {
  serializePixPaymentAttemptResponse,
  STRIPE_PIX_INITIATION_LAYER,
  startPixPaymentAttempt,
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
  baseRepository_?: {
    transaction<T>(
      callback: (transactionManager: TransactionalManagerLike) => Promise<T>
    ): Promise<T>
  }
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

type PgConnectionForPaymentTransaction = {
  transaction<T>(callback: (transaction: KnexLike) => Promise<T>): Promise<T>
}

function currentPaymentTransactionContext(
  transactionManager: TransactionalManagerLike
): SharedTransactionContext {
  return {
    __type: "MedusaContext",
    transactionManager,
    manager: transactionManager,
  }
}

function requirePaymentKnex(
  sharedContext: SharedTransactionContext
): KnexLike {
  const knex = sharedContext.transactionManager.getTransactionContext?.()
  if (!knex || typeof knex.raw !== "function") {
    throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
  }

  return knex
}

function paymentKnexRows(
  result: { rows?: Array<Record<string, unknown>> }
): Array<Record<string, unknown>> {
  return result.rows ?? []
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
  let cartModule: CartModuleForPaymentTransaction | undefined

  try {
    cartModule = req.scope.resolve(
      Modules.CART
    ) as CartModuleForPaymentTransaction
  } catch {
    cartModule = undefined
  }

  const cartTransaction = cartModule?.baseRepository_?.transaction
  if (typeof cartTransaction === "function") {
    return cartTransaction.call(
      cartModule?.baseRepository_,
      async (transactionManager) => {
        if (!transactionManager.getTransactionContext?.()) {
          throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
        }

        return callback(currentPaymentTransactionContext(transactionManager))
      }
    )
  }

  let pgConnection: PgConnectionForPaymentTransaction | undefined
  try {
    pgConnection = req.scope.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    ) as PgConnectionForPaymentTransaction
  } catch {
    pgConnection = undefined
  }

  if (typeof pgConnection?.transaction === "function") {
    return pgConnection.transaction(async (transaction) => {
      const transactionManager: TransactionalManagerLike = {
        getTransactionContext: () => transaction,
      }
      return callback(currentPaymentTransactionContext(transactionManager))
    })
  }

  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "Autoridade transacional do cart indisponivel."
  )
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

  if (
    typeof cartModule?.retrieveCart !== "function" ||
    typeof cartModule.baseRepository_?.transaction !== "function"
  ) {
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

async function hydrateLockedCartRegion(
  knex: KnexLike,
  regionId: string | null
): Promise<StoreCartPreOrderRecord["region"]> {
  if (!regionId) {
    return null
  }

  const result = await knex.raw(
    `
      select iso_2
      from region_country
      where region_id = ?
        and deleted_at is null
    `,
    [regionId]
  )

  return {
    countries: paymentKnexRows(result).map((row) => ({
      iso_2: asNonEmptyString(row.iso_2),
    })),
  }
}

function coerceLockedCartPriceAmount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const amount = Number(value)
    return Number.isFinite(amount) ? amount : undefined
  }

  return undefined
}

function parseLockedCartVariantMetadata(
  value: unknown
): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }

  return null
}

function mapLockedCartVariant(row: unknown): CatalogVariantInput | null {
  if (!row || typeof row !== "object") {
    return null
  }

  const variant = row as {
    id?: unknown
    sku?: unknown
    metadata?: unknown
    prices?: unknown
  }
  const id = asNonEmptyString(variant.id)
  if (!id) {
    return null
  }

  const prices = Array.isArray(variant.prices)
    ? variant.prices.flatMap((price) => {
        if (!price || typeof price !== "object") {
          return []
        }

        const currencyCode = asNonEmptyString(
          (price as { currency_code?: unknown }).currency_code
        )
        if (!currencyCode) {
          return []
        }

        const amount = coerceLockedCartPriceAmount(
          (price as { amount?: unknown }).amount
        )
        if (amount === undefined) {
          return []
        }

        return [
          {
            currency_code: currencyCode,
            amount,
          },
        ]
      })
    : undefined

  return {
    id,
    sku: asNonEmptyString(variant.sku) ?? undefined,
    metadata:
      variant.metadata && typeof variant.metadata === "object"
        ? (variant.metadata as Record<string, unknown>)
        : ((variant.metadata as CatalogVariantInput["metadata"]) ?? null),
    prices,
  }
}

async function hydrateLockedCartVariants(
  knex: KnexLike,
  variantIds: string[]
): Promise<Map<string, CatalogVariantInput>> {
  const variantsById = new Map<string, CatalogVariantInput>()
  if (variantIds.length === 0) {
    return variantsById
  }

  const placeholders = variantIds.map(() => "?").join(", ")
  const [variantResult, linkResult] = await Promise.all([
    knex.raw(
      `
        select id, sku, metadata
        from product_variant
        where id in (${placeholders})
          and deleted_at is null
      `,
      variantIds
    ),
    knex.raw(
      `
        select variant_id, price_set_id
        from product_variant_price_set
        where variant_id in (${placeholders})
          and deleted_at is null
      `,
      variantIds
    ),
  ])

  const variantRows = paymentKnexRows(variantResult)
  const linkRows = paymentKnexRows(linkResult)
  const priceSetIds = [
    ...new Set(
      linkRows
        .map((row) => asNonEmptyString(row.price_set_id))
        .filter((priceSetId): priceSetId is string => Boolean(priceSetId))
    ),
  ]

  const pricesByPriceSetId = new Map<
    string,
    Array<{ currency_code: string; amount: number }>
  >()
  if (priceSetIds.length > 0) {
    const pricePlaceholders = priceSetIds.map(() => "?").join(", ")
    const priceResult = await knex.raw(
      `
        select price_set_id, currency_code, amount
        from price
        where price_set_id in (${pricePlaceholders})
          and deleted_at is null
      `,
      priceSetIds
    )

    for (const row of paymentKnexRows(priceResult)) {
      const priceSetId = asNonEmptyString(row.price_set_id)
      const currencyCode = asNonEmptyString(row.currency_code)
      const amount = coerceLockedCartPriceAmount(row.amount)
      if (!priceSetId || !currencyCode || amount === undefined) {
        continue
      }

      const prices = pricesByPriceSetId.get(priceSetId) ?? []
      prices.push({ currency_code: currencyCode, amount })
      pricesByPriceSetId.set(priceSetId, prices)
    }
  }

  const pricesByVariantId = new Map<
    string,
    Array<{ currency_code: string; amount: number }>
  >()
  for (const row of linkRows) {
    const variantId = asNonEmptyString(row.variant_id)
    const priceSetId = asNonEmptyString(row.price_set_id)
    if (!variantId || !priceSetId) {
      continue
    }

    const linkedPrices = pricesByPriceSetId.get(priceSetId) ?? []
    const prices = pricesByVariantId.get(variantId) ?? []
    prices.push(...linkedPrices)
    pricesByVariantId.set(variantId, prices)
  }

  for (const row of variantRows) {
    const variantId = asNonEmptyString(row.id)
    if (!variantId) {
      continue
    }

    const variant = mapLockedCartVariant({
      id: variantId,
      sku: row.sku,
      metadata: parseLockedCartVariantMetadata(row.metadata),
      prices: pricesByVariantId.get(variantId) ?? [],
    })
    if (variant?.id) {
      variantsById.set(variant.id, variant)
    }
  }

  for (const variantId of variantIds) {
    if (!variantsById.has(variantId)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Catalogo de variantes indisponivel para iniciar pagamento."
      )
    }
  }

  return variantsById
}

type LockedCartMoneyAmount = number | null | undefined

async function adaptLockedCartForPaymentPipeline(
  lockedCart: LockedCartRecord,
  sharedContext: SharedTransactionContext
): Promise<StoreCartPreOrderRecord & { total?: number | null }> {
  const knex = requirePaymentKnex(sharedContext)
  const variantIds = [
    ...new Set(
      (lockedCart.items ?? [])
        .map((item) => asNonEmptyString(item.variant_id))
        .filter((variantId): variantId is string => Boolean(variantId))
    ),
  ]
  const [region, variantsById] = await Promise.all([
    hydrateLockedCartRegion(knex, asNonEmptyString(lockedCart.region_id)),
    hydrateLockedCartVariants(knex, variantIds),
  ])

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
    region,
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
        variant: variantId ? variantsById.get(variantId) ?? null : null,
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
  result: Awaited<ReturnType<typeof startPixPaymentAttempt>>,
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
  const result = await withCartPaymentTransaction(request, async (sharedContext) => {
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
      lockedCart,
      sharedContext
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

    const paymentResult = await startPixPaymentAttempt({
      cart,
      actor,
      sessionActiveCartId: request.session?.active_cart_id,
      existingAttempts,
      stripeLayer,
      generateId: () => `payatt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      cartResourceVersion,
      generatePaymentCollectionId: () =>
        `paycol_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    })

    await persistPixPaymentAttemptResult(request, paymentResult, sharedContext)
    return paymentResult
  })

  res.status(201).json({
    payment_attempt: serializePixPaymentAttemptResponse(result.response),
  })
}
