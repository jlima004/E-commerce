import type { MedusaRequest } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import { storeCartPreOrderFields } from "./query-config"
import type { StoreCartPreOrderRecord } from "./serializers"

const CUSTOMER_ACTIVE_CART_QUERY_FIELDS = storeCartPreOrderFields

function sortByUpdatedAtDesc(
  a: StoreCartPreOrderRecord,
  b: StoreCartPreOrderRecord
): number {
  return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
}

/** The existing /store/carts/active Customer eligibility rule. */
export function isActiveCartForCheckout(
  cart: StoreCartPreOrderRecord
): boolean {
  const metadata = cart.metadata

  return (
    !cart.completed_at &&
    (!metadata ||
      typeof metadata !== "object" ||
      Array.isArray(metadata) ||
      (metadata as Record<string, unknown>).active_for_checkout !== false)
  )
}

/** The single canonical Customer cart selector used by active GET/POST and mutations. */
export function selectCanonicalCustomerActiveCart(
  carts: readonly StoreCartPreOrderRecord[]
): StoreCartPreOrderRecord | null {
  return [...carts].filter(isActiveCartForCheckout).sort(sortByUpdatedAtDesc)[0] ?? null
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
  return selectCanonicalCustomerActiveCart(
    await listCustomerActiveCarts(req, customerId)
  )
}
