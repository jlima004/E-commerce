import {
  MedusaError,
  MedusaService,
  defineJoinerConfig,
  generateEntityId,
} from "@medusajs/framework/utils"
import type { SharedTransactionContext } from "../../infrastructure/store-foundation-transaction-compatibility"
import CustomerCartAuthority from "./models/customer-cart-authority"
import CartMergeResult from "./models/cart-merge-result"
import CartReview from "./models/cart-review"
import {
  CartMergeOrchestrator,
  type CartMergeExecutionInput,
  type CartMergeExecutionResult,
  type CartReviewAcknowledgeExecutionInput,
  type CartReviewAcknowledgeExecutionResult,
} from "../../workflows/cart-merge/orchestrator"

type CartMergeTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
}

export type CustomerCartAuthorityRow = {
  id: string
  customer_id: string
  cart_id: string
  state: "active" | "superseded"
}

export type CartMergeResultPersistenceInput = {
  id?: string
  idempotencyRecordId: string
  customerId: string
  guestCartId: string
  customerCartId: string | null
  canonicalCartId: string
  capabilityId: string
  capabilityHash: string | null
  requestFingerprint: string
  guestVersionBefore: number
  customerVersionBefore: number | null
  guestVersionAfter: number
  customerVersionAfter: number | null
  outcome: string
  rejectedItems: unknown
  reviewId: string | null
  reviewRef: string | null
  originalPublicCartSnapshot: unknown
  originalReviewSnapshot: unknown
  originalEtag: string
  expiresAt: Date
}

export type CartReviewPersistenceInput = {
  id: string
  cartId: string
  reviewRef: string
  mergeResultId: string
  producedCartVersion: number
  rejectedItems: unknown
}

const CART_MERGE_LINKABLE_KEYS = {
  customer_cart_authority_customer_id: "CustomerCartAuthority",
  customer_cart_authority_cart_id: "CustomerCartAuthority",
  cart_merge_result_idempotency_record_id: "CartMergeResult",
  cart_merge_result_customer_id: "CartMergeResult",
  cart_merge_result_guest_cart_id: "CartMergeResult",
  cart_merge_result_customer_cart_id: "CartMergeResult",
  cart_merge_result_canonical_cart_id: "CartMergeResult",
  cart_merge_result_capability_id: "CartMergeResult",
  cart_review_cart_id: "CartReview",
} as const

function requireTransaction(
  sharedContext?: SharedTransactionContext
): CartMergeTransaction {
  const transaction = sharedContext?.transactionManager?.getTransactionContext?.()
  if (!transaction || typeof transaction.raw !== "function") {
    throw new Error("CART_TRANSACTION_CONTEXT_UNAVAILABLE")
  }

  return transaction as CartMergeTransaction
}

function mapAuthorityRow(row: Record<string, unknown>): CustomerCartAuthorityRow {
  const id = typeof row.id === "string" ? row.id : ""
  const customerId =
    typeof row.customer_id === "string" ? row.customer_id : ""
  const cartId = typeof row.cart_id === "string" ? row.cart_id : ""
  const state = row.state === "superseded" ? "superseded" : "active"

  if (!id || !customerId || !cartId) {
    throw new Error("CUSTOMER_CART_AUTHORITY_CONFLICT")
  }

  return {
    id,
    customer_id: customerId,
    cart_id: cartId,
    state,
  }
}

function conflict(): never {
  throw Object.assign(
    new MedusaError(
      MedusaError.Types.CONFLICT,
      "CUSTOMER_CART_AUTHORITY_CONFLICT"
    ),
    {
      code: "CUSTOMER_CART_AUTHORITY_CONFLICT",
      statusCode: 409,
      status: 409,
    }
  )
}

/**
 * CartMerge owns only its three persistence models. Cross-module coordination
 * lives in workflows/cart-merge/orchestrator.ts; these methods are the public
 * authority boundary used by that coordinator and by the authority workflow.
 */
