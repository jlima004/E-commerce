import type { MedusaContainer } from "@medusajs/framework/types"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../modules/analytics-event-log"
import {
  ANALYTICS_EVENT_STATUS,
  type AnalyticsEventLogRecord,
} from "../../modules/analytics-event-log/types"
import {
  buildAnalyticsRelayFailureUpdate,
  buildPostHogCaptureFromAnalyticsEvent,
  computeAnalyticsRelayBackoffMs,
  isAnalyticsRelayDue,
  isPurchaseCompletedLocallyRecorded,
} from "../../modules/analytics-event-log/service"
import {
  default as analyticsPosthogRelayJob,
  createPostHogRelayClient,
  resolvePostHogRelayConfig,
  runAnalyticsPosthogRelay,
  type PostHogRelayClient,
} from "../analytics-posthog-relay"

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const POSTHOG_LABEL = joinKey("Post", "Hog")

function buildRecord(
  overrides: Partial<AnalyticsEventLogRecord> = {}
): AnalyticsEventLogRecord {
  return {
    id: "anlevt_relay_01",
    event_name: "purchase_completed",
    event_version: 1,
    idempotency_key: "purchase_completed:stripe:pi_relay_01",
    order_id: "order_relay_01",
    cart_id: "cart_relay_01",
    payment_attempt_id: "payatt_relay_01",
    checkout_completion_log_id: "chkcpl_relay_01",
    payment_intent_id: "pi_relay_01",
    status: ANALYTICS_EVENT_STATUS.RECORDED,
    payload: {
      event_name: "purchase_completed",
      event_version: 1,
      occurred_at: "2026-07-01T12:00:00.000Z",
      order_id: "order_relay_01",
      cart_id: "cart_relay_01",
      payment_attempt_id: "payatt_relay_01",
      checkout_completion_log_id: "chkcpl_relay_01",
      payment_intent_id: "pi_relay_01",
      payment_method_type: "card",
      amount: 9900,
      currency_code: "brl",
      order_status: "confirmed",
      payment_status: "captured",
      item_count: 1,
      items: [
        {
          variant_id: "variant_relay_01",
          sku: "SKU-RELAY-01",
          quantity: 1,
          unit_price: 9900,
          subtotal: 9900,
        },
      ],
    },
    metadata: null,
    attempt_count: 0,
    last_error_code: null,
    last_error_message: null,
    next_retry_at: null,
    recorded_at: "2026-07-01T12:00:00.000Z",
    queued_at: null,
    sending_started_at: null,
    sent_at: null,
    failed_at: null,
    dead_lettered_at: null,
    created_at: "2026-07-01T12:00:00.000Z",
    updated_at: "2026-07-01T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  }
}

function createAnalyticsModule(initial: AnalyticsEventLogRecord[] = []) {
  const store = initial.map((record) => ({ ...record }))

  return {
    listAnalyticsEventLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => {
        if (filters?.status && record.status !== filters.status) {
          return false
        }

        return true
      })
    }),
    updateAnalyticsEventLogs: jest.fn(async (input) => {
      const rows = Array.isArray(input) ? input : [input]

      for (const row of rows) {
        const index = store.findIndex((record) => record.id === row.id)

        if (index >= 0) {
          store[index] = {
            ...store[index],
            ...row,
          }
        }
      }

      return rows
    }),
    store,
  }
}

function createContainer(module: ReturnType<typeof createAnalyticsModule>) {
  return {
    resolve: jest.fn((key: string) => {
      if (key === ANALYTICS_EVENT_LOG_MODULE || key === "analytics_event_log") {
        return module
      }

      return undefined
    }),
  } as unknown as MedusaContainer
}

