import type { MedusaContainer } from "@medusajs/framework/types"
import { PAYMENT_ATTEMPT_MODULE } from "../../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../../modules/payment-attempt/types"
import {
  OrderCreationEntrypointError,
  processCreateOrderFromConfirmedPaymentAttemptStub,
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

  it("nao expoe idempotency_key no contrato de input", () => {
    const source = require("fs").readFileSync(
      require("path").join(__dirname, "../webhook-order-entrypoint.ts"),
      "utf8"
    )

    expect(source).not.toMatch(/idempotency_key/)
    expect(() =>
      validateCreateOrderFromConfirmedPaymentAttemptInput(buildInput())
    ).not.toThrow()
  })
})

describe("processCreateOrderFromConfirmedPaymentAttemptStub", () => {
  it("retorna stub/no-op para tentativa elegivel sem chamar Order creation", () => {
    const result = processCreateOrderFromConfirmedPaymentAttemptStub(
      buildEligibleAttempt(),
      buildInput()
    )

    expect(result).toEqual({
      status: "stub_no_op",
      payment_attempt_id: "payatt_entry_01",
      payment_intent_id: "pi_entry_123",
      order_id: null,
      stripe_event_id: "evt_entry_01",
      correlation_id: "corr_entry_01",
    })
  })

  it("falha antes de qualquer dependencia de Order para status invalido", () => {
    expect(() =>
      processCreateOrderFromConfirmedPaymentAttemptStub(
        buildEligibleAttempt({ status: "awaiting_pix_payment" }),
        buildInput()
      )
    ).toThrow("PAYMENT_ATTEMPT_NOT_ELIGIBLE_FOR_ORDER_STATUS")
  })

  it("falha quando payment_attempt_id nao corresponde", () => {
    expect(() =>
      processCreateOrderFromConfirmedPaymentAttemptStub(
        buildEligibleAttempt(),
        buildInput({ payment_attempt_id: "payatt_outro" })
      )
    ).toThrow(OrderCreationEntrypointError)
  })

  it("falha quando payment_intent_id nao corresponde", () => {
    expect(() =>
      processCreateOrderFromConfirmedPaymentAttemptStub(
        buildEligibleAttempt(),
        buildInput({ payment_intent_id: "pi_outro" })
      )
    ).toThrow(OrderCreationEntrypointError)
  })
})

describe("runCreateOrderFromConfirmedPaymentAttemptEntrypoint", () => {
  it("carrega PaymentAttempt e aplica guard antes do stub", async () => {
    const attempt = buildEligibleAttempt()
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === PAYMENT_ATTEMPT_MODULE) {
          return {
            listPaymentAttempts: jest.fn(async () => [attempt]),
          }
        }
        return undefined
      }),
    } as unknown as MedusaContainer

    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      container,
      buildInput()
    )

    expect(result.status).toBe("stub_no_op")
    expect(result.order_id).toBeNull()
  })

  it("propaga inelegibilidade sem criar Order", async () => {
    const attempt = buildEligibleAttempt({ status: "payment_failed" })
    const container = {
      resolve: jest.fn((key: string) => {
        if (key === PAYMENT_ATTEMPT_MODULE) {
          return {
            listPaymentAttempts: jest.fn(async () => [attempt]),
          }
        }
        return undefined
      }),
    } as unknown as MedusaContainer

    await expect(
      runCreateOrderFromConfirmedPaymentAttemptEntrypoint(container, buildInput())
    ).rejects.toThrow("PAYMENT_ATTEMPT_NOT_ELIGIBLE_FOR_ORDER_STATUS")
  })
})

describe("webhook-order-entrypoint — provas negativas de escopo 06-02", () => {
  it("nao referencia completeCartWorkflow, createOrderWorkflow ou CheckoutCompletionLog", () => {
    const source = require("fs").readFileSync(
      require("path").join(__dirname, "../webhook-order-entrypoint.ts"),
      "utf8"
    )

    expect(source).not.toMatch(
      /completeCartWorkflow|createOrderWorkflow|CheckoutCompletionLog|purchase_completed|gelato|AnalyticsEventLog|EmailDeliveryLog|refund/i
    )
  })
})