class CartMergeModuleService extends MedusaService({
  CustomerCartAuthority,
  CartMergeResult,
  CartReview,
}) {
  /**
   * Foreign identifiers remain immutable receipt data, while these explicit
   * linkable keys give Medusa's Link module a role-specific association for
   * each cross-module reference without introducing database foreign keys.
   */
  private __joinerConfig() {
    return defineJoinerConfig("cart_merge", {
      models: [CustomerCartAuthority, CartMergeResult, CartReview],
      linkableKeys: CART_MERGE_LINKABLE_KEYS,
    })
  }

  async listCustomerCartAuthoritiesForUpdate(
    customerId: string,
    sharedContext?: SharedTransactionContext
  ): Promise<CustomerCartAuthorityRow[]> {
    if (typeof customerId !== "string" || customerId.trim().length === 0) {
      conflict()
    }

    const transaction = requireTransaction(sharedContext)
    const result = await transaction.raw(
      `
        select id, customer_id, cart_id, state
        from customer_cart_authority
        where customer_id = ?
          and state = 'active'
          and deleted_at is null
        order by id
        limit 2
        for update
      `,
      [customerId]
    )

    return (result.rows ?? []).map(mapAuthorityRow)
  }

  async createCustomerCartAuthority(
    input: { customer_id: string; cart_id: string },
    sharedContext?: SharedTransactionContext
  ): Promise<CustomerCartAuthorityRow> {
    const customerId = input.customer_id?.trim()
    const cartId = input.cart_id?.trim()
    if (!customerId || !cartId) {
      conflict()
    }

    const transaction = requireTransaction(sharedContext)
    const id = generateEntityId(undefined, "ccauth")
    const result = await transaction.raw(
      `
        insert into customer_cart_authority (id, customer_id, cart_id, state)
        values (?, ?, ?, 'active')
        returning id, customer_id, cart_id, state
      `,
      [id, customerId, cartId]
    )

    const row = result.rows?.[0]
    return row ? mapAuthorityRow(row) : { id, customer_id: customerId, cart_id: cartId, state: "active" }
  }

  async supersedeCustomerCartAuthority(
    input: {
      authority_id: string
      customer_id: string
      cart_id: string
    },
    sharedContext?: SharedTransactionContext
  ): Promise<{ type: "superseded" | "already_superseded" }> {
    const authorityId = input.authority_id?.trim()
    const customerId = input.customer_id?.trim()
    const cartId = input.cart_id?.trim()
    if (!authorityId || !customerId || !cartId) {
      conflict()
    }

    const transaction = requireTransaction(sharedContext)
    const result = await transaction.raw(
      `
        select id, customer_id, cart_id, state
        from customer_cart_authority
        where id = ? and deleted_at is null
        for update
      `,
      [authorityId]
    )
    const row = result.rows?.[0]
    if (!row) {
      conflict()
    }

    const authority = mapAuthorityRow(row)
    if (
      authority.customer_id !== customerId ||
      authority.cart_id !== cartId
    ) {
      conflict()
    }
    if (authority.state === "superseded") {
      return { type: "already_superseded" }
    }

    const updated = await transaction.raw(
      `
        update customer_cart_authority
        set state = 'superseded', updated_at = now()
        where id = ?
          and customer_id = ?
          and cart_id = ?
          and state = 'active'
          and deleted_at is null
        returning id
      `,
      [authorityId, customerId, cartId]
    )
    if ((updated.rows ?? []).length !== 1) {
      conflict()
    }

    return { type: "superseded" }
  }

  async listCartMergeResultsForReplay(
    input: {
      customerId: string
      guestCartId: string
      capabilityHash: string
    },
    sharedContext?: SharedTransactionContext
  ): Promise<Array<Record<string, unknown>>> {
    const transaction = requireTransaction(sharedContext)
    const result = await transaction.raw(
      `
        select *
        from cart_merge_result
        where customer_id = ?
          and guest_cart_id = ?
          and capability_hash = ?
          and deleted_at is null
        order by created_at desc
        limit 5
      `,
      [input.customerId, input.guestCartId, input.capabilityHash]
    )
    return result.rows ?? []
  }

  async insertCartMergeResult(
    input: CartMergeResultPersistenceInput,
    sharedContext?: SharedTransactionContext
  ): Promise<string> {
    const transaction = requireTransaction(sharedContext)
    const id = input.id ?? generateEntityId(undefined, "cmres")
    await transaction.raw(
      `
        insert into cart_merge_result (
          id, idempotency_record_id, customer_id, guest_cart_id,
          customer_cart_id, canonical_cart_id, capability_id, capability_hash,
          request_fingerprint, guest_version_before, customer_version_before,
          guest_version_after, customer_version_after, outcome, rejected_items,
          review_id, review_ref, original_public_cart_snapshot,
          original_review_snapshot, original_etag, expires_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, cast(? as jsonb), ?, ?,
                  cast(? as jsonb), cast(? as jsonb), ?, ?)
      `,
      [
        id,
        input.idempotencyRecordId,
        input.customerId,
        input.guestCartId,
        input.customerCartId,
        input.canonicalCartId,
        input.capabilityId,
        input.capabilityHash,
        input.requestFingerprint,
        input.guestVersionBefore,
        input.customerVersionBefore,
        input.guestVersionAfter,
        input.customerVersionAfter,
        input.outcome,
        JSON.stringify(input.rejectedItems),
        input.reviewId,
        input.reviewRef,
        JSON.stringify(input.originalPublicCartSnapshot),
        JSON.stringify(input.originalReviewSnapshot),
        input.originalEtag,
        input.expiresAt.toISOString(),
      ]
    )
    return id
  }

  async insertCartReview(
    input: CartReviewPersistenceInput,
    sharedContext?: SharedTransactionContext
  ): Promise<void> {
    const transaction = requireTransaction(sharedContext)
    await transaction.raw(
      `
        insert into cart_review (
          id, cart_id, review_ref, merge_result_id, produced_cart_version,
          status, rejected_items
        ) values (?, ?, ?, ?, ?, 'pending', cast(? as jsonb))
      `,
      [
        input.id,
        input.cartId,
        input.reviewRef,
        input.mergeResultId,
        input.producedCartVersion,
        JSON.stringify(input.rejectedItems),
      ]
    )
  }

  async listCartReviewsForUpdate(
    cartId: string,
    sharedContext?: SharedTransactionContext
  ): Promise<Array<Record<string, unknown>>> {
    const transaction = requireTransaction(sharedContext)
    const result = await transaction.raw(
      `
        select id, cart_id, review_ref, merge_result_id,
               produced_cart_version, status, acknowledged_at
        from cart_review
        where cart_id = ? and deleted_at is null
        order by created_at desc, id desc
        for update
      `,
      [cartId]
    )
    return result.rows ?? []
  }

  async acknowledgeCartReviewRecord(
    reviewId: string,
    sharedContext?: SharedTransactionContext
  ): Promise<void> {
    const transaction = requireTransaction(sharedContext)
    await transaction.raw(
      `
        update cart_review
        set status = 'acknowledged', acknowledged_at = now(), updated_at = now()
        where id = ? and status = 'pending' and deleted_at is null
      `,
      [reviewId]
    )
  }

  /**
   * Compatibility facade for Store routes. Multi-module coordination is
   * implemented by the workflow orchestrator, never by this module service.
   */
  async executeCartMerge(
    input: CartMergeExecutionInput
  ): Promise<CartMergeExecutionResult> {
    return new CartMergeOrchestrator().executeCartMerge(input)
  }

  async acknowledgeCartReview(
    input: CartReviewAcknowledgeExecutionInput
  ): Promise<CartReviewAcknowledgeExecutionResult> {
    return new CartMergeOrchestrator().acknowledgeCartReview(input)
  }
}

export { CartMergeModuleService }
export default CartMergeModuleService
