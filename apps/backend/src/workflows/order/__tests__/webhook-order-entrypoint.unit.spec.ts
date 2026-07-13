import fs from "fs"
import path from "path"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../../modules/analytics-event-log"
import { CHECKOUT_COMPLETION_MODULE } from "../../../modules/checkout-completion"
import { EMAIL_DELIVERY_LOG_MODULE } from "../../../modules/email-delivery-log"
import { PAYMENT_ATTEMPT_MODULE } from "../../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../../modules/payment-attempt/types"
import {
  OrderCreationEntrypointError,
  runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
  validateCreateOrderFromConfirmedPaymentAttemptInput,
} from "../webhook-order-entrypoint"

const entrypointPath = path.join(__dirname, "../webhook-order-entrypoint.ts")

function buildEligibleAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_entry_01",
    cart_id: "cart_01",
    payment_collection_id: "paycol_01",
    payment_session_id: "payses_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_entry_123",
    provider_payment_session_id: "ps_123",
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
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

function buildInput(
  overrides: Partial<{
    payment_attempt_id: string
    payment_intent_id: string
    stripe_event_id: string | null
    correlation_id: string | null
  }> = {}
) {
  return {
    payment_attempt_id: "payatt_entry_01",
    payment_intent_id: "pi_entry_123",
    stripe_event_id: "evt_entry_01",
    correlation_id: "corr_entry_01",
    ...overrides,
  }
}

