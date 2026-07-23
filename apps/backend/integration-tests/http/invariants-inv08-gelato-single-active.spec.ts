import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../src/modules/analytics-event-log"
import { CHECKOUT_COMPLETION_MODULE } from "../../src/modules/checkout-completion"
import { EMAIL_DELIVERY_LOG_MODULE } from "../../src/modules/email-delivery-log"
import {
  buildRecipientEmailAudit,
} from "../../src/modules/email-delivery-log/service"
import { GELATO_FULFILLMENT_MODULE } from "../../src/modules/gelato-fulfillment"
import {
  assertSingleActiveGelatoFulfillmentForOrder,
  buildGelatoDispatchIdempotencyKey,
} from "../../src/modules/gelato-fulfillment/service"
import { GELATO_FULFILLMENT_STATUS } from "../../src/modules/gelato-fulfillment/types"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { WEBHOOKS_MODULE } from "../../src/modules/webhooks"
import { runCreateOrderFromConfirmedPaymentAttemptEntrypoint } from "../../src/workflows/order/webhook-order-entrypoint"

const ORDER_ID = "order_inv08_gelato_01"
const FIXED_ORDER_EMAIL = ["comprador", "@", "loja", ".", "test"].join("")

type StoredGelatoFulfillmentRecord = {
  id: string
  order_id: string
  idempotency_key: string
  status: string
  [key: string]: unknown
}

function joinKey(...parts: string[]): string {
  return parts.join("")
}

function enableOrderConfirmationEmailDeliveryForTest(): void {
  process.env.RESEND_ORDER_CONFIRMATION_ENABLED = "true"
  process.env.RESEND_API_KEY = joinKey("re", "_", "test", "_", "local")
  process.env.RESEND_FROM_EMAIL = joinKey("pedidos", "@", "lojinha", ".", "test")
}

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_inv08_01",
    cart_id: "cart_inv08_01",
    payment_collection_id: "paycol_inv08_01",
    payment_session_id: "payses_inv08_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_inv08_123",
    provider_payment_session_id: "ps_inv08_123",
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: ORDER_ID,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-07-22T10:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-07-22T09:00:00.000Z",
    updated_at: "2026-07-22T09:00:00.000Z",
    ...overrides,
  }
}

function createGelatoFulfillmentModule(
  records: StoredGelatoFulfillmentRecord[] = [],
  options: { duplicateOnCreate?: boolean } = {}
) {
  const store = [...records]
  let providerCalls = 0

  return {
    listGelatoFulfillments: jest.fn(async (filters?: Record<string, unknown>) => {
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
        return true
      })
    }),
    createGelatoFulfillments: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      providerCalls += 1

      const existingActive = store.find(
        (record) =>
          record.order_id === row.order_id &&
          record.status !== GELATO_FULFILLMENT_STATUS.DEAD_LETTER &&
          record.status !== GELATO_FULFILLMENT_STATUS.CANCELED
      )
      if (existingActive && !options.duplicateOnCreate) {
        throw new Error("GELATO_FULFILLMENT_ORDER_ALREADY_ACTIVE")
      }

      if (options.duplicateOnCreate) {
        if (store.length === 0) {
          store.push({
            ...row,
            id: "gelful_inv08_existing",
            created_at: "2026-07-22T12:31:00.000Z",
            updated_at: "2026-07-22T12:31:00.000Z",
            deleted_at: null,
          } as StoredGelatoFulfillmentRecord)
        }
        throw new Error("duplicate key value violates unique constraint")
      }

      const created: StoredGelatoFulfillmentRecord = {
        ...row,
        id: `gelful_inv08_${store.length + 1}`,
        created_at: "2026-07-22T12:31:00.000Z",
        updated_at: "2026-07-22T12:31:00.000Z",
        deleted_at: null,
      }
      store.push(created)
      return [created]
    }),
    store,
    get providerCalls() {
      return providerCalls
    },
  }
}

