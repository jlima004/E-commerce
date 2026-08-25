import { MedusaError } from "@medusajs/framework/utils"
import type {
  SharedTransactionContext,
  KnexLike,
} from "../../infrastructure/store-foundation-transaction-compatibility"

type CartReviewRow = {
  id: string
  cart_id: string
  review_ref: string
  merge_result_id: string
  produced_cart_version: number
  status: "pending" | "acknowledged"
  acknowledged_at: unknown
}

function rows(result: { rows?: Array<Record<string, unknown>> }): Array<Record<string, unknown>> {
  return result.rows ?? []
}

function throwReviewStateConflict(): never {
  throw Object.assign(
    new MedusaError(
      MedusaError.Types.CONFLICT,
      "Cart review state conflict"
    ),
    { code: "CART_REVIEW_STATE_CONFLICT", statusCode: 409, status: 409 }
  )
}

function throwReviewRequired(): never {
  throw Object.assign(
    new MedusaError(
      MedusaError.Types.CONFLICT,
      "Cart review must be acknowledged before this operation"
    ),
    { code: "REVIEW_REQUIRED", statusCode: 409, status: 409 }
  )
}

function reviewTransaction(
  sharedContext: SharedTransactionContext
): KnexLike {
  const transactionManager = sharedContext?.transactionManager
  const transaction = transactionManager?.getTransactionContext?.()
  if (!transaction) {
    throwReviewStateConflict()
  }
  return transaction
}

function mapCartReviewRow(
  row: Record<string, unknown>,
  cartIds: ReadonlySet<string>
): CartReviewRow {
  const id = typeof row.id === "string" ? row.id : ""
  const cartId = typeof row.cart_id === "string" ? row.cart_id : ""
  const reviewRef = typeof row.review_ref === "string" ? row.review_ref : ""
  const mergeResultId =
    typeof row.merge_result_id === "string" ? row.merge_result_id : ""
  const status = row.status
  const producedCartVersion = Number(row.produced_cart_version)
  const acknowledgedAt = row.acknowledged_at ?? null

  if (
    !id ||
    !cartIds.has(cartId) ||
    !reviewRef ||
    !mergeResultId ||
    (status !== "pending" && status !== "acknowledged") ||
    !Number.isSafeInteger(producedCartVersion) ||
    producedCartVersion <= 0 ||
    (status === "pending" && acknowledgedAt !== null) ||
    (status === "acknowledged" && acknowledgedAt === null)
  ) {
    throwReviewStateConflict()
  }

  return {
    id,
    cart_id: cartId,
    review_ref: reviewRef,
    merge_result_id: mergeResultId,
    produced_cart_version: producedCartVersion,
    status,
    acknowledged_at: acknowledgedAt,
  }
}

/**
 * Assert the PostgreSQL CartReview authority is clear for the supplied cart(s).
 *
 * This helper intentionally accepts only a transaction context. It does not
 * consult Cart metadata, session state, Redis, timestamps or a client review
 * projection. The CartReview rows are locked and validated before the pending
 * state is interpreted, so malformed or ambiguous authority fails closed.
 */
export async function assertNoPendingCartReview(
  cartIdsInput: string | readonly string[],
  sharedContext: SharedTransactionContext
): Promise<void> {
  const cartIds = [
    ...new Set(
      (typeof cartIdsInput === "string" ? [cartIdsInput] : cartIdsInput).map(
        (cartId) => (typeof cartId === "string" ? cartId.trim() : "")
      )
    ),
  ]

  if (cartIds.length === 0 || cartIds.some((cartId) => cartId.length === 0)) {
    throwReviewStateConflict()
  }

  const transaction = reviewTransaction(sharedContext)
  const bindings = cartIds.map(() => "?").join(", ")
  const result = await transaction.raw(
    `
      select id, cart_id, review_ref, merge_result_id,
             produced_cart_version, status, acknowledged_at
      from cart_review
      where cart_id in (${bindings})
        and deleted_at is null
      order by cart_id, id
      for update
    `,
    cartIds
  )

  const cartIdSet = new Set(cartIds)
  const reviews = rows(result).map((row) =>
    mapCartReviewRow(row, cartIdSet)
  )
  const seenReviewIds = new Set<string>()
  const pendingCartIds = new Set<string>()

  for (const review of reviews) {
    if (seenReviewIds.has(review.id)) {
      throwReviewStateConflict()
    }
    seenReviewIds.add(review.id)

    if (review.status === "pending") {
      if (pendingCartIds.has(review.cart_id)) {
        throwReviewStateConflict()
      }
      pendingCartIds.add(review.cart_id)
    }
  }

  if (pendingCartIds.size > 0) {
    throwReviewRequired()
  }
}

