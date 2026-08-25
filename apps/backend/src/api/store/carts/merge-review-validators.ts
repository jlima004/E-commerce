import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"

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
