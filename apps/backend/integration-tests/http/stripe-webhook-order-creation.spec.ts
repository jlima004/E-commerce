import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStripeWebhookPostHandler } from "../../src/api/hooks/stripe/route"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../src/modules/analytics-event-log"
import { CHECKOUT_COMPLETION_MODULE } from "../../src/modules/checkout-completion"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { WEBHOOKS_MODULE } from "../../src/modules/webhooks"
import { runCreateOrderFromConfirmedPaymentAttemptEntrypoint } from "../../src/workflows/order/webhook-order-entrypoint"
import { runAnalyticsPosthogRelay } from "../../src/jobs/analytics-posthog-relay"
import { runEmailResendRelay } from "../../src/jobs/email-resend-relay"
import { isPurchaseCompletedLocallyRecorded } from "../../src/modules/analytics-event-log/service"
import { EMAIL_DELIVERY_LOG_MODULE } from "../../src/modules/email-delivery-log"
import {
  buildRecipientEmailAudit,
  isOrderConfirmationEmailLocallyRecorded,
} from "../../src/modules/email-delivery-log/service"

type RequestWithRawBody = MedusaRequest & {
  rawBody?: Buffer | string
  correlationId?: string
}

type StoredWebhookRecord = {
  id: string
  provider: string
  external_event_id: string | null
  deduplication_key: string
  event_type: string
  status: string
  entity_type?: string
  entity_id?: string | null
  error_code?: string | null
  error_message?: string | null
  processed_at?: string | null
  failed_at?: string | null
  ignored_at?: string | null
  metadata?: Record<string, unknown> | null
}

type StoredCheckoutCompletionRecord = {
  id: string
  idempotency_key: string
  cart_id: string
  payment_intent_id: string
  payment_attempt_id: string
  order_id?: string | null
  status: string
  metadata?: Record<string, unknown> | null
  error_code?: string | null
  error_message?: string | null
  completed_at?: string | null
  failed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type StoredAnalyticsEventRecord = {
  id: string
  event_name: string
  event_version: number
  idempotency_key: string
  order_id: string
  cart_id: string
  payment_attempt_id: string
  checkout_completion_log_id: string
  payment_intent_id: string
  status: string
  payload: Record<string, unknown>
  metadata?: Record<string, unknown> | null
  attempt_count: number
  last_error_code?: string | null
  last_error_message?: string | null
  next_retry_at?: string | null
  recorded_at: string
  queued_at?: string | null
  sending_started_at?: string | null
  sent_at?: string | null
  failed_at?: string | null
  dead_lettered_at?: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

type StoredEmailDeliveryRecord = {
  id: string
  email_type: string
  template_key: string
  template_version: number
  provider: string
  idempotency_key: string
  order_id: string
  cart_id: string
  payment_attempt_id: string
  checkout_completion_log_id: string
  analytics_event_log_id: string
  payment_intent_id: string
  status: string
  recipient_email_hash: string
  recipient_email_domain: string
  payload: Record<string, unknown>
  metadata?: Record<string, unknown> | null
  attempt_count: number
  last_error_code?: string | null
  last_error_message?: string | null
  next_retry_at?: string | null
  recorded_at: string
  queued_at?: string | null
  sending_started_at?: string | null
  sent_at?: string | null
  failed_at?: string | null
  dead_lettered_at?: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

type OrderCartLineItemRecord = {
  id: string
  quantity: number
  metadata?: Record<string, unknown> | null
  variant?: {
    id?: string | null
    sku?: string | null
    metadata?: Record<string, unknown> | null
    prices?: Array<{
      amount: number
      currency_code: string
    }> | null
  } | null
}

type OrderCartRecord = {
  id: string
  total: number
  currency_code: string
  completed_at: string | null
  items: OrderCartLineItemRecord[]
}

const EXACT_GELATO_SNAPSHOT_KEYS = [
  "gelato_product_uid",
  "gelato_template_id",
  "gelato_variant_options",
  "template_mode",
  "source_product_variant_id",
  "source_product_variant_sku",
  "captured_at",
]

const FORBIDDEN_STRINGS = [
  ["purchase", "completed"].join("_"),
  ["Analytics", "Event", "Log"].join(""),
  ["Email", "Delivery", "Log"].join(""),
  ["order", "gelatoapis", "com"].join("."),
  ["gelato", "order", "id"].join("_"),
  ["ref", "und"].join(""),
] as const

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const SUPPORT_EMAIL = joinKey("support", "@", "lojinha", ".", "test")
const ORDER_EMAIL = joinKey("comprador", "@", "loja", ".", "test")

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_order_http_01",
    cart_id: "cart_order_http_01",
    payment_collection_id: "paycol_order_http_01",
    payment_session_id: "payses_order_http_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_order_http_123",
    provider_payment_session_id: "ps_order_http_123",
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-06-30T10:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-06-30T09:00:00.000Z",
    updated_at: "2026-06-30T09:00:00.000Z",
    ...overrides,
  }
}

function createResponse() {
  const response = {
    statusCode: 200,
    status: jest.fn(function status(code: number) {
      response.statusCode = code
      return response
    }),
    json: jest.fn(function json(body: unknown) {
      return body
    }),
  }

  return response as MedusaResponse & {
    statusCode: number
    status: jest.Mock
    json: jest.Mock
  }
}

function createStatefulWebhookService(records: StoredWebhookRecord[] = []) {
  return {
    listWebhookEventLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return records.filter((record) => {
        return (
          (!filters?.provider || record.provider === filters.provider) &&
          (!filters?.deduplication_key ||
            record.deduplication_key === filters.deduplication_key)
        )
      })
    }),
    createWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const duplicate = records.find(
        (record) =>
          record.provider === row.provider &&
          record.deduplication_key === row.deduplication_key
      )

      if (duplicate) {
        throw new Error("duplicate key value violates unique constraint")
      }

      const created: StoredWebhookRecord = {
        id: `whlog_order_${records.length + 1}`,
        provider: row.provider,
        external_event_id: row.external_event_id ?? null,
        deduplication_key: row.deduplication_key,
        event_type: row.event_type,
        status: row.status ?? "received",
        entity_type: row.entity_type ?? "unknown",
        entity_id: row.entity_id ?? null,
        error_code: row.error_code ?? null,
        error_message: row.error_message ?? null,
        processed_at: row.processed_at ?? null,
        failed_at: row.failed_at ?? null,
        ignored_at: row.ignored_at ?? null,
        metadata: row.metadata ?? null,
      }
      records.push(created)
      return [created]
    }),
    updateWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = records.findIndex((record) => record.id === row.id)
      if (index < 0) {
        throw new Error("webhook record not found")
      }

      records[index] = {
        ...records[index],
        ...row,
      }

      return [records[index]]
    }),
    records,
  }
}