describe("analytics relay helpers", () => {
  it("maps payload allowlist-only para capture com order_id como distinctId", () => {
    const record = buildRecord()

    expect(buildPostHogCaptureFromAnalyticsEvent(record)).toEqual({
      event: "purchase_completed",
      distinctId: "order_relay_01",
      properties: record.payload,
    })
  })

  it("aplica backoff exponencial com teto", () => {
    expect(computeAnalyticsRelayBackoffMs(1)).toBe(60_000)
    expect(computeAnalyticsRelayBackoffMs(2)).toBe(120_000)
    expect(computeAnalyticsRelayBackoffMs(10)).toBe(3_600_000)
  })

  it("considera failed e dead_letter como gate local valido", () => {
    expect(
      isPurchaseCompletedLocallyRecorded({
        status: ANALYTICS_EVENT_STATUS.FAILED,
      })
    ).toBe(true)
    expect(
      isPurchaseCompletedLocallyRecorded({
        status: ANALYTICS_EVENT_STATUS.DEAD_LETTER,
      })
    ).toBe(true)
    expect(isPurchaseCompletedLocallyRecorded({ status: "processing" as never })).toBe(
      false
    )
  })

  it("respeita next_retry_at ao selecionar candidatos", () => {
    const now = new Date("2026-07-01T12:00:00.000Z")

    expect(isAnalyticsRelayDue(null, now)).toBe(true)
    expect(isAnalyticsRelayDue("2026-07-01T11:59:00.000Z", now)).toBe(true)
    expect(isAnalyticsRelayDue("2026-07-01T12:01:00.000Z", now)).toBe(false)
  })

  it("marca dead_letter apos esgotar tentativas", () => {
    const update = buildAnalyticsRelayFailureUpdate(new Error("relay down"), 4, {
      maxAttempts: 5,
      at: new Date("2026-07-01T12:05:00.000Z"),
    })

    expect(update.status).toBe(ANALYTICS_EVENT_STATUS.DEAD_LETTER)
    expect(update.attempt_count).toBe(5)
    expect(update.next_retry_at).toBeNull()
  })
})

describe("resolvePostHogRelayConfig", () => {
  it("retorna null quando token ausente", () => {
    expect(resolvePostHogRelayConfig({})).toBeNull()
    expect(resolvePostHogRelayConfig({ POSTHOG_API_KEY: "   " })).toBeNull()
  })

  it("nao exige host para habilitar relay", () => {
    expect(
      resolvePostHogRelayConfig({
        POSTHOG_API_KEY: "phc_test_key",
      })
    ).toEqual({
      apiKey: "phc_test_key",
    })
  })
})

