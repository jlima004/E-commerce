import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  serializeStoreCartPreOrder,
} from "../../../../carts/serializers"
import { formatCartEtag, requireIfMatch } from "../../../../carts/concurrency"
import {
  CART_MERGE_MODULE,
  type CartMergeModuleService,
} from "../../../../../../modules/cart-merge"
import {
  parseCartMergeBody,
  parseCartMergeCustomerId,
  parseCartMergePresentedHeaders,
  type CartMergeRequestLike,
} from "../../../../carts/merge-review-validators"

type MergeRequest = MedusaRequest &
  CartMergeRequestLike & {
    customerAuthBff?: { authorized?: boolean }
  }

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const request = req as MergeRequest
  if (request.customerAuthBff?.authorized !== true) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Not Found")
  }

  const customerId = parseCartMergeCustomerId(request)
  const guestCartId = parseCartMergeBody(request)
  const { presentedCapability, rawIdempotencyKey } =
    parseCartMergePresentedHeaders(request)
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

  res.setHeader("Cache-Control", "no-store")
  res.setHeader("ETag", formatCartEtag(result.version))
  res.status(200).json({
    outcome: result.outcome,
    cart: serializeStoreCartPreOrder(result.cart),
    review: {
      requiresReview: result.review.requiresReview,
      reviewRef: result.review.reviewRef,
      rejectedItems: result.review.rejectedItems,
    },
  })
}
