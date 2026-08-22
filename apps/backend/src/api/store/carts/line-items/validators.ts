import { MedusaError } from "@medusajs/framework/utils"
import { z } from "zod"
import { STORE_PUBLIC_FIELD_ERROR_MESSAGE } from "../../../store-surface/errors"

const LINE_ITEM_AUTHORITY_FIELDS = [
  "cart_id",
  "id",
  "unit_price",
  "price",
  "metadata",
  "guestCartToken",
] as const

export const AddCartLineItemBodySchema = z
  .object({
    variant_id: z.string().min(1),
    quantity: z.number().int().min(1).max(99),
  })
  .strict()

export const UpdateCartLineItemBodySchema = z
  .object({
    quantity: z.number().int().min(0).max(99),
  })
  .strict()

export type AddCartLineItemBody = z.infer<typeof AddCartLineItemBodySchema>
export type UpdateCartLineItemBody = z.infer<typeof UpdateCartLineItemBodySchema>

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invalidLineItemRequest(
  fieldErrors: Record<string, string> = {}
): MedusaError & { fieldErrors?: Record<string, string> } {
  const error = new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "Invalid cart line-item request"
  ) as MedusaError & { fieldErrors?: Record<string, string> }

  if (Object.keys(fieldErrors).length > 0) {
    error.fieldErrors = fieldErrors
  }

  return error
}

export function rejectLineItemAuthorityFields(body: unknown): void {
  if (!isPlainObject(body)) {
    return
  }

  const rejected = Object.keys(body).filter((key) =>
    (LINE_ITEM_AUTHORITY_FIELDS as readonly string[]).includes(key)
  )

  if (rejected.length === 0) {
    return
  }

  throw invalidLineItemRequest(
    Object.fromEntries(
      rejected.map((field) => [field, STORE_PUBLIC_FIELD_ERROR_MESSAGE])
    )
  )
}

function parseLineItemBody<T>(
  schema: z.ZodType<T>,
  body: unknown
): T {
  rejectLineItemAuthorityFields(body)
  const parsed = schema.safeParse(body ?? {})

  if (parsed.success) {
    return parsed.data
  }

  const fieldErrors: Record<string, string> = {}
  for (const issue of parsed.error.issues) {
    const field = issue.path[0]
    if (typeof field === "string") {
      fieldErrors[field] = STORE_PUBLIC_FIELD_ERROR_MESSAGE
    }
  }

  throw invalidLineItemRequest(fieldErrors)
}

export function parseAddCartLineItemBody(body: unknown): AddCartLineItemBody {
  return parseLineItemBody(AddCartLineItemBodySchema, body)
}

export function parseUpdateCartLineItemBody(
  body: unknown
): UpdateCartLineItemBody {
  return parseLineItemBody(UpdateCartLineItemBodySchema, body)
}
