import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../../modules/analytics-event-log"
import { CHECKOUT_COMPLETION_MODULE } from "../../../modules/checkout-completion"
import { EMAIL_DELIVERY_LOG_MODULE } from "../../../modules/email-delivery-log"
import { PAYMENT_ATTEMPT_MODULE } from "../../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../../modules/payment-attempt/types"
import {
  runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
  validateCreateOrderFromConfirmedPaymentAttemptInput,
  type CreateOrderFromConfirmedPaymentAttemptInput,
} from "../webhook-order-entrypoint"

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_01",
    cart_id: "cart_01",
    payment_collection_id: "paycol_01",
    payment_session_id: "payses_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_01",
    provider_payment_session_id: "ps_01",
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-06-30T12:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-06-30T11:00:00.000Z",
    updated_at: "2026-06-30T11:00:00.000Z",
    ...overrides,
  }
}

function buildInput(
  overrides: Partial<CreateOrderFromConfirmedPaymentAttemptInput> = {}
): CreateOrderFromConfirmedPaymentAttemptInput {
  return {
    payment_attempt_id: "payatt_01",
    payment_intent_id: "pi_01",
    stripe_event_id: "evt_01",
    correlation_id: "corr_01",
    ...overrides,
  }
}

function buildCart() {
  return {
    id: "cart_01",
    total: 9900,
    currency_code: "brl",
    completed_at: null,
    items: [
      {
        id: "line_item_01",
        quantity: 1,
        metadata: {
          preserve_me: true,
        },
        variant: {
          id: "variant_01",
          sku: "SKU-01",
          metadata: {
            gelato_product_uid: "gelato_prod_01",
            gelato_template_id: "tmpl_01",
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

function createCheckoutCompletionModule(records: Array<Record<string, unknown>> = []) {
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

        if (filters?.cart_id && record.cart_id !== filters.cart_id) {
          return false
        }

        if (
          filters?.payment_attempt_id &&
          record.payment_attempt_id !== filters.payment_attempt_id
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

      const created = {
        ...row,
        id: `chkcpl_${store.length + 1}`,
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

function createPaymentAttemptModule(attempt: PaymentAttemptRecord) {
  const store = [attempt]

  return {
    listPaymentAttempts: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => {
        if (filters?.id && record.id !== filters.id) {
          return false
        }

        return true
      })
    }),
    updatePaymentAttempts: jest.fn(async (input) => {
      const rows = Array.isArray(input) ? input : [input]

      rows.forEach((row) => {
        const index = store.findIndex((record) => record.id === row.id)
        if (index >= 0) {
          store[index] = row
        }
      })

      return rows
    }),
    store,
  }
}

function createOrderModule(records: Array<Record<string, unknown>> = []) {
  const store: Array<Record<string, unknown>> = [...records]

  return {
    listOrders: jest.fn(async (selector?: Record<string, unknown>) => {
      if (selector?.cart_id) {
        throw new Error("Order.cart_id must not be queried")
      }

      return store.filter((order) => {
        if (selector?.id && order.id !== selector.id) {
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

      return [store[index]]
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
      const created = {
        ...row,
        id: `anlevt_creation_${store.length + 1}`,
      }
      store.push(created)
      return [created]
    }),
    store,
  }
}

function createEmailDeliveryLogModule(records: Array<Record<string, unknown>> = []) {
  const store = [...records]

  return {
    listEmailDeliveryLogs: jest.fn(async (filters?: Record<string, unknown>) => {
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
    createEmailDeliveryLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const created = {
        ...row,
        id: `emlog_creation_${store.length + 1}`,
      }
      store.push(created)
      return [created]
    }),
    store,
  }
}

function createGelatoFulfillmentModule(records: Array<Record<string, unknown>> = []) {
  const store = [...records]

  return {
    listGelatoFulfillments: jest.fn(async (filters?: Record<string, unknown>) => {
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
    createGelatoFulfillments: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const created = {
        ...row,
        id: `gelful_creation_${store.length + 1}`,
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
  emailDeliveryLogModule?: ReturnType<typeof createEmailDeliveryLogModule>
  gelatoFulfillmentModule?: ReturnType<typeof createGelatoFulfillmentModule>
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

      if (key === ANALYTICS_EVENT_LOG_MODULE || key === "analytics_event_log") {
        return input.analyticsEventLogModule ?? createAnalyticsEventLogModule()
      }

      if (key === EMAIL_DELIVERY_LOG_MODULE || key === "email_delivery_log") {
        return input.emailDeliveryLogModule ?? createEmailDeliveryLogModule()
      }

      if (key === "gelato_fulfillment" || key === "gelato-fulfillment") {
        return input.gelatoFulfillmentModule ?? createGelatoFulfillmentModule()
      }

      if (key === ContainerRegistrationKeys.QUERY) {
        return {
          graph: jest.fn(async () => ({
            data: [buildCart()],
          })),
        }
      }

      if (key === Modules.CART) {
        return {
          updateLineItems: jest.fn(async (rows) => rows),
        }
      }

      if (key === Modules.ORDER) {
        return input.orderModule ?? createOrderModule()
      }

      return undefined
    }),
  } as unknown as MedusaContainer
}

describe("validateCreateOrderFromConfirmedPaymentAttemptInput", () => {
  it("exige ids obrigatorios e nao aceita espacos em branco", () => {
    expect(() =>
      validateCreateOrderFromConfirmedPaymentAttemptInput(
        buildInput({ payment_attempt_id: " " })
      )
    ).toThrow("ORDER_ENTRYPOINT_PAYMENT_ATTEMPT_ID_REQUIRED")
  })
})

describe("runCreateOrderFromConfirmedPaymentAttemptEntrypoint", () => {
  const originalSupportEmail = process.env.SUPPORT_EMAIL

  beforeEach(() => {
    process.env.SUPPORT_EMAIL = "support@pedido.test"
  })

  afterEach(() => {
    if (originalSupportEmail === undefined) {
      delete process.env.SUPPORT_EMAIL
    } else {
      process.env.SUPPORT_EMAIL = originalSupportEmail
    }
  })

  it("cria uma Order, completa CheckoutCompletionLog e correlaciona PaymentAttempt.order_id", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const orderModule = createOrderModule()
    const persistCartSnapshots = jest.fn(async () => undefined)
    const runCompleteCart = jest.fn(async () => {
      orderModule.store.push({
        id: "order_01",
        cart_id: "cart_01",
        email: "cliente@pedido.test",
        display_id: 1001,
        metadata: null,
      })

      return { id: "order_01" }
    })

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-06-30T16:00:00.000Z"),
        getCart: async () => buildCart(),
        persistCartSnapshots,
        runCompleteCart,
      }
    )

    expect(result).toEqual({
      status: "created",
      payment_attempt_id: "payatt_01",
      payment_intent_id: "pi_01",
      order_id: "order_01",
      stripe_event_id: "evt_01",
      correlation_id: "corr_01",
      checkout_completion_status: "completed",
      order_status: "confirmed",
      payment_status: "captured",
    })
    expect(persistCartSnapshots).toHaveBeenCalledWith(
      expect.anything(),
      [
        expect.objectContaining({
          id: "line_item_01",
          metadata: expect.objectContaining({
            preserve_me: true,
            gelato_snapshot: expect.objectContaining({
              source_product_variant_id: "variant_01",
              source_product_variant_sku: "SKU-01",
            }),
          }),
        }),
      ]
    )
    expect(runCompleteCart).toHaveBeenCalledWith(expect.anything(), "cart_01")
    expect(checkoutCompletionModule.store[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        order_id: "order_01",
      })
    )
    expect(paymentAttemptModule.store[0]?.order_id).toBe("order_01")
    expect(orderModule.store[0]?.metadata).toEqual({
      order_status: "confirmed",
      payment_status: "captured",
    })
  })

  it("reusa Order ja completada sem criar segunda Order", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_01",
        idempotency_key: "pi_01",
        cart_id: "cart_01",
        payment_intent_id: "pi_01",
        payment_attempt_id: "payatt_01",
        order_id: "order_existing",
        status: "completed",
        metadata: null,
      },
    ])
    const orderModule = createOrderModule([
      {
        id: "order_existing",
        cart_id: "cart_01",
        email: "cliente@pedido.test",
        display_id: 1002,
        metadata: null,
      },
    ])
    const runCompleteCart = jest.fn()

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-06-30T16:00:00.000Z"),
        runCompleteCart,
      }
    )

    expect(result.status).toBe("reused_existing_order")
    expect(result.order_id).toBe("order_existing")
    expect(result.checkout_completion_status).toBe("completed")
    expect(runCompleteCart).not.toHaveBeenCalled()
    expect(paymentAttemptModule.store[0]?.order_id).toBe("order_existing")
  })

  it("concurrency respeita log processing e nao deixa segundo vencedor", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_01",
        idempotency_key: "pi_01",
        cart_id: "cart_01",
        payment_intent_id: "pi_01",
        payment_attempt_id: "payatt_01",
        order_id: null,
        status: "processing",
        metadata: null,
      },
    ])
    const runCompleteCart = jest.fn()

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-06-30T16:00:00.000Z"),
        runCompleteCart,
      }
    )

    expect(result).toEqual({
      status: "already_processing",
      payment_attempt_id: "payatt_01",
      payment_intent_id: "pi_01",
      order_id: null,
      stripe_event_id: "evt_01",
      correlation_id: "corr_01",
      checkout_completion_status: "processing",
      order_status: null,
      payment_status: null,
    })
    expect(runCompleteCart).not.toHaveBeenCalled()
  })

  it("reusa PaymentAttempt.order_id como primeira fonte de idempotencia", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(
      buildAttempt({ order_id: "order_from_attempt" })
    )
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const orderModule = createOrderModule([
      {
        id: "order_from_attempt",
        email: "cliente@pedido.test",
        display_id: 1003,
        metadata: null,
      },
    ])
    const runCompleteCart = jest.fn()

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-06-30T16:00:00.000Z"),
        runCompleteCart,
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "reused_existing_order",
        order_id: "order_from_attempt",
        checkout_completion_status: "completed",
      })
    )
    expect(runCompleteCart).not.toHaveBeenCalled()
    expect(checkoutCompletionModule.store[0]).toEqual(
      expect.objectContaining({
        cart_id: "cart_01",
        payment_attempt_id: "payatt_01",
        order_id: "order_from_attempt",
        status: "completed",
      })
    )
  })

  it("reusa CheckoutCompletionLog por cart_id e payment_attempt_id sem consultar Order.cart_id", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_by_attempt",
        idempotency_key: "legacy-key",
        cart_id: "cart_01",
        payment_intent_id: "pi_01",
        payment_attempt_id: "payatt_01",
        order_id: "order_from_log",
        status: "completed",
        metadata: null,
      },
    ])
    const orderModule = createOrderModule([
      {
        id: "order_from_log",
        email: "cliente@pedido.test",
        display_id: 1004,
        metadata: null,
      },
    ])
    const runCompleteCart = jest.fn()

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-06-30T16:00:00.000Z"),
        runCompleteCart,
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "reused_existing_order",
        order_id: "order_from_log",
        checkout_completion_status: "completed",
      })
    )
    expect(runCompleteCart).not.toHaveBeenCalled()
    expect(paymentAttemptModule.store[0]?.order_id).toBe("order_from_log")
    expect(orderModule.listOrders).not.toHaveBeenCalledWith(
      expect.objectContaining({ cart_id: "cart_01" })
    )
  })

  it("marca CheckoutCompletionLog como failed quando falha antes de completar a Order", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        createContainer({
          paymentAttemptModule,
          checkoutCompletionModule,
        }),
        buildInput(),
        {
          now: () => new Date("2026-06-30T16:00:00.000Z"),
          getCart: async () => ({
            ...buildCart(),
            total: 0,
          }),
        }
      )
    ).rejects.toThrow("ORDER_ENTRYPOINT_CART_TOTAL_MISMATCH")

    expect(checkoutCompletionModule.store[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        order_id: null,
        error_code: "ORDER_ENTRYPOINT_FAILED",
      })
    )
  })

  it("recupera falha parcial depois da Order criada sem chamar completeCartWorkflow de novo", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const orderModule = createOrderModule([])
    const runCompleteCart = jest.fn(async () => {
      orderModule.store.push({
        id: "order_partial_01",
        cart_id: "cart_01",
        email: "cliente@pedido.test",
        display_id: 1002,
        metadata: null,
      })

      return { id: "order_partial_01" }
    })
    let shouldFailPersistOrderState = true
    const persistOrderState = jest.fn(async (_container, orderId: string) => {
      if (shouldFailPersistOrderState) {
        shouldFailPersistOrderState = false
        throw new Error("ORDER_METADATA_WRITE_FAILED")
      }

      const order = orderModule.store.find((entry) => entry.id === orderId)
      if (order) {
        order.metadata = {
          order_status: "confirmed",
          payment_status: "captured",
        }
      }
    })
    const container = createContainer({
      paymentAttemptModule,
      checkoutCompletionModule,
      orderModule,
    })

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        container,
        buildInput(),
        {
          now: () => new Date("2026-06-30T16:00:00.000Z"),
          getCart: async () => buildCart(),
          persistCartSnapshots: jest.fn(async () => undefined),
          runCompleteCart,
          persistOrderState,
        }
      )
    ).rejects.toThrow("ORDER_METADATA_WRITE_FAILED")

    expect(checkoutCompletionModule.store[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        order_id: "order_partial_01",
      })
    )
    expect(paymentAttemptModule.store[0]?.order_id).toBe("order_partial_01")

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      container,
      buildInput({ stripe_event_id: "evt_retry" }),
      {
        now: () => new Date("2026-06-30T16:01:00.000Z"),
        getCart: async () => buildCart(),
        runCompleteCart,
        persistOrderState,
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "reused_existing_order",
        order_id: "order_partial_01",
        checkout_completion_status: "completed",
        order_status: "confirmed",
        payment_status: "captured",
      })
    )
    expect(runCompleteCart).toHaveBeenCalledTimes(1)
    expect(checkoutCompletionModule.store[0]).toEqual(
      expect.objectContaining({
        status: "completed",
        order_id: "order_partial_01",
      })
    )
    expect(paymentAttemptModule.store[0]?.order_id).toBe("order_partial_01")
    expect(orderModule.store.find((order) => order.id === "order_partial_01")).toEqual(
      expect.objectContaining({
        metadata: {
          order_status: "confirmed",
          payment_status: "captured",
        },
      })
    )
  })
})
