import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../modules/analytics-event-log"
import type { AnalyticsEventLogRecord } from "../../modules/analytics-event-log/types"
import { EMAIL_DELIVERY_LOG_MODULE } from "../../modules/email-delivery-log"
import type { EmailDeliveryLogRecord } from "../../modules/email-delivery-log/types"
import { GELATO_FULFILLMENT_MODULE } from "../../modules/gelato-fulfillment"
import {
  buildGelatoFulfillmentRecord,
} from "../../modules/gelato-fulfillment/service"
import type {
  GelatoDispatchResult,
  GelatoFulfillmentRecord,
} from "../../modules/gelato-fulfillment/types"
import {
  default as gelatoDispatchRelayJob,
  createGelatoDispatchClient,
  isGelatoDispatchDisabled,
  resolveGelatoDispatchRelayConfig,
  runGelatoDispatchRelay,
  type GelatoDispatchRelayResult,
} from "../gelato-dispatch-relay"

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const ENABLE_KEY = joinKey("GELATO", "_", "DISPATCH", "_", "ENABLED")
const API_ENV_KEY = joinKey("GELATO", "_", "API", "_", "KEY")
const SHIPMENT_ENV_KEY = joinKey("GELATO", "_", "SHIPMENT", "_", "METHOD", "_", "UID")
const API_VALUE = joinKey("ge", "_", "test", "_", "dispatch", "_", "key")

function buildOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "order_gelato_relay_01",
    display_id: 8101,
    cart_id: "cart_gelato_relay_01",
    currency_code: "brl",
    email: "cliente@lojinha.test",
    metadata: {
      order_status: "confirmed",
      payment_status: "captured",
    },
    shipping_address: {
      first_name: "Julia",
      last_name: "Lima",
      address_1: "Rua das Flores, 123",
      address_2: "Apto 45",
      city: "Sao Paulo",
      province: "SP",
      postal_code: "01000-000",
      country_code: "br",
      phone: "+55 11 98888-7777",
      metadata: {
        federal_tax_id: "529.982.247-25",
      },
    },
    items: [
      {
        id: "ordli_gelato_relay_01",
        quantity: 1,
        metadata: {
          gelato_snapshot: {
            gelato_product_uid: "gelato_prod_relay_01",
            gelato_template_id: "tmpl_relay_01",
            gelato_variant_options: {
              size: "M",
              color: "Preto",
            },
            template_mode: "fixed",
            source_product_variant_id: "variant_relay_01",
            source_product_variant_sku: "SKU-RELAY-01",
            captured_at: "2026-07-02T12:00:00.000Z",
            files: [
              {
                type: "default",
                url: "https://cdn.lojinha.test/print/front-01.png",
              },
            ],
          },
        },
      },
    ],
    ...overrides,
  }
}

