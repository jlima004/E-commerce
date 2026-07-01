import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../../modules/analytics-event-log"
import { CHECKOUT_COMPLETION_MODULE } from "../../../modules/checkout-completion"
import { PAYMENT_ATTEMPT_MODULE } from "../../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../../modules/payment-attempt/types"
import {
  runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
  type CreateOrderFromConfirmedPaymentAttemptInput,
} from "../webhook-order-entrypoint"
import { isPurchaseCompletedLocallyRecorded } from "../../../modules/analytics-event-log/service"

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const SNAPSHOT_KEY = joinKey("gelato", "_", "snapshot")

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_outbox_01",
    cart_id: "cart_outbox_01",
    payment_collection_id: "paycol_outbox_01",
    payment_session_id: "payses_outbox_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_outbox_01",
    provider_payment_session_id: "ps_outbox_01",
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-07-01T10:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-07-01T09:00:00.000Z",
    updated_at: "2026-07-01T09:00:00.000Z",
    ...overrides,
  }
}

function buildInput(
  overrides: Partial<CreateOrderFromConfirmedPaymentAttemptInput> = {}
): CreateOrderFromConfirmedPaymentAttemptInput {
  return {
    payment_attempt_id: "payatt_outbox_01",
    payment_intent_id: "pi_outbox_01",
    stripe_event_id: "evt_outbox_01",
    correlation_id: "corr_outbox_01",
    ...overrides,
  }
}

function buildCart() {
  return {
    id: "cart_outbox_01",
    total: 9900,
    currency_code: "brl",
    completed_at: null,
    items: [
      {
        id: "line_item_outbox_01",
        quantity: 1,
        metadata: {
          preserve_me: true,
        },
        variant: {
          id: "variant_outbox_01",
          sku: "SKU-OUTBOX-01",
          metadata: {
            gelato_product_uid: "gelato_prod_outbox_01",
            gelato_template_id: "tmpl_outbox_01",
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
    ],
  }
}

function createPaymentAttemptModule(attempt: PaymentAttemptRecord) {
  const store = [attempt]

  return {
    listPaymentAttempts: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => !filters?.id || record.id === filters.id)
    }),
    updatePaymentAttempts: jest.fn(async (input) => {
      const rows = Array.isArray(input) ? input : [input]

      for (const row of rows) {
        const index = store.findIndex((record) => record.id === row.id)

        if (index >= 0) {
          store[index] = row
        }
      }

      return rows
    }),
    store,
  }
}

function createCheckoutCompletionModule(records: Array<Record<string, unknown>> = []) {
  const store = [...records]

  return {
    listCheckoutCompletionLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => {
        return (
          !filters?.idempotency_key ||
          record.idempotency_key === filters.idempotency_key
        )
      })
    }),
    createCheckoutCompletionLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input

      if (store.some((record) => record.idempotency_key === row.idempotency_key)) {
        throw new Error("duplicate key value violates unique constraint")
      }

      const created = {
        ...row,
        id: `chkcpl_outbox_${store.length + 1}`,
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

function createOrderModule(records: Array<Record<string, unknown>> = []) {
  const store = [...records]

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
    updateOrders: jest.fn(async (selector: Record<string, unknown>, update: Record<string, unknown>) => {
      const index = store.findIndex((order) => order.id === selector.id)

      if (index >= 0) {
        store[index] = {
          ...store[index],
          ...update,
        }
      }

      return index >= 0 ? [store[index]] : []
    }),
    store,
  }
}

function createAnalyticsEventLogModule(records: Array<Record<string, unknown>> = []) {
  const store = [...records]

  return {
    listAnalyticsEventLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => {
        if (filters?.idempotency_key && record.idempotency_key !== filters.idempotency_key) {
          return false
        }

        if (filters?.order_id && record.order_id !== filters.order_id) {
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

      const created = {
        ...row,
        id: `anlevt_outbox_${store.length + 1}`,
      }
      store.push(created)
      return [created]
    }),
    store,
  }
}

