import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { SharedTransactionContext } from "../../infrastructure/store-foundation-transaction-compatibility"
import {
  lockCustomerCartAuthority,
} from "../../modules/cart-merge/authority-lock"
import { CART_MERGE_MODULE } from "../../modules/cart-merge/module-id"
import type { CustomerCartAuthorityRow } from "../../modules/cart-merge/service"
import type { CanonicalCustomerCartAuthorityResult } from "../../modules/cart-merge/types"
import {
  withCartModuleTransaction,
  type CartTransactionSql,
} from "./cart-transaction-boundary"

export type CustomerCartAuthoritySqlTransaction = CartTransactionSql
export type CustomerCartAuthoritySharedContext = SharedTransactionContext

type CartAuthorityModule = {
  listCustomerCartAuthoritiesForUpdate?: (
    customerId: string,
    sharedContext: CustomerCartAuthoritySharedContext
  ) => Promise<CustomerCartAuthorityRow[]>
  listCustomerCartAuthorities?: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>,
    sharedContext?: CustomerCartAuthoritySharedContext
  ) => Promise<CustomerCartAuthorityRow[]>
  createCustomerCartAuthority?: (
    input: { customer_id: string; cart_id: string },
    sharedContext: CustomerCartAuthoritySharedContext
  ) => Promise<CustomerCartAuthorityRow>
  supersedeCustomerCartAuthority?: (
    input: {
      authority_id: string
      customer_id: string
      cart_id: string
    },
    sharedContext: CustomerCartAuthoritySharedContext
  ) => Promise<unknown>
}

type CartAuthorityProjection = {
  id?: unknown
  customer_id?: unknown
  completed_at?: unknown
  deleted_at?: unknown
  metadata?: unknown
}

type CartModule = {
  listCarts?: (
    filters?: Record<string, unknown>,
    config?: { select?: string[]; take?: number },
    sharedContext?: CustomerCartAuthoritySharedContext
  ) => Promise<CartAuthorityProjection[]>
  retrieveCart?: (
    cartId: string,
    config?: { select?: string[]; relations?: string[] },
    sharedContext?: CustomerCartAuthoritySharedContext
  ) => Promise<CartAuthorityProjection | null>
}

type LinkService = {
  create(
    input: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<unknown>
  list?(
    input: Record<string, unknown> | Array<Record<string, unknown>>
  ): Promise<unknown[]>
}

const TERMINAL_CART_SELECT = [
  "id",
  "customer_id",
  "completed_at",
  "deleted_at",
]

const AUTHORITY_CART_SELECT = [
  "id",
  "customer_id",
  "completed_at",
  "deleted_at",
  "metadata",
]

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function metadataAllowsCheckout(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return true
  }

  return (value as Record<string, unknown>).active_for_checkout !== false
}

function isUsableCustomerCart(
  cart: CartAuthorityProjection,
  customerId: string
): boolean {
  return (
    nonEmptyString(cart.id) !== null &&
    cart.customer_id === customerId &&
    cart.completed_at == null &&
    cart.deleted_at == null &&
    metadataAllowsCheckout(cart.metadata)
  )
}

function authorityResult(
  type: CanonicalCustomerCartAuthorityResult["type"],
  customerId: string,
  cartId?: string,
  authorityId?: string
): CanonicalCustomerCartAuthorityResult {
  if (type === "single" && cartId && authorityId) {
    return { type, customerId, cartId, authorityId }
  }

  return { type, customerId } as CanonicalCustomerCartAuthorityResult
}

function conflict(message = "CUSTOMER_CART_AUTHORITY_CONFLICT"): never {
  const error = new Error(message)
  Object.assign(error, {
    code: "CUSTOMER_CART_AUTHORITY_CONFLICT",
    statusCode: 409,
    status: 409,
  })
  throw error
}

function requireAuthorityModule(container: MedusaContainer): CartAuthorityModule {
  return container.resolve(CART_MERGE_MODULE) as CartAuthorityModule
}

function requireCartModule(container: MedusaContainer): CartModule {
  return container.resolve(Modules.CART) as CartModule
}