function buildAnalyticsEvent(
  overrides: Partial<AnalyticsEventLogRecord> = {}
): AnalyticsEventLogRecord {
  return {
    id: "anlevt_gelato_relay_01",
    event_name: "purchase_completed",
    event_version: 1,
    idempotency_key: "purchase_completed:stripe:pi_gelato_relay_01",
    order_id: "order_gelato_relay_01",
    cart_id: "cart_gelato_relay_01",
    payment_attempt_id: "payatt_gelato_relay_01",
    checkout_completion_log_id: "chkcpl_gelato_relay_01",
    payment_intent_id: "pi_gelato_relay_01",
    status: "recorded",
    payload: {
      event_name: "purchase_completed",
      event_version: 1,
      occurred_at: "2026-07-02T12:00:00.000Z",
      order_id: "order_gelato_relay_01",
      cart_id: "cart_gelato_relay_01",
      payment_attempt_id: "payatt_gelato_relay_01",
      checkout_completion_log_id: "chkcpl_gelato_relay_01",
      payment_intent_id: "pi_gelato_relay_01",
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
    recorded_at: "2026-07-02T12:00:00.000Z",
    queued_at: null,
    sending_started_at: null,
    sent_at: null,
    failed_at: null,
    dead_lettered_at: null,
    created_at: "2026-07-02T12:00:00.000Z",
    updated_at: "2026-07-02T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  }
}

function buildEmailLog(
  overrides: Partial<EmailDeliveryLogRecord> = {}
): EmailDeliveryLogRecord {
  return {
    id: "emlog_gelato_relay_01",
    email_type: "order_confirmation",
    template_key: "order_confirmation_v1",
    template_version: 1,
    provider: "resend",
    idempotency_key: "order-confirmation/order_gelato_relay_01",
    order_id: "order_gelato_relay_01",
    cart_id: "cart_gelato_relay_01",
    payment_attempt_id: "payatt_gelato_relay_01",
    checkout_completion_log_id: "chkcpl_gelato_relay_01",
    analytics_event_log_id: "anlevt_gelato_relay_01",
    payment_intent_id: "pi_gelato_relay_01",
    status: "sent",
    recipient_email_hash: "hash",
    recipient_email_domain: "lojinha.test",
    payload: {
      order_id: "order_gelato_relay_01",
      order_reference: "8101",
      amount: 9900,
      currency_code: "brl",
      item_count: 1,
      items: [
        {
          sku: "SKU-RELAY-01",
          quantity: 1,
          unit_price: 9900,
          subtotal: 9900,
        },
      ],
      support_email: "suporte@lojinha.test",
    },
    metadata: null,
    provider_message_id: "msg_01",
    attempt_count: 1,
    last_error_code: null,
    last_error_message: null,
    next_retry_at: null,
    recorded_at: "2026-07-02T12:00:00.000Z",
    queued_at: "2026-07-02T12:01:00.000Z",
    sending_started_at: "2026-07-02T12:02:00.000Z",
    sent_at: "2026-07-02T12:03:00.000Z",
    failed_at: null,
    dead_lettered_at: null,
    created_at: "2026-07-02T12:00:00.000Z",
    updated_at: "2026-07-02T12:03:00.000Z",
    deleted_at: null,
    ...overrides,
  }
}

function buildFulfillment(
  overrides: Partial<GelatoFulfillmentRecord> = {}
): GelatoFulfillmentRecord {
  return buildGelatoFulfillmentRecord(
    {
      order_id: "order_gelato_relay_01",
      cart_id: "cart_gelato_relay_01",
      payment_attempt_id: "payatt_gelato_relay_01",
      checkout_completion_log_id: "chkcpl_gelato_relay_01",
      analytics_event_log_id: "anlevt_gelato_relay_01",
      email_delivery_log_id: "emlog_gelato_relay_01",
      request_hash: "sha256:relay",
      request_summary: {
        order_id: "order_gelato_relay_01",
        cart_id: "cart_gelato_relay_01",
        payment_attempt_id: "payatt_gelato_relay_01",
        checkout_completion_log_id: "chkcpl_gelato_relay_01",
        analytics_event_log_id: "anlevt_gelato_relay_01",
        email_delivery_log_id: "emlog_gelato_relay_01",
        idempotency_key: "gelato-dispatch:order_gelato_relay_01",
        request_hash: "sha256:relay",
        item_count: 1,
        currency_code: "brl",
        status: "recorded",
      },
      status: "recorded",
      recorded_at: "2026-07-02T12:00:00.000Z",
      ...(overrides as Partial<GelatoFulfillmentRecord>),
    },
    "gelful_gelato_relay_01",
    new Date("2026-07-02T12:00:00.000Z")
  )
}

function createAnalyticsModule(records: AnalyticsEventLogRecord[] = []) {
  const store = records.map((record) => ({ ...record }))

  return {
    listAnalyticsEventLogs: jest.fn(async () => store),
    store,
  }
}

function createEmailModule(records: EmailDeliveryLogRecord[] = []) {
  const store = records.map((record) => ({ ...record }))

  return {
    listEmailDeliveryLogs: jest.fn(async () => store),
    store,
  }
}

function createOrderModule(records: Array<Record<string, unknown>> = []) {
  const store = records.map((record) => ({ ...record }))

  return {
    listOrders: jest.fn(async (selector?: Record<string, unknown>) => {
      if (!selector || Object.keys(selector).length === 0) {
        return store
      }

      return store.filter((record) => {
        return Object.entries(selector).every(([key, value]) => record[key] === value)
      })
    }),
    store,
  }
}

function createGelatoModule(records: GelatoFulfillmentRecord[] = []) {
  const store = records.map((record) => ({ ...record }))

  return {
    listGelatoFulfillments: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => {
        if (!filters) {
          return true
        }

        return Object.entries(filters).every(([key, value]) => record[key] === value)
      })
    }),
    createGelatoFulfillments: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input

      if (
        store.some(
          (record) =>
            record.order_id === row.order_id ||
            record.idempotency_key === row.idempotency_key
        )
      ) {
        throw new Error("duplicate key value violates unique constraint")
      }

      const created = {
        ...(row as GelatoFulfillmentRecord),
        id: `gelful_store_${store.length + 1}`,
        created_at: "2026-07-02T12:00:00.000Z",
        updated_at: "2026-07-02T12:00:00.000Z",
        deleted_at: null,
      }

      store.push(created)
      return [created]
    }),
    updateGelatoFulfillments: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = store.findIndex((record) => record.id === row.id)

      if (index < 0) {
        throw new Error("gelato fulfillment not found")
      }

      store[index] = {
        ...store[index],
        ...row,
      }

      return [store[index]]
    }),
    store,
  }
}

