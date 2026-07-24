import {
  CHECKOUT_COMPLETION_STALE_AFTER_MS,
  isCheckoutCompletionLockedStale,
} from "../../checkout-completion/staleness"
import {
  detectFulfillmentFailed,
  detectPaymentStuckConfirmedWithoutOrder,
  detectPixExpiredWithoutOrder,
  PIX_EXPIRED_ALERT_STATUSES,
} from "../detectors"

const NOW = new Date("2026-07-22T12:00:00.000Z")

describe("operational-alert detectors", () => {
  describe("CHECKOUT_COMPLETION_STALE_AFTER_MS", () => {
    it("exports the fifteen-minute window", () => {
      expect(CHECKOUT_COMPLETION_STALE_AFTER_MS).toBe(15 * 60_000)
    })
  })

  describe("detectFulfillmentFailed", () => {
    it("maps dead_letter to critical", () => {
      const alert = detectFulfillmentFailed(
        {
          id: "gelful_01",
          status: "dead_letter",
          order_id: "order_01",
          requires_operator_attention: false,
          last_error_code: "gelato_dispatch_http_400",
        },
        NOW
      )

      expect(alert).toEqual(
        expect.objectContaining({
          type: "fulfillment_failed",
          severity: "critical",
          entity_type: "fulfillment",
          entity_id: "gelful_01",
          message_code: "FULFILLMENT_DEAD_LETTER",
          error_code: "gelato_dispatch_http_400",
        })
      )
      expect(alert?.metadata).not.toHaveProperty("payload")
    })

    it("maps operator attention without dead_letter to high", () => {
      const alert = detectFulfillmentFailed(
        {
          id: "gelful_02",
          status: "failed",
          requires_operator_attention: true,
          operator_alert_code: "GELATO_DISPATCH_STALE",
        },
        NOW
      )

      expect(alert).toEqual(
        expect.objectContaining({
          type: "fulfillment_failed",
          severity: "high",
          message_code: "FULFILLMENT_OPERATOR_ATTENTION",
          error_code: "GELATO_DISPATCH_STALE",
        })
      )
    })

    it("prefers critical when dead_letter and operator attention coexist", () => {
      const alert = detectFulfillmentFailed(
        {
          id: "gelful_03",
          status: "dead_letter",
          requires_operator_attention: true,
          last_error_code: "gelato_dispatch_dead_letter",
          operator_alert_code: "gelato_dispatch_reconciliation_required",
        },
        NOW
      )

      expect(alert?.severity).toBe("critical")
      expect(alert?.message_code).toBe("FULFILLMENT_DEAD_LETTER")
    })

    it("returns null for non-eligible fulfillment state", () => {
      expect(
        detectFulfillmentFailed(
          {
            id: "gelful_04",
            status: "failed",
            requires_operator_attention: false,
          },
          NOW
        )
      ).toBeNull()
      expect(
        detectFulfillmentFailed(
          {
            id: "gelful_05",
            status: "submitted",
            requires_operator_attention: false,
          },
          NOW
        )
      ).toBeNull()
    })
  })

  describe("detectPaymentStuckConfirmedWithoutOrder", () => {
    const confirmed = {
      id: "payatt_01",
      status: "payment_confirmed_by_webhook",
      order_id: null,
      provider_payment_intent_id: "pi_01",
    }

    it("treats confirmed without order as a candidate base", () => {
      const alert = detectPaymentStuckConfirmedWithoutOrder({
        paymentAttempt: confirmed,
        checkoutCompletion: {
          id: "chkcpl_failed",
          status: "failed",
          order_id: null,
        },
        now: NOW,
      })
      expect(alert?.entity_id).toBe("payatt_01")
      expect(alert?.type).toBe("payment_stuck")
    })

    it("returns null when an order already exists", () => {
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: {
            ...confirmed,
            order_id: "order_01",
          },
          checkoutCompletion: {
            id: "chkcpl_failed",
            status: "failed",
          },
          now: NOW,
        })
      ).toBeNull()
    })

    it("returns null when status diverges from payment_confirmed_by_webhook", () => {
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: {
            ...confirmed,
            status: "awaiting_webhook_confirmation",
          },
          checkoutCompletion: {
            id: "chkcpl_failed",
            status: "failed",
          },
          now: NOW,
        })
      ).toBeNull()
    })

    it("alerts immediately for CCL failed", () => {
      const alert = detectPaymentStuckConfirmedWithoutOrder({
        paymentAttempt: confirmed,
        checkoutCompletion: {
          id: "chkcpl_failed",
          status: "failed",
          order_id: null,
        },
        now: NOW,
      })

      expect(alert).toEqual(
        expect.objectContaining({
          type: "payment_stuck",
          severity: "high",
          message_code: "PAYMENT_CONFIRMED_CHECKOUT_FAILED",
        })
      )
    })

    it("alerts for CCL processing exactly at fifteen minutes", () => {
      const lockedAt = new Date(NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS)
      expect(isCheckoutCompletionLockedStale(lockedAt, NOW)).toBe(true)

      const alert = detectPaymentStuckConfirmedWithoutOrder({
        paymentAttempt: confirmed,
        checkoutCompletion: {
          id: "chkcpl_stale",
          status: "processing",
          order_id: null,
          locked_at: lockedAt.toISOString(),
        },
        now: NOW,
      })

      expect(alert?.message_code).toBe("PAYMENT_CONFIRMED_CHECKOUT_STALE")
    })

    it("returns null for CCL processing below fifteen minutes", () => {
      const lockedAt = new Date(
        NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS + 1
      )
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: confirmed,
          checkoutCompletion: {
            id: "chkcpl_fresh",
            status: "processing",
            locked_at: lockedAt.toISOString(),
          },
          now: NOW,
        })
      ).toBeNull()
    })

    it("returns null for CCL processing without locked_at", () => {
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: confirmed,
          checkoutCompletion: {
            id: "chkcpl_nolock",
            status: "processing",
            locked_at: null,
          },
          now: NOW,
        })
      ).toBeNull()
    })

    it("returns null for CCL processing with invalid locked_at", () => {
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: confirmed,
          checkoutCompletion: {
            id: "chkcpl_badlock",
            status: "processing",
            locked_at: "not-a-date",
          },
          now: NOW,
        })
      ).toBeNull()
    })

    it("alerts for missing CCL with one stale canonical webhook", () => {
      const receivedAt = new Date(
        NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS
      )
      const alert = detectPaymentStuckConfirmedWithoutOrder({
        paymentAttempt: confirmed,
        checkoutCompletion: null,
        webhookCandidates: [
          {
            id: "whlog_01",
            provider: "stripe",
            event_type: "payment_intent.succeeded",
            entity_type: "payment_attempt",
            entity_id: "payatt_01",
            received_at: receivedAt.toISOString(),
            metadata: { payment_intent_id: "pi_01" },
          },
        ],
        now: NOW,
      })

      expect(alert?.message_code).toBe("PAYMENT_CONFIRMED_CHECKOUT_MISSING")
      expect(alert?.metadata).toEqual(
        expect.objectContaining({
          webhook_event_log_id: "whlog_01",
        })
      )
    })

    it("returns null for a fresh canonical webhook", () => {
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: confirmed,
          checkoutCompletion: null,
          webhookCandidates: [
            {
              id: "whlog_fresh",
              provider: "stripe",
              event_type: "payment_intent.succeeded",
              entity_id: "pi_01",
              received_at: new Date(
                NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS + 1
              ).toISOString(),
              metadata: { payment_intent_id: "pi_01" },
            },
          ],
          now: NOW,
        })
      ).toBeNull()
    })

    it("returns null without a canonical webhook", () => {
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: confirmed,
          checkoutCompletion: null,
          webhookCandidates: [],
          now: NOW,
        })
      ).toBeNull()
    })

    it("returns null when webhook received_at is invalid", () => {
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: confirmed,
          checkoutCompletion: null,
          webhookCandidates: [
            {
              id: "whlog_bad",
              provider: "stripe",
              event_type: "payment_intent.succeeded",
              entity_id: "pi_01",
              received_at: "bad-timestamp",
              metadata: { payment_intent_id: "pi_01" },
            },
          ],
          now: NOW,
        })
      ).toBeNull()
    })

    it("returns null for divergent event type", () => {
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: confirmed,
          checkoutCompletion: null,
          webhookCandidates: [
            {
              id: "whlog_other",
              provider: "stripe",
              event_type: "payment_intent.payment_failed",
              entity_id: "pi_01",
              received_at: new Date(
                NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS
              ).toISOString(),
              metadata: { payment_intent_id: "pi_01" },
            },
          ],
          now: NOW,
        })
      ).toBeNull()
    })

    it("returns null for divergent payment_intent correlation", () => {
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: confirmed,
          checkoutCompletion: null,
          webhookCandidates: [
            {
              id: "whlog_divergent",
              provider: "stripe",
              event_type: "payment_intent.succeeded",
              entity_id: "pi_other",
              received_at: new Date(
                NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS
              ).toISOString(),
              metadata: { payment_intent_id: "pi_other" },
            },
          ],
          now: NOW,
        })
      ).toBeNull()
    })

    it("returns null when multiple canonical candidates are ambiguous", () => {
      const receivedAt = new Date(
        NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS
      ).toISOString()
      expect(
        detectPaymentStuckConfirmedWithoutOrder({
          paymentAttempt: confirmed,
          checkoutCompletion: null,
          webhookCandidates: [
            {
              id: "whlog_a",
              provider: "stripe",
              event_type: "payment_intent.succeeded",
              entity_id: "pi_01",
              received_at: receivedAt,
              metadata: { payment_intent_id: "pi_01" },
            },
            {
              id: "whlog_b",
              provider: "stripe",
              event_type: "payment_intent.succeeded",
              entity_id: "pi_01",
              received_at: receivedAt,
              metadata: { payment_intent_id: "pi_01" },
            },
          ],
          now: NOW,
        })
      ).toBeNull()
    })
  })

  describe("detectPixExpiredWithoutOrder", () => {
    const expiredAt = new Date(NOW.getTime() - 1).toISOString()

    it.each([...PIX_EXPIRED_ALERT_STATUSES])(
      "alerts for pix status %s when expired without order",
      (status) => {
        const alert = detectPixExpiredWithoutOrder(
          {
            id: `payatt_pix_${status}`,
            payment_method_type: "pix",
            status,
            order_id: null,
            expires_at: expiredAt,
          },
          NOW
        )

        expect(alert).toEqual(
          expect.objectContaining({
            type: "payment_stuck",
            severity: "high",
            message_code: "PIX_PAYMENT_EXPIRED_WITHOUT_ORDER",
            entity_id: `payatt_pix_${status}`,
          })
        )
      }
    )

    it("returns null for non-pix method", () => {
      expect(
        detectPixExpiredWithoutOrder(
          {
            id: "payatt_card",
            payment_method_type: "card",
            status: "awaiting_webhook_confirmation",
            order_id: null,
            expires_at: expiredAt,
          },
          NOW
        )
      ).toBeNull()
    })

    it("returns null when expires_at is absent", () => {
      expect(
        detectPixExpiredWithoutOrder(
          {
            id: "payatt_no_exp",
            payment_method_type: "pix",
            status: "awaiting_pix_payment",
            order_id: null,
            expires_at: null,
          },
          NOW
        )
      ).toBeNull()
    })

    it("returns null when expires_at is invalid", () => {
      expect(
        detectPixExpiredWithoutOrder(
          {
            id: "payatt_bad_exp",
            payment_method_type: "pix",
            status: "awaiting_pix_payment",
            order_id: null,
            expires_at: "bad",
          },
          NOW
        )
      ).toBeNull()
    })

    it("returns null when pix is not yet expired", () => {
      expect(
        detectPixExpiredWithoutOrder(
          {
            id: "payatt_future",
            payment_method_type: "pix",
            status: "awaiting_pix_payment",
            order_id: null,
            expires_at: NOW.toISOString(),
          },
          NOW
        )
      ).toBeNull()
    })

    it("returns null when an order already exists", () => {
      expect(
        detectPixExpiredWithoutOrder(
          {
            id: "payatt_with_order",
            payment_method_type: "pix",
            status: "awaiting_pix_payment",
            order_id: "order_01",
            expires_at: expiredAt,
          },
          NOW
        )
      ).toBeNull()
    })

    it("returns null for terminal pix statuses", () => {
      for (const status of [
        "pix_expired",
        "payment_failed",
        "payment_canceled",
        "payment_confirmed_by_webhook",
        "superseded",
        "invalidated_by_cart_change",
      ]) {
        expect(
          detectPixExpiredWithoutOrder(
            {
              id: `payatt_term_${status}`,
              payment_method_type: "pix",
              status,
              order_id: null,
              expires_at: expiredAt,
            },
            NOW
          )
        ).toBeNull()
      }
    })

    it("returns null for unknown status", () => {
      expect(
        detectPixExpiredWithoutOrder(
          {
            id: "payatt_unknown",
            payment_method_type: "pix",
            status: "weird_status",
            order_id: null,
            expires_at: expiredAt,
          },
          NOW
        )
      ).toBeNull()
    })
  })

  it("never inspects unstable payment-attempt update clocks in detector source", async () => {
    const fs = await import("fs/promises")
    const path = await import("path")
    const source = await fs.readFile(
      path.join(__dirname, "..", "detectors.ts"),
      "utf8"
    )
    expect(source).not.toMatch(/updated_at/)
  })
})
