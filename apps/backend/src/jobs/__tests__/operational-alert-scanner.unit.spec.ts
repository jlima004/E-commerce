import { CHECKOUT_COMPLETION_STALE_AFTER_MS } from "../../modules/operational-alert/detectors"
import type { UpsertAlertInput } from "../../modules/operational-alert"
import {
  config,
  OPERATIONAL_ALERT_SCANNER_BATCH_SIZE,
  OPERATIONAL_ALERT_SCANNER_MAX_PAGES,
  runOperationalAlertScanner,
} from "../operational-alert-scanner"

const NOW = new Date("2026-07-22T12:00:00.000Z")

function createLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
}

describe("operational-alert-scanner", () => {
  it("exports cron */5 and scanner name", () => {
    expect(config).toEqual({
      name: "operational-alert-scanner",
      schedule: "*/5 * * * *",
    })
    expect(OPERATIONAL_ALERT_SCANNER_BATCH_SIZE).toBe(100)
    expect(OPERATIONAL_ALERT_SCANNER_MAX_PAGES).toBe(20)
  })

  it("is a no-op outside WORKER_MODE=worker", async () => {
    const upsertAlert = jest.fn()
    const listGelatoFulfillments = jest.fn()

    const result = await runOperationalAlertScanner({
      operationalAlert: { upsertAlert },
      gelatoFulfillment: { listGelatoFulfillments },
      isWorker: () => false,
    })

    expect(result.noop_reason).toBe("not_worker")
    expect(listGelatoFulfillments).not.toHaveBeenCalled()
    expect(upsertAlert).not.toHaveBeenCalled()
  })

  it("is a no-op in release migration mode", async () => {
    const upsertAlert = jest.fn()
    const listGelatoFulfillments = jest.fn()

    const result = await runOperationalAlertScanner({
      operationalAlert: { upsertAlert },
      gelatoFulfillment: { listGelatoFulfillments },
      isWorker: () => true,
      isReleaseMigration: () => true,
    })

    expect(result.noop_reason).toBe("release_migration")
    expect(listGelatoFulfillments).not.toHaveBeenCalled()
    expect(upsertAlert).not.toHaveBeenCalled()
  })

  it("paginates fulfillment candidates and stops at max pages", async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: `gelful_${index}`,
      status: "dead_letter",
      requires_operator_attention: true,
      updated_at: `2026-07-22T11:0${index}:00.000Z`,
    }))
    const listGelatoFulfillments = jest.fn(
      async (
        _filters?: Record<string, unknown>,
        config?: Record<string, unknown>
      ) => {
        const skip = Number(config?.skip ?? 0)
        const take = Number(config?.take ?? rows.length)
        return rows.slice(skip, skip + take)
      }
    )
    const upsertAlert = jest.fn(async () => ({ id: "opalert" }))

    const result = await runOperationalAlertScanner({
      operationalAlert: { upsertAlert },
      gelatoFulfillment: { listGelatoFulfillments },
      isWorker: () => true,
      isReleaseMigration: () => false,
      now: () => NOW,
      batchSize: 2,
      maxPages: 2,
    })

    expect(listGelatoFulfillments).toHaveBeenCalledTimes(2)
    expect(result.pages).toBe(2)
    expect(result.upserted).toBe(4)
    expect(upsertAlert).toHaveBeenCalledTimes(4)
  })

  it("upserts fulfillment dead_letter and operator-attention candidates", async () => {
    const upsertAlert = jest.fn(
      async (_input: UpsertAlertInput) => ({ id: "opalert" })
    )

    await runOperationalAlertScanner({
      operationalAlert: { upsertAlert },
      gelatoFulfillment: {
        listGelatoFulfillments: jest.fn(async () => [
          {
            id: "gelful_dead",
            status: "dead_letter",
            requires_operator_attention: true,
            updated_at: "2026-07-22T11:00:00.000Z",
          },
          {
            id: "gelful_attention",
            status: "failed",
            requires_operator_attention: true,
            operator_alert_code: "GELATO_DISPATCH_STALE",
            updated_at: "2026-07-22T11:01:00.000Z",
          },
          {
            id: "gelful_ok",
            status: "submitted",
            requires_operator_attention: false,
            updated_at: "2026-07-22T11:02:00.000Z",
          },
        ]),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
      now: () => NOW,
    })

    expect(upsertAlert).toHaveBeenCalledTimes(2)
    expect(upsertAlert.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        entity_id: "gelful_dead",
        severity: "critical",
        type: "fulfillment_failed",
      })
    )
    expect(upsertAlert.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        entity_id: "gelful_attention",
        severity: "high",
      })
    )
  })

  it("upserts CCL failed, stale processing, missing CCL and pix expired candidates", async () => {
    const upsertAlert = jest.fn(
      async (_input: UpsertAlertInput) => ({ id: "opalert" })
    )
    const staleLockedAt = new Date(
      NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS
    ).toISOString()
    const staleReceivedAt = staleLockedAt

    const result = await runOperationalAlertScanner({
      operationalAlert: { upsertAlert },
      paymentAttempt: {
        listPaymentAttempts: jest.fn(async () => [
          {
            id: "payatt_failed",
            status: "payment_confirmed_by_webhook",
            order_id: null,
            provider_payment_intent_id: "pi_failed",
            updated_at: "2026-07-22T11:00:00.000Z",
          },
          {
            id: "payatt_stale",
            status: "payment_confirmed_by_webhook",
            order_id: null,
            provider_payment_intent_id: "pi_stale",
            updated_at: "2026-07-22T11:01:00.000Z",
          },
          {
            id: "payatt_missing",
            status: "payment_confirmed_by_webhook",
            order_id: null,
            provider_payment_intent_id: "pi_missing",
            updated_at: "2026-07-22T11:02:00.000Z",
          },
          {
            id: "payatt_pix",
            status: "awaiting_pix_payment",
            payment_method_type: "pix",
            order_id: null,
            expires_at: new Date(NOW.getTime() - 1).toISOString(),
            updated_at: "2026-07-22T11:03:00.000Z",
          },
          {
            id: "payatt_negative",
            status: "payment_confirmed_by_webhook",
            order_id: "order_exists",
            provider_payment_intent_id: "pi_neg",
            updated_at: "2026-07-22T11:04:00.000Z",
          },
        ]),
      },
      checkoutCompletion: {
        listCheckoutCompletionLogs: jest.fn(async (filters) => {
          if (filters?.payment_attempt_id === "payatt_failed") {
            return [{ id: "chkcpl_failed", status: "failed", order_id: null }]
          }
          if (filters?.payment_attempt_id === "payatt_stale") {
            return [
              {
                id: "chkcpl_stale",
                status: "processing",
                order_id: null,
                locked_at: staleLockedAt,
              },
            ]
          }
          return []
        }),
      },
      webhooks: {
        listWebhookEventLogs: jest.fn(async () => [
          {
            id: "whlog_missing",
            provider: "stripe",
            event_type: "payment_intent.succeeded",
            entity_id: "pi_missing",
            received_at: staleReceivedAt,
            metadata: { payment_intent_id: "pi_missing" },
          },
        ]),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
      now: () => NOW,
    })

    expect(result.upserted).toBe(4)
    expect(result.by_source.pix_expired).toBe(1)
    expect(result.by_source.confirmed_without_order).toBe(3)

    const codes = upsertAlert.mock.calls.map((call) => call[0].message_code)
    expect(codes).toEqual(
      expect.arrayContaining([
        "PAYMENT_CONFIRMED_CHECKOUT_FAILED",
        "PAYMENT_CONFIRMED_CHECKOUT_STALE",
        "PAYMENT_CONFIRMED_CHECKOUT_MISSING",
        "PIX_PAYMENT_EXPIRED_WITHOUT_ORDER",
      ])
    )
  })

  it("excludes negatives and never calls providers", async () => {
    const upsertAlert = jest.fn(async () => ({ id: "opalert" }))
    const createOrder = jest.fn()
    const stripe = jest.fn()

    await runOperationalAlertScanner({
      operationalAlert: { upsertAlert },
      paymentAttempt: {
        listPaymentAttempts: jest.fn(async () => [
          {
            id: "payatt_fresh",
            status: "payment_confirmed_by_webhook",
            order_id: null,
            provider_payment_intent_id: "pi_fresh",
            updated_at: "2026-07-22T11:00:00.000Z",
          },
          {
            id: "payatt_pix_terminal",
            status: "pix_expired",
            payment_method_type: "pix",
            order_id: null,
            expires_at: new Date(NOW.getTime() - 1).toISOString(),
            updated_at: "2026-07-22T11:01:00.000Z",
          },
        ]),
      },
      checkoutCompletion: {
        listCheckoutCompletionLogs: jest.fn(async () => [
          {
            id: "chkcpl_fresh",
            status: "processing",
            locked_at: new Date(
              NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS + 1
            ).toISOString(),
          },
        ]),
      },
      webhooks: {
        listWebhookEventLogs: jest.fn(async () => [
          {
            id: "whlog_fresh",
            provider: "stripe",
            event_type: "payment_intent.succeeded",
            entity_id: "pi_fresh",
            received_at: new Date(
              NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS + 1
            ).toISOString(),
            metadata: { payment_intent_id: "pi_fresh" },
          },
        ]),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
      now: () => NOW,
    })

    expect(upsertAlert).not.toHaveBeenCalled()
    expect(createOrder).not.toHaveBeenCalled()
    expect(stripe).not.toHaveBeenCalled()
  })

  it("isolates per-item failures and keeps scanning", async () => {
    const upsertAlert = jest
      .fn()
      .mockRejectedValueOnce(new Error("upsert boom"))
      .mockResolvedValue({ id: "opalert" })

    const result = await runOperationalAlertScanner({
      operationalAlert: { upsertAlert },
      gelatoFulfillment: {
        listGelatoFulfillments: jest.fn(async () => [
          {
            id: "gelful_a",
            status: "dead_letter",
            updated_at: "2026-07-22T11:00:00.000Z",
          },
          {
            id: "gelful_b",
            status: "dead_letter",
            updated_at: "2026-07-22T11:01:00.000Z",
          },
        ]),
      },
      isWorker: () => true,
      isReleaseMigration: () => false,
      now: () => NOW,
    })

    expect(result.failed_items).toBe(1)
    expect(result.upserted).toBe(1)
  })

  it("passes only allowlisted upsert DTOs and reuses the logical key on rerun", async () => {
    const upsertAlert = jest.fn(
      async (_input: UpsertAlertInput) => ({ id: "opalert" })
    )
    const deps = {
      operationalAlert: { upsertAlert },
      gelatoFulfillment: {
        listGelatoFulfillments: jest.fn(async () => [
          {
            id: "gelful_key",
            status: "dead_letter",
            order_id: "order_01",
            last_error_code: "gelato_dispatch_dead_letter",
            updated_at: "2026-07-22T11:00:00.000Z",
          },
        ]),
      },
      isWorker: () => true as const,
      isReleaseMigration: () => false as const,
      now: () => NOW,
    }

    await runOperationalAlertScanner(deps)
    await runOperationalAlertScanner(deps)

    expect(upsertAlert).toHaveBeenCalledTimes(2)
    for (const call of upsertAlert.mock.calls) {
      const dto = call[0]
      expect(Object.keys(dto).sort()).toEqual(
        [
          "entity_id",
          "entity_type",
          "error_code",
          "message",
          "message_code",
          "metadata",
          "observed_at",
          "severity",
          "type",
        ].sort()
      )
      expect(dto).toEqual(
        expect.objectContaining({
          type: "fulfillment_failed",
          entity_type: "fulfillment",
          entity_id: "gelful_key",
        })
      )
      expect(JSON.stringify(dto)).not.toMatch(/client_secret|payload|stack|qr/i)
    }
  })

  it("emits sanitized completion logs without payloads", async () => {
    const logger = createLogger()

    await runOperationalAlertScanner({
      operationalAlert: { upsertAlert: jest.fn(async () => ({ id: "x" })) },
      gelatoFulfillment: {
        listGelatoFulfillments: jest.fn(async () => []),
      },
      logger,
      isWorker: () => true,
      isReleaseMigration: () => false,
      now: () => NOW,
    })

    expect(logger.info).toHaveBeenCalledWith(
      "OPERATIONAL_ALERT_SCANNER_COMPLETE",
      expect.objectContaining({
        job: "operational-alert-scanner",
        processed: 0,
        upserted: 0,
      })
    )
    const payload = JSON.stringify(logger.info.mock.calls)
    expect(payload).not.toMatch(/client_secret|authorization|cookie|payload/i)
  })

  it("does not require custom Redis modules in the unit double path", async () => {
    const result = await runOperationalAlertScanner({
      operationalAlert: { upsertAlert: jest.fn(async () => ({ id: "x" })) },
      isWorker: () => true,
      isReleaseMigration: () => false,
      now: () => NOW,
    })

    expect(result.noop_reason).toBeNull()
    expect(result.processed).toBe(0)
  })
})