function createContainer(input: {
  paymentAttemptModule: ReturnType<typeof createPaymentAttemptModule>
  checkoutCompletionModule: ReturnType<typeof createCheckoutCompletionModule>
  analyticsEventLogModule?: ReturnType<typeof createAnalyticsEventLogModule>
  orderModule?: ReturnType<typeof createOrderModule>
}) {
  return {
    resolve: jest.fn((key: string) => {
      if (key === PAYMENT_ATTEMPT_MODULE) {
        return input.paymentAttemptModule
      }

      if (key === CHECKOUT_COMPLETION_MODULE) {
        return input.checkoutCompletionModule
      }

      if (key === ANALYTICS_EVENT_LOG_MODULE) {
        return input.analyticsEventLogModule
      }

      if (key === Modules.ORDER) {
        return input.orderModule ?? createOrderModule()
      }

      return undefined
    }),
  } as unknown as MedusaContainer
}

describe("runCreateOrderFromConfirmedPaymentAttemptEntrypoint analytics outbox", () => {
  it("grava purchase_completed localmente quando a Order nasce com sucesso", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const orderModule = createOrderModule()

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        analyticsEventLogModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-01T12:00:00.000Z"),
        getCart: async () => buildCart(),
        persistCartSnapshots: jest.fn(async () => undefined),
        runCompleteCart: jest.fn(async () => ({ id: "order_outbox_01" })),
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "created",
        order_id: "order_outbox_01",
        checkout_completion_status: "completed",
      })
    )
    expect(analyticsEventLogModule.store).toHaveLength(1)
    expect(analyticsEventLogModule.store[0]).toEqual(
      expect.objectContaining({
        event_name: "purchase_completed",
        idempotency_key: "purchase_completed:stripe:pi_outbox_01",
        order_id: "order_outbox_01",
        status: "recorded",
        payment_attempt_id: "payatt_outbox_01",
        checkout_completion_log_id: "chkcpl_outbox_1",
      })
    )
    expect(analyticsEventLogModule.store[0]?.payload).toEqual(
      expect.objectContaining({
        order_id: "order_outbox_01",
        cart_id: "cart_outbox_01",
        payment_method_type: "card",
        amount: 9900,
        currency_code: "brl",
        order_status: "confirmed",
        payment_status: "captured",
        item_count: 1,
      })
    )
    expect(JSON.stringify(analyticsEventLogModule.store[0]?.payload)).not.toContain(
      SNAPSHOT_KEY
    )
  })

  it("replay reutiliza purchase_completed existente sem duplicar evento", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(
      buildAttempt()
    )
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_outbox_01",
        idempotency_key: "pi_outbox_01",
        cart_id: "cart_outbox_01",
        payment_intent_id: "pi_outbox_01",
        payment_attempt_id: "payatt_outbox_01",
        order_id: "order_existing_01",
        status: "completed",
        metadata: null,
      },
    ])
    const analyticsEventLogModule = createAnalyticsEventLogModule([
      {
        id: "anlevt_existing_01",
        event_name: "purchase_completed",
        event_version: 1,
        idempotency_key: "purchase_completed:stripe:pi_outbox_01",
        order_id: "order_existing_01",
        cart_id: "cart_outbox_01",
        payment_attempt_id: "payatt_outbox_01",
        checkout_completion_log_id: "chkcpl_outbox_01",
        payment_intent_id: "pi_outbox_01",
        status: "failed",
        payload: {
          occurred_at: "2026-07-01T12:00:00.000Z",
          event_name: "purchase_completed",
          event_version: 1,
          order_id: "order_existing_01",
          cart_id: "cart_outbox_01",
          payment_attempt_id: "payatt_outbox_01",
          checkout_completion_log_id: "chkcpl_outbox_01",
          payment_intent_id: "pi_outbox_01",
          payment_method_type: "card",
          amount: 9900,
          currency_code: "brl",
          order_status: "confirmed",
          payment_status: "captured",
          item_count: 1,
          items: [
            {
              variant_id: "variant_outbox_01",
              sku: "SKU-OUTBOX-01",
              quantity: 1,
              unit_price: 9900,
              subtotal: 9900,
            },
          ],
        },
        metadata: null,
        attempt_count: 1,
        last_error_code: "relay_failed",
        last_error_message: "sanitized",
        next_retry_at: null,
        recorded_at: "2026-07-01T12:00:00.000Z",
        queued_at: null,
        sending_started_at: null,
        sent_at: null,
        failed_at: "2026-07-01T12:01:00.000Z",
        dead_lettered_at: null,
        created_at: "2026-07-01T12:00:00.000Z",
        updated_at: "2026-07-01T12:01:00.000Z",
        deleted_at: null,
      },
    ])
    const orderModule = createOrderModule([
      {
        id: "order_existing_01",
        metadata: null,
      },
    ])

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        analyticsEventLogModule,
        orderModule,
      }),
      buildInput({ stripe_event_id: "evt_outbox_replay" }),
      {
        now: () => new Date("2026-07-01T12:02:00.000Z"),
        getCart: async () => buildCart(),
      }
    )

    expect(result.status).toBe("reused_existing_order")
    expect(analyticsEventLogModule.createAnalyticsEventLogs).not.toHaveBeenCalled()
    expect(analyticsEventLogModule.store).toHaveLength(1)
  })

  it("recovery de Order existente cria purchase_completed ausente antes de retornar sucesso", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_outbox_processing",
        idempotency_key: "pi_outbox_01",
        cart_id: "cart_outbox_01",
        payment_intent_id: "pi_outbox_01",
        payment_attempt_id: "payatt_outbox_01",
        order_id: null,
        status: "processing",
        metadata: null,
      },
    ])
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const orderModule = createOrderModule([
      {
        id: "order_recovered_01",
        cart_id: "cart_outbox_01",
        metadata: null,
      },
    ])

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        analyticsEventLogModule,
        orderModule,
      }),
      buildInput({ stripe_event_id: "evt_outbox_recovery" }),
      {
        now: () => new Date("2026-07-01T12:03:00.000Z"),
        getCart: async () => buildCart(),
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "reused_existing_order",
        order_id: "order_recovered_01",
      })
    )
    expect(analyticsEventLogModule.store).toHaveLength(1)
    expect(analyticsEventLogModule.store[0]).toEqual(
      expect.objectContaining({
        order_id: "order_recovered_01",
        checkout_completion_log_id: "chkcpl_outbox_processing",
        status: "recorded",
      })
    )
  })

  it("estados nao elegiveis nao criam Order nem purchase_completed", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(
      buildAttempt({
        status: "payment_failed",
      })
    )
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        createContainer({
          paymentAttemptModule,
          checkoutCompletionModule,
          analyticsEventLogModule,
        }),
        buildInput()
      )
    ).rejects.toThrow("PAYMENT_ATTEMPT_NOT_ELIGIBLE_FOR_ORDER_STATUS")

    expect(analyticsEventLogModule.store).toHaveLength(0)
  })

  it("failed e dead_letter continuam satisfazendo gate local sem exigir sent", () => {
    expect(
      isPurchaseCompletedLocallyRecorded({
        status: "failed",
      })
    ).toBe(true)
    expect(
      isPurchaseCompletedLocallyRecorded({
        status: "dead_letter",
      })
    ).toBe(true)
    expect(
      isPurchaseCompletedLocallyRecorded({
        status: "sent",
      })
    ).toBe(true)
    expect(isPurchaseCompletedLocallyRecorded("processing")).toBe(false)
  })

  it("falha fechado quando o modulo AnalyticsEventLog esta ausente e nao chama completeCartWorkflow", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const runCompleteCart = jest.fn(async () => ({ id: "order_should_not_exist" }))

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        createContainer({
          paymentAttemptModule,
          checkoutCompletionModule,
        }),
        buildInput(),
        {
          now: () => new Date("2026-07-01T12:04:00.000Z"),
          getCart: async () => buildCart(),
          runCompleteCart,
        }
      )
    ).rejects.toMatchObject({
      name: "OrderCreationEntrypointError",
      code: "ORDER_ENTRYPOINT_ANALYTICS_EVENT_LOG_MODULE_UNAVAILABLE",
      message: "Modulo de analytics_event_log nao configurado.",
    })

    expect(runCompleteCart).not.toHaveBeenCalled()
    expect(checkoutCompletionModule.store).toHaveLength(0)
    expect(paymentAttemptModule.store[0]?.order_id).toBeNull()
  })
})
