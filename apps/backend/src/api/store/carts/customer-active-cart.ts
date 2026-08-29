import type { MedusaRequest } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  generateEntityId,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import { storeCartPreOrderFields } from "./query-config"
import type { StoreCartPreOrderRecord } from "./serializers"
import type { CanonicalCustomerCartAuthorityResult } from "../../../modules/cart-merge/types"
import {
  lockCustomerCartAuthority,
} from "../../../modules/cart-merge/authority-lock"
import {
  reconcileTerminalCustomerCartAuthority,
} from "../../../workflows/cart/customer-cart-authority"

const CUSTOMER_ACTIVE_CART_QUERY_FIELDS = storeCartPreOrderFields

export type CustomerCartAuthoritySqlTransaction = import("../../../modules/cart-merge/authority-lock").CustomerCartAuthorityTransaction

export type CustomerCartAuthoritySharedContext = {
  __type?: "MedusaContext"
  transactionManager?: {
    getTransactionContext?: () =>
      | CustomerCartAuthoritySqlTransaction
      | null
      | undefined
  }
  manager?: unknown
}

type CustomerCartAuthorityTransactionManager = {
  getTransactionContext?: () => CustomerCartAuthoritySqlTransaction | null
}

type CustomerCartModule = {
  baseRepository_?: {
    transaction<T>(
      callback: (manager: CustomerCartAuthorityTransactionManager) => Promise<T>
    ): Promise<T>
  }
}

type CustomerCartAuthorityTransactionInput = {
  authority: CanonicalCustomerCartAuthorityResult
  sharedContext: CustomerCartAuthoritySharedContext
  transactionContext: CustomerCartAuthoritySqlTransaction
  cartModule: CustomerCartModule | null
}

export const CUSTOMER_CART_AUTHORITY_CONFLICT =
  "CUSTOMER_CART_AUTHORITY_CONFLICT"

function rowsOf(
  result: { rows?: Array<Record<string, unknown>> }
): Array<Record<string, unknown>> {
  return result.rows ?? []
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function metadataAllowsCheckout(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return true
  }

  return (value as Record<string, unknown>).active_for_checkout !== false
}

