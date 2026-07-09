import { createHash } from "crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../../modules/analytics-event-log"
import { isPurchaseCompletedLocallyRecorded } from "../../../modules/analytics-event-log/service"
import { CHECKOUT_COMPLETION_MODULE } from "../../../modules/checkout-completion"
import { EMAIL_DELIVERY_LOG_MODULE } from "../../../modules/email-delivery-log"
import {
  buildRecipientEmailAudit,
  isOrderConfirmationEmailLocallyRecorded,
} from "../../../modules/email-delivery-log/service"
import { PAYMENT_ATTEMPT_MODULE } from "../../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../../modules/payment-attempt/types"
import {
  runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
  type CreateOrderFromConfirmedPaymentAttemptInput,
} from "../webhook-order-entrypoint"

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const SUPPORT_EMAIL = joinKey("support", "@", "lojinha", ".", "test")
const ORDER_EMAIL = joinKey("cliente", "@", "compras", ".", "test")

function buildAwilixResolutionError(key: string): Error {
  const error = new Error(`Could not resolve '${key}'`)
  error.name = "AwilixResolutionError"
  return error
}

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_email_01",
    cart_id: "cart_email_01",
    payment_collection_id: "paycol_email_01",
    payment_session_id: "payses_email_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_email_01",
    provider_payment_session_id: "ps_email_01",
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
    payment_attempt_id: "payatt_email_01",
    payment_intent_id: "pi_email_01",
    stripe_event_id: "evt_email_01",
    correlation_id: "corr_email_01",
    ...overrides,
  }
}

function buildCart() {
  return {
    id: "cart_email_01",
    total: 9900,
    currency_code: "brl",
    completed_at: null,
    items: [
      {
        id: "line_item_email_01",
        quantity: 1,
        metadata: {
          preserve_me: true,
        },
        variant: {
          id: "variant_email_01",
          sku: "SKU-EMAIL-01",
          metadata: {
            gelato_product_uid: "gelato_prod_email_01",
            gelato_template_id: "tmpl_email_01",
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

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order_email_01",
    cart_id: "cart_email_01",
    email: ORDER_EMAIL,
    display_id: 1001,
    metadata: null,
    ...overrides,
  }
}

function createPaymentAttemptModule(
  attempts: PaymentAttemptRecord | PaymentAttemptRecord[]
) {
  const store = Array.isArray(attempts) ? [...attempts] : [attempts]

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
        id: `chkcpl_email_${store.length + 1}`,
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

function createAnalyticsEventLogModule(records: Array<Record<string, unknown>> = []) {
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
        id: `anlevt_email_${store.length + 1}`,
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
    createEmailDeliveryLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input

      if (
        store.some(
          (record) =>
            (row.id && record.id === row.id) ||
            record.idempotency_key === row.idempotency_key ||
            (record.email_type === row.email_type &&
              record.order_id === row.order_id)
        )
      ) {
        throw new Error("duplicate key value violates unique constraint")
      }

      const created = {
        ...row,
        id: `emlog_email_${store.length + 1}`,
      }
      store.push(created)
      return [created]
    }),
    store,
  }
}

function createOrderModule(records: Array<Record<string, unknown>> = []) {
  const store = [...records]

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

      return index >= 0 ? [store[index]] : []
    }),
    store,
  }
}

function createQueryGraph(cart: ReturnType<typeof buildCart>) {
  return {
    graph: jest.fn(async (input: { filters?: Record<string, unknown> }) => {
      return {
        data: input.filters?.id === cart.id ? [cart] : [],
      }
    }),
  }
}

function createContainer(input: {
  paymentAttemptModule: ReturnType<typeof createPaymentAttemptModule>
  checkoutCompletionModule: ReturnType<typeof createCheckoutCompletionModule>
  analyticsEventLogModule?: ReturnType<typeof createAnalyticsEventLogModule>
  emailDeliveryLogModule?: ReturnType<typeof createEmailDeliveryLogModule>
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
        return input.analyticsEventLogModule
      }

      if (key === EMAIL_DELIVERY_LOG_MODULE || key === "email_delivery_log") {
        return input.emailDeliveryLogModule
      }

      if (key === Modules.ORDER) {
        return input.orderModule ?? createOrderModule()
      }

      if (key === ContainerRegistrationKeys.QUERY) {
        return createQueryGraph(buildCart())
      }

      if (key === Modules.CART) {
        return {
          updateLineItems: jest.fn(async () => undefined),
        }
      }

      return undefined
    }),
  } as unknown as MedusaContainer
}