function createScopeResolve(input: {
  gelatoFulfillmentModule: ReturnType<typeof createGelatoFulfillmentModule>
}) {
  const paymentAttemptModule = {
    listPaymentAttempts: jest.fn(async () => [buildAttempt()]),
    updatePaymentAttempts: jest.fn(async (row) => [row]),
  }
  const checkoutCompletionModule = {
    listCheckoutCompletionLogs: jest.fn(async () => [
      {
        id: "chkcpl_inv08_01",
        idempotency_key: "pi_inv08_123",
        cart_id: "cart_inv08_01",
        payment_intent_id: "pi_inv08_123",
        payment_attempt_id: "payatt_inv08_01",
        order_id: ORDER_ID,
        status: "completed",
      },
    ]),
    createCheckoutCompletionLogs: jest.fn(),
    updateCheckoutCompletionLogs: jest.fn(),
  }
  const analyticsEventLogModule = {
    listAnalyticsEventLogs: jest.fn(async () => [
      {
        id: "anlevt_inv08_01",
        event_name: "purchase_completed",
        idempotency_key: "purchase_completed:stripe:pi_inv08_123",
        order_id: ORDER_ID,
        cart_id: "cart_inv08_01",
        payment_attempt_id: "payatt_inv08_01",
        checkout_completion_log_id: "chkcpl_inv08_01",
        payment_intent_id: "pi_inv08_123",
        status: "sent",
        payload: { order_id: ORDER_ID },
        attempt_count: 0,
        recorded_at: "2026-07-22T12:00:00.000Z",
        created_at: "2026-07-22T12:00:00.000Z",
        updated_at: "2026-07-22T12:00:00.000Z",
      },
    ]),
    createAnalyticsEventLogs: jest.fn(),
    updateAnalyticsEventLogs: jest.fn(),
  }
  const emailAudit = buildRecipientEmailAudit(FIXED_ORDER_EMAIL)
  const emailDeliveryLogModule = {
    listEmailDeliveryLogs: jest.fn(async () => [
      {
        id: "emlog_inv08_01",
        email_type: "order_confirmation",
        template_key: "order_confirmation_v1",
        template_version: 1,
        provider: "resend",
        idempotency_key: `order-confirmation/${ORDER_ID}`,
        order_id: ORDER_ID,
        cart_id: "cart_inv08_01",
        payment_attempt_id: "payatt_inv08_01",
        checkout_completion_log_id: "chkcpl_inv08_01",
        analytics_event_log_id: "anlevt_inv08_01",
        payment_intent_id: "pi_inv08_123",
        status: "sent",
        recipient_email_hash: emailAudit.recipient_email_hash,
        recipient_email_domain: emailAudit.recipient_email_domain,
        payload: { order_id: ORDER_ID },
        attempt_count: 1,
        recorded_at: "2026-07-22T12:00:00.000Z",
        sent_at: "2026-07-22T12:03:00.000Z",
        created_at: "2026-07-22T12:00:00.000Z",
        updated_at: "2026-07-22T12:03:00.000Z",
      },
    ]),
    createEmailDeliveryLogs: jest.fn(),
    updateEmailDeliveryLogs: jest.fn(),
  }
  const orderModule = {
    listOrders: jest.fn(async () => [
      {
        id: ORDER_ID,
        cart_id: "cart_inv08_01",
        email: FIXED_ORDER_EMAIL,
        display_id: 8001,
        metadata: {
          order_status: "confirmed",
          payment_status: "captured",
        },
        items: [
          {
            id: "ordli_inv08_01",
            quantity: 1,
            metadata: {
              gelato_product_uid: "gelato_prod_inv08_01",
              gelato_template_id: "tmpl_inv08_01",
              gelato_variant_options: { size: "M", color: "Preto" },
              template_mode: "fixed",
              source_product_variant_id: "variant_inv08_01",
              source_product_variant_sku: "SKU-INV08",
              captured_at: "2026-07-22T12:00:00.000Z",
            },
          },
        ],
      },
    ]),
    updateOrders: jest.fn(async () => []),
  }
  const queryGraph = {
    graph: jest.fn(async () => ({
      data: [
        {
          id: "cart_inv08_01",
          total: 99,
          currency_code: "brl",
          completed_at: "2026-07-22T11:59:00.000Z",
          items: [
            {
              id: "li_inv08_01",
              quantity: 1,
              metadata: {
                gelato_product_uid: "gelato_prod_inv08_01",
                gelato_template_id: "tmpl_inv08_01",
                gelato_variant_options: { size: "M", color: "Preto" },
                template_mode: "fixed",
                source_product_variant_id: "variant_inv08_01",
                source_product_variant_sku: "SKU-INV08",
                captured_at: "2026-07-22T12:00:00.000Z",
              },
              variant: {
                id: "variant_inv08_01",
                sku: "SKU-INV08",
                metadata: {
                  gelato_product_uid: "gelato_prod_inv08_01",
                  gelato_template_id: "tmpl_inv08_01",
                  gelato_variant_options: { size: "M", color: "Preto" },
                  template_mode: "fixed",
                },
                prices: [{ amount: 99, currency_code: "brl" }],
              },
            },
          ],
        },
      ],
    })),
  }

  return jest.fn((key: string) => {
    if (key === WEBHOOKS_MODULE) {
      return {
        listWebhookEventLogs: jest.fn(async () => []),
        createWebhookEventLogs: jest.fn(),
        updateWebhookEventLogs: jest.fn(),
      }
    }
    if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttemptModule
    if (key === CHECKOUT_COMPLETION_MODULE) return checkoutCompletionModule
    if (key === ANALYTICS_EVENT_LOG_MODULE || key === "analytics_event_log") {
      return analyticsEventLogModule
    }
    if (key === EMAIL_DELIVERY_LOG_MODULE || key === "email_delivery_log") {
      return emailDeliveryLogModule
    }
    if (key === GELATO_FULFILLMENT_MODULE || key === "gelato_fulfillment") {
      return input.gelatoFulfillmentModule
    }
    if (key === Modules.ORDER) return orderModule
    if (key === ContainerRegistrationKeys.QUERY) return queryGraph
    return undefined
  })
}

