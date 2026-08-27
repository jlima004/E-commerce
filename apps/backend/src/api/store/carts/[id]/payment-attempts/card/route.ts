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
import type { CatalogVariantInput } from "../../../../../../modules/catalog/types"
import {
  serializeCardPaymentAttemptResponse,
  STRIPE_CARD_INITIATION_LAYER,
  startCardPaymentAttempt,
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
  createPaymentSession_?: (
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
const MEDUSA_STRIPE_PROVIDER_ID = "pp_stripe_stripe"
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

  return {
    ...lockedCart,
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

  if (typeof paymentModule.createPaymentSession_ !== "function") {
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
    input.sharedContext && paymentModule.createPaymentSession_.length >= 3
      ? await paymentModule.createPaymentSession_(
          input.paymentCollection.id,
          sessionInput,
          input.sharedContext
        )
      : await paymentModule.createPaymentSession_(
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
  result: Awaited<ReturnType<typeof startCardPaymentAttempt>>
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
  result: Awaited<ReturnType<typeof startCardPaymentAttempt>>,
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
  if (sharedContext && paymentModule.updatePaymentSessions.length >= 3) {
    await paymentModule.updatePaymentSessions(update, undefined, sharedContext)
  } else if (sharedContext && paymentModule.updatePaymentSessions.length >= 2) {
    await paymentModule.updatePaymentSessions(update, sharedContext)
  } else {
    await paymentModule.updatePaymentSessions(update)
  }
}

async function cancelMedusaPaymentSession(
  req: SessionCapableRequest,
  paymentSessionId: string,
  sharedContext?: SharedTransactionContext
): Promise<void> {
  try {
    const paymentModule = resolvePaymentModule(req)
    const update = {
      id: paymentSessionId,
      status: PaymentSessionStatus.CANCELED,
    }
    if (
      sharedContext &&
      paymentModule.updatePaymentSessions &&
      paymentModule.updatePaymentSessions.length >= 3
    ) {
      await paymentModule.updatePaymentSessions(update, undefined, sharedContext)
    } else if (
      sharedContext &&
      paymentModule.updatePaymentSessions &&
      paymentModule.updatePaymentSessions.length >= 2
    ) {
      await paymentModule.updatePaymentSessions(update, sharedContext)
    } else {
      await paymentModule.updatePaymentSessions?.(update)
    }
  } catch {
    return
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
  result: Awaited<ReturnType<typeof startCardPaymentAttempt>>,
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

    let paymentResult: Awaited<ReturnType<typeof startCardPaymentAttempt>>

    try {
      paymentResult = await startCardPaymentAttempt({
        cart,
        actor,
        sessionActiveCartId: request.session?.active_cart_id,
        existingAttempts,
        stripeLayer,
        generateId: () => `payatt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        cartResourceVersion,
        paymentSession,
      })

      await updateMedusaPaymentSessionAfterStripeInitiation(
        request,
        paymentResult,
        sharedContext
      )
    } catch (error) {
      await cancelMedusaPaymentSession(
        request,
        paymentSession.payment_session_id,
        sharedContext
      )
      throw error
    }

    await persistCardPaymentAttemptResult(request, paymentResult, sharedContext)
    return paymentResult
  })

  res.status(201).json({
    payment_attempt: serializeCardPaymentAttemptResponse(result.response),
  })
}