describe("runCreateOrderFromConfirmedPaymentAttemptEntrypoint email enqueue", () => {
  const originalSupportEmail = process.env.SUPPORT_EMAIL
  const originalResendEnabled = process.env.RESEND_ORDER_CONFIRMATION_ENABLED
  const originalResendApiKey = process.env.RESEND_API_KEY
  const originalResendFromEmail = process.env.RESEND_FROM_EMAIL

  beforeEach(() => {
    process.env.SUPPORT_EMAIL = SUPPORT_EMAIL
    process.env.RESEND_ORDER_CONFIRMATION_ENABLED = "true"
    process.env.RESEND_API_KEY = "re_test_email_enqueue"
    process.env.RESEND_FROM_EMAIL = "pedidos@lojinha.test"
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

  it("grava EmailDeliveryLog localmente quando Order e purchase_completed existem", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const emailDeliveryLogModule = createEmailDeliveryLogModule()
    const orderModule = createOrderModule()

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        analyticsEventLogModule,
        emailDeliveryLogModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-01T12:00:00.000Z"),
        getCart: async () => buildCart(),
        persistCartSnapshots: jest.fn(async () => undefined),
        runCompleteCart: jest.fn(async () => {
          orderModule.store.push(buildOrder())
          return { id: "order_email_01" }
        }),
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "created",
        order_id: "order_email_01",
      })
    )
    expect(analyticsEventLogModule.store).toHaveLength(1)
    expect(emailDeliveryLogModule.store).toHaveLength(1)
    expect(emailDeliveryLogModule.store[0]).toEqual(
      expect.objectContaining({
        email_type: "order_confirmation",
        template_key: "order_confirmation_v1",
        template_version: 1,
        provider: "resend",
        idempotency_key: "order-confirmation/order_email_01",
        order_id: "order_email_01",
        status: "recorded",
        analytics_event_log_id: "anlevt_email_1",
      })
    )
    expect(emailDeliveryLogModule.store[0]?.payload).toEqual(
      expect.objectContaining({
        order_id: "order_email_01",
        order_reference: "1001",
        amount: 9900,
        currency_code: "brl",
        item_count: 1,
        items: [
          {
            sku: "SKU-EMAIL-01",
            quantity: 1,
            unit_price: 9900,
            subtotal: 9900,
          },
        ],
      })
    )
    const createInput = emailDeliveryLogModule.createEmailDeliveryLogs.mock
      .calls[0]?.[0] as Record<string, unknown>
    expect(createInput).not.toHaveProperty("id")
    expect(createInput).not.toHaveProperty("created_at")
    expect(createInput).not.toHaveProperty("updated_at")
    expect(createInput).not.toHaveProperty("deleted_at")
    expect(JSON.stringify(createInput)).not.toContain(
      joinKey("emlog", "_order_entrypoint", "_pending")
    )
    const audit = buildRecipientEmailAudit(ORDER_EMAIL)
    expect(emailDeliveryLogModule.store[0]).toEqual(
      expect.objectContaining({
        recipient_email_hash: audit.recipient_email_hash,
        recipient_email_domain: audit.recipient_email_domain,
      })
    )
    expect(JSON.stringify(emailDeliveryLogModule.store[0])).not.toContain(ORDER_EMAIL)
  })

  it("ignora e-mail com provider incompleto e preserva Order e analytics", async () => {
    delete process.env.SUPPORT_EMAIL
    process.env.RESEND_ORDER_CONFIRMATION_ENABLED = "true"
    delete process.env.RESEND_API_KEY
    delete process.env.RESEND_FROM_EMAIL

    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const orderModule = createOrderModule()

    const container = createContainer({
      paymentAttemptModule,
      checkoutCompletionModule,
      analyticsEventLogModule,
      orderModule,
    })
    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      container,
      buildInput(),
      {
        now: () => new Date("2026-07-01T12:00:00.000Z"),
        getCart: async () => buildCart(),
        persistCartSnapshots: jest.fn(async () => undefined),
        runCompleteCart: jest.fn(async () => {
          orderModule.store.push(buildOrder())
          return { id: "order_email_01" }
        }),
      }
    )

    expect(result).toEqual(
      expect.objectContaining({
        status: "created",
        order_id: "order_email_01",
      })
    )
    expect(analyticsEventLogModule.store).toHaveLength(1)
    expect(container.resolve).not.toHaveBeenCalledWith("email_delivery_log")
    expect(container.resolve).not.toHaveBeenCalledWith(EMAIL_DELIVERY_LOG_MODULE)
  })

  it("dois Orders distintos criam EmailDeliveryLogs com ids gerados distintos", async () => {
    const paymentAttemptModule = createPaymentAttemptModule([
      buildAttempt(),
      buildAttempt({
        id: "payatt_email_02",
        cart_id: "cart_email_02",
        payment_collection_id: "paycol_email_02",
        payment_session_id: "payses_email_02",
        provider_payment_intent_id: "pi_email_02",
        provider_payment_session_id: "ps_email_02",
      }),
    ])
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const emailDeliveryLogModule = createEmailDeliveryLogModule()
    const orderModule = createOrderModule()
    const baseCart = buildCart()
    const baseItem = baseCart.items[0]
    const cart2 = {
      ...baseCart,
      id: "cart_email_02",
      items: [
        {
          ...baseItem,
          id: "line_item_email_02",
          variant: {
            ...baseItem.variant,
            id: "variant_email_02",
            sku: "SKU-EMAIL-02",
          },
        },
      ],
    }

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        analyticsEventLogModule,
        emailDeliveryLogModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-01T12:00:00.000Z"),
        getCart: async () => buildCart(),
        persistCartSnapshots: jest.fn(async () => undefined),
        runCompleteCart: jest.fn(async () => {
          orderModule.store.push(buildOrder())
          return { id: "order_email_01" }
        }),
      }
    )

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        analyticsEventLogModule,
        emailDeliveryLogModule,
        orderModule,
      }),
      buildInput({
        payment_attempt_id: "payatt_email_02",
        payment_intent_id: "pi_email_02",
        stripe_event_id: "evt_email_02",
        correlation_id: "corr_email_02",
      }),
      {
        now: () => new Date("2026-07-01T12:01:00.000Z"),
        getCart: async () => cart2,
        persistCartSnapshots: jest.fn(async () => undefined),
        runCompleteCart: jest.fn(async () => {
          orderModule.store.push(
            buildOrder({
              id: "order_email_02",
              cart_id: "cart_email_02",
              display_id: 1002,
            })
          )
          return { id: "order_email_02" }
        }),
      }
    )

    expect(emailDeliveryLogModule.store).toHaveLength(2)
    expect(emailDeliveryLogModule.store.map((record) => record.id)).toEqual([
      "emlog_email_1",
      "emlog_email_2",
    ])
    expect(
      emailDeliveryLogModule.createEmailDeliveryLogs.mock.calls.map(
        ([input]) => (input as Record<string, unknown>).id
      )
    ).toEqual([undefined, undefined])
  })

  it("tolera alias legado ausente quando a key canonica email_delivery_log ja resolve", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_email_alias",
        idempotency_key: "pi_email_01",
        cart_id: "cart_email_01",
        payment_intent_id: "pi_email_01",
        payment_attempt_id: "payatt_email_01",
        order_id: "order_email_01",
        status: "completed",
        metadata: null,
      },
    ])
    const analyticsEventLogModule = createAnalyticsEventLogModule([
      {
        id: "anlevt_email_alias",
        event_name: "purchase_completed",
        event_version: 1,
        idempotency_key: "purchase_completed:stripe:pi_email_01",
        order_id: "order_email_01",
        cart_id: "cart_email_01",
        payment_attempt_id: "payatt_email_01",
        checkout_completion_log_id: "chkcpl_email_alias",
        payment_intent_id: "pi_email_01",
        status: "recorded",
        payload: {
          order_id: "order_email_01",
        },
        metadata: null,
        attempt_count: 0,
        recorded_at: "2026-07-01T12:00:00.000Z",
        created_at: "2026-07-01T12:00:00.000Z",
        updated_at: "2026-07-01T12:00:00.000Z",
        deleted_at: null,
      },
    ])
    const emailDeliveryLogModule = createEmailDeliveryLogModule([
      {
        id: "emlog_email_alias",
        email_type: "order_confirmation",
        template_key: "order_confirmation_v1",
        template_version: 1,
        provider: "resend",
        idempotency_key: "order-confirmation/order_email_01",
        order_id: "order_email_01",
        cart_id: "cart_email_01",
        payment_attempt_id: "payatt_email_01",
        checkout_completion_log_id: "chkcpl_email_alias",
        analytics_event_log_id: "anlevt_email_alias",
        payment_intent_id: "pi_email_01",
        status: "recorded",
        recipient_email_hash: "hash",
        recipient_email_domain: "compras.test",
        payload: {
          order_id: "order_email_01",
        },
        metadata: null,
        attempt_count: 0,
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
      },
    ])
    const orderModule = createOrderModule([buildOrder()])

    const container = {
      resolve: jest.fn((key: string) => {
        if (key === PAYMENT_ATTEMPT_MODULE) {
          return paymentAttemptModule
        }

        if (key === CHECKOUT_COMPLETION_MODULE) {
          return checkoutCompletionModule
        }

        if (key === "analytics_event_log" || key === ANALYTICS_EVENT_LOG_MODULE) {
          return analyticsEventLogModule
        }

        if (key === "email_delivery_log") {
          return emailDeliveryLogModule
        }

        if (key === EMAIL_DELIVERY_LOG_MODULE) {
          throw buildAwilixResolutionError(key)
        }

        if (key === Modules.ORDER) {
          return orderModule
        }

        if (key === ContainerRegistrationKeys.QUERY) {
          return createQueryGraph(buildCart())
        }

        if (key === Modules.CART) {
          return {
            updateLineItems: jest.fn(async () => undefined),
          }
        }

        return undefined
      }),
    } as unknown as MedusaContainer

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      container,
      buildInput({ stripe_event_id: "evt_email_alias" }),
      {
        now: () => new Date("2026-07-01T12:05:30.000Z"),
        getCart: async () => buildCart(),
      }
    )

    expect(result.status).toBe("reused_existing_order")
    expect(container.resolve).toHaveBeenCalledWith("email_delivery_log")
    expect(container.resolve).not.toHaveBeenCalledWith(EMAIL_DELIVERY_LOG_MODULE)
  })

  it("unique violation sem registro reutilizavel nao vira sucesso silencioso", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const emailDeliveryLogModule = createEmailDeliveryLogModule()
    emailDeliveryLogModule.createEmailDeliveryLogs.mockImplementation(async () => {
      throw new Error("duplicate key value violates unique constraint")
    })
    const orderModule = createOrderModule()

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        createContainer({
          paymentAttemptModule,
          checkoutCompletionModule,
          analyticsEventLogModule,
          emailDeliveryLogModule,
          orderModule,
        }),
        buildInput(),
        {
          now: () => new Date("2026-07-01T12:00:00.000Z"),
          getCart: async () => buildCart(),
          persistCartSnapshots: jest.fn(async () => undefined),
          runCompleteCart: jest.fn(async () => {
            orderModule.store.push(buildOrder())
            return { id: "order_email_01" }
          }),
        }
      )
    ).rejects.toThrow("duplicate key value violates unique constraint")
  })

  it("SKU ausente usa fallback estavel e nao bloqueia Order, purchase_completed ou EmailDeliveryLog", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const emailDeliveryLogModule = createEmailDeliveryLogModule()
    const orderModule = createOrderModule()
    const baseCart = buildCart()
    const baseItem = baseCart.items[0]
    const cartWithoutSku = {
      ...baseCart,
      items: [
        {
          ...baseItem,
          variant: {
            ...baseItem.variant,
            sku: null,
          },
        },
      ],
    }

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        analyticsEventLogModule,
        emailDeliveryLogModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-01T12:00:00.000Z"),
        getCart: async () => cartWithoutSku,
        persistCartSnapshots: jest.fn(async () => undefined),
        runCompleteCart: jest.fn(async () => {
          orderModule.store.push(buildOrder())
          return { id: "order_email_01" }
        }),
      }
    )

    expect(result.status).toBe("created")
    expect(analyticsEventLogModule.store).toHaveLength(1)
    expect(emailDeliveryLogModule.store).toHaveLength(1)
    const storedEmail = emailDeliveryLogModule.store[0] as {
      payload: { items: Array<{ sku: string }> }
    }
    expect(storedEmail.payload.items[0]?.sku).toBe("variant_email_01")
  })

  it("replay reutiliza EmailDeliveryLog existente sem duplicar Order, analytics ou e-mail", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_email_01",
        idempotency_key: "pi_email_01",
        cart_id: "cart_email_01",
        payment_intent_id: "pi_email_01",
        payment_attempt_id: "payatt_email_01",
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
        idempotency_key: "purchase_completed:stripe:pi_email_01",
        order_id: "order_existing_01",
        cart_id: "cart_email_01",
        payment_attempt_id: "payatt_email_01",
        checkout_completion_log_id: "chkcpl_email_01",
        payment_intent_id: "pi_email_01",
        status: "failed",
        payload: {
          order_id: "order_existing_01",
          cart_id: "cart_email_01",
          payment_attempt_id: "payatt_email_01",
          checkout_completion_log_id: "chkcpl_email_01",
          payment_intent_id: "pi_email_01",
          payment_method_type: "card",
          amount: 9900,
          currency_code: "brl",
          order_status: "confirmed",
          payment_status: "captured",
          item_count: 1,
          items: [],
        },
        metadata: null,
      },
    ])
    const emailDeliveryLogModule = createEmailDeliveryLogModule([
      {
        id: "emlog_existing_01",
        email_type: "order_confirmation",
        template_key: "order_confirmation_v1",
        template_version: 1,
        provider: "resend",
        idempotency_key: "order-confirmation/order_existing_01",
        order_id: "order_existing_01",
        cart_id: "cart_email_01",
        payment_attempt_id: "payatt_email_01",
        checkout_completion_log_id: "chkcpl_email_01",
        analytics_event_log_id: "anlevt_existing_01",
        payment_intent_id: "pi_email_01",
        status: "failed",
        recipient_email_hash: buildRecipientEmailAudit(ORDER_EMAIL).recipient_email_hash,
        recipient_email_domain: buildRecipientEmailAudit(ORDER_EMAIL).recipient_email_domain,
        payload: {
          order_id: "order_existing_01",
          order_reference: "1001",
          amount: 9900,
          currency_code: "brl",
          item_count: 1,
          items: [
            {
              sku: "SKU-EMAIL-01",
              quantity: 1,
              unit_price: 9900,
              subtotal: 9900,
            },
          ],
          support_email: SUPPORT_EMAIL,
        },
        metadata: null,
      },
    ])
    const orderModule = createOrderModule([
      buildOrder({
        id: "order_existing_01",
      }),
    ])

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        analyticsEventLogModule,
        emailDeliveryLogModule,
        orderModule,
      }),
      buildInput({ stripe_event_id: "evt_email_replay" }),
      {
        now: () => new Date("2026-07-01T12:02:00.000Z"),
        getCart: async () => buildCart(),
      }
    )

    expect(result.status).toBe("reused_existing_order")
    expect(analyticsEventLogModule.createAnalyticsEventLogs).not.toHaveBeenCalled()
    expect(emailDeliveryLogModule.createEmailDeliveryLogs).not.toHaveBeenCalled()
    expect(analyticsEventLogModule.store).toHaveLength(1)
    expect(emailDeliveryLogModule.store).toHaveLength(1)
  })

  it("recovery por CheckoutCompletionLog cria EmailDeliveryLog ausente depois de purchase_completed", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule([
      {
        id: "chkcpl_email_processing",
        idempotency_key: "pi_email_01",
        cart_id: "cart_email_01",
        payment_intent_id: "pi_email_01",
        payment_attempt_id: "payatt_email_01",
        order_id: "order_recovered_01",
        status: "completed",
        metadata: null,
      },
    ])
    const analyticsEventLogModule = createAnalyticsEventLogModule([
      {
        id: "anlevt_recovery_01",
        event_name: "purchase_completed",
        event_version: 1,
        idempotency_key: "purchase_completed:stripe:pi_email_01",
        order_id: "order_recovered_01",
        cart_id: "cart_email_01",
        payment_attempt_id: "payatt_email_01",
        checkout_completion_log_id: "chkcpl_email_processing",
        payment_intent_id: "pi_email_01",
        status: "recorded",
        payload: {
          order_id: "order_recovered_01",
          cart_id: "cart_email_01",
          payment_attempt_id: "payatt_email_01",
          checkout_completion_log_id: "chkcpl_email_processing",
          payment_intent_id: "pi_email_01",
          payment_method_type: "card",
          amount: 9900,
          currency_code: "brl",
          order_status: "confirmed",
          payment_status: "captured",
          item_count: 1,
          items: [],
        },
        metadata: null,
      },
    ])
    const emailDeliveryLogModule = createEmailDeliveryLogModule()
    const orderModule = createOrderModule([
      buildOrder({
        id: "order_recovered_01",
      }),
    ])

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        analyticsEventLogModule,
        emailDeliveryLogModule,
        orderModule,
      }),
      buildInput({ stripe_event_id: "evt_email_recovery" }),
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
    expect(emailDeliveryLogModule.store).toHaveLength(1)
    expect(emailDeliveryLogModule.store[0]).toEqual(
      expect.objectContaining({
        order_id: "order_recovered_01",
        idempotency_key: "order-confirmation/order_recovered_01",
        status: "recorded",
      })
    )
  })

  it("nao cria EmailDeliveryLog quando purchase_completed local duravel nao existe", () => {
    expect(isPurchaseCompletedLocallyRecorded("processing")).toBe(false)
    expect(isPurchaseCompletedLocallyRecorded(null)).toBe(false)
    expect(isOrderConfirmationEmailLocallyRecorded({ status: "recorded" })).toBe(
      true
    )
  })

  it("estados nao elegiveis nao criam Order nem EmailDeliveryLog", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(
      buildAttempt({
        status: "payment_failed",
      })
    )
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const emailDeliveryLogModule = createEmailDeliveryLogModule()

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        createContainer({
          paymentAttemptModule,
          checkoutCompletionModule,
          analyticsEventLogModule,
          emailDeliveryLogModule,
        }),
        buildInput()
      )
    ).rejects.toThrow("PAYMENT_ATTEMPT_NOT_ELIGIBLE_FOR_ORDER_STATUS")

    expect(emailDeliveryLogModule.store).toHaveLength(0)
  })

  it("failed e dead_letter continuam satisfazendo gate local de e-mail sem exigir sent", () => {
    expect(
      isOrderConfirmationEmailLocallyRecorded({
        status: "failed",
      })
    ).toBe(true)
    expect(
      isOrderConfirmationEmailLocallyRecorded({
        status: "dead_letter",
      })
    ).toBe(true)
    expect(
      isOrderConfirmationEmailLocallyRecorded({
        status: "sent",
      })
    ).toBe(true)
    expect(isOrderConfirmationEmailLocallyRecorded("processing")).toBe(false)
  })

  it("EmailDeliveryLog module missing or misconfigured -> no silent success", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const runCompleteCart = jest.fn(async () => ({ id: "order_should_not_exist" }))

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        createContainer({
          paymentAttemptModule,
          checkoutCompletionModule,
          analyticsEventLogModule,
        }),
        buildInput(),
        {
          now: () => new Date("2026-07-01T12:05:00.000Z"),
          getCart: async () => buildCart(),
          runCompleteCart,
        }
      )
    ).rejects.toMatchObject({
      name: "OrderCreationEntrypointError",
      code: "ORDER_ENTRYPOINT_EMAIL_DELIVERY_LOG_MODULE_UNAVAILABLE",
      message:
        "Modulo de email_delivery_log nao configurado. Keys tentadas: email_delivery_log, email-delivery-log.",
    })

    expect(runCompleteCart).not.toHaveBeenCalled()
    expect(checkoutCompletionModule.store).toHaveLength(0)
    expect(paymentAttemptModule.store[0]?.order_id).toBeNull()
    expect(analyticsEventLogModule.store).toHaveLength(0)
  })

  it("persiste somente hash/domain do destinatario canonico Order.email", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const analyticsEventLogModule = createAnalyticsEventLogModule()
    const emailDeliveryLogModule = createEmailDeliveryLogModule()
    const orderModule = createOrderModule()

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        analyticsEventLogModule,
        emailDeliveryLogModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-01T12:06:00.000Z"),
        getCart: async () => buildCart(),
        persistCartSnapshots: jest.fn(async () => undefined),
        runCompleteCart: jest.fn(async () => {
          orderModule.store.push(buildOrder())
          return { id: "order_email_01" }
        }),
      }
    )

    const serialized = JSON.stringify(emailDeliveryLogModule.store[0])
    expect(serialized).not.toContain(ORDER_EMAIL)
    expect(emailDeliveryLogModule.store[0]?.recipient_email_hash).toBe(
      createHash("sha256").update(ORDER_EMAIL).digest("hex")
    )
    expect(emailDeliveryLogModule.store[0]?.recipient_email_domain).toBe(
      joinKey("compras", ".", "test")
    )
  })
})