function createContainer(input: {
  analyticsModule?: ReturnType<typeof createAnalyticsModule>
  emailModule?: ReturnType<typeof createEmailModule>
  gelatoModule?: ReturnType<typeof createGelatoModule>
  orderModule?: ReturnType<typeof createOrderModule>
}) {
  const analyticsModule = input.analyticsModule ?? createAnalyticsModule()
  const emailModule = input.emailModule ?? createEmailModule()
  const gelatoModule = input.gelatoModule ?? createGelatoModule()
  const orderModule = input.orderModule ?? createOrderModule()

  return {
    resolve: jest.fn((key: string) => {
      if (key === ANALYTICS_EVENT_LOG_MODULE || key === "analytics_event_log") {
        return analyticsModule
      }

      if (key === EMAIL_DELIVERY_LOG_MODULE || key === "email_delivery_log") {
        return emailModule
      }

      if (key === GELATO_FULFILLMENT_MODULE || key === "gelato_fulfillment") {
        return gelatoModule
      }

      if (key === Modules.ORDER) {
        return orderModule
      }

      return undefined
    }),
  } as unknown as MedusaContainer
}

function enabledEnv(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    [ENABLE_KEY]: "true",
    [API_ENV_KEY]: API_VALUE,
    [SHIPMENT_ENV_KEY]: "normal",
    ...overrides,
  }
}

describe("Gelato relay config", () => {
  it("retorna null quando relay esta desabilitado ou incompleto", () => {
    expect(resolveGelatoDispatchRelayConfig({})).toBeNull()
    expect(isGelatoDispatchDisabled({})).toBe(true)
    expect(
      resolveGelatoDispatchRelayConfig({
        [ENABLE_KEY]: "true",
      })
    ).toBeNull()
  })

  it("resolve config minima quando habilitado", () => {
    expect(resolveGelatoDispatchRelayConfig(enabledEnv())).toEqual({
      enabled: true,
      apiKey: API_VALUE,
      shipmentMethodUid: "normal",
    })
  })
})