async function listAuthoritiesForUpdate(
  authorityModule: CartAuthorityModule,
  customerId: string,
  sharedContext: CustomerCartAuthoritySharedContext
): Promise<CustomerCartAuthorityRow[]> {
  if (typeof authorityModule.listCustomerCartAuthoritiesForUpdate === "function") {
    return authorityModule.listCustomerCartAuthoritiesForUpdate(
      customerId,
      sharedContext
    )
  }

  // Compatibility for narrow test doubles and pre-remediation harnesses. The
  // production CartMerge service always exposes the transaction-bound owner
  // method above.
  if (typeof authorityModule.listCustomerCartAuthorities === "function") {
    return authorityModule.listCustomerCartAuthorities(
      { customer_id: customerId, state: "active" },
      { take: 2 },
      sharedContext
    )
  }

  throw new Error("CUSTOMER_CART_AUTHORITY_RECONCILIATION_UNAVAILABLE")
}

async function createAuthority(
  authorityModule: CartAuthorityModule,
  customerId: string,
  cartId: string,
  sharedContext: CustomerCartAuthoritySharedContext
): Promise<CustomerCartAuthorityRow> {
  if (typeof authorityModule.createCustomerCartAuthority !== "function") {
    throw new Error("CUSTOMER_CART_AUTHORITY_MATERIALIZATION_UNAVAILABLE")
  }

  const authority = await authorityModule.createCustomerCartAuthority(
    { customer_id: customerId, cart_id: cartId },
    sharedContext
  )
  const authorityId = nonEmptyString(authority.id)
  if (!authorityId) {
    conflict()
  }
  return authority
}

/**
 * Materializes the two cross-module associations for a committed authority.
 * The CartMerge service owns the authority row; the Link service owns the
 * association and its own ORM transaction. Callers deliberately invoke this
 * only after the Cart transaction commits, so a rolled-back authority cannot
 * leave an orphan link row behind.
 */
export async function materializeCustomerCartAuthorityLinks(
  container: MedusaContainer,
  authority: CustomerCartAuthorityRow
): Promise<void> {
  const link = container.resolve(
    ContainerRegistrationKeys.LINK
  ) as LinkService | undefined
  if (!link || typeof link.create !== "function") {
    throw new Error("CUSTOMER_CART_AUTHORITY_LINK_UNAVAILABLE")
  }

  // The Link module owns a separate MikroORM metadata boundary. Reusing the
  // Cart transaction manager here makes LinkService hydrate LinkModel with
  // Cart metadata. Domain writes stay in the Cart transaction; the Link
  // module persists its own association rows with its own manager.
  const definitions = [
    {
      [CART_MERGE_MODULE]: {
        customer_cart_authority_customer_id: authority.id,
      },
      [Modules.CUSTOMER]: { customer_id: authority.customer_id },
    },
    {
      [CART_MERGE_MODULE]: {
        customer_cart_authority_cart_id: authority.id,
      },
      [Modules.CART]: { cart_id: authority.cart_id },
    },
  ]

  for (const definition of definitions) {
    await createLinkIdempotently(link, definition)
  }
}

async function createLinkIdempotently(
  link: LinkService,
  definition: Record<string, unknown>,
): Promise<void> {
  if (typeof link.list !== "function") {
    await link.create(definition)
    return
  }

  const existing = await link.list(definition)
  if (existing.length > 0) {
    return
  }

  try {
    await link.create(definition)
  } catch (error) {
    // Two post-commit retries can observe the gap at the same time. Treat a
    // subsequent exact match as success, but preserve a real one-to-one
    // conflict for a different target.
    const materialized = await link.list(definition)
    if (materialized.length === 0) {
      throw error
    }
  }
}

async function retrieveCustomerCart(
  cartModule: CartModule,
  cartId: string,
  sharedContext: CustomerCartAuthoritySharedContext
): Promise<CartAuthorityProjection | null> {
  if (typeof cartModule.retrieveCart !== "function") {
    throw new Error("CUSTOMER_CART_AUTHORITY_RECONCILIATION_UNAVAILABLE")
  }

  return cartModule.retrieveCart(
    cartId,
    { select: AUTHORITY_CART_SELECT },
    sharedContext
  )
}

/**
 * Resolves the Customer cart authority under one transaction and one
 * Customer-scope advisory lock. Cart is read through the public Cart module;
 * the authority table is accessed only by its owning CartMerge service.
 */
