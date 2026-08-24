import {
  CART_MERGE_MAX_QUANTITY,
  buildCartMergeDecision,
  normalizeGuestIntent,
} from "../decision"
import {
  CART_MERGE_OUTCOMES,
  CART_MERGE_REJECTION_REASONS,
  CartMergeStateConflictError,
  type CartMergeDecisionInput,
  type CartReviewState,
  type RejectedItem,
} from "../types"
import {
  serializeCartMergeRejectedItem,
  serializeCartMergeResponse,
  serializeCartReviewAcknowledgeResponse,
  serializeCartReviewState,
} from "../../../api/store/carts/serializers"

function guestCart(items: CartMergeDecisionInput["guestItems"] = []) {
  return { items }
}

function customerCart(items: CartMergeDecisionInput["customerItems"] = []) {
  return { items }
}

function publicCart() {
  return {
    id: "cart_public_01",
    email: "customer@example.test",
    currency_code: "brl",
    locale: "pt-BR",
    total: 100,
    subtotal: 100,
    item_total: 100,
    shipping_total: 0,
    tax_total: 0,
    discount_total: 0,
    region_id: "reg_br",
    created_at: "2026-08-24T12:00:00.000Z",
    updated_at: "2026-08-24T12:00:01.000Z",
    checkout_data_complete: false,
    customer: {
      id: "cus_public_01",
      email: "customer@example.test",
    },
    items: [],
    shipping_address: null,
  }
}

