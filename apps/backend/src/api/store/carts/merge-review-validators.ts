import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"
import { GUEST_CART_CAPABILITY_HEADER } from "../../../modules/guest-cart-capability/types"
import { assertValidRawIdempotencyKey } from "../../../modules/store-idempotency"
import {
  CART_MERGE_OUTCOMES,
  CART_MERGE_REJECTION_REASONS,
  type RejectedItem,
} from "../../../modules/cart-merge/types"
import type { PublicStoreCartPreOrder } from "./serializers"

export const CartReviewAcknowledgeParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict()

export const CartMergeRequestSchema = z
  .object({
    guestCartId: z
      .string()
      .min(1)
      .refine((value) => value.trim().length > 0),
  })
  .strict()

const cartMergeRejectedItemShape = {
  variantId: z.string().min(1),
  requestedQuantity: z.number().int().min(1),
  acceptedQuantity: z.number().int().min(0).max(99),
  rejectedQuantity: z.number().int().min(0),
  reason: z.enum(CART_MERGE_REJECTION_REASONS),
}

export const CartMergeRejectedItemSchema = z
  .object(cartMergeRejectedItemShape)
  .strict()
  .superRefine((item, context) => {
    if (item.acceptedQuantity > item.requestedQuantity) {
      context.addIssue({
        code: "custom",
        path: ["acceptedQuantity"],
        message: "acceptedQuantity cannot exceed requestedQuantity",
      })
    }

    if (
      item.acceptedQuantity + item.rejectedQuantity !==
      item.requestedQuantity
    ) {
      context.addIssue({
        code: "custom",
        path: ["rejectedQuantity"],
        message:
          "acceptedQuantity plus rejectedQuantity must equal requestedQuantity",
      })
    }
  })

export const CartReviewStateSchema = z
  .object({
    requiresReview: z.boolean(),
    reviewRef: z.string().min(1).nullable(),
    rejectedItems: z.array(CartMergeRejectedItemSchema),
  })
  .strict()
  .superRefine((review, context) => {
    if (!review.requiresReview && review.reviewRef !== null) {
      context.addIssue({
        code: "custom",
        path: ["reviewRef"],
        message: "A review reference requires a pending review",
      })
    }
  })

const publicStoreCartSchema = z.custom<PublicStoreCartPreOrder>()

export const CartMergeResponseSchema = z
  .object({
    outcome: z.enum(CART_MERGE_OUTCOMES),
    cart: publicStoreCartSchema.nullable(),
    review: CartReviewStateSchema,
  })
  .strict()
  .superRefine((response, context) => {
    const requiresReview = response.outcome === "MERGED_PARTIAL"
    if (response.review.requiresReview !== requiresReview) {
      context.addIssue({
        code: "custom",
        path: ["review", "requiresReview"],
        message: "requiresReview must match the MERGED_PARTIAL outcome",
      })
    }
  })

export const CartReviewAcknowledgeBodySchema = z
  .object({
    reviewRef: z.string().min(1).nullable(),
  })
  .strict()

export const CartReviewAcknowledgeResponseSchema = z
  .object({
    cart: publicStoreCartSchema.nullable(),
    review: CartReviewStateSchema,
  })
  .strict()

export type CartMergeRequest = z.infer<typeof CartMergeRequestSchema>
export type CartReviewAcknowledgeParams = z.infer<
  typeof CartReviewAcknowledgeParamsSchema
>

export type CartReviewAcknowledgeBody = z.infer<
  typeof CartReviewAcknowledgeBodySchema
>

export type CartMergeRequestLike = {
  auth_context?: {
    actor_id?: unknown
    actor_type?: unknown
  }
  customerAuth?: { customerId?: string }
  customerAuthBff?: { authorized?: boolean }
  body?: Record<string, unknown>
  headers: Record<string, unknown>
  session?: {
    id?: string
    active_cart_id?: string
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

function headerValue(req: CartMergeRequestLike, name: string): string | undefined {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()]
  if (Array.isArray(value)) return nonEmptyString(value[0])
  return nonEmptyString(value)
}

export function isAttachNewContractPresent(req: CartMergeRequestLike): boolean {
  if (!CartMergeRequestSchema.safeParse(req.body).success) {
    return false
  }

  if (req.customerAuthBff?.authorized !== true) {
    return false
  }

  if (!headerValue(req, GUEST_CART_CAPABILITY_HEADER)) {
    return false
  }

  if (!headerValue(req, "idempotency-key")) {
    return false
  }

  if (!headerValue(req, "if-match")) {
    return false
  }

  return true
}

export function parseCartMergeCustomerId(req: CartMergeRequestLike): string {
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

export function requireCustomerId(req: CartMergeRequestLike): string {
  return parseCartMergeCustomerId(req)
}

export function parseCartMergeBody(req: CartMergeRequestLike): string {
  return requireGuestCartId(req)
}

export function requireGuestCartId(req: CartMergeRequestLike): string {
  const parsed = CartMergeRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Invalid cart merge request"
    )
  }
  return parsed.data.guestCartId.trim()
}

export function parseCartMergePresentedHeaders(req: CartMergeRequestLike): {
  presentedCapability: string
  rawIdempotencyKey: string
} {
  const presentedCapability = headerValue(req, GUEST_CART_CAPABILITY_HEADER)
  if (!presentedCapability) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Presented guest capability is invalid"
    )
  }
  const rawIdempotencyKey = headerValue(req, "idempotency-key")
  if (!rawIdempotencyKey) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Idempotency-Key header is required"
    )
  }
  assertValidRawIdempotencyKey(rawIdempotencyKey)
  return { presentedCapability, rawIdempotencyKey }
}

function invalidAcknowledgeRequest(): MedusaError {
  return new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "Invalid cart review acknowledge request"
  )
}

export function parseCartReviewAcknowledgeParams(
  value: unknown
): CartReviewAcknowledgeParams {
  const parsed = CartReviewAcknowledgeParamsSchema.safeParse(value)
  if (!parsed.success) {
    throw invalidAcknowledgeRequest()
  }
  return parsed.data
}

export function parseCartReviewAcknowledgeBody(
  value: unknown
): CartReviewAcknowledgeBody {
  const parsed = CartReviewAcknowledgeBodySchema.safeParse(value)
  if (!parsed.success) {
    throw invalidAcknowledgeRequest()
  }
  return parsed.data
}