export async function resolveCanonicalCustomerCartAuthority(
  container: MedusaContainer,
  sharedContext: CustomerCartAuthoritySharedContext,
  customerId: string
): Promise<CanonicalCustomerCartAuthorityResult> {
  const authorityModule = requireAuthorityModule(container)
  const cartModule = requireCartModule(container)
  const transaction =
    sharedContext.transactionManager.getTransactionContext?.() as
      | CustomerCartAuthoritySqlTransaction
      | null
      | undefined
  if (!transaction || typeof transaction.raw !== "function") {
    throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
  }

  await lockCustomerCartAuthority(transaction, customerId)

  const authorities = await listAuthoritiesForUpdate(
    authorityModule,
    customerId,
    sharedContext
  )
  const carts =
    typeof cartModule.listCarts === "function"
      ? await cartModule.listCarts(
          { customer_id: customerId, completed_at: null },
          { select: AUTHORITY_CART_SELECT, take: 100 },
          sharedContext
        )
      : []
  const candidates = (carts ?? [])
    .filter((cart) => isUsableCustomerCart(cart, customerId))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))

  if (authorities.length > 1) {
    return authorityResult("conflict", customerId)
  }

  const authority = authorities[0]
  if (authority) {
    const authorityCartId = nonEmptyString(authority.cart_id)
    const authorityId = nonEmptyString(authority.id)
    if (!authorityCartId || !authorityId || authority.state !== "active") {
      return authorityResult("conflict", customerId)
    }

    // Re-read the pointed Cart through the public service after the candidate
    // query. This makes terminal/foreign/deleted pointer changes fail closed
    // without relying on private Cart SQL.
    const pointedCart = await retrieveCustomerCart(
      cartModule,
      authorityCartId,
      sharedContext
    )
    if (
      !pointedCart ||
      !isUsableCustomerCart(pointedCart, customerId) ||
      !candidates.some((candidate) => candidate.id === authorityCartId)
    ) {
      return authorityResult("conflict", customerId)
    }

    return authorityResult(
      "single",
      customerId,
      authorityCartId,
      authorityId
    )
  }

  if (candidates.length === 0) {
    return authorityResult("none", customerId)
  }
  if (candidates.length > 1) {
    return authorityResult("ambiguous", customerId)
  }

  const cartId = nonEmptyString(candidates[0]?.id)
  if (!cartId) {
    return authorityResult("conflict", customerId)
  }

  const newAuthority = await createAuthority(
    authorityModule,
    customerId,
    cartId,
    sharedContext
  )
  return authorityResult("single", customerId, cartId, newAuthority.id)
}

/**
 * Repairs only the already-committed native Cart completion window. The
 * advisory lock, Cart read and owner-module transition share one transaction.
 */
export async function reconcileTerminalCustomerCartAuthority(
  container: MedusaContainer,
  customerId: string
): Promise<boolean> {
  const authorityModule = requireAuthorityModule(container)
  const cartModule = requireCartModule(container)
  if (typeof cartModule.retrieveCart !== "function") {
    throw new Error("CUSTOMER_CART_AUTHORITY_RECONCILIATION_UNAVAILABLE")
  }
  const retrieveCart = cartModule.retrieveCart.bind(cartModule)

  return withCartModuleTransaction(container, async (transaction, _manager, sharedContext) => {
    await lockCustomerCartAuthority(transaction, customerId)
    const authorities = await listAuthoritiesForUpdate(
      authorityModule,
      customerId,
      sharedContext
    )
    if (authorities.length === 0) {
      return false
    }
    if (authorities.length > 1) {
      conflict()
    }

    const authority = authorities[0]
    const authorityId = nonEmptyString(authority.id)
    const authorityCustomerId = nonEmptyString(authority.customer_id)
    const authorityCartId = nonEmptyString(authority.cart_id)
    if (
      !authorityId ||
      !authorityCustomerId ||
      !authorityCartId ||
      authorityCustomerId !== customerId ||
      authority.state !== "active"
    ) {
      conflict()
    }

    let cart: CartAuthorityProjection | null
    try {
      cart = await retrieveCart(
        authorityCartId,
        { select: TERMINAL_CART_SELECT },
        sharedContext
      )
    } catch {
      conflict()
    }

    if (
      !cart ||
      nonEmptyString(cart.id) !== authorityCartId ||
      nonEmptyString(cart.customer_id) !== customerId ||
      cart.deleted_at != null
    ) {
      conflict()
    }
    if (cart.completed_at == null) {
      return false
    }

    if (typeof authorityModule.supersedeCustomerCartAuthority !== "function") {
      throw new Error("CUSTOMER_CART_AUTHORITY_RECONCILIATION_UNAVAILABLE")
    }
    await authorityModule.supersedeCustomerCartAuthority(
      {
        authority_id: authorityId,
        customer_id: customerId,
        cart_id: authorityCartId,
      },
      sharedContext
    )
    return true
  })
}
