import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"
import { GUEST_CART_CAPABILITY_HEADER } from "../../../modules/guest-cart-capability/types"
import { assertValidRawIdempotencyKey } from "../../../modules/store-idempotency"

export const CartReviewAcknowledgeParamsSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict()

export const CartReviewAcknowledgeBodySchema = z
  .object({
    reviewRef: z.string().min(1).nullable(),
  })
  .strict()

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
  const body = req.body ?? {}
  const guestCartId = nonEmptyString(body.guestCartId ?? body.guest_cart_id)
  if (!guestCartId) {
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
