import type { MedusaRequest } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import { storeCartPreOrderFields } from "./query-config"
import type { StoreCartPreOrderRecord } from "./serializers"
import type { CanonicalCustomerCartAuthorityResult } from "../../../modules/cart-merge/types"
import {
  materializeCustomerCartAuthorityLinks,
  reconcileTerminalCustomerCartAuthority,
  resolveCanonicalCustomerCartAuthority,
} from "../../../workflows/cart/customer-cart-authority"
import type { CustomerCartAuthorityRow } from "../../../modules/cart-merge/service"
export { resolveCanonicalCustomerCartAuthority } from "../../../workflows/cart/customer-cart-authority"

export type {
  CustomerCartAuthoritySharedContext,
  CustomerCartAuthoritySqlTransaction,
} from "../../../workflows/cart/customer-cart-authority"
import type {
  CustomerCartAuthoritySharedContext,
  CustomerCartAuthoritySqlTransaction,
} from "../../../workflows/cart/customer-cart-authority"
import { withCartModuleTransaction } from "../../../workflows/cart/cart-transaction-boundary"

const CUSTOMER_ACTIVE_CART_QUERY_FIELDS = storeCartPreOrderFields

export type CustomerCartAuthorityTransactionInput = {
  authority: CanonicalCustomerCartAuthorityResult
  sharedContext: CustomerCartAuthoritySharedContext
  transactionContext: CustomerCartAuthoritySqlTransaction
  registerAuthority: CustomerCartAuthorityRegistration
}

export type CustomerCartAuthorityRegistration = (
  authority: CanonicalCustomerCartAuthorityResult
) => void

export const CUSTOMER_CART_AUTHORITY_CONFLICT =
  "CUSTOMER_CART_AUTHORITY_CONFLICT"

function metadataAllowsCheckout(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return true
  }

  return (value as Record<string, unknown>).active_for_checkout !== false
}

/** The existing /store/carts/active Customer eligibility rule. */
export function isActiveCartForCheckout(
  cart: StoreCartPreOrderRecord
): boolean {
  return !cart.completed_at && metadataAllowsCheckout(cart.metadata)
}

/**
 * Opens the Cart transaction used by active/reuse/create and merge. The
 * framework transaction manager is passed to every owner method in the
 * transaction.
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

  let authorityForLinks: CustomerCartAuthorityRow | null = null
  const registerAuthority: CustomerCartAuthorityRegistration = (authority) => {
    if (authority.type !== "single") {
      return
    }
    authorityForLinks = {
      id: authority.authorityId,
      customer_id: authority.customerId,
      cart_id: authority.cartId,
      state: "active",
    }
  }

  const result = await withCartModuleTransaction(req.scope, async (transaction, _manager, sharedContext) => {
    const authority = await resolveCanonicalCustomerCartAuthority(
      req.scope,
      sharedContext as CustomerCartAuthoritySharedContext,
      customerId
    )
    registerAuthority(authority)
    return callback({
      authority,
      sharedContext: sharedContext as CustomerCartAuthoritySharedContext,
      transactionContext: transaction,
      registerAuthority,
    })
  })

  if (authorityForLinks) {
    await materializeCustomerCartAuthorityLinks(req.scope, authorityForLinks)
  }

  return result
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
