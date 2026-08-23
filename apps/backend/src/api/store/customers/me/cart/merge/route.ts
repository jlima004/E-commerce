import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  serializeStoreCartPreOrder,
} from "../../../../carts/serializers"
import { formatCartEtag } from "../../../../carts/concurrency"
import {
  CART_MERGE_MODULE,
  type CartMergeModuleService,
} from "../../../../../../modules/cart-merge"
import {
  GUEST_CART_CAPABILITY_HEADER,
} from "../../../../../../modules/guest-cart-capability/types"
import { requireIfMatch } from "../../../../carts/concurrency"
import { assertValidRawIdempotencyKey } from "../../../../../../modules/store-idempotency"

type MergeRequest = MedusaRequest & {
  auth_context?: {
    actor_id?: unknown
    actor_type?: unknown
  }
  customerAuth?: { customerId?: string }
  customerAuthBff?: { authorized?: boolean }
  body?: Record<string, unknown>
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

function headerValue(req: MergeRequest, name: string): string | undefined {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()]
  if (Array.isArray(value)) return nonEmptyString(value[0])
  return nonEmptyString(value)
}

function requireCustomerId(req: MergeRequest): string {
  const customerId =
    nonEmptyString(req.customerAuth?.customerId) ??
    (req.auth_context?.actor_type === "customer"
      ? nonEmptyString(req.auth_context.actor_id)
      : undefined)
  if (!customerId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Customer authentication is required"
    )
  }
  return customerId
}

function requireGuestCartId(req: MergeRequest): string {
  const body = req.body ?? {}
  for (const forbidden of [
    "customerCartId",
    "customer_cart_id",
    "customerCartVersion",
    "customer_cart_version",
    "etag",
  ]) {
    if (Object.prototype.hasOwnProperty.call(body, forbidden)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Customer destination is server-authoritative"
      )
    }
  }
  const guestCartId = nonEmptyString(body.guestCartId ?? body.guest_cart_id)
  if (!guestCartId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "guestCartId is required"
    )
  }
  return guestCartId
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const request = req as MergeRequest
  if (request.customerAuthBff?.authorized !== true) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found")
  }

  const customerId = requireCustomerId(request)
  const guestCartId = requireGuestCartId(request)
  const presentedCapability = headerValue(
    request,
    GUEST_CART_CAPABILITY_HEADER
  )
  const rawIdempotencyKey = headerValue(request, "idempotency-key")
  if (!presentedCapability) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Presented guest capability is invalid"
    )
  }
  if (!rawIdempotencyKey) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Idempotency-Key header is required"
    )
  }
  assertValidRawIdempotencyKey(rawIdempotencyKey)
  const expectedGuestVersion = requireIfMatch(request)

  const service = request.scope.resolve<CartMergeModuleService>(
    CART_MERGE_MODULE
  )
  const result = await service.executeCartMerge({
    request,
    customerId,
    guestCartId,
    presentedCapability,
    rawIdempotencyKey,
    expectedGuestVersion,
  })

  res.setHeader("ETag", formatCartEtag(result.version))
  res.status(200).json({
    outcome: result.outcome,
    cart: serializeStoreCartPreOrder(result.cart),
    review: {
      requiresReview: false,
      reviewRef: null,
      rejectedItems: [],
    },
  })
}