describe("INV-8 Gelato single-active at HTTP/workflow boundary", () => {
  const originalResendEnabled = process.env.RESEND_ORDER_CONFIRMATION_ENABLED
  const originalResendApiKey = process.env.RESEND_API_KEY
  const originalResendFrom = process.env.RESEND_FROM_EMAIL
  const originalSupportEmail = process.env.SUPPORT_EMAIL

  beforeEach(() => {
    enableOrderConfirmationEmailDeliveryForTest()
    process.env.SUPPORT_EMAIL = joinKey("support", "@", "lojinha", ".", "test")
  })

  afterEach(() => {
    if (originalResendEnabled === undefined) {
      delete process.env.RESEND_ORDER_CONFIRMATION_ENABLED
    } else {
      process.env.RESEND_ORDER_CONFIRMATION_ENABLED = originalResendEnabled
    }
    if (originalResendApiKey === undefined) {
      delete process.env.RESEND_API_KEY
    } else {
      process.env.RESEND_API_KEY = originalResendApiKey
    }
    if (originalResendFrom === undefined) {
      delete process.env.RESEND_FROM_EMAIL
    } else {
      process.env.RESEND_FROM_EMAIL = originalResendFrom
    }
    if (originalSupportEmail === undefined) {
      delete process.env.SUPPORT_EMAIL
    } else {
      process.env.SUPPORT_EMAIL = originalSupportEmail
    }
  })

  it("INV-8: idempotency key is deterministic per Order", () => {
    expect(buildGelatoDispatchIdempotencyKey({ order_id: ORDER_ID })).toBe(
      `gelato-dispatch:${ORDER_ID}`
    )
    expect(buildGelatoDispatchIdempotencyKey({ order_id: `  ${ORDER_ID}  ` })).toBe(
      `gelato-dispatch:${ORDER_ID}`
    )
  })

  it("INV-8: single-active guard rejects a second active fulfillment for the same Order", () => {
    expect(() =>
      assertSingleActiveGelatoFulfillmentForOrder({
        order_id: ORDER_ID,
        existing: {
          order_id: ORDER_ID,
          status: GELATO_FULFILLMENT_STATUS.QUEUED,
        },
      })
    ).toThrow("GELATO_FULFILLMENT_ORDER_ALREADY_ACTIVE")
  })

  it("INV-8: double trigger and logical retry keep at most one active fulfillment (Gelato double local)", async () => {
    const gelatoFulfillmentModule = createGelatoFulfillmentModule([], {
      duplicateOnCreate: true,
    })
    const scopeResolve = createScopeResolve({ gelatoFulfillmentModule })

    const first = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      { resolve: scopeResolve } as never,
      {
        payment_attempt_id: "payatt_inv08_01",
        payment_intent_id: "pi_inv08_123",
        stripe_event_id: "evt_inv08_trigger_01",
        correlation_id: "corr_inv08_01",
      },
      { now: () => new Date("2026-07-22T12:31:00.000Z") }
    )

    const retry = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      { resolve: scopeResolve } as never,
      {
        payment_attempt_id: "payatt_inv08_01",
        payment_intent_id: "pi_inv08_123",
        stripe_event_id: "evt_inv08_trigger_02",
        correlation_id: "corr_inv08_01",
      },
      { now: () => new Date("2026-07-22T12:31:01.000Z") }
    )

    expect(first.status).toBe("reused_existing_order")
    expect(retry.status).toBe("reused_existing_order")
    expect(gelatoFulfillmentModule.store).toHaveLength(1)
    expect(gelatoFulfillmentModule.store[0]?.order_id).toBe(ORDER_ID)
    expect(gelatoFulfillmentModule.store[0]?.idempotency_key).toBe(
      `gelato-dispatch:${ORDER_ID}`
    )
    expect(gelatoFulfillmentModule.providerCalls).toBeGreaterThanOrEqual(1)
    // Physical unique/concurrency is proven in gelato-fulfillment.postgres.spec.ts
  })
})
