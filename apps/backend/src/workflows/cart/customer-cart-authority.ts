import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  lockCustomerCartAuthority,
  type CustomerCartAuthorityTransaction,
} from "../../modules/cart-merge/authority-lock"
import { CART_MERGE_MODULE } from "../../modules/cart-merge/module-id"

type CustomerCartAuthorityRow = {
  id?: unknown
  customer_id?: unknown
  cart_id?: unknown
  state?: unknown
}

type CustomerCartAuthorityModule = {
  listCustomerCartAuthorities?: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<CustomerCartAuthorityRow[]>
  supersedeCustomerCartAuthority?: (input: {
    authority_id: string
    customer_id: string
    cart_id: string
  }) => Promise<unknown>
}

type CartModule = {
  retrieveCart?: (
    cartId: string,
    config?: { select?: string[]; relations?: string[] }
  ) => Promise<{
    id?: unknown
    customer_id?: unknown
    completed_at?: unknown
    deleted_at?: unknown
  } | null>
}

type PostgreSqlConnection = {
  transaction<T>(
    callback: (transaction: CustomerCartAuthorityTransaction) => Promise<T>
  ): Promise<T>
}

const TERMINAL_CART_SELECT = [
  "id",
  "customer_id",
  "completed_at",
  "deleted_at",
]

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

function isResolutionUnavailable(error: unknown): boolean {
  return error instanceof Error && /could not resolve|not registered/i.test(error.message)
}

function resolveOptional<T>(container: MedusaContainer, key: string): T | null {
  try {
    return container.resolve(key) as T
  } catch (error) {
    if (isResolutionUnavailable(error)) {
      return null
    }
    throw error
  }
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

/**
 * Repairs only the already-committed native Cart completion window.
 *
 * The Customer lock is held for the complete read/verify/supersede decision.
 * Cart is read through its public module service and the authority transition
 * is delegated to CartMerge's own generated model API; neither foreign table
 * SQL nor client-provided identifiers participate in the mutation.
 */
export async function reconcileTerminalCustomerCartAuthority(
  container: MedusaContainer,
  customerId: string
): Promise<boolean> {
  const authorityModule = resolveOptional<CustomerCartAuthorityModule>(
    container,
    CART_MERGE_MODULE
  )
  if (
    !authorityModule ||
    typeof authorityModule.listCustomerCartAuthorities !== "function" ||
    typeof authorityModule.supersedeCustomerCartAuthority !== "function"
  ) {
    return false
  }
  const listCustomerCartAuthorities =
    authorityModule.listCustomerCartAuthorities
  const supersedeCustomerCartAuthority =
    authorityModule.supersedeCustomerCartAuthority

  const connection = resolveOptional<PostgreSqlConnection>(
    container,
    ContainerRegistrationKeys.PG_CONNECTION
  )
  if (!connection || typeof connection.transaction !== "function") {
    throw new Error("CUSTOMER_CART_AUTHORITY_RECONCILIATION_UNAVAILABLE")
  }

  const cartModule = resolveOptional<CartModule>(container, Modules.CART)
  if (!cartModule || typeof cartModule.retrieveCart !== "function") {
    throw new Error("CUSTOMER_CART_AUTHORITY_RECONCILIATION_UNAVAILABLE")
  }
  const retrieveCart = cartModule.retrieveCart

  return connection.transaction(async (transaction) => {
    await lockCustomerCartAuthority(transaction, customerId)

    const authorities = await listCustomerCartAuthorities(
      { customer_id: customerId, state: "active" },
      { take: 2 }
    )
    const rows = authorities ?? []
    if (rows.length === 0) {
      return false
    }
    if (rows.length > 1) {
      conflict()
    }

    const authority = rows[0]
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

    let cart: Awaited<ReturnType<NonNullable<CartModule["retrieveCart"]>>>
    try {
      cart = await retrieveCart(authorityCartId, {
        select: TERMINAL_CART_SELECT,
      })
    } catch {
      conflict()
    }

    if (!cart) {
      conflict()
    }
    if (
      nonEmptyString(cart.id) !== authorityCartId ||
      nonEmptyString(cart.customer_id) !== customerId ||
      cart.deleted_at != null
    ) {
      conflict()
    }
    if (cart.completed_at == null) {
      return false
    }

    await supersedeCustomerCartAuthority({
      authority_id: authorityId,
      customer_id: customerId,
      cart_id: authorityCartId,
    })
    return true
  })
}
