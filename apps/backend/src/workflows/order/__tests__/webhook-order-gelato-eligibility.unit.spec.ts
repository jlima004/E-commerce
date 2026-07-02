import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { ANALYTICS_EVENT_LOG_MODULE } from "../../../modules/analytics-event-log"
import { CHECKOUT_COMPLETION_MODULE } from "../../../modules/checkout-completion"
import { EMAIL_DELIVERY_LOG_MODULE } from "../../../modules/email-delivery-log"
import { PAYMENT_ATTEMPT_MODULE } from "../../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../../modules/payment-attempt/types"
import { runCreateOrderFromConfirmedPaymentAttemptEntrypoint } from "../webhook-order-entrypoint"

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_gelato_01",
    cart_id: "cart_gelato_01",
    payment_collection_id: "paycol_gelato_01",
    payment_session_id: "payses_gelato_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_gelato_01",
    provider_payment_session_id: "ps_gelato_01",
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

function buildCart() {
  return {
    id: "cart_gelato_01",
    total: 9900,
    currency_code: "brl",
    completed_at: null,
    items: [
      {
        id: "line_item_gelato_01",
        quantity: 1,
        metadata: {
          keep: true,
        },
        variant: {
          id: "variant_gelato_01",
          sku: "SKU-GELATO-01",
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

function createCheckoutCompletionModule() {
  const store = [
    {
      id: "chkcpl_gelato_01",
      idempotency_key: "checkout-completion:pi_gelato_01",
      cart_id: "cart_gelato_01",
      payment_intent_id: "pi_gelato_01",
      payment_attempt_id: "payatt_gelato_01",
      order_id: "order_gelato_01",
      status: "completed",
      metadata: null,
    },
  ]

  return {
    listCheckoutCompletionLogs: jest.fn(async () => store),
    createCheckoutCompletionLogs: jest.fn(),
    updateCheckoutCompletionLogs: jest.fn(async (input: Record<string, unknown>) => {
      store[0] = {
        ...store[0],
        ...input,
      }
      return [store[0]]
    }),
    store,
  }
}

function createAnalyticsEventLogModule(
  records: Array<Record<string, unknown>> = [
    {
      id: "anlevt_gelato_01",
      event_name: "purchase_completed",
      event_version: 1,
      idempotency_key: "purchase_completed:stripe:pi_gelato_01",
      order_id: "order_gelato_01",
      cart_id: "cart_gelato_01",
      payment_attempt_id: "payatt_gelato_01",
      checkout_completion_log_id: "chkcpl_gelato_01",
      payment_intent_id: "pi_gelato_01",
      status: "recorded",
      payload: {
        order_id: "order_gelato_01",
      },
      metadata: null,
      attempt_count: 0,
      recorded_at: "2026-07-01T12:00:00.000Z",
      created_at: "2026-07-01T12:00:00.000Z",
      updated_at: "2026-07-01T12:00:00.000Z",
      deleted_at: null,
    },
  ]
) {
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
    createAnalyticsEventLogs: jest.fn(async () => store),
    store,
  }
}

function createEmailDeliveryLogModule(status: string) {
  const store = [
    {
      id: "emlog_gelato_01",
      email_type: "order_confirmation",
      template_key: "order_confirmation_v1",
      template_version: 1,
      provider: "resend",
      idempotency_key: "order-confirmation/order_gelato_01",
      order_id: "order_gelato_01",
      cart_id: "cart_gelato_01",
      payment_attempt_id: "payatt_gelato_01",
      checkout_completion_log_id: "chkcpl_gelato_01",
      analytics_event_log_id: "anlevt_gelato_01",
      payment_intent_id: "pi_gelato_01",
      status,
      recipient_email_hash: "hash",
      recipient_email_domain: "loja.test",
      payload: {
        order_id: "order_gelato_01",
      },
      metadata: null,
      attempt_count: 0,
      next_retry_at: null,
      recorded_at: "2026-07-01T12:00:00.000Z",
      queued_at: null,
      sending_started_at: null,
      sent_at: status === "sent" ? "2026-07-01T12:10:00.000Z" : null,
      failed_at: status === "failed" ? "2026-07-01T12:10:00.000Z" : null,
      dead_lettered_at:
        status === "dead_letter" ? "2026-07-01T12:11:00.000Z" : null,
      created_at: "2026-07-01T12:00:00.000Z",
      updated_at: "2026-07-01T12:00:00.000Z",
      deleted_at: null,
    },
  ]

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
    createEmailDeliveryLogs: jest.fn(async () => store),
    store,
  }
}

function createGelatoFulfillmentModule(
  initial: Array<Record<string, unknown>> = [],
  options: { misconfigured?: boolean; duplicateOnCreate?: boolean } = {}
) {
  const store = [...initial]

  if (options.misconfigured) {
    return {
      listGelatoFulfillments: undefined,
      createGelatoFulfillments: undefined,
      store,
    }
  }

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
    createGelatoFulfillments: jest.fn(async (input: Record<string, unknown>) => {
      if (options.duplicateOnCreate) {
        if (store.length === 0) {
          store.push({
            ...input,
            id: "gelful_gelato_existing",
            created_at: "2026-07-01T12:15:00.000Z",
            updated_at: "2026-07-01T12:15:00.000Z",
            deleted_at: null,
          })
        }
        throw new Error("duplicate key value violates unique constraint")
      }

      const created = {
        ...input,
        id: `gelful_gelato_${store.length + 1}`,
        created_at: "2026-07-01T12:15:00.000Z",
        updated_at: "2026-07-01T12:15:00.000Z",
        deleted_at: null,
      }
      store.push(created)
      return [created]
    }),
    store,
  }
}

function createOrderModule(
  overrides: Partial<Record<string, unknown>> = {}
) {
  const store: Array<Record<string, unknown>> = [
    {
      id: "order_gelato_01",
      cart_id: "cart_gelato_01",
      email: "comprador@loja.test",
      display_id: 6101,
      metadata: {
        order_status: "confirmed",
        payment_status: "captured",
      },
      ...overrides,
    },
  ]

  return {
    listOrders: jest.fn(async (selector?: Record<string, unknown>) => {
      return store.filter((record) => {
        if (selector?.id && record.id !== selector.id) {
          return false
        }
        if (selector?.cart_id && record.cart_id !== selector.cart_id) {
          return false
        }
        return true
      })
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

function createContainer(input: {
  paymentAttemptModule: ReturnType<typeof createPaymentAttemptModule>
  checkoutCompletionModule: ReturnType<typeof createCheckoutCompletionModule>
  analyticsEventLogModule?: ReturnType<typeof createAnalyticsEventLogModule>
  emailDeliveryLogModule?: ReturnType<typeof createEmailDeliveryLogModule>
  gelatoFulfillmentModule?: ReturnType<typeof createGelatoFulfillmentModule>
  orderModule?: ReturnType<typeof createOrderModule>
  cart?: ReturnType<typeof buildCart>
}) {
  const cart = input.cart ?? buildCart()

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
        return input.emailDeliveryLogModule ?? createEmailDeliveryLogModule("sent")
      }
      if (key === "gelato_fulfillment" || key === "gelato-fulfillment") {
        return input.gelatoFulfillmentModule
      }
      if (key === Modules.ORDER) {
        return input.orderModule ?? createOrderModule()
      }
      if (key === Modules.CART) {
        return {
          updateLineItems: jest.fn(async (rows) => rows),
        }
      }
      if (key === ContainerRegistrationKeys.QUERY) {
        return {
          graph: jest.fn(async () => ({
            data: [cart],
          })),
        }
      }

      return undefined
    }),
  } as unknown as MedusaContainer
}

function buildInput() {
  return {
    payment_attempt_id: "payatt_gelato_01",
    payment_intent_id: "pi_gelato_01",
    stripe_event_id: "evt_gelato_01",
    correlation_id: "corr_gelato_01",
  }
}

describe("runCreateOrderFromConfirmedPaymentAttemptEntrypoint gelato eligibility", () => {
  it("bloqueia sem Order confirmada", async () => {
    const gelatoFulfillmentModule = createGelatoFulfillmentModule()

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule: createPaymentAttemptModule(buildAttempt()),
        checkoutCompletionModule: createCheckoutCompletionModule(),
        analyticsEventLogModule: createAnalyticsEventLogModule(),
        emailDeliveryLogModule: createEmailDeliveryLogModule("sent"),
        gelatoFulfillmentModule,
        orderModule: createOrderModule({
          metadata: {
            order_status: "pending",
            payment_status: "captured",
          },
        }),
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-02T12:00:00.000Z"),
        persistOrderState: async () => undefined,
      }
    )

    expect(gelatoFulfillmentModule.createGelatoFulfillments).not.toHaveBeenCalled()
  })

  it("bloqueia sem purchase_completed local", async () => {
    const gelatoFulfillmentModule = createGelatoFulfillmentModule()

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule: createPaymentAttemptModule(buildAttempt()),
        checkoutCompletionModule: createCheckoutCompletionModule(),
        analyticsEventLogModule: createAnalyticsEventLogModule([]),
        emailDeliveryLogModule: createEmailDeliveryLogModule("sent"),
        gelatoFulfillmentModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-02T12:00:00.000Z"),
      }
    )

    expect(gelatoFulfillmentModule.createGelatoFulfillments).not.toHaveBeenCalled()
  })

  it("bloqueia email em recorded queued sending failed e dead_letter", async () => {
    for (const status of ["recorded", "queued", "sending", "failed", "dead_letter"]) {
      const gelatoFulfillmentModule = createGelatoFulfillmentModule()

      await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        createContainer({
          paymentAttemptModule: createPaymentAttemptModule(buildAttempt()),
          checkoutCompletionModule: createCheckoutCompletionModule(),
          analyticsEventLogModule: createAnalyticsEventLogModule(),
          emailDeliveryLogModule: createEmailDeliveryLogModule(status),
          gelatoFulfillmentModule,
        }),
        buildInput(),
        {
          now: () => new Date("2026-07-02T12:00:00.000Z"),
        }
      )

      expect(gelatoFulfillmentModule.createGelatoFulfillments).not.toHaveBeenCalled()
    }
  })

  it("PostHog state e AnalyticsEventLog.status sent sao irrelevantes", async () => {
    const gelatoFulfillmentModule = createGelatoFulfillmentModule()

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule: createPaymentAttemptModule(buildAttempt()),
        checkoutCompletionModule: createCheckoutCompletionModule(),
        analyticsEventLogModule: createAnalyticsEventLogModule([
          {
            id: "anlevt_gelato_01",
            event_name: "purchase_completed",
            event_version: 1,
            idempotency_key: "purchase_completed:stripe:pi_gelato_01",
            order_id: "order_gelato_01",
            cart_id: "cart_gelato_01",
            payment_attempt_id: "payatt_gelato_01",
            checkout_completion_log_id: "chkcpl_gelato_01",
            payment_intent_id: "pi_gelato_01",
            status: "sent",
            payload: {
              order_id: "order_gelato_01",
            },
            metadata: null,
            attempt_count: 0,
            recorded_at: "2026-07-01T12:00:00.000Z",
            created_at: "2026-07-01T12:00:00.000Z",
            updated_at: "2026-07-01T12:00:00.000Z",
            deleted_at: null,
          },
        ]),
        emailDeliveryLogModule: createEmailDeliveryLogModule("sent"),
        gelatoFulfillmentModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-02T12:00:00.000Z"),
      }
    )

    expect(gelatoFulfillmentModule.createGelatoFulfillments).toHaveBeenCalledTimes(1)
  })

  it("Order + purchase_completed + EmailDeliveryLog sent cria GelatoFulfillment local sem campos gerados", async () => {
    const gelatoFulfillmentModule = createGelatoFulfillmentModule()

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule: createPaymentAttemptModule(buildAttempt()),
        checkoutCompletionModule: createCheckoutCompletionModule(),
        analyticsEventLogModule: createAnalyticsEventLogModule(),
        emailDeliveryLogModule: createEmailDeliveryLogModule("sent"),
        gelatoFulfillmentModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-02T12:00:00.000Z"),
      }
    )

    expect(gelatoFulfillmentModule.store).toHaveLength(1)
    expect(gelatoFulfillmentModule.createGelatoFulfillments).toHaveBeenCalledTimes(1)
    expect(gelatoFulfillmentModule.createGelatoFulfillments).toHaveBeenCalledWith(
      expect.not.objectContaining({
        id: expect.anything(),
        created_at: expect.anything(),
        updated_at: expect.anything(),
        deleted_at: expect.anything(),
      })
    )
  })

  it("replay e concorrencia mantem exatamente um GelatoFulfillment local", async () => {
    const gelatoFulfillmentModule = createGelatoFulfillmentModule([], {
      duplicateOnCreate: true,
    })

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule: createPaymentAttemptModule(buildAttempt()),
        checkoutCompletionModule: createCheckoutCompletionModule(),
        analyticsEventLogModule: createAnalyticsEventLogModule(),
        emailDeliveryLogModule: createEmailDeliveryLogModule("sent"),
        gelatoFulfillmentModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-02T12:00:00.000Z"),
      }
    )

    await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule: createPaymentAttemptModule(buildAttempt()),
        checkoutCompletionModule: createCheckoutCompletionModule(),
        analyticsEventLogModule: createAnalyticsEventLogModule(),
        emailDeliveryLogModule: createEmailDeliveryLogModule("sent"),
        gelatoFulfillmentModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-07-02T12:00:01.000Z"),
      }
    )

    expect(gelatoFulfillmentModule.store).toHaveLength(1)
  })

  it("modulo gelato_fulfillment ausente ou mal configurado falha fechado sem sucesso silencioso", async () => {
    const containerWithoutModule = createContainer({
      paymentAttemptModule: createPaymentAttemptModule(buildAttempt()),
      checkoutCompletionModule: createCheckoutCompletionModule(),
      analyticsEventLogModule: createAnalyticsEventLogModule(),
      emailDeliveryLogModule: createEmailDeliveryLogModule("sent"),
      gelatoFulfillmentModule: undefined,
    })

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        containerWithoutModule,
        buildInput(),
        {
          now: () => new Date("2026-07-02T12:00:00.000Z"),
        }
      )
    ).rejects.toMatchObject({
      code: "ORDER_ENTRYPOINT_GELATO_FULFILLMENT_MODULE_UNAVAILABLE",
    })

    const misconfiguredModule = createGelatoFulfillmentModule([], {
      misconfigured: true,
    })
    const orderModule = createOrderModule()

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
        createContainer({
          paymentAttemptModule: createPaymentAttemptModule(buildAttempt()),
          checkoutCompletionModule: createCheckoutCompletionModule(),
          analyticsEventLogModule: createAnalyticsEventLogModule(),
          emailDeliveryLogModule: createEmailDeliveryLogModule("sent"),
          gelatoFulfillmentModule: misconfiguredModule,
          orderModule,
        }),
        buildInput(),
        {
          now: () => new Date("2026-07-02T12:00:00.000Z"),
        }
      )
    ).rejects.toMatchObject({
      code: "ORDER_ENTRYPOINT_GELATO_FULFILLMENT_MODULE_UNAVAILABLE",
    })

    expect(orderModule.store[0]?.metadata).toEqual({
      order_status: "confirmed",
      payment_status: "captured",
    })
  })
})