describe("runGelatoDispatchRelay", () => {
  function buildBaseContext() {
    const analyticsModule = createAnalyticsModule([buildAnalyticsEvent()])
    const emailModule = createEmailModule([buildEmailLog()])
    const gelatoModule = createGelatoModule()
    const orderModule = createOrderModule([buildOrder()])

    return {
      analyticsModule,
      emailModule,
      gelatoModule,
      orderModule,
      container: createContainer({
        analyticsModule,
        emailModule,
        gelatoModule,
        orderModule,
      }),
    }
  }

  it("nao envia quando config esta ausente", async () => {
    const ctx = buildBaseContext()
    const createClient = jest.fn()

    const result = await runGelatoDispatchRelay(ctx.container, {
      env: {
        [ENABLE_KEY]: "true",
      },
      config: null,
      createClient,
    })

    expect(result.skipped_missing_config).toBe(true)
    expect(createClient).not.toHaveBeenCalled()
    expect(ctx.gelatoModule.store).toHaveLength(0)
  })

  it("nao envia quando relay esta desabilitado", async () => {
    const ctx = buildBaseContext()
    const createClient = jest.fn()

    const result = await runGelatoDispatchRelay(ctx.container, {
      env: enabledEnv({
        [ENABLE_KEY]: "false",
      }),
      createClient,
    })

    expect(result.skipped_disabled).toBe(true)
    expect(createClient).not.toHaveBeenCalled()
  })

  it("cria fulfillment local e envia com fake client quando EmailDeliveryLog sent chega depois do webhook original", async () => {
    const ctx = buildBaseContext()
    const createOrder = jest.fn(async (): Promise<GelatoDispatchResult> => ({
      status: "submitted",
      gelato_primary_order_id: "gelato_ord_relay_01",
      connected_order_ids: [],
      provider_status: "created",
      provider_reference_id: "order_gelato_relay_01",
    }))

    const result = await runGelatoDispatchRelay(ctx.container, {
      now: () => new Date("2026-07-02T12:10:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
        shipmentMethodUid: "normal",
      },
      createClient: () => ({
        createOrder,
      }),
    })

    expect(result).toEqual<GelatoDispatchRelayResult>({
      processed: 1,
      submitted: 1,
      accepted: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: false,
      skipped_disabled: false,
      created_local_fulfillments: 1,
      reused_local_fulfillments: 0,
    })
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(ctx.gelatoModule.store).toHaveLength(1)
    expect(ctx.gelatoModule.store[0]?.status).toBe("submitted")
    expect(ctx.gelatoModule.store[0]?.gelato_primary_order_id).toBe(
      "gelato_ord_relay_01"
    )
  })

  it("mantem connected_order_ids no mesmo fulfillment em resposta split order", async () => {
    const ctx = buildBaseContext()

    await runGelatoDispatchRelay(ctx.container, {
      now: () => new Date("2026-07-02T12:10:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
      },
      createClient: () => ({
        createOrder: jest.fn(async (): Promise<GelatoDispatchResult> => ({
          status: "accepted",
          gelato_primary_order_id: "gelato_ord_relay_02",
          connected_order_ids: ["gelato_ord_relay_03", "gelato_ord_relay_04"],
          provider_status: "accepted",
          provider_reference_id: "order_gelato_relay_01",
        })),
      }),
    })

    expect(ctx.gelatoModule.store).toHaveLength(1)
    expect(ctx.gelatoModule.store[0]?.connected_order_ids).toEqual([
      "gelato_ord_relay_03",
      "gelato_ord_relay_04",
    ])
  })

  it("aplica retry/backoff para 429 e 5xx", async () => {
    for (const statusCode of [429, 503]) {
      const ctx = buildBaseContext()

      const result = await runGelatoDispatchRelay(ctx.container, {
        now: () => new Date("2026-07-02T12:15:00.000Z"),
        config: {
          enabled: true,
          apiKey: API_VALUE,
        },
        createClient: () => ({
          createOrder: jest.fn(async () => {
            throw Object.assign(new Error(`http_${statusCode}`), { statusCode })
          }),
        }),
      })

      expect(result.failed).toBe(1)
      expect(ctx.gelatoModule.store[0]?.status).toBe("failed")
      expect(ctx.gelatoModule.store[0]?.next_retry_at).toBe(
        "2026-07-02T12:16:00.000Z"
      )
    }
  })

  it("nao faz retry infinito para 400, 401 e 404", async () => {
    for (const statusCode of [400, 401, 404]) {
      const ctx = buildBaseContext()

      const result = await runGelatoDispatchRelay(ctx.container, {
        now: () => new Date("2026-07-02T12:15:00.000Z"),
        config: {
          enabled: true,
          apiKey: API_VALUE,
        },
        createClient: () => ({
          createOrder: jest.fn(async () => {
            throw Object.assign(new Error(`http_${statusCode}`), { statusCode })
          }),
        }),
      })

      expect(result.dead_lettered).toBe(1)
      expect(ctx.gelatoModule.store[0]?.status).toBe("dead_letter")
      expect(ctx.gelatoModule.store[0]?.requires_operator_attention).toBe(true)
    }
  })

  it("marca dead_letter e operator attention em falha persistente", async () => {
    const ctx = buildBaseContext()
    ctx.gelatoModule.store.push(
      buildFulfillment({
        id: "gelful_persistent_01",
        status: "failed",
        attempt_count: 4,
        next_retry_at: "2026-07-02T12:14:00.000Z",
      })
    )

    const result = await runGelatoDispatchRelay(ctx.container, {
      now: () => new Date("2026-07-02T12:15:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
      },
      createClient: () => ({
        createOrder: jest.fn(async () => {
          throw Object.assign(new Error("outage"), { statusCode: 503 })
        }),
      }),
    })

    expect(result.dead_lettered).toBe(1)
    expect(ctx.gelatoModule.store[0]?.status).toBe("dead_letter")
    expect(ctx.gelatoModule.store[0]?.requires_operator_attention).toBe(true)
  })

  it("nao cria fulfillment quando EmailDeliveryLog esta dead_letter ou nao sent", async () => {
    for (const status of [
      "dead_letter",
      "recorded",
      "queued",
      "sending",
      "failed",
    ] as const) {
      const analyticsModule = createAnalyticsModule([buildAnalyticsEvent()])
      const emailModule = createEmailModule([buildEmailLog({ status })])
      const gelatoModule = createGelatoModule()
      const orderModule = createOrderModule([buildOrder()])
      const container = createContainer({
        analyticsModule,
        emailModule,
        gelatoModule,
        orderModule,
      })
      const createOrder = jest.fn()

      const result = await runGelatoDispatchRelay(container, {
        now: () => new Date("2026-07-02T12:10:00.000Z"),
        config: {
          enabled: true,
          apiKey: API_VALUE,
        },
        createClient: () => ({
          createOrder,
        }),
      })

      expect(result.processed).toBe(0)
      expect(gelatoModule.store).toHaveLength(0)
      expect(createOrder).not.toHaveBeenCalled()
    }
  })

  it("nao reverte Order, purchase_completed ou EmailDeliveryLog quando Gelato falha", async () => {
    const ctx = buildBaseContext()

    await runGelatoDispatchRelay(ctx.container, {
      now: () => new Date("2026-07-02T12:15:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
      },
      createClient: () => ({
        createOrder: jest.fn(async () => {
          throw Object.assign(new Error("temporary"), { statusCode: 503 })
        }),
      }),
    })

    expect(ctx.orderModule.store[0]?.metadata).toEqual({
      order_status: "confirmed",
      payment_status: "captured",
    })
    expect(ctx.analyticsModule.store[0]?.status).toBe("recorded")
    expect(ctx.emailModule.store[0]?.status).toBe("sent")
  })

  it("nao reprocessa queued, dispatching e submitted recentes", async () => {
    const baseNow = new Date("2026-07-02T12:15:00.000Z")

    for (const fulfillment of [
      buildFulfillment({
        id: "gelful_recent_queue_01",
        status: "queued",
        queued_at: "2026-07-02T12:10:00.000Z",
      }),
      buildFulfillment({
        id: "gelful_recent_dispatching_01",
        status: "dispatching",
        queued_at: "2026-07-02T12:10:00.000Z",
        dispatching_started_at: "2026-07-02T12:12:00.000Z",
      }),
      buildFulfillment({
        id: "gelful_recent_submitted_01",
        status: "submitted",
        queued_at: "2026-07-02T12:10:00.000Z",
        dispatching_started_at: "2026-07-02T12:11:00.000Z",
        submitted_at: "2026-07-02T12:12:00.000Z",
        gelato_primary_order_id: "gelato_ord_recent_01",
      }),
    ]) {
      const analyticsModule = createAnalyticsModule([buildAnalyticsEvent()])
      const emailModule = createEmailModule([buildEmailLog()])
      const gelatoModule = createGelatoModule([fulfillment])
      const orderModule = createOrderModule([buildOrder()])
      const container = createContainer({
        analyticsModule,
        emailModule,
        gelatoModule,
        orderModule,
      })
      const createOrder = jest.fn()

      const result = await runGelatoDispatchRelay(container, {
        now: () => baseNow,
        config: {
          enabled: true,
          apiKey: API_VALUE,
        },
        createClient: () => ({
          createOrder,
        }),
      })

      expect(result.submitted).toBe(0)
      expect(result.accepted).toBe(0)
      expect(result.failed).toBe(0)
      expect(result.dead_lettered).toBe(0)
      expect(createOrder).not.toHaveBeenCalled()
    }
  })

  it("recupera queued stale antes de qualquer chamada externa", async () => {
    const analyticsModule = createAnalyticsModule([buildAnalyticsEvent()])
    const emailModule = createEmailModule([buildEmailLog()])
    const gelatoModule = createGelatoModule([
      buildFulfillment({
        id: "gelful_stale_queue_01",
        status: "queued",
        queued_at: "2026-07-02T11:00:00.000Z",
      }),
    ])
    const orderModule = createOrderModule([buildOrder()])
    const container = createContainer({
      analyticsModule,
      emailModule,
      gelatoModule,
      orderModule,
    })
    const createOrder = jest.fn(async () => ({
      status: "submitted" as const,
      gelato_primary_order_id: "gelato_ord_recovered_01",
      connected_order_ids: [],
      provider_status: "created",
      provider_reference_id: "order_gelato_relay_01",
    }))

    const result = await runGelatoDispatchRelay(container, {
      now: () => new Date("2026-07-02T12:30:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
      },
      createClient: () => ({
        createOrder,
      }),
    })

    expect(result.submitted).toBe(1)
    expect(createOrder).toHaveBeenCalledTimes(1)
  })

  it("nao cria novo pedido Gelato cegamente quando dispatching stale fica incerto", async () => {
    const analyticsModule = createAnalyticsModule([buildAnalyticsEvent()])
    const emailModule = createEmailModule([buildEmailLog()])
    const gelatoModule = createGelatoModule([
      buildFulfillment({
        id: "gelful_stale_dispatching_01",
        status: "dispatching",
        queued_at: "2026-07-02T11:00:00.000Z",
        dispatching_started_at: "2026-07-02T11:05:00.000Z",
      }),
    ])
    const orderModule = createOrderModule([buildOrder()])
    const container = createContainer({
      analyticsModule,
      emailModule,
      gelatoModule,
      orderModule,
    })
    const createOrder = jest.fn()

    const result = await runGelatoDispatchRelay(container, {
      now: () => new Date("2026-07-02T12:30:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
      },
      createClient: () => ({
        createOrder,
      }),
    })

    expect(result.dead_lettered).toBe(1)
    expect(createOrder).not.toHaveBeenCalled()
    expect(gelatoModule.store[0]?.requires_operator_attention).toBe(true)
  })

  it("operator-gateia submitted stale quando reconciliacao oficial nao esta disponivel", async () => {
    const analyticsModule = createAnalyticsModule([buildAnalyticsEvent()])
    const emailModule = createEmailModule([buildEmailLog()])
    const gelatoModule = createGelatoModule([
      buildFulfillment({
        id: "gelful_stale_submitted_01",
        status: "submitted",
        queued_at: "2026-07-02T11:00:00.000Z",
        dispatching_started_at: "2026-07-02T11:05:00.000Z",
        submitted_at: "2026-07-02T11:06:00.000Z",
        gelato_primary_order_id: "gelato_ord_uncertain_01",
      }),
    ])
    const orderModule = createOrderModule([buildOrder()])
    const container = createContainer({
      analyticsModule,
      emailModule,
      gelatoModule,
      orderModule,
    })

    await runGelatoDispatchRelay(container, {
      now: () => new Date("2026-07-02T12:30:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
      },
      createClient: () => ({
        createOrder: jest.fn(),
      }),
    })

    expect(gelatoModule.store[0]?.status).toBe("dead_letter")
    expect(gelatoModule.store[0]?.requires_operator_attention).toBe(true)
  })

  it("nao redispatcha submitted ou accepted com gelato_primary_order_id local", async () => {
    for (const fulfillment of [
      buildFulfillment({
        id: "gelful_submitted_lock_01",
        status: "submitted",
        queued_at: "2026-07-02T12:01:00.000Z",
        dispatching_started_at: "2026-07-02T12:02:00.000Z",
        submitted_at: "2026-07-02T12:03:00.000Z",
        gelato_primary_order_id: "gelato_ord_lock_01",
      }),
      buildFulfillment({
        id: "gelful_accepted_lock_01",
        status: "accepted",
        queued_at: "2026-07-02T12:01:00.000Z",
        dispatching_started_at: "2026-07-02T12:02:00.000Z",
        submitted_at: "2026-07-02T12:03:00.000Z",
        accepted_at: "2026-07-02T12:04:00.000Z",
        gelato_primary_order_id: "gelato_ord_lock_02",
      }),
    ]) {
      const analyticsModule = createAnalyticsModule([buildAnalyticsEvent()])
      const emailModule = createEmailModule([buildEmailLog()])
      const gelatoModule = createGelatoModule([fulfillment])
      const orderModule = createOrderModule([buildOrder()])
      const container = createContainer({
        analyticsModule,
        emailModule,
        gelatoModule,
        orderModule,
      })
      const createOrder = jest.fn()

      const result = await runGelatoDispatchRelay(container, {
        now: () => new Date("2026-07-02T12:05:00.000Z"),
        config: {
          enabled: true,
          apiKey: API_VALUE,
        },
        createClient: () => ({
          createOrder,
        }),
      })

      expect(result.submitted).toBe(0)
      expect(result.accepted).toBe(0)
      expect(createOrder).not.toHaveBeenCalled()
    }
  })

  it("persiste dead_letter antes do alert upsert e usa severity critical", async () => {
    const ctx = buildBaseContext()
    const upsertOrder: string[] = []
    const originalUpdate = ctx.gelatoModule.updateGelatoFulfillments
    ctx.gelatoModule.updateGelatoFulfillments = jest.fn(async (input) => {
      const result = await originalUpdate(input)
      const row = Array.isArray(result) ? result[0] : result
      if (row?.status === "dead_letter") {
        upsertOrder.push("gelato_persisted")
      }
      return result
    })
    const upsertOperationalAlert = jest.fn(async () => {
      upsertOrder.push("alert_upsert")
      return { id: "opalert_1" }
    })

    await runGelatoDispatchRelay(ctx.container, {
      now: () => new Date("2026-07-02T12:15:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
      },
      createClient: () => ({
        createOrder: jest.fn(async () => {
          throw Object.assign(new Error("http_400"), { statusCode: 400 })
        }),
      }),
      upsertOperationalAlert,
    })

    expect(ctx.gelatoModule.store[0]?.status).toBe("dead_letter")
    expect(upsertOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "fulfillment_failed",
        severity: "critical",
        entity_type: "fulfillment",
        message_code: "FULFILLMENT_DEAD_LETTER",
      })
    )
    expect(upsertOrder.indexOf("gelato_persisted")).toBeGreaterThanOrEqual(0)
    expect(upsertOrder.indexOf("alert_upsert")).toBeGreaterThan(
      upsertOrder.indexOf("gelato_persisted")
    )
    expect(JSON.stringify(upsertOperationalAlert.mock.calls)).not.toMatch(
      /client_secret|authorization|payload|stack/i
    )
  })

  it("persiste operator attention stale antes do alert upsert", async () => {
    const analyticsModule = createAnalyticsModule([buildAnalyticsEvent()])
    const emailModule = createEmailModule([buildEmailLog()])
    const gelatoModule = createGelatoModule([
      buildFulfillment({
        id: "gelful_stale_alert_01",
        status: "dispatching",
        queued_at: "2026-07-02T11:00:00.000Z",
        dispatching_started_at: "2026-07-02T11:05:00.000Z",
      }),
    ])
    const orderModule = createOrderModule([buildOrder()])
    const container = createContainer({
      analyticsModule,
      emailModule,
      gelatoModule,
      orderModule,
    })
    const upsertOrder: string[] = []
    const originalUpdate = gelatoModule.updateGelatoFulfillments
    gelatoModule.updateGelatoFulfillments = jest.fn(async (input) => {
      const result = await originalUpdate(input)
      const row = Array.isArray(result) ? result[0] : result
      if (row?.requires_operator_attention) {
        upsertOrder.push("gelato_persisted")
      }
      return result
    })
    const upsertOperationalAlert = jest.fn(async () => {
      upsertOrder.push("alert_upsert")
      return { id: "opalert_2" }
    })
    const createOrder = jest.fn()

    await runGelatoDispatchRelay(container, {
      now: () => new Date("2026-07-02T12:30:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
      },
      createClient: () => ({ createOrder }),
      upsertOperationalAlert,
    })

    expect(gelatoModule.store[0]?.requires_operator_attention).toBe(true)
    expect(gelatoModule.store[0]?.status).toBe("dead_letter")
    expect(upsertOperationalAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "critical",
        message_code: "FULFILLMENT_DEAD_LETTER",
      })
    )
    expect(createOrder).not.toHaveBeenCalled()
    expect(upsertOrder.indexOf("alert_upsert")).toBeGreaterThan(
      upsertOrder.indexOf("gelato_persisted")
    )
  })

  it("preserva verdade local e nao chama Gelato de novo quando alert upsert falha", async () => {
    const ctx = buildBaseContext()
    const createOrder = jest.fn(async () => {
      throw Object.assign(new Error("http_401"), { statusCode: 401 })
    })
    const logger = { warn: jest.fn() }

    await runGelatoDispatchRelay(ctx.container, {
      now: () => new Date("2026-07-02T12:15:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
      },
      createClient: () => ({ createOrder }),
      upsertOperationalAlert: jest.fn(async () => {
        throw new Error("alert unavailable")
      }),
      logger,
    })

    expect(ctx.gelatoModule.store[0]?.status).toBe("dead_letter")
    expect(ctx.gelatoModule.store[0]?.requires_operator_attention).toBe(true)
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      "GELATO_DISPATCH_ALERT_UPSERT_FAILED",
      expect.objectContaining({
        error_code: "GELATO_DISPATCH_ALERT_UPSERT_FAILED",
        fulfillment_id: expect.any(String),
      })
    )
  })

  it("nao alerta estado nao elegivel de fulfillment", async () => {
    const ctx = buildBaseContext()
    const upsertOperationalAlert = jest.fn()

    await runGelatoDispatchRelay(ctx.container, {
      now: () => new Date("2026-07-02T12:15:00.000Z"),
      config: {
        enabled: true,
        apiKey: API_VALUE,
      },
      createClient: () => ({
        createOrder: jest.fn(async () => {
          throw Object.assign(new Error("temporary"), { statusCode: 503 })
        }),
      }),
      upsertOperationalAlert,
    })

    expect(ctx.gelatoModule.store[0]?.status).toBe("failed")
    expect(ctx.gelatoModule.store[0]?.requires_operator_attention).toBe(false)
    expect(upsertOperationalAlert).not.toHaveBeenCalled()
  })
})

describe("createGelatoDispatchClient", () => {
  it("expoe createOrder sem chamar rede em teste", () => {
    const client = createGelatoDispatchClient()

    expect(typeof client.createOrder).toBe("function")
  })
})

describe("gelatoDispatchRelayJob migration mode", () => {
  it("retorna antes de resolver dependencias ou emitir logs operacionais", async () => {
    const originalMode = process.env.DTC_RELEASE_MIGRATION_MODE
    const originalChild = process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS
    process.env.DTC_RELEASE_MIGRATION_MODE = "true"
    process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS = "true"
    const container = { resolve: jest.fn() } as unknown as MedusaContainer
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined)

    try {
      await gelatoDispatchRelayJob(container)
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