describe("Phase 16 cart merge decision engine", () => {
  it("fecha exatamente os cinco outcomes e os três rejection reasons", () => {
    expect(CART_MERGE_OUTCOMES).toEqual([
      "MERGED",
      "MERGED_PARTIAL",
      "GUEST_CART_ATTACHED",
      "CUSTOMER_CART_PRESERVED",
      "NO_ITEMS",
    ])
    expect(CART_MERGE_REJECTION_REASONS).toEqual([
      "VARIANT_INVALID",
      "VARIANT_UNAVAILABLE",
      "QUANTITY_LIMIT_EXCEEDED",
    ])
  })

  it("agrega duplicatas guest por variantId e ordena pelo identificador público", () => {
    expect(
      normalizeGuestIntent([
        { variant_id: "variant_b", quantity: 2 },
        { variantId: "variant_a", quantity: 3 },
        { variant_id: "variant_a", quantity: 4 },
      ])
    ).toEqual([
      { variantId: "variant_a", quantity: 7 },
      { variantId: "variant_b", quantity: 2 },
    ])
  })

  it("falha com conflito 409 para linha persisted sem variantId seguro", () => {
    expect(() => normalizeGuestIntent([{ quantity: 1 }])).toThrow(
      CartMergeStateConflictError
    )
    try {
      normalizeGuestIntent([{ quantity: 1 }])
    } catch (error) {
      expect(error).toMatchObject({
        code: "CART_MERGE_STATE_CONFLICT",
        statusCode: 409,
        status: 409,
      })
    }
  })

  it("aplica o teto 99 sem reduzir Customer e localiza o overflow", () => {
    const decision = buildCartMergeDecision({
      guestCart: guestCart([{ variantId: "variant_a", quantity: 30 }]),
      customerCart: customerCart([{ variantId: "variant_a", quantity: 80 }]),
    })

    expect(CART_MERGE_MAX_QUANTITY).toBe(99)
    expect(decision.outcome).toBe("MERGED_PARTIAL")
    expect(decision.decisions).toEqual([
      {
        variantId: "variant_a",
        requestedQuantity: 30,
        acceptedQuantity: 19,
        rejectedQuantity: 11,
        customerQuantityBefore: 80,
        customerQuantityAfter: 99,
        reason: "QUANTITY_LIMIT_EXCEEDED",
      },
    ])
    expect(decision.rejectedItems).toEqual([
      {
        variantId: "variant_a",
        requestedQuantity: 30,
        acceptedQuantity: 19,
        rejectedQuantity: 11,
        reason: "QUANTITY_LIMIT_EXCEEDED",
      },
    ])
    expect(decision.review).toEqual({
      requiresReview: true,
      reviewRef: null,
      rejectedItems: decision.rejectedItems,
    })
  })

  it("retorna MERGED para Customer vazio, que continua sendo destino", () => {
    const decision = buildCartMergeDecision({
      guestCart: guestCart([{ variantId: "variant_a", quantity: 2 }]),
      customerCart: customerCart(),
    })

    expect(decision.outcome).toBe("MERGED")
    expect(decision.acceptedItems).toEqual([
      { variantId: "variant_a", quantity: 2 },
    ])
    expect(decision.review).toEqual({
      requiresReview: false,
      reviewRef: null,
      rejectedItems: [],
    })
  })

  it("promove integralmente sem destino com GUEST_CART_ATTACHED", () => {
    const decision = buildCartMergeDecision({
      guestCart: guestCart([{ variantId: "variant_a", quantity: 2 }]),
    })

    expect(decision.outcome).toBe("GUEST_CART_ATTACHED")
    expect(decision.review.requiresReview).toBe(false)
    expect(decision.rejectedItems).toEqual([])
  })

  it("usa MERGED_PARTIAL e review quando a promoção sem destino é parcial", () => {
    const allRejected = buildCartMergeDecision({
      guestCart: guestCart([{ variantId: "variant_a", quantity: 30 }]),
      variantAvailability: new Map([["variant_a", "unavailable"]]),
    })

    expect(allRejected.outcome).toBe("NO_ITEMS")
    expect(allRejected.review.requiresReview).toBe(false)

    const partialPromotion = buildCartMergeDecision({
      guestCart: guestCart([
        { variantId: "variant_a", quantity: 2 },
        { variantId: "variant_b", quantity: 1 },
      ]),
      unavailableVariantIds: ["variant_b"],
    })
    expect(partialPromotion.outcome).toBe("MERGED_PARTIAL")
    expect(partialPromotion.review.requiresReview).toBe(true)
  })

  it("retorna NO_ITEMS sem review quando todas as variantes são rejeitadas", () => {
    const decision = buildCartMergeDecision({
      guestCart: guestCart([
        { variantId: "variant_a", quantity: 2 },
        { variantId: "variant_b", quantity: 1 },
      ]),
      invalidVariantIds: ["variant_a"],
      unavailableVariantIds: ["variant_b"],
    })

    expect(decision.outcome).toBe("NO_ITEMS")
    expect(decision.review).toEqual({
      requiresReview: false,
      reviewRef: null,
      rejectedItems: decision.rejectedItems,
    })
    expect(decision.rejectedItems).toEqual([
      expect.objectContaining({
        variantId: "variant_a",
        reason: "VARIANT_INVALID",
        acceptedQuantity: 0,
        rejectedQuantity: 2,
      }),
      expect.objectContaining({
        variantId: "variant_b",
        reason: "VARIANT_UNAVAILABLE",
        acceptedQuantity: 0,
        rejectedQuantity: 1,
      }),
    ])
  })

  it("falha fechado para duplicatas físicas Customer incompatíveis", () => {
    expect(() =>
      buildCartMergeDecision({
        guestCart: guestCart([{ variantId: "variant_a", quantity: 1 }]),
        customerCart: customerCart([
          { variantId: "variant_a", quantity: 1, unit_price: 100 },
          { variantId: "variant_a", quantity: 1, unit_price: 200 },
        ]),
      })
    ).toThrow(CartMergeStateConflictError)
  })

  it("conserva requested = accepted + rejected por variante", () => {
    const decision = buildCartMergeDecision({
      guestCart: guestCart([
        { variantId: "variant_a", quantity: 30 },
        { variantId: "variant_b", quantity: 2 },
      ]),
      customerCart: customerCart([{ variantId: "variant_a", quantity: 80 }]),
      unavailableVariantIds: ["variant_b"],
    })

    for (const item of decision.decisions) {
      expect(item.acceptedQuantity + item.rejectedQuantity).toBe(
        item.requestedQuantity
      )
    }
  })

  it("serializa rejected item e review com property sets fechados", () => {
    const rejectedItem = serializeCartMergeRejectedItem({
      variantId: "variant_public",
      requestedQuantity: 30,
      acceptedQuantity: 19,
      rejectedQuantity: 11,
      reason: "QUANTITY_LIMIT_EXCEEDED",
      providerId: "provider-internal",
      catalogTitle: "internal-catalog-title",
    } as RejectedItem & {
      providerId: string
      catalogTitle: string
    })
    const review = serializeCartReviewState({
      requiresReview: true,
      reviewRef: "review_opaque",
      rejectedItems: [rejectedItem],
      internalId: "must-not-leak",
    } as CartReviewState & { internalId: string })

    expect(Object.keys(rejectedItem)).toEqual([
      "variantId",
      "requestedQuantity",
      "acceptedQuantity",
      "rejectedQuantity",
      "reason",
    ])
    expect(Object.keys(review)).toEqual([
      "requiresReview",
      "reviewRef",
      "rejectedItems",
    ])
    expect(JSON.stringify(review)).not.toContain("provider")
    expect(JSON.stringify(review)).not.toContain("internal")
  })

  it("serializa merge e ACK sem espalhar receipt ou campos internos", () => {
    const response = serializeCartMergeResponse({
      outcome: "MERGED_PARTIAL",
      cart: publicCart(),
      review: {
        requiresReview: true,
        reviewRef: "review_opaque",
        rejectedItems: [
          {
            variantId: "variant_public",
            requestedQuantity: 2,
            acceptedQuantity: 1,
            rejectedQuantity: 1,
            reason: "VARIANT_UNAVAILABLE",
          },
        ],
        resultId: "internal-result",
        requestFingerprint: "secret-digest",
      } as never,
    })
    const acknowledge = serializeCartReviewAcknowledgeResponse({
      cart: publicCart(),
      review: {
        requiresReview: false,
        reviewRef: null,
        rejectedItems: [],
        actorId: "internal-actor",
      } as never,
    })

    expect(Object.keys(response)).toEqual(["outcome", "cart", "review"])
    expect(Object.keys(acknowledge)).toEqual(["cart", "review"])
    expect(response.cart).not.toHaveProperty("capability")
    expect(response.cart).not.toHaveProperty("requestFingerprint")
    expect(JSON.stringify(response)).not.toContain("internal-result")
    expect(JSON.stringify(response)).not.toContain("secret-digest")
    expect(JSON.stringify(acknowledge)).not.toContain("internal-actor")
  })
})
