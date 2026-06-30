import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { CHECKOUT_COMPLETION_MODULE } from "../../../modules/checkout-completion"
import { PAYMENT_ATTEMPT_MODULE } from "../../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../../modules/payment-attempt/types"
import {
  OrderCreationEntrypointError,
  runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
  validateCreateOrderFromConfirmedPaymentAttemptInput,
} from "../webhook-order-entrypoint"

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
  const store: Array<Record<string, unknown>> = [
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

  return {
    listCheckoutCompletionLogs: jest.fn(async () => store),
    createCheckoutCompletionLogs: jest.fn(),
    updateCheckoutCompletionLogs: jest.fn(async (input: Record<string, unknown> | Array<Record<string, unknown>>) => {
      const row = Array.isArray(input) ? input[0] : input
      store[0] = {
        ...store[0],
        ...row,
      }
      return [store[0]]
    }),
    store,
  }
}

function createOrderModule() {
  const store: Array<Record<string, unknown>> = [
    {
      id: "order_entry_existing",
      metadata: null,
    },
  ]

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

function createContainer(input: {
  paymentAttemptModule?: ReturnType<typeof createPaymentAttemptModule>
  checkoutCompletionModule?: ReturnType<typeof createCheckoutCompletionModule>
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
  it("reusa CheckoutCompletionLog completo e cura PaymentAttempt.order_id", async () => {
    const paymentAttemptModule = createPaymentAttemptModule(buildEligibleAttempt())
    const checkoutCompletionModule = createCheckoutCompletionModule()
    const orderModule = createOrderModule()

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      createContainer({
        paymentAttemptModule,
        checkoutCompletionModule,
        orderModule,
      }),
      buildInput(),
      {
        now: () => new Date("2026-06-30T16:00:00.000Z"),
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
})