function createPaymentAttemptModule(attempts: PaymentAttemptRecord[] = []) {
  const store = [...attempts]

  return {
    listPaymentAttempts: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((attempt) => {
        if (filters?.id && attempt.id !== filters.id) {
          return false
        }
        if (
          filters?.provider_payment_intent_id &&
          attempt.provider_payment_intent_id !==
            filters.provider_payment_intent_id
        ) {
          return false
        }
        return true
      })
    }),
    updatePaymentAttempts: jest.fn(async (input) => {
      const rows = Array.isArray(input) ? input : [input]
      for (const row of rows) {
        const index = store.findIndex((attempt) => attempt.id === row.id)
        if (index >= 0) {
          store[index] = row
        }
      }
      return rows
    }),
    attempts: store,
  }
}

function buildOrderCart(
  overrides: Partial<OrderCartRecord> = {}
): OrderCartRecord {
  return {
    id: "cart_order_http_01",
    total: 9900,
    currency_code: "brl",
    completed_at: null,
    items: [
      {
        id: "line_item_http_01",
        quantity: 1,
        metadata: {
          safe_note: "preserve",
        },
        variant: {
          id: "variant_http_01",
          sku: "SKU-HTTP-01",
          metadata: {
            gelato_product_uid: "gelato_prod_http_01",
            gelato_template_id: "tmpl_http_01",
            gelato_variant_options: {
              size: "M",
              color: "Preto",
            },
            template_mode: "fixed",
          },
          prices: [
            {
              amount: 9900,
              currency_code: "brl",
            },
          ],
        },
      },
      {
        id: "line_item_http_02",
        quantity: 1,
        metadata: {
          gift_wrap: false,
        },
        variant: {
          id: "variant_http_02",
          sku: "SKU-HTTP-02",
          metadata: {
            gelato_product_uid: "gelato_prod_http_02",
            gelato_template_id: "tmpl_http_02",
            gelato_variant_options: {
              size: "G",
              color: "Branco",
            },
            template_mode: "fixed",
          },
          prices: [
            {
              amount: 9900,
              currency_code: "brl",
            },
          ],
        },
      },
    ],
    ...overrides,
  }
}

function createCheckoutCompletionModule(
  records: StoredCheckoutCompletionRecord[] = []
) {
  const store = [...records]

  return {
    listCheckoutCompletionLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => {
        if (
          filters?.idempotency_key &&
          record.idempotency_key !== filters.idempotency_key
        ) {
          return false
        }

        return true
      })
    }),
    createCheckoutCompletionLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input

      if (
        store.some(
          (record) => record.idempotency_key === row.idempotency_key
        )
      ) {
        throw new Error("duplicate key value violates unique constraint")
      }

      const created: StoredCheckoutCompletionRecord = {
        ...row,
        id: `chkcpl_http_${store.length + 1}`,
      }
      store.push(created)
      return [created]
    }),
    updateCheckoutCompletionLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = store.findIndex((record) => record.id === row.id)

      if (index < 0) {
        throw new Error("checkout completion log not found")
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

function createAnalyticsEventLogModule(
  records: StoredAnalyticsEventRecord[] = []
) {
  const store = [...records]

  return {
    listAnalyticsEventLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => {
        if (
          filters?.idempotency_key &&
          record.idempotency_key !== filters.idempotency_key
        ) {
          return false
        }

        if (filters?.order_id && record.order_id !== filters.order_id) {
          return false
        }

        if (filters?.status && record.status !== filters.status) {
          return false
        }

        return true
      })
    }),
    createAnalyticsEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input

      if (
        store.some(
          (record) =>
            record.idempotency_key === row.idempotency_key ||
            record.order_id === row.order_id
        )
      ) {
        throw new Error("duplicate key value violates unique constraint")
      }

      const created: StoredAnalyticsEventRecord = {
        ...row,
        id: `anlevt_http_${store.length + 1}`,
      }
      store.push(created)
      return [created]
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

