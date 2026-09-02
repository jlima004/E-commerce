import fs from "node:fs"
import path from "node:path"
import {
  PAYMENT_ATTEMPT_FINANCIAL_AUTHORITY_INCOMPLETE,
  isUnresolvedFinancialFreeze,
  projectPaymentAttemptFinancialAuthority,
} from "../financial-authority"
import { PAYMENT_ATTEMPT_STATUSES } from "../types"
import { CHECKOUT_COMPLETION_STATUS } from "../../checkout-completion/types"

const paymentMigration = path.join(__dirname, "../migrations/Migration20260901130000.ts")
const paymentModel = path.join(__dirname, "../models/payment-attempt.ts")

describe("PaymentAttempt R3 financial authority", () => {
  it("uses only the three authority fields, regardless of local status", () => {
    for (const status of PAYMENT_ATTEMPT_STATUSES) {
      expect(isUnresolvedFinancialFreeze({
        id: "payatt_1",
        cart_id: "cart_1",
        financial_freeze_started_at: "2026-09-01T00:00:00.000Z",
        provider_canceled_confirmed_at: null,
        order_id: null,
        status,
      } as never)).toBe(true)
    }
    expect(isUnresolvedFinancialFreeze({
      id: "payatt_1",
      cart_id: "cart_1",
      financial_freeze_started_at: "2026-09-01T00:00:00.000Z",
      provider_canceled_confirmed_at: "2026-09-01T00:01:00.000Z",
      order_id: null,
    })).toBe(false)
    expect(isUnresolvedFinancialFreeze({
      id: "payatt_1",
      cart_id: "cart_1",
      financial_freeze_started_at: "2026-09-01T00:00:00.000Z",
      provider_canceled_confirmed_at: null,
      order_id: "order_1",
    })).toBe(false)
  })

  it.each([
    "financial_freeze_started_at",
    "provider_canceled_confirmed_at",
    "order_id",
  ] as const)("throws for undefined %s", (field) => {
    const authority = {
      id: "payatt_1",
      cart_id: "cart_1",
      financial_freeze_started_at: "2026-09-01T00:00:00.000Z",
      provider_canceled_confirmed_at: null,
      order_id: null,
      [field]: undefined,
    }

    expect(() => isUnresolvedFinancialFreeze(authority as never)).toThrow(
      PAYMENT_ATTEMPT_FINANCIAL_AUTHORITY_INCOMPLETE
    )
  })

  it("supports explicit null authority state", () => {
    expect(isUnresolvedFinancialFreeze({
      id: "payatt_1",
      cart_id: "cart_1",
      financial_freeze_started_at: null,
      provider_canceled_confirmed_at: null,
      order_id: null,
    })).toBe(false)
  })

  it("throws when projection authority fields are incomplete", () => {
    expect(() => projectPaymentAttemptFinancialAuthority({
      id: "payatt_1",
      cart_id: "cart_1",
      order_id: undefined,
      financial_freeze_started_at: undefined,
      provider_canceled_confirmed_at: undefined,
    } as never)).toThrow(PAYMENT_ATTEMPT_FINANCIAL_AUTHORITY_INCOMPLETE)
  })

  it("projects nullable defaults without adding provider behavior", () => {
    const projection = projectPaymentAttemptFinancialAuthority({
      id: "payatt_1",
      cart_id: "cart_1",
      order_id: null,
      financial_freeze_started_at: null,
      provider_canceled_confirmed_at: null,
    })
    expect(projection).toEqual({
      id: "payatt_1",
      cart_id: "cart_1",
      order_id: null,
      financial_freeze_started_at: null,
      provider_canceled_confirmed_at: null,
      unresolved_financial_freeze: false,
    })
  })

  it("E-01 projects only the financial authority keyset from a noisy attempt", () => {
    const projection = projectPaymentAttemptFinancialAuthority({
      id: "payatt_1",
      cart_id: "cart_1",
      order_id: null,
      financial_freeze_started_at: "2026-09-01T00:00:00.000Z",
      provider_canceled_confirmed_at: null,
      provider: "stripe",
      provider_payment_intent_id: "pi_secret",
      payment_method_type: "card",
      status: "succeeded",
      amount: 1990,
      currency_code: "brl",
      metadata: { sensitive: true },
      payment_collection_id: "paycol_1",
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
    } as never)

    expect(Object.keys(projection).sort()).toEqual([
      "cart_id",
      "financial_freeze_started_at",
      "id",
      "order_id",
      "provider_canceled_confirmed_at",
      "unresolved_financial_freeze",
    ])
    for (const forbiddenField of [
      "provider",
      "provider_payment_intent_id",
      "payment_method_type",
      "status",
      "amount",
      "currency_code",
      "metadata",
    ]) {
      expect(projection).not.toHaveProperty(forbiddenField)
    }
  })

  it("declares all six nullable fields, partial indexes and a fail-closed down", () => {
    const migration = fs.readFileSync(paymentMigration, "utf8")
    const model = fs.readFileSync(paymentModel, "utf8")
    for (const field of [
      "financial_freeze_started_at",
      "provider_canceled_confirmed_at",
      "provider_discovery_started_at",
      "reconciliation_reason_code",
      "reconciliation_locked_at",
      "last_reconciliation_at",
    ]) {
      expect(migration).toContain(`"${field}"`)
      expect(model).toContain(`${field}:`)
    }
    expect(migration).toContain("IDX_payment_attempt_unresolved_financial_freeze")
    expect(migration).toContain("IDX_payment_attempt_reconciliation_candidates")
    expect(migration).toContain("PAYMENT_ATTEMPT_R3_AUTHORITY_IN_USE")
    expect(migration).toContain("LEGACY_PROVIDER_DISPATCH_UNKNOWN")
    expect(migration).not.toMatch(/stripe|Stripe|fetch\(|https?:\/\//)
  })

  it("keeps reconciliation vocabulary shared with CheckoutCompletionLog", () => {
    expect(CHECKOUT_COMPLETION_STATUS.RECONCILIATION_REQUIRED).toBe("reconciliation_required")
  })
})