describe("runAnalyticsPosthogRelay", () => {
  it("nao envia quando config PostHog esta ausente", async () => {
    const module = createAnalyticsModule([buildRecord()])
    const capture = jest.fn()

    const result = await runAnalyticsPosthogRelay(createContainer(module), {
      config: null,
      createClient: () => ({
        capture,
      }),
    })

    expect(result).toEqual({
      processed: 0,
      sent: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: true,
    })
    expect(capture).not.toHaveBeenCalled()
    expect(module.store[0]?.status).toBe(ANALYTICS_EVENT_STATUS.RECORDED)
  })

  it("envia evento recorded e marca sent", async () => {
    const module = createAnalyticsModule([buildRecord()])
    const capture = jest.fn(async () => undefined)
    const shutdown = jest.fn(async () => undefined)

    const result = await runAnalyticsPosthogRelay(createContainer(module), {
      now: () => new Date("2026-07-01T12:01:00.000Z"),
      config: { apiKey: "phc_test_key" },
      createClient: () => ({
        capture,
        shutdown,
      }),
    })

    expect(result).toEqual({
      processed: 1,
      sent: 1,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: false,
    })
    expect(capture).toHaveBeenCalledWith({
      event: "purchase_completed",
      distinctId: "order_relay_01",
      properties: expect.objectContaining({
        order_id: "order_relay_01",
        payment_method_type: "card",
      }),
    })
    expect(module.store[0]?.status).toBe(ANALYTICS_EVENT_STATUS.SENT)
    expect(module.store[0]?.sent_at).toBe("2026-07-01T12:01:00.000Z")
    expect(shutdown).toHaveBeenCalledTimes(1)
  })

  it("marca failed com retry quando PostHog falha", async () => {
    const module = createAnalyticsModule([buildRecord()])
    const capture = jest.fn(async () => {
      throw new Error(`${POSTHOG_LABEL} unavailable`)
    })

    const result = await runAnalyticsPosthogRelay(createContainer(module), {
      now: () => new Date("2026-07-01T12:02:00.000Z"),
      config: { apiKey: "phc_test_key" },
      createClient: () => ({
        capture,
        shutdown: jest.fn(async () => undefined),
      }),
    })

    expect(result).toEqual({
      processed: 1,
      sent: 0,
      failed: 1,
      dead_lettered: 0,
      skipped_missing_config: false,
    })
    expect(module.store[0]?.status).toBe(ANALYTICS_EVENT_STATUS.FAILED)
    expect(module.store[0]?.attempt_count).toBe(1)
    expect(module.store[0]?.next_retry_at).toBe("2026-07-01T12:03:00.000Z")
    expect(module.store[0]?.last_error_message).toContain("unavailable")
    expect(isPurchaseCompletedLocallyRecorded(module.store[0])).toBe(true)
  })

  it("reprocessa failed due e marca dead_letter apos limite", async () => {
    const module = createAnalyticsModule([
      buildRecord({
        status: ANALYTICS_EVENT_STATUS.FAILED,
        attempt_count: 4,
        next_retry_at: "2026-07-01T12:04:59.000Z",
        failed_at: "2026-07-01T12:03:00.000Z",
      }),
    ])
    const capture = jest.fn(async () => {
      throw new Error("persistent outage")
    })

    const result = await runAnalyticsPosthogRelay(createContainer(module), {
      now: () => new Date("2026-07-01T12:05:00.000Z"),
      config: { apiKey: "phc_test_key" },
      maxAttempts: 5,
      createClient: () => ({
        capture,
        shutdown: jest.fn(async () => undefined),
      }),
    })

    expect(result).toEqual({
      processed: 1,
      sent: 0,
      failed: 0,
      dead_lettered: 1,
      skipped_missing_config: false,
    })
    expect(module.store[0]?.status).toBe(ANALYTICS_EVENT_STATUS.DEAD_LETTER)
    expect(module.store[0]?.attempt_count).toBe(5)
    expect(isPurchaseCompletedLocallyRecorded(module.store[0])).toBe(true)
  })

  it("nao altera Order, PaymentAttempt ou CheckoutCompletionLog", async () => {
    const module = createAnalyticsModule([buildRecord()])

    await runAnalyticsPosthogRelay(createContainer(module), {
      config: { apiKey: "phc_test_key" },
      createClient: () => ({
        capture: jest.fn(async () => undefined),
        shutdown: jest.fn(async () => undefined),
      }),
    })

    expect(module.updateAnalyticsEventLogs).toHaveBeenCalled()
    expect(Object.keys(module.store[0] ?? {})).not.toContain("payment_attempt")
  })
})

describe("createPostHogRelayClient", () => {
  it("expoe capture e shutdown sem chamar rede em teste", () => {
    const client = createPostHogRelayClient({
      apiKey: "phc_test_key",
      host: "https://example.test",
    }) as PostHogRelayClient

    expect(typeof client.capture).toBe("function")
    expect(typeof client.shutdown).toBe("function")
  })
})

describe("analyticsPosthogRelayJob migration mode", () => {
  it("retorna antes de resolver dependencias ou emitir logs operacionais", async () => {
    const originalMode = process.env.DTC_RELEASE_MIGRATION_MODE
    const originalChild = process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS
    process.env.DTC_RELEASE_MIGRATION_MODE = "true"
    process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS = "true"
    const container = { resolve: jest.fn() } as unknown as MedusaContainer
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      await analyticsPosthogRelayJob(container)
      expect(container.resolve).not.toHaveBeenCalled()
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
      originalMode === undefined
        ? delete process.env.DTC_RELEASE_MIGRATION_MODE
        : (process.env.DTC_RELEASE_MIGRATION_MODE = originalMode)
      originalChild === undefined
        ? delete process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS
        : (process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS = originalChild)
    }
  })
})
