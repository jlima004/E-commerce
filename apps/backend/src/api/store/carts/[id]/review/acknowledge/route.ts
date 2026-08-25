import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  formatCartEtag,
  requireIfMatch,
} from "../../../concurrency"
import {
  serializeCartReviewAcknowledgeResponse,
} from "../../../serializers"
import {
  CART_MERGE_MODULE,
  type CartMergeModuleService,
} from "../../../../../../modules/cart-merge"
import {
  GUEST_CART_CAPABILITY_HEADER,
} from "../../../../../../modules/guest-cart-capability/types"
import {
  parseCartReviewAcknowledgeBody,
  parseCartReviewAcknowledgeParams,
  type CartReviewAcknowledgeBody,
} from "../../../merge-review-validators"

type CartReviewAcknowledgeRequest = MedusaRequest & {
  params?: unknown
  body?: unknown
  auth_context?: {
    actor_id?: unknown
    actor_type?: unknown
  }
  customerAuth?: { customerId?: unknown }
  customerAuthBff?: { authorized?: boolean }
}

function hasHeader(
  request: CartReviewAcknowledgeRequest,
  headerName: string
): boolean {
  return Object.keys(request.headers ?? {}).some(
    (key) => key.toLowerCase() === headerName.toLowerCase()
  )
}

function rejectForbiddenHeaders(
  request: CartReviewAcknowledgeRequest
): void {
  if (hasHeader(request, GUEST_CART_CAPABILITY_HEADER)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Guest cart capability is not accepted"
    )
  }

  if (hasHeader(request, "idempotency-key")) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Idempotency-Key is not accepted"
    )
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

function requireCustomerId(request: CartReviewAcknowledgeRequest): string {
  const actorCustomerId =
    request.auth_context?.actor_type === "customer"
      ? nonEmptyString(request.auth_context.actor_id)
      : undefined
  const resolvedCustomerId = nonEmptyString(
    request.customerAuth?.customerId
  )

  if (actorCustomerId && resolvedCustomerId && actorCustomerId !== resolvedCustomerId) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found")
  }

  const customerId = actorCustomerId ?? resolvedCustomerId
  if (!customerId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Customer authentication is required"
    )
  }
  return customerId
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const request = req as CartReviewAcknowledgeRequest
  if (request.customerAuthBff?.authorized !== true) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found")
  }

  const { id: cartId } = parseCartReviewAcknowledgeParams(request.params)
  rejectForbiddenHeaders(request)
  const customerId = requireCustomerId(request)
  const expectedVersion = requireIfMatch(request)
  const { reviewRef }: CartReviewAcknowledgeBody =
    parseCartReviewAcknowledgeBody(request.body)

  const service = request.scope.resolve<CartMergeModuleService>(
    CART_MERGE_MODULE
  )
  const result = await service.acknowledgeCartReview({
    request,
    cartId,
    customerId,
    reviewRef,
    expectedVersion,
  })

  res.setHeader("Cache-Control", "no-store")
  res.setHeader("ETag", formatCartEtag(result.version))
  res.status(200).json(
    serializeCartReviewAcknowledgeResponse({
      cart: result.cart,
      review: result.review,
    })
  )
}
