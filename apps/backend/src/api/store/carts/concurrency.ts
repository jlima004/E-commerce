import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaRequest } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  STORE_RESOURCE_VERSION_MODULE,
  type StoreResourceVersionModuleService,
  type StoreResourceVersionMutationContext,
} from "../../../modules/store-resource-version"
import {
  serializeStoreCartPreOrder,
  type PublicStoreCartPreOrder,
  type StoreCartPreOrderRecord,
} from "./serializers"

export function formatCartEtag(version: number): string {
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error("CART_VERSION_INVALID")
  }
  return `"${version}"`
}

export function parseIfMatchHeader(ifMatch: unknown): number | null {
  if (typeof ifMatch !== "string") {
    return null
  }
  const trimmed = ifMatch.trim()
  if (
    trimmed.length < 3 ||
    !trimmed.startsWith('"') ||
    !trimmed.endsWith('"') ||
    trimmed.startsWith("W/") ||
    trimmed.startsWith("w/")
  ) {
    return null
  }

  const unquoted = trimmed.slice(1, -1)
  if (!/^[1-9]\d*$/.test(unquoted)) {
    return null
  }

  const parsed = Number(unquoted)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

export function requireIfMatch(req: {
  headers: Record<string, unknown>
}): number {
  const headerValue = req.headers["if-match"] ?? req.headers["If-Match"]
  const parsed = parseIfMatchHeader(headerValue)
  if (parsed === null) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      'If-Match header is required and must be a quoted positive integer (e.g. "1")'
    )
  }
  return parsed
}

export class CartVersionMismatchError extends MedusaError {
  readonly code = "CART_VERSION_MISMATCH"
  readonly statusCode = 412
  readonly currentVersion: number
  readonly currentEtag: string
  readonly cart: PublicStoreCartPreOrder | null

  constructor(
    currentCart: StoreCartPreOrderRecord | PublicStoreCartPreOrder | null,
    currentVersion: number
  ) {
    super(MedusaError.Types.CONFLICT, "Cart version conflict")
    this.name = "CartVersionMismatchError"
    this.currentVersion = currentVersion
    this.currentEtag = formatCartEtag(currentVersion)
    this.cart =
      currentCart && "checkout_data_complete" in currentCart
        ? (currentCart as PublicStoreCartPreOrder)
        : serializeStoreCartPreOrder(currentCart as StoreCartPreOrderRecord | null)
  }
}

export async function initializeCartResourceVersion(
  req: MedusaRequest,
  cartId: string
): Promise<number> {
  const versionService = req.scope.resolve<StoreResourceVersionModuleService>(
    STORE_RESOURCE_VERSION_MODULE
  )
  const pgConnection = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as {
    transaction<T>(
      cb: (trx: {
        raw(
          sql: string,
          bindings?: unknown[]
        ): Promise<{ rows?: Array<Record<string, unknown>> }>
      }) => Promise<T>
    ): Promise<T>
  }

  return pgConnection.transaction(async (trx) => {
    const sharedContext: StoreResourceVersionMutationContext = {
      __type: "MedusaContext",
      transactionManager: {
        getTransactionContext: () => trx,
      },
    }
    const row = await versionService.initialize(
      "cart",
      cartId,
      sharedContext
    )
    return row.version
  })
}