function buildCart() {
  return {
    id: "cart_01",
    total: 99,
    currency_code: "brl",
    completed_at: null,
    items: [
      {
        id: "line_item_entry_01",
        quantity: 1,
        unit_price: 99,
        metadata: {
          preserve_me: true,
        },
        variant: {
          id: "variant_entry_01",
          sku: "SKU-ENTRY-01",
          metadata: {
            gelato_product_uid: "gelato_prod_entry_01",
            gelato_template_id: "tmpl_entry_01",
            gelato_variant_options: {
              size: "M",
              color: "Preto",
            },
            template_mode: "fixed",
          },
          prices: [
            {
              amount: 99,
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
    updatePaymentAttempts: jest.fn(async (input: PaymentAttemptRecord | PaymentAttemptRecord[]) => {
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

function createCheckoutCompletionModule(
  records: Array<Record<string, unknown>> = [
    {
      id: "chkcpl_entry_01",
      idempotency_key: "pi_entry_123",
      cart_id: "cart_01",
      payment_intent_id: "pi_entry_123",
      payment_attempt_id: "payatt_entry_01",
      order_id: "order_entry_existing",
      status: "completed",
      metadata: null,
    },
  ]
) {
  const store: Array<Record<string, unknown>> = [...records]
  const matchesFilters = (
    record: Record<string, unknown>,
    filters: Record<string, unknown> = {}
  ) => {
    return Object.entries(filters).every(([key, value]) => {
      return value === undefined || record[key] === value
    })
  }

  return {
    listCheckoutCompletionLogs: jest.fn(
      async (filters?: Record<string, unknown>) => {
        return store.filter((record) => matchesFilters(record, filters))
      }
    ),
    createCheckoutCompletionLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const created = {
        ...row,
        id: row.id ?? `chkcpl_entry_${store.length + 1}`,
      }
      if (
        store.some(
          (record) =>
            record.id === created.id ||
            record.idempotency_key === created.idempotency_key
        )
      ) {
        throw new Error("duplicate key value violates unique constraint")
      }
      store.push(created)
      return [created]
    }),
    updateCheckoutCompletionLogs: jest.fn(async (input: Record<string, unknown> | Array<Record<string, unknown>>) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = store.findIndex((record) => record.id === row.id)

      if (index < 0) {
        return []
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

function createOrderModule(
  records: Array<Record<string, unknown>> = [
    {
      id: "order_entry_existing",
      cart_id: "cart_01",
      email: "cliente@pedido.test",
      display_id: 1001,
      metadata: null,
    },
  ]
) {
  const store: Array<Record<string, unknown>> = [...records]

  return {
    listOrders: jest.fn(async (selector?: Record<string, unknown>) => {
      return store.filter((record) => !selector?.id || record.id === selector.id)
    }),
    updateOrders: jest.fn(async (selector: Record<string, unknown>, update: Record<string, unknown>) => {
      const index = store.findIndex((record) => record.id === selector.id)
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
    listAnalyticsEventLogs: jest.fn(async () => store),
    createAnalyticsEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const created = {
        ...row,
        id: `anlevt_entry_${store.length + 1}`,
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
    listEmailDeliveryLogs: jest.fn(async () => store),
    createEmailDeliveryLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const created = {
        ...row,
        id: `emlog_entry_${store.length + 1}`,
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
    listGelatoFulfillments: jest.fn(async () => store),
    createGelatoFulfillments: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const created = {
        ...row,
        id: `gelful_entry_${store.length + 1}`,
      }
      store.push(created)
      return [created]
    }),
    store,
  }
}

function createContainer(input: {
  paymentAttemptModule?: ReturnType<typeof createPaymentAttemptModule>
  checkoutCompletionModule?: ReturnType<typeof createCheckoutCompletionModule>
  analyticsEventLogModule?: ReturnType<typeof createAnalyticsEventLogModule>
  emailDeliveryLogModule?: ReturnType<typeof createEmailDeliveryLogModule>
  gelatoFulfillmentModule?: ReturnType<typeof createGelatoFulfillmentModule>
  orderModule?: ReturnType<typeof createOrderModule>
  cart?: Record<string, unknown>
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
            data: [input.cart ?? buildCart()],
          })),
        }
      }

      if (key === Modules.CART) {
        return {
          updateLineItems: jest.fn(async (rows) => rows),
        }
      }

      if (key === Modules.ORDER) {
        return input.orderModule
      }

      return undefined
    }),
  } as unknown as MedusaContainer
}

describe("validateCreateOrderFromConfirmedPaymentAttemptInput", () => {
  it("exige payment_attempt_id e payment_intent_id", () => {
    expect(() =>
      validateCreateOrderFromConfirmedPaymentAttemptInput(
        buildInput({ payment_attempt_id: "  " })
      )
    ).toThrow(OrderCreationEntrypointError)

    expect(() =>
      validateCreateOrderFromConfirmedPaymentAttemptInput(
        buildInput({ payment_intent_id: "" })
      )
    ).toThrow(OrderCreationEntrypointError)
  })
})

describe("runCreateOrderFromConfirmedPaymentAttemptEntrypoint", () => {
  const originalSupportEmail = process.env.SUPPORT_EMAIL
  const originalResendEnabled = process.env.RESEND_ORDER_CONFIRMATION_ENABLED
  const originalResendApiKey = process.env.RESEND_API_KEY
  const originalResendFromEmail = process.env.RESEND_FROM_EMAIL

  beforeEach(() => {
    process.env.SUPPORT_EMAIL = "support@pedido.test"
    process.env.RESEND_ORDER_CONFIRMATION_ENABLED = "true"
    process.env.RESEND_API_KEY = "re_test_order_entrypoint"
    process.env.RESEND_FROM_EMAIL = "pedidos@pedido.test"
  })

  afterEach(() => {
    if (originalSupportEmail === undefined) {
      delete process.env.SUPPORT_EMAIL
    } else {
      process.env.SUPPORT_EMAIL = originalSupportEmail
    }

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

    if (originalResendFromEmail === undefined) {
      delete process.env.RESEND_FROM_EMAIL
    } else {
      process.env.RESEND_FROM_EMAIL = originalResendFromEmail
    }
  })

  it("nao contem o id fixo historico no runtime do entrypoint", () => {
    const source = fs.readFileSync(entrypointPath, "utf8")
    const fixedId = ["chkcpl", "order", "entrypoint", "pending"].join("_")

    expect(source).not.toContain(fixedId)
  })

  it("reusa CheckoutCompletionLog completo e cura PaymentAttempt.order_id", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildEligibleAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const orderModule = createOrderModule()
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
        order_id: "order_entry_existing",
        checkout_completion_status: "completed",
        order_status: "confirmed",
        payment_status: "captured",
      })
    )
    expect(paymentAttemptModule.store[0]?.order_id).toBe("order_entry_existing")
    expect(orderModule.store[0]?.metadata).toEqual({
      order_status: "confirmed",
      payment_status: "captured",
    })
    expect(checkoutCompletionModule.createCheckoutCompletionLogs).not.toHaveBeenCalled()
    expect(runCompleteCart).not.toHaveBeenCalled()
  })

  it("propaga inelegibilidade antes de tocar em CheckoutCompletionLog", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(
      buildEligibleAttempt({ status: "payment_failed" })
    )
    const checkoutCompletionModule = createCheckoutCompletionModule()

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        createContainer({
          paymentAttemptModule,
          checkoutCompletionModule,
          orderModule: createOrderModule(),
        }),
        buildInput()
      )
    ).rejects.toThrow("PAYMENT_ATTEMPT_NOT_ELIGIBLE_FOR_ORDER_STATUS")

    expect(checkoutCompletionModule.listCheckoutCompletionLogs).not.toHaveBeenCalled()
  })

  it("preserva contrato Phase 05 quando modulo de conclusao nao esta configurado", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildEligibleAttempt())

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        orderModule: createOrderModule(),
      }),
      buildInput()
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "order_creation_unavailable",
        order_id: null,
        checkout_completion_status: "processing",
      })
    )
    expect(paymentAttemptModule.store[0]?.order_id).toBeNull()
  })

  it("marca processing antigo sem order_id como retryable e cria Order na nova tentativa", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildEligibleAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_stale_processing",
        idempotency_key: "pi_entry_123",
        cart_id: "cart_01",
        payment_intent_id: "pi_entry_123",
        payment_attempt_id: "payatt_entry_01",
        order_id: null,
        status: "processing",
        metadata: null,
        locked_at: "2026-07-06T10:00:00.000Z",
      },
    ])
    const orderModule = createOrderModule()

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-07T12:00:00.000Z"),
        runCompleteCart: async () => ({ id: "order_entry_existing" }),
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "created",
        order_id: "order_entry_existing",
        checkout_completion_status: "completed",
      })
    )
    expect(checkoutCompletionModule.updateCheckoutCompletionLogs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "chkcpl_stale_processing",
        status: "failed",
        error_code: "CHECKOUT_COMPLETION_STALE_PROCESSING_WITHOUT_ORDER",
      })
    )
    expect(checkoutCompletionModule.updateCheckoutCompletionLogs).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "chkcpl_stale_processing",
        status: "processing",
        error_code: null,
      })
    )
    expect(paymentAttemptModule.store[0]?.order_id).toBe("order_entry_existing")
  })

  it("cria CheckoutCompletionLog sem id explicito e deixa o modulo gerar a chave primaria", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildEligibleAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([])
    const orderModule = createOrderModule()

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-08T12:00:00.000Z"),
        runCompleteCart: async () => ({ id: "order_entry_existing" }),
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "created",
        order_id: "order_entry_existing",
        checkout_completion_status: "completed",
      })
    )
    expect(checkoutCompletionModule.createCheckoutCompletionLogs).toHaveBeenCalledWith(
      expect.not.objectContaining({
        id: expect.anything(),
      })
    )
    expect(checkoutCompletionModule.store).toHaveLength(1)
    expect(checkoutCompletionModule.store[0]).toEqual(
      expect.objectContaining({
        id: "chkcpl_entry_1",
        idempotency_key: "pi_entry_123",
        payment_intent_id: "pi_entry_123",
        payment_attempt_id: "payatt_entry_01",
        order_id: "order_entry_existing",
        status: "completed",
      })
    )
    expect(paymentAttemptModule.store[0]?.order_id).toBe("order_entry_existing")
  })

  it("dois payment_intents diferentes criam CheckoutCompletionLogs distintos sem colisao de primary key", async () => {
    const checkoutCompletionModule = createCheckoutCompletionModule([])
    const firstAttemptModule = createPaymentAttemptModule(buildEligibleAttempt())
    const secondAttemptModule = createPaymentAttemptModule(
      buildEligibleAttempt({
        id: "payatt_entry_02",
        cart_id: "cart_02",
        provider_payment_intent_id: "pi_entry_456",
      })
    )

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule: firstAttemptModule,
        checkoutCompletionModule,
        orderModule: createOrderModule([
          {
            id: "order_entry_01",
            cart_id: "cart_01",
            email: "primeiro@pedido.test",
            display_id: 1001,
            metadata: null,
          },
        ]),
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-08T12:05:00.000Z"),
        runCompleteCart: async () => ({ id: "order_entry_01" }),
      }
    )

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule: secondAttemptModule,
        checkoutCompletionModule,
        orderModule: createOrderModule([
          {
            id: "order_entry_02",
            cart_id: "cart_02",
            email: "segundo@pedido.test",
            display_id: 1002,
            metadata: null,
          },
        ]),
        cart: {
          ...buildCart(),
          id: "cart_02",
        },
      }),
      buildInput({
        payment_attempt_id: "payatt_entry_02",
        payment_intent_id: "pi_entry_456",
        stripe_event_id: "evt_entry_02",
        correlation_id: "corr_entry_02",
      }),
      {
        now: () => new Date("2026-07-08T12:06:00.000Z"),
        runCompleteCart: async () => ({ id: "order_entry_02" }),
      }
    )

    expect(checkoutCompletionModule.store).toEqual([
      expect.objectContaining({
        id: "chkcpl_entry_1",
        idempotency_key: "pi_entry_123",
        payment_intent_id: "pi_entry_123",
        payment_attempt_id: "payatt_entry_01",
        order_id: "order_entry_01",
      }),
      expect.objectContaining({
        id: "chkcpl_entry_2",
        idempotency_key: "pi_entry_456",
        payment_intent_id: "pi_entry_456",
        payment_attempt_id: "payatt_entry_02",
        order_id: "order_entry_02",
      }),
    ])
    expect(new Set(checkoutCompletionModule.store.map((row) => row.id)).size).toBe(2)
    expect(firstAttemptModule.store[0]?.order_id).toBe("order_entry_01")
    expect(secondAttemptModule.store[0]?.order_id).toBe("order_entry_02")
  })

  it("reprocessa CheckoutCompletionLog failed sem order_id por idempotency_key e cria Order", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildEligibleAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_failed_retry",
        idempotency_key: "pi_entry_123",
        cart_id: "cart_01",
        payment_intent_id: "pi_entry_123",
        payment_attempt_id: "payatt_entry_01",
        order_id: null,
        status: "failed",
        error_code: "ORDER_ENTRYPOINT_FAILED",
        error_message: "Falha anterior.",
        metadata: null,
      },
    ])

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        orderModule: createOrderModule(),
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-08T12:10:00.000Z"),
        runCompleteCart: async () => ({ id: "order_entry_existing" }),
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "created",
        order_id: "order_entry_existing",
        checkout_completion_status: "completed",
      })
    )
    expect(checkoutCompletionModule.createCheckoutCompletionLogs).not.toHaveBeenCalled()
    expect(checkoutCompletionModule.updateCheckoutCompletionLogs).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "chkcpl_failed_retry",
        status: "processing",
        error_code: null,
        error_message: null,
      })
    )
    expect(checkoutCompletionModule.store[0]).toEqual(
      expect.objectContaining({
        id: "chkcpl_failed_retry",
        order_id: "order_entry_existing",
        status: "completed",
      })
    )
    expect(paymentAttemptModule.store[0]?.order_id).toBe("order_entry_existing")
  })

  it("valida PaymentAttempt.amount pelo total dos line items quando cart.total nao vem carregado", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildEligibleAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([])
    const orderModule = createOrderModule()
    const { total: _missingTotal, ...cartWithoutTotal } = buildCart()

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        orderModule,
        cart: cartWithoutTotal,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-07T13:00:00.000Z"),
        runCompleteCart: async () => ({ id: "order_entry_existing" }),
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "created",
        order_id: "order_entry_existing",
        checkout_completion_status: "completed",
      })
    )
    expect(paymentAttemptModule.store[0]?.order_id).toBe("order_entry_existing")
  })
})