function createEmailDeliveryLogModule(
  records: StoredEmailDeliveryRecord[] = []
) {
  const store = [...records]

  return {
    listEmailDeliveryLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => {
        if (
          filters?.idempotency_key &&
          record.idempotency_key !== filters.idempotency_key
        ) {
          return false
        }

        if (filters?.order_id && record.order_id !== filters.order_id) {
          return false
        }

        if (filters?.status && record.status !== filters.status) {
          return false
        }

        return true
      })
    }),
    createEmailDeliveryLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input

      if (
        store.some(
          (record) =>
            record.idempotency_key === row.idempotency_key ||
            (record.email_type === row.email_type &&
              record.order_id === row.order_id)
        )
      ) {
        throw new Error("duplicate key value violates unique constraint")
      }

      const created: StoredEmailDeliveryRecord = {
        ...row,
        id: `emlog_http_${store.length + 1}`,
      }
      store.push(created)
      return [created]
    }),
    updateEmailDeliveryLogs: jest.fn(async (input) => {
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

function createCartModule(cart: OrderCartRecord) {
  return {
    updateLineItems: jest.fn(async (updates) => {
      for (const update of updates) {
        const item = cart.items.find((entry) => entry.id === update.selector.id)
        if (item) {
          item.metadata = update.data.metadata
        }
      }

      return updates
    }),
  }
}

function createOrderModule() {
  const store: Array<Record<string, unknown>> = []

  return {
    listOrders: jest.fn(async (selector?: Record<string, unknown>) => {
      return store.filter((order) => {
        if (selector?.id && order.id !== selector.id) {
          return false
        }
        if (selector?.cart_id && order.cart_id !== selector.cart_id) {
          return false
        }

        return true
      })
    }),
    updateOrders: jest.fn(
      async (
        selector: Record<string, unknown>,
        update: Record<string, unknown>
      ) => {
        const index = store.findIndex((order) => order.id === selector.id)
        if (index >= 0) {
          store[index] = {
            ...store[index],
            ...update,
          }
        }

        return index >= 0 ? [store[index]] : []
      }
    ),
    store,
  }
}

function createQueryGraph(cart: OrderCartRecord) {
  return {
    graph: jest.fn(async (input: { filters?: Record<string, unknown> }) => {
      return {
        data: input.filters?.id === cart.id ? [cart] : [],
      }
    }),
  }
}

function createRequest(
  scopeResolve: jest.Mock,
  overrides: Partial<RequestWithRawBody> = {}
) {
  return {
    headers: {
      "stripe-signature": "t=1,v1=signature",
    },
    scope: {
      resolve: scopeResolve,
    },
    rawBody: Buffer.from('{"id":"evt_order_default","type":"payment_intent.succeeded"}'),
    correlationId: "corr_order_http_01",
    ...overrides,
  } as RequestWithRawBody
}

function createScopeResolve(input: {
  webhookService: ReturnType<typeof createStatefulWebhookService>
  paymentAttemptModule?: ReturnType<typeof createPaymentAttemptModule>
  checkoutCompletionModule?: ReturnType<typeof createCheckoutCompletionModule>
  analyticsEventLogModule?: ReturnType<typeof createAnalyticsEventLogModule>
  emailDeliveryLogModule?: ReturnType<typeof createEmailDeliveryLogModule>
  cartModule?: ReturnType<typeof createCartModule>
  orderModule?: ReturnType<typeof createOrderModule>
  queryGraph?: ReturnType<typeof createQueryGraph>
}) {
  const analyticsEventLogModule =
    input.analyticsEventLogModule ?? createAnalyticsEventLogModule()
  const emailDeliveryLogModule =
    input.emailDeliveryLogModule ?? createEmailDeliveryLogModule()

  return jest.fn((key: string) => {
    if (key === WEBHOOKS_MODULE) {
      return input.webhookService
    }

    if (key === PAYMENT_ATTEMPT_MODULE) {
      return input.paymentAttemptModule
    }

    if (key === CHECKOUT_COMPLETION_MODULE) {
      return input.checkoutCompletionModule
    }

    if (key === ANALYTICS_EVENT_LOG_MODULE || key === "analytics_event_log") {
      return analyticsEventLogModule
    }

    if (key === EMAIL_DELIVERY_LOG_MODULE || key === "email_delivery_log") {
      return emailDeliveryLogModule
    }

    if (key === Modules.CART) {
      return input.cartModule
    }

    if (key === Modules.ORDER) {
      return input.orderModule
    }

    if (key === ContainerRegistrationKeys.QUERY) {
      return input.queryGraph
    }

    return undefined
  })
}

function createHandler(
  event: Record<string, unknown>,
  runOrderEntrypoint: jest.Mock = jest.fn(async () => ({
    status: "created",
    payment_attempt_id: "payatt_order_http_01",
    payment_intent_id: "pi_order_http_123",
    order_id: "order_http_01",
    stripe_event_id: "evt_order_entrypoint",
    correlation_id: "corr_order_http_01",
    checkout_completion_status: "completed",
    order_status: "confirmed",
    payment_status: "captured",
  }))
) {
  return createStripeWebhookPostHandler({
    appEnv: {
      STRIPE_WEBHOOK_INGESTION_ENABLED: true,
      STRIPE_WEBHOOK_SECRET: "test_webhook_secret_fixture",
    } as never,
    stripe: {
      webhooks: {
        constructEvent: jest.fn(() => event),
      },
    },
    now: () => new Date("2026-06-30T12:00:00.000Z"),
    runOrderEntrypoint,
  })
}

function serializeProof(payload: unknown) {
  return JSON.stringify(payload)
}

describe("stripe webhook order creation integration", () => {
  const originalSupportEmail = process.env.SUPPORT_EMAIL

  beforeEach(() => {
    process.env.SUPPORT_EMAIL = SUPPORT_EMAIL
  })

  afterEach(() => {
    if (originalSupportEmail === undefined) {
      delete process.env.SUPPORT_EMAIL
    } else {
      process.env.SUPPORT_EMAIL = originalSupportEmail
    }
  })

  it("webhook valido cria fluxo interno, completa correlacao e nao expande para efeitos da Phase 07", async () => {
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const runOrderEntrypoint = jest.fn(async () => ({
      status: "created" as const,
      payment_attempt_id: "payatt_order_http_01",
      payment_intent_id: "pi_order_http_123",
      order_id: "order_http_01",
      stripe_event_id: "evt_order_entrypoint",
      correlation_id: "corr_order_http_01",
      checkout_completion_status: "completed" as const,
      order_status: "confirmed" as const,
      payment_status: "captured" as const,
    }))
    const handler = createHandler(
      {
        id: "evt_order_entrypoint",
        type: "payment_intent.succeeded",
        livemode: false,
        data: {
          object: {
            id: "pi_order_http_123",
            object: "payment_intent",
            amount: 9900,
            amount_received: 9900,
            currency: "brl",
            metadata: {
              cart_id: "cart_order_http_01",
            },
            payment_method_types: ["card"],
          },
        },
      },
      runOrderEntrypoint
    )
    const res = createResponse()

    await handler(
      createRequest(
        createScopeResolve({
          webhookService,
          paymentAttemptModule,
        })
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(paymentAttemptModule.attempts[0]).toEqual(
      expect.objectContaining({
        status: "payment_confirmed_by_webhook",
        order_id: null,
      })
    )
    expect(runOrderEntrypoint).toHaveBeenCalledTimes(1)
    expect(runOrderEntrypoint).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        payment_attempt_id: "payatt_order_http_01",
        payment_intent_id: "pi_order_http_123",
        stripe_event_id: "evt_order_entrypoint",
        correlation_id: "corr_order_http_01",
      })
    )
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: false,
        status: "processed",
      })
    )

    const proof = serializeProof({
      body: res.json.mock.calls[0][0],
      attempts: paymentAttemptModule.attempts,
      entrypointCalls: runOrderEntrypoint.mock.calls,
    })
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(proof).not.toContain(forbidden)
    }
  })

  it("duplicate received com attempt confirmada respeita replay idempotente", async () => {
    const webhookService = createStatefulWebhookService([
      {
        id: "whlog_order_received_retry",
        provider: "stripe",
        external_event_id: "evt_order_received_retry",
        deduplication_key: "evt_order_received_retry",
        event_type: "payment_intent.succeeded",
        status: "received",
        entity_type: "unknown",
        entity_id: null,
        error_code: null,
        error_message: null,
        processed_at: null,
        failed_at: null,
        ignored_at: null,
        metadata: null,
      },
    ])
    const paymentAttemptModule = createPaymentAttemptModule([
      buildAttempt({ status: "payment_confirmed_by_webhook" }),
    ])
    const runOrderEntrypoint = jest.fn(async () => ({
      status: "reused_existing_order" as const,
      payment_attempt_id: "payatt_order_http_01",
      payment_intent_id: "pi_order_http_123",
      order_id: "order_http_existing",
      stripe_event_id: "evt_order_received_retry",
      correlation_id: "corr_order_http_01",
      checkout_completion_status: "completed" as const,
      order_status: "confirmed" as const,
      payment_status: "captured" as const,
    }))
    const handler = createHandler(
      {
        id: "evt_order_received_retry",
        type: "payment_intent.succeeded",
        livemode: false,
        data: {
          object: {
            id: "pi_order_http_123",
            object: "payment_intent",
            amount: 9900,
            amount_received: 9900,
            currency: "brl",
            metadata: {
              cart_id: "cart_order_http_01",
            },
            payment_method_types: ["card"],
          },
        },
      },
      runOrderEntrypoint
    )
    const res = createResponse()

    await handler(
      createRequest(
        createScopeResolve({
          webhookService,
          paymentAttemptModule,
        }),
        {
          rawBody: Buffer.from(
            '{"id":"evt_order_received_retry","type":"payment_intent.succeeded"}'
          ),
        }
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: true,
        status: "processed",
      })
    )
    expect(runOrderEntrypoint).toHaveBeenCalledTimes(1)
  })

  it("eventos de falha ou cancelamento nao chamam criacao de Order", async () => {
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const runOrderEntrypoint = jest.fn()
    const handler = createHandler(
      {
        id: "evt_order_failed",
        type: "payment_intent.payment_failed",
        livemode: false,
        data: {
          object: {
            id: "pi_order_http_123",
            object: "payment_intent",
            amount: 9900,
            currency: "brl",
            metadata: {
              cart_id: "cart_order_http_01",
            },
            payment_method_types: ["card"],
          },
        },
      },
      runOrderEntrypoint
    )
    const res = createResponse()

    await handler(
      createRequest(
        createScopeResolve({
          webhookService,
          paymentAttemptModule,
        }),
        {
          rawBody: Buffer.from(
            '{"id":"evt_order_failed","type":"payment_intent.payment_failed"}'
          ),
        }
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(paymentAttemptModule.attempts[0]?.status).toBe("payment_failed")
    expect(runOrderEntrypoint).not.toHaveBeenCalled()
  })

  it("gelato_snapshot edge multi-line mantem shape v1 e imutabilidade apos ProductVariant mudar", async () => {
    const cart = buildOrderCart()
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const cartModule = createCartModule(cart)
    const orderModule = createOrderModule()
    const queryGraph = createQueryGraph(cart)
    const runCompleteCart = jest.fn(async (_container, cartId: string) => {
      const order = {
        id: "order_http_real_01",
        cart_id: cartId,
        email: ORDER_EMAIL,
        display_id: 2001,
        metadata: null,
        items: cart.items.map((item) => ({
          id: `ordli_${item.id}`,
          metadata: {
            ...(item.metadata ?? {}),
          },
        })),
      }
      orderModule.store.push(order)

      return { id: order.id }
    })
    const handler = createHandler(
      {
        id: "evt_order_snapshot_edge",
        type: "payment_intent.succeeded",
        livemode: false,
        data: {
          object: {
            id: "pi_order_http_123",
            object: "payment_intent",
            amount: 9900,
            amount_received: 9900,
            currency: "brl",
            metadata: {
              cart_id: "cart_order_http_01",
            },
            payment_method_types: ["card"],
          },
        },
      },
      (scope, input) =>
        runCreateOrderFromConfirmedPaymentAttemptEntrypoint(scope as never, input, {
          now: () => new Date("2026-06-30T12:00:00.000Z"),
          runCompleteCart,
        })
    )
    const res = createResponse()

    await handler(
      createRequest(
        createScopeResolve({
          webhookService,
          paymentAttemptModule,
          checkoutCompletionModule,
          cartModule,
          orderModule,
          queryGraph,
        }),
        {
          rawBody: Buffer.from(
            '{"id":"evt_order_snapshot_edge","type":"payment_intent.succeeded"}'
          ),
        }
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "processed",
      })
    )
    expect(cartModule.updateLineItems).toHaveBeenCalledTimes(1)
    expect(runCompleteCart).toHaveBeenCalledTimes(1)
    expect(orderModule.store).toHaveLength(1)
    const order = orderModule.store[0] as {
      items: Array<{ metadata: Record<string, unknown> }>
    }
    const snapshots = order.items.map((item) => item.metadata.gelato_snapshot)

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]).toEqual({
      gelato_product_uid: "gelato_prod_http_01",
      gelato_template_id: "tmpl_http_01",
      gelato_variant_options: {
        size: "M",
        color: "Preto",
      },
      template_mode: "fixed",
      source_product_variant_id: "variant_http_01",
      source_product_variant_sku: "SKU-HTTP-01",
      captured_at: "2026-06-30T12:00:00.000Z",
    })
    expect(Object.keys(snapshots[0] as Record<string, unknown>)).toEqual(
      EXACT_GELATO_SNAPSHOT_KEYS
    )
    expect((snapshots[0] as Record<string, unknown>).captured_at).toBe(
      (snapshots[1] as Record<string, unknown>).captured_at
    )
    expect(order.items[0]?.metadata.safe_note).toBe("preserve")
    expect(order.items[1]?.metadata.gift_wrap).toBe(false)

    const persistedSnapshot = JSON.parse(JSON.stringify(snapshots[0]))
    const firstVariantMetadata = cart.items[0]?.variant?.metadata
    if (firstVariantMetadata) {
      firstVariantMetadata.gelato_template_id = "tmpl_mutated_future"
      firstVariantMetadata.gelato_variant_options = {
        size: "GG",
        color: "Azul",
      }
    }

    expect(order.items[0]?.metadata.gelato_snapshot).toEqual(persistedSnapshot)
    expect(checkoutCompletionModule.store[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        order_id: "order_http_real_01",
      })
    )
    expect(paymentAttemptModule.attempts[0]?.order_id).toBe("order_http_real_01")
  })

  it("snapshot failure edge marca CheckoutCompletionLog.failed sanitizado e retry nao cria Order parcial", async () => {
    const invalidItem = buildOrderCart().items[0]
    const cart = buildOrderCart({
      items: [
        {
          ...invalidItem,
          variant: {
            ...invalidItem?.variant,
            metadata: {
              gelato_product_uid: "gelato_prod_http_01",
              gelato_variant_options: {
                size: "M",
                color: "Preto",
              },
              template_mode: "fixed",
            },
          },
        },
      ],
    })
    const webhookService = createStatefulWebhookService()
    const paymentAttemptModule = createPaymentAttemptModule([buildAttempt()])
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const cartModule = createCartModule(cart)
    const orderModule = createOrderModule()
    const queryGraph = createQueryGraph(cart)
    const runCompleteCart = jest.fn(async () => {
      orderModule.store.push({ id: "order_should_not_exist" })

      return { id: "order_should_not_exist" }
    })
    const runEntrypoint = (
      scope: MedusaRequest["scope"],
      input: {
        payment_attempt_id: string
        payment_intent_id: string
        stripe_event_id?: string | null
        correlation_id?: string | null
      }
    ) =>
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(scope as never, input, {
        now: () => new Date("2026-06-30T12:00:00.000Z"),
        runCompleteCart,
      })
    const createSnapshotFailureHandler = (eventId: string) =>
      createHandler(
        {
          id: eventId,
          type: "payment_intent.succeeded",
          livemode: false,
          data: {
            object: {
              id: "pi_order_http_123",
              object: "payment_intent",
              amount: 9900,
              amount_received: 9900,
              currency: "brl",
              metadata: {
                cart_id: "cart_order_http_01",
              },
              payment_method_types: ["card"],
            },
          },
        },
        runEntrypoint
      )

    for (const eventId of [
      "evt_order_snapshot_failure",
      "evt_order_snapshot_failure_retry",
    ]) {
      const handler = createSnapshotFailureHandler(eventId)
      const res = createResponse()

      await handler(
        createRequest(
          createScopeResolve({
            webhookService,
            paymentAttemptModule,
            checkoutCompletionModule,
            cartModule,
            orderModule,
            queryGraph,
          }),
          {
            rawBody: Buffer.from(
              `{"id":"${eventId}","type":"payment_intent.succeeded"}`
            ),
          }
        ),
        res
      )

      expect(res.statusCode).toBe(200)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
        })
      )
    }

    expect(checkoutCompletionModule.store).toHaveLength(1)
    expect(checkoutCompletionModule.store[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        order_id: null,
        error_code: "ORDER_GELATO_METADATA_INCOMPLETE",
        error_message:
          "Nao foi possivel gerar o snapshot Gelato para o item do carrinho.",
      })
    )
    expect(runCompleteCart).not.toHaveBeenCalled()
    expect(orderModule.store).toHaveLength(0)
    expect(paymentAttemptModule.attempts[0]).toEqual(
      expect.objectContaining({
        status: "payment_confirmed_by_webhook",
        order_id: null,
      })
    )
  })

  it(
    ["purchase_completed local e gravado no fluxo aceito da Order sem chamar Post", "Hog"].join(""),
    async () => {
    const cart = buildOrderCart({
      items: [
        {
          id: "line_item_http_outbox_01",
          quantity: 1,
          metadata: {
            safe_note: "preserve",
          },
          variant: {
            id: "variant_http_outbox_01",
            sku: "SKU-HTTP-OUTBOX-01",
            metadata: {
              gelato_product_uid: "gelato_prod_http_outbox_01",
              gelato_template_id: "tmpl_http_outbox_01",
              gelato_variant_options: {
                size: "M",
                color: "Azul",
              },
              template_mode: "fixed",
            },
            prices: [
              {
                amount: 9900,
                currency_code: "brl",
              },
            ],
          },
        },
      ],
    })
    const paymentAttemptModule = createPaymentAttemptModule([
      buildAttempt({
        payment_method_type: "pix",
        status: "payment_confirmed_by_webhook",
      }),
    ])
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const cartModule = createCartModule(cart)
    const orderModule = createOrderModule()
    const queryGraph = createQueryGraph(cart)
    const runCompleteCart = jest.fn(async (_container, cartId: string) => {
      const order = {
        id: "order_http_outbox_01",
        cart_id: cartId,
        email: ORDER_EMAIL,
        display_id: 3001,
        metadata: null,
        items: cart.items.map((item) => ({
          id: `ordli_${item.id}`,
          metadata: {
            ...(item.metadata ?? {}),
          },
        })),
      }
      orderModule.store.push(order)

      return { id: order.id }
    })

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      {
        resolve: createScopeResolve({
          webhookService: createStatefulWebhookService(),
          paymentAttemptModule,
          checkoutCompletionModule,
          analyticsEventLogModule,
          cartModule,
          orderModule,
          queryGraph,
        }),
      } as never,
      {
        payment_attempt_id: "payatt_order_http_01",
        payment_intent_id: "pi_order_http_123",
        stripe_event_id: "evt_purchase_completed_http_01",
        correlation_id: "corr_order_http_01",
      },
      {
        now: () => new Date("2026-07-01T12:00:00.000Z"),
        runCompleteCart,
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "created",
        order_id: "order_http_outbox_01",
        checkout_completion_status: "completed",
      })
    )
    expect(analyticsEventLogModule.store).toHaveLength(1)
    expect(analyticsEventLogModule.store[0]).toEqual(
      expect.objectContaining({
        event_name: "purchase_completed",
        idempotency_key: "purchase_completed:stripe:pi_order_http_123",
        order_id: "order_http_outbox_01",
        payment_attempt_id: "payatt_order_http_01",
        checkout_completion_log_id: "chkcpl_http_1",
        status: "recorded",
      })
    )
    expect(analyticsEventLogModule.store[0]?.payload).toEqual(
      expect.objectContaining({
        payment_method_type: "pix",
        amount: 9900,
        currency_code: "brl",
        order_status: "confirmed",
        payment_status: "captured",
        item_count: 1,
      })
    )
    const serialized = JSON.stringify(analyticsEventLogModule.store[0])
    expect(serialized).not.toContain(["Post", "Hog"].join(""))
    expect(serialized).not.toContain("client_secret")
    expect(serialized).not.toContain("gelato_snapshot")
  })

  it("analytics outbox recovery cria purchase_completed ausente para Order existente", async () => {
    const cart = buildOrderCart({
      completed_at: "2026-07-01T11:59:00.000Z",
    })
    const paymentAttemptModule = createPaymentAttemptModule([
      buildAttempt({
        status: "payment_confirmed_by_webhook",
      }),
    ])
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_http_processing",
        idempotency_key: "pi_order_http_123",
        cart_id: "cart_order_http_01",
        payment_intent_id: "pi_order_http_123",
        payment_attempt_id: "payatt_order_http_01",
        order_id: null,
        status: "processing",
        metadata: null,
      },
    ])
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const orderModule = createOrderModule()
    orderModule.store.push({
      id: "order_http_recovered_01",
      cart_id: "cart_order_http_01",
      email: ORDER_EMAIL,
      display_id: 3002,
      metadata: null,
    })
    const queryGraph = createQueryGraph(cart)

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      {
        resolve: createScopeResolve({
          webhookService: createStatefulWebhookService(),
          paymentAttemptModule,
          checkoutCompletionModule,
          analyticsEventLogModule,
          orderModule,
          queryGraph,
        }),
      } as never,
      {
        payment_attempt_id: "payatt_order_http_01",
        payment_intent_id: "pi_order_http_123",
        stripe_event_id: "evt_analytics_outbox_recovery",
        correlation_id: "corr_order_http_01",
      },
      {
        now: () => new Date("2026-07-01T12:01:00.000Z"),
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "reused_existing_order",
        order_id: "order_http_recovered_01",
      })
    )
    expect(analyticsEventLogModule.store).toHaveLength(1)
    expect(analyticsEventLogModule.store[0]).toEqual(
      expect.objectContaining({
        order_id: "order_http_recovered_01",
        checkout_completion_log_id: "chkcpl_http_processing",
        status: "recorded",
      })
    )
  })

  it(
    ["PostHog indisponivel nao bloqueia Order nem gate local de purchase_completed"].join(
      " "
    ),
    async () => {
      const cart = buildOrderCart()
      const paymentAttemptModule = createPaymentAttemptModule([
        buildAttempt({
          status: "payment_confirmed_by_webhook",
        }),
      ])
      const checkoutCompletionModule = createCheckoutCompletionModule()
      const analyticsEventLogModule = createAnalyticsEventLogModule()
      const cartModule = createCartModule(cart)
      const orderModule = createOrderModule()
      const queryGraph = createQueryGraph(cart)
      const runCompleteCart = jest.fn(async (_container, cartId: string) => {
        const order = {
          id: "order_http_posthog_gate_01",
          cart_id: cartId,
          email: ORDER_EMAIL,
          display_id: 3003,
          metadata: null,
          items: cart.items.map((item) => ({
            id: `ordli_${item.id}`,
            metadata: {
              ...(item.metadata ?? {}),
            },
          })),
        }
        orderModule.store.push(order)

        return { id: order.id }
      })

      const orderResult = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        {
          resolve: createScopeResolve({
            webhookService: createStatefulWebhookService(),
            paymentAttemptModule,
            checkoutCompletionModule,
            analyticsEventLogModule,
            cartModule,
            orderModule,
            queryGraph,
          }),
        } as never,
        {
          payment_attempt_id: "payatt_order_http_01",
          payment_intent_id: "pi_order_http_123",
          stripe_event_id: "evt_posthog_gate_http_01",
          correlation_id: "corr_order_http_01",
        },
        {
          now: () => new Date("2026-07-01T12:10:00.000Z"),
          runCompleteCart,
        }
      )

      expect(orderResult).toEqual(
        expect.objectContaining({
          status: "created",
          order_id: "order_http_posthog_gate_01",
        })
      )
      expect(analyticsEventLogModule.store[0]?.status).toBe("recorded")

      const relayResult = await runAnalyticsPosthogRelay(
        {
          resolve: createScopeResolve({
            analyticsEventLogModule,
          }),
        } as never,
        {
          now: () => new Date("2026-07-01T12:11:00.000Z"),
          config: { apiKey: "phc_test_key" },
          createClient: () => ({
            capture: jest.fn(async () => {
              throw new Error(["Post", "Hog", " unavailable"].join(""))
            }),
            shutdown: jest.fn(async () => undefined),
          }),
        }
      )

      expect(relayResult).toEqual(
        expect.objectContaining({
          processed: 1,
          failed: 1,
          sent: 0,
        })
      )
      expect(analyticsEventLogModule.store[0]?.status).toBe("failed")
      expect(isPurchaseCompletedLocallyRecorded(analyticsEventLogModule.store[0])).toBe(
        true
      )
      expect(orderModule.store).toHaveLength(1)
      expect(paymentAttemptModule.attempts[0]?.order_id).toBe(
        "order_http_posthog_gate_01"
      )
    }
  )

  it("EmailDeliveryLog local e gravado depois de purchase_completed sem chamar Resend", async () => {
    const cart = buildOrderCart({
      items: [
        {
          id: "line_item_http_email_01",
          quantity: 1,
          metadata: {
            safe_note: "preserve",
          },
          variant: {
            id: "variant_http_email_01",
            sku: "SKU-HTTP-EMAIL-01",
            metadata: {
              gelato_product_uid: "gelato_prod_http_email_01",
              gelato_template_id: "tmpl_http_email_01",
              gelato_variant_options: {
                size: "M",
                color: "Azul",
              },
              template_mode: "fixed",
            },
            prices: [
              {
                amount: 9900,
                currency_code: "brl",
              },
            ],
          },
        },
      ],
    })
    const paymentAttemptModule = createPaymentAttemptModule([
      buildAttempt({
        payment_method_type: "pix",
        status: "payment_confirmed_by_webhook",
      }),
    ])
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const emailDeliveryLogModule = createEmailDeliveryLogModule()
    const cartModule = createCartModule(cart)
    const orderModule = createOrderModule()
    const queryGraph = createQueryGraph(cart)
    const runCompleteCart = jest.fn(async (_container, cartId: string) => {
      const order = {
        id: "order_http_email_01",
        cart_id: cartId,
        email: ORDER_EMAIL,
        display_id: 4001,
        metadata: null,
        items: cart.items.map((item) => ({
          id: `ordli_${item.id}`,
          metadata: {
            ...(item.metadata ?? {}),
          },
        })),
      }
      orderModule.store.push(order)

      return { id: order.id }
    })

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      {
        resolve: createScopeResolve({
          webhookService: createStatefulWebhookService(),
          paymentAttemptModule,
          checkoutCompletionModule,
          analyticsEventLogModule,
          emailDeliveryLogModule,
          cartModule,
          orderModule,
          queryGraph,
        }),
      } as never,
      {
        payment_attempt_id: "payatt_order_http_01",
        payment_intent_id: "pi_order_http_123",
        stripe_event_id: "evt_email_http_01",
        correlation_id: "corr_order_http_01",
      },
      {
        now: () => new Date("2026-07-01T12:20:00.000Z"),
        runCompleteCart,
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "created",
        order_id: "order_http_email_01",
      })
    )
    expect(analyticsEventLogModule.store).toHaveLength(1)
    expect(isPurchaseCompletedLocallyRecorded(analyticsEventLogModule.store[0])).toBe(
      true
    )
    expect(emailDeliveryLogModule.store).toHaveLength(1)
    expect(emailDeliveryLogModule.store[0]).toEqual(
      expect.objectContaining({
        email_type: "order_confirmation",
        template_key: "order_confirmation_v1",
        template_version: 1,
        provider: "resend",
        idempotency_key: "order-confirmation/order_http_email_01",
        order_id: "order_http_email_01",
        status: "recorded",
        analytics_event_log_id: "anlevt_http_1",
      })
    )
    const audit = buildRecipientEmailAudit(ORDER_EMAIL)
    expect(emailDeliveryLogModule.store[0]).toEqual(
      expect.objectContaining({
        recipient_email_hash: audit.recipient_email_hash,
        recipient_email_domain: audit.recipient_email_domain,
      })
    )
    const serialized = JSON.stringify(emailDeliveryLogModule.store[0])
    expect(serialized).not.toContain(ORDER_EMAIL)
    expect(serialized).not.toContain(["Res", "end"].join(""))
  })

  it("email recovery cria EmailDeliveryLog ausente para Order e purchase_completed existentes", async () => {
    const cart = buildOrderCart({
      completed_at: "2026-07-01T11:59:00.000Z",
    })
    const paymentAttemptModule = createPaymentAttemptModule([
      buildAttempt({
        status: "payment_confirmed_by_webhook",
      }),
    ])
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_http_email_processing",
        idempotency_key: "pi_order_http_123",
        cart_id: "cart_order_http_01",
        payment_intent_id: "pi_order_http_123",
        payment_attempt_id: "payatt_order_http_01",
        order_id: null,
        status: "processing",
        metadata: null,
      },
    ])
    const analyticsEventLogModule = createAnalyticsEventLogModule([
      {
        id: "anlevt_http_email_recovery",
        event_name: "purchase_completed",
        event_version: 1,
        idempotency_key: "purchase_completed:stripe:pi_order_http_123",
        order_id: "order_http_email_recovery_01",
        cart_id: "cart_order_http_01",
        payment_attempt_id: "payatt_order_http_01",
        checkout_completion_log_id: "chkcpl_http_email_processing",
        payment_intent_id: "pi_order_http_123",
        status: "recorded",
        payload: {
          order_id: "order_http_email_recovery_01",
          cart_id: "cart_order_http_01",
          payment_attempt_id: "payatt_order_http_01",
          checkout_completion_log_id: "chkcpl_http_email_processing",
          payment_intent_id: "pi_order_http_123",
          payment_method_type: "card",
          amount: 9900,
          currency_code: "brl",
          order_status: "confirmed",
          payment_status: "captured",
          item_count: 2,
          items: [],
        },
        metadata: null,
        attempt_count: 0,
        recorded_at: "2026-07-01T12:00:00.000Z",
        created_at: "2026-07-01T12:00:00.000Z",
        updated_at: "2026-07-01T12:00:00.000Z",
        deleted_at: null,
      },
    ])
    const emailDeliveryLogModule = createEmailDeliveryLogModule()
    const orderModule = createOrderModule()
    orderModule.store.push({
      id: "order_http_email_recovery_01",
      cart_id: "cart_order_http_01",
      email: ORDER_EMAIL,
      display_id: 4002,
      metadata: null,
    })
    const queryGraph = createQueryGraph(cart)

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      {
        resolve: createScopeResolve({
          webhookService: createStatefulWebhookService(),
          paymentAttemptModule,
          checkoutCompletionModule,
          analyticsEventLogModule,
          emailDeliveryLogModule,
          orderModule,
          queryGraph,
        }),
      } as never,
      {
        payment_attempt_id: "payatt_order_http_01",
        payment_intent_id: "pi_order_http_123",
        stripe_event_id: "evt_email_recovery_http_01",
        correlation_id: "corr_order_http_01",
      },
      {
        now: () => new Date("2026-07-01T12:21:00.000Z"),
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "reused_existing_order",
        order_id: "order_http_email_recovery_01",
      })
    )
    expect(emailDeliveryLogModule.store).toHaveLength(1)
    expect(emailDeliveryLogModule.store[0]).toEqual(
      expect.objectContaining({
        order_id: "order_http_email_recovery_01",
        idempotency_key: "order-confirmation/order_http_email_recovery_01",
        status: "recorded",
      })
    )
  })

  it(
    ["Resend indisponivel does not block Order depois de EmailDeliveryLog.recorded"].join(
      " "
    ),
    async () => {
      const cart = buildOrderCart()
      const paymentAttemptModule = createPaymentAttemptModule([
        buildAttempt({
          status: "payment_confirmed_by_webhook",
        }),
      ])
      const checkoutCompletionModule = createCheckoutCompletionModule()
      const analyticsEventLogModule = createAnalyticsEventLogModule()
      const emailDeliveryLogModule = createEmailDeliveryLogModule()
      const cartModule = createCartModule(cart)
      const orderModule = createOrderModule()
      const queryGraph = createQueryGraph(cart)
      const runCompleteCart = jest.fn(async (_container, cartId: string) => {
        const order = {
          id: "order_http_resend_gate_01",
          cart_id: cartId,
          email: ORDER_EMAIL,
          display_id: 5001,
          metadata: null,
          items: cart.items.map((item) => ({
            id: `ordli_${item.id}`,
            metadata: {
              ...(item.metadata ?? {}),
            },
          })),
        }
        orderModule.store.push(order)

        return { id: order.id }
      })

      const orderResult = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        {
          resolve: createScopeResolve({
            webhookService: createStatefulWebhookService(),
            paymentAttemptModule,
            checkoutCompletionModule,
            analyticsEventLogModule,
            emailDeliveryLogModule,
            cartModule,
            orderModule,
            queryGraph,
          }),
        } as never,
        {
          payment_attempt_id: "payatt_order_http_01",
          payment_intent_id: "pi_order_http_123",
          stripe_event_id: "evt_resend_gate_http_01",
          correlation_id: "corr_order_http_01",
        },
        {
          now: () => new Date("2026-07-01T12:20:00.000Z"),
          runCompleteCart,
        }
      )

      expect(orderResult).toEqual(
        expect.objectContaining({
          status: "created",
          order_id: "order_http_resend_gate_01",
        })
      )
      expect(emailDeliveryLogModule.store[0]?.status).toBe("recorded")

      const relayResult = await runEmailResendRelay(
        {
          resolve: createScopeResolve({
            webhookService: createStatefulWebhookService(),
            emailDeliveryLogModule,
            orderModule,
          }),
        } as never,
        {
          now: () => new Date("2026-07-01T12:21:00.000Z"),
          config: {
            apiKey: joinKey("re", "_", "test", "_", "relay"),
            fromEmail: joinKey("pedidos", "@", "lojinha", ".", "test"),
          },
          createClient: () => ({
            send: jest.fn(async () => {
              throw new Error(["Re", "send", " unavailable"].join(""))
            }),
          }),
        }
      )

      expect(relayResult).toEqual(
        expect.objectContaining({
          processed: 1,
          failed: 1,
          sent: 0,
        })
      )
      expect(emailDeliveryLogModule.store[0]?.status).toBe("failed")
      expect(isOrderConfirmationEmailLocallyRecorded(emailDeliveryLogModule.store[0])).toBe(
        true
      )
      expect(orderModule.store).toHaveLength(1)
      expect(paymentAttemptModule.attempts[0]?.order_id).toBe(
        "order_http_resend_gate_01"
      )
    }
  )

  it("EmailDeliveryLog replay remains idempotent when Resend relay fails", async () => {
    const cart = buildOrderCart()
    const paymentAttemptModule = createPaymentAttemptModule([
      buildAttempt({
        status: "payment_confirmed_by_webhook",
      }),
    ])
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_http_resend_replay",
        idempotency_key: "pi_order_http_123",
        cart_id: "cart_order_http_01",
        payment_intent_id: "pi_order_http_123",
        payment_attempt_id: "payatt_order_http_01",
        order_id: "order_http_resend_replay_01",
        status: "completed",
        metadata: null,
      },
    ])
    const analyticsEventLogModule = createAnalyticsEventLogModule([
      {
        id: "anlevt_http_resend_replay",
        event_name: "purchase_completed",
        event_version: 1,
        idempotency_key: "purchase_completed:stripe:pi_order_http_123",
        order_id: "order_http_resend_replay_01",
        cart_id: "cart_order_http_01",
        payment_attempt_id: "payatt_order_http_01",
        checkout_completion_log_id: "chkcpl_http_resend_replay",
        payment_intent_id: "pi_order_http_123",
        status: "recorded",
        payload: {
          order_id: "order_http_resend_replay_01",
        },
        metadata: null,
        attempt_count: 0,
        recorded_at: "2026-07-01T12:00:00.000Z",
        created_at: "2026-07-01T12:00:00.000Z",
        updated_at: "2026-07-01T12:00:00.000Z",
      },
    ])
    const emailDeliveryLogModule = createEmailDeliveryLogModule([
      {
        id: "emlog_http_resend_replay",
        email_type: "order_confirmation",
        template_key: "order_confirmation_v1",
        template_version: 1,
        provider: "resend",
        idempotency_key: "order-confirmation/order_http_resend_replay_01",
        order_id: "order_http_resend_replay_01",
        cart_id: "cart_order_http_01",
        payment_attempt_id: "payatt_order_http_01",
        checkout_completion_log_id: "chkcpl_http_resend_replay",
        analytics_event_log_id: "anlevt_http_resend_replay",
        payment_intent_id: "pi_order_http_123",
        status: "failed",
        recipient_email_hash: buildRecipientEmailAudit(ORDER_EMAIL).recipient_email_hash,
        recipient_email_domain: buildRecipientEmailAudit(ORDER_EMAIL).recipient_email_domain,
        payload: {
          order_id: "order_http_resend_replay_01",
          order_reference: "5002",
          amount: 9900,
          currency_code: "brl",
          item_count: 1,
          items: [
            {
              sku: "SKU-HTTP-RESEND-01",
              quantity: 1,
              unit_price: 9900,
              subtotal: 9900,
            },
          ],
          support_email: SUPPORT_EMAIL,
        },
        metadata: null,
        attempt_count: 1,
        next_retry_at: "2026-07-01T12:19:00.000Z",
        recorded_at: "2026-07-01T12:00:00.000Z",
        created_at: "2026-07-01T12:00:00.000Z",
        updated_at: "2026-07-01T12:20:00.000Z",
      },
    ])
    const orderModule = createOrderModule([
      {
        id: "order_http_resend_replay_01",
        cart_id: "cart_order_http_01",
        email: ORDER_EMAIL,
        display_id: 5002,
        metadata: null,
      },
    ])
    const cartModule = createCartModule(cart)
    const queryGraph = createQueryGraph(cart)

    const replayResult = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      {
        resolve: createScopeResolve({
          webhookService: createStatefulWebhookService(),
          paymentAttemptModule,
          checkoutCompletionModule,
          analyticsEventLogModule,
          emailDeliveryLogModule,
          cartModule,
          orderModule,
          queryGraph,
        }),
      } as never,
      {
        payment_attempt_id: "payatt_order_http_01",
        payment_intent_id: "pi_order_http_123",
        stripe_event_id: "evt_resend_replay_http_01",
        correlation_id: "corr_order_http_01",
      },
      {
        now: () => new Date("2026-07-01T12:22:00.000Z"),
      }
    )

    expect(replayResult.status).toBe("reused_existing_order")
    expect(emailDeliveryLogModule.createEmailDeliveryLogs).not.toHaveBeenCalled()
    expect(emailDeliveryLogModule.store).toHaveLength(1)

    await runEmailResendRelay(
      {
        resolve: createScopeResolve({
          webhookService: createStatefulWebhookService(),
          emailDeliveryLogModule,
          orderModule,
        }),
      } as never,
      {
        now: () => new Date("2026-07-01T12:23:00.000Z"),
        config: {
          apiKey: joinKey("re", "_", "test", "_", "relay"),
          fromEmail: joinKey("pedidos", "@", "lojinha", ".", "test"),
        },
        createClient: () => ({
          send: jest.fn(async () => {
            throw new Error(["Re", "send", " unavailable"].join(""))
          }),
        }),
      }
    )

    expect(emailDeliveryLogModule.store).toHaveLength(1)
    expect(emailDeliveryLogModule.store[0]?.status).toBe("failed")
    expect(isOrderConfirmationEmailLocallyRecorded(emailDeliveryLogModule.store[0])).toBe(
      true
    )
  })
})