function rowIsUsableCustomerCart(
  row: Record<string, unknown>,
  customerId: string
): boolean {
  return (
    stringValue(row.id) !== null &&
    row.customer_id === customerId &&
    row.completed_at == null &&
    row.deleted_at == null &&
    metadataAllowsCheckout(row.metadata)
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

function transactionFromSharedContext(
  sharedContext: CustomerCartAuthoritySharedContext
): CustomerCartAuthoritySqlTransaction {
  const transaction = sharedContext.transactionManager?.getTransactionContext?.()
  if (!transaction || typeof transaction.raw !== "function") {
    throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
  }

  return transaction
}

export { lockCustomerCartAuthority }

/** The existing /store/carts/active Customer eligibility rule. */
export function isActiveCartForCheckout(
  cart: StoreCartPreOrderRecord
): boolean {
  return !cart.completed_at && metadataAllowsCheckout(cart.metadata)
}

async function loadAuthorityForUpdate(
  transaction: CustomerCartAuthoritySqlTransaction,
  customerId: string
): Promise<Array<Record<string, unknown>>> {
  const result = await transaction.raw(
    `
      select id, customer_id, cart_id, state
      from customer_cart_authority
      where customer_id = ?
        and state = 'active'
        and deleted_at is null
      for update
    `,
    [customerId]
  )

  return rowsOf(result)
}

async function loadUsableCustomerCartsForUpdate(
  transaction: CustomerCartAuthoritySqlTransaction,
  customerId: string
): Promise<Array<Record<string, unknown>>> {
  const result = await transaction.raw(
    `
      select id, customer_id, completed_at, deleted_at, metadata
      from cart
      where customer_id = ?
        and completed_at is null
        and deleted_at is null
      order by id
      for update
    `,
    [customerId]
  )

  return rowsOf(result).filter((row) =>
    rowIsUsableCustomerCart(row, customerId)
  )
}

async function materializeCustomerCartAuthority(
  transaction: CustomerCartAuthoritySqlTransaction,
  customerId: string,
  cartId: string
): Promise<string> {
  const authorityId = generateEntityId(undefined, "ccauth")
  await transaction.raw(
    `
      insert into customer_cart_authority (id, customer_id, cart_id, state)
      values (?, ?, ?, 'active')
    `,
    [authorityId, customerId, cartId]
  )
  return authorityId
}

/** Resolve Customer authority under the caller's transaction. */
export async function resolveCanonicalCustomerCartAuthority(
  sharedContext: CustomerCartAuthoritySharedContext,
  customerId: string
): Promise<CanonicalCustomerCartAuthorityResult> {
  const transaction = transactionFromSharedContext(sharedContext)
  await lockCustomerCartAuthority(transaction, customerId)

  const authorities = await loadAuthorityForUpdate(transaction, customerId)
  const candidates = await loadUsableCustomerCartsForUpdate(
    transaction,
    customerId
  )

  if (authorities.length > 1) {
    return authorityResult("conflict", customerId)
  }

  const authority = authorities[0]
  if (authority) {
    const authorityCartId = stringValue(authority.cart_id)
    const authorityId = stringValue(authority.id)
    const matchingCandidate = candidates.find(
      (candidate) => candidate.id === authorityCartId
    )

    // Stale, inactive, completed, deleted or foreign pointers fail closed.
    if (!authorityCartId || !authorityId || !matchingCandidate) {
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

  const cartId = stringValue(candidates[0]?.id)
  if (!cartId) {
    return authorityResult("conflict", customerId)
  }

  const authorityId = await materializeCustomerCartAuthority(
    transaction,
    customerId,
    cartId
  )
  return authorityResult("single", customerId, cartId, authorityId)
}

/**
 * Opens the Cart transaction used by active/reuse/create and merge. The PG
 * fallback is only for narrow harnesses; production wiring uses Modules.CART.
 */
export async function withCustomerCartAuthorityTransaction<T>(
  req: MedusaRequest,
  customerId: string,
  callback: (input: CustomerCartAuthorityTransactionInput) => Promise<T>
): Promise<T> {
  // A native cart-completion workflow commits Cart.completed_at before the
  // authority row can be retired. Reconcile that narrow crash window before
  // resolving the next canonical cart. The helper only mutates an exact,
  // owned, terminal pointer and otherwise leaves fail-closed resolution intact.
  await reconcileTerminalCustomerCartAuthority(req.scope, customerId)

  let cartModule: CustomerCartModule | null = null
  try {
    cartModule = req.scope.resolve(Modules.CART) as CustomerCartModule
  } catch {
    cartModule = null
  }

  const resolvedCartModule = cartModule
  const repositoryTransaction = resolvedCartModule?.baseRepository_?.transaction
  if (typeof repositoryTransaction === "function") {
    return repositoryTransaction.call(
      resolvedCartModule?.baseRepository_,
      async (manager) => {
        const transactionContext = manager.getTransactionContext?.()
        if (!transactionContext) {
          throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
        }

        const sharedContext: CustomerCartAuthoritySharedContext = {
          __type: "MedusaContext",
          transactionManager: manager,
          manager,
        }
        const authority = await resolveCanonicalCustomerCartAuthority(
          sharedContext,
          customerId
        )
        return callback({
          authority,
          sharedContext,
          transactionContext,
          cartModule,
        })
      }
    )
  }

  const pgConnection = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as {
    transaction<TInner>(
      callback: (transaction: CustomerCartAuthoritySqlTransaction) => Promise<TInner>
    ): Promise<TInner>
  }
  return pgConnection.transaction(async (transaction) => {
    const transactionManager = {
      getTransactionContext: () => transaction,
    }
    const sharedContext: CustomerCartAuthoritySharedContext = {
      __type: "MedusaContext",
      transactionManager,
      manager: transaction,
    }
    const authority = await resolveCanonicalCustomerCartAuthority(
      sharedContext,
      customerId
    )
    return callback({
      authority,
      sharedContext,
      transactionContext: transaction,
      cartModule: null,
    })
  })
}

/** Legacy pure selector, now fail-closed and never timestamp-based. */
export function selectCanonicalCustomerActiveCart(
  carts: readonly StoreCartPreOrderRecord[]
): StoreCartPreOrderRecord | null {
  const activeCarts = carts.filter(isActiveCartForCheckout)
  return activeCarts.length === 1 ? activeCarts[0] : null
}

export async function listCustomerActiveCarts(
  req: MedusaRequest,
  customerId: string
): Promise<StoreCartPreOrderRecord[]> {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: {
      filters: {
        customer_id: customerId,
        completed_at: null,
      },
    },
    fields: [...CUSTOMER_ACTIVE_CART_QUERY_FIELDS],
  })

  const results = (await remoteQuery(queryObject)) as StoreCartPreOrderRecord[]
  return results.filter(isActiveCartForCheckout)
}

export async function resolveCanonicalCustomerActiveCart(
  req: MedusaRequest,
  customerId: string
): Promise<StoreCartPreOrderRecord | null> {
  const cartId = await withCustomerCartAuthorityTransaction(
    req,
    customerId,
    async ({ authority }) => {
      if (authority.type === "ambiguous" || authority.type === "conflict") {
        const error = new Error(CUSTOMER_CART_AUTHORITY_CONFLICT)
        Object.assign(error, {
          code: CUSTOMER_CART_AUTHORITY_CONFLICT,
          statusCode: 409,
          status: 409,
        })
        throw error
      }
      return authority.type === "single" ? authority.cartId : null
    }
  )

  if (!cartId) {
    return null
  }

  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: { filters: { id: cartId } },
    fields: [...CUSTOMER_ACTIVE_CART_QUERY_FIELDS],
  })
  const [cart] = (await remoteQuery(queryObject)) as StoreCartPreOrderRecord[]
  return cart && isActiveCartForCheckout(cart) ? cart : null
}
