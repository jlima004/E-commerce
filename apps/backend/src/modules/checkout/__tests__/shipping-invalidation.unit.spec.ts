import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  applyStructuralCartInvalidation,
  createStructuralCartInvalidationRunner,
} from "../shipping-invalidation"

describe("structural cart invalidation hooks (CART-09)", () => {
  it("invoca PaymentAttempt, quote e selection em ordem sem network", async () => {
    const calls: string[] = []
    const at = new Date("2026-08-21T12:00:00.000Z")

    await applyStructuralCartInvalidation("cart_01", at, {
      invalidateActivePaymentAttemptForCartChange: async (cartId, timestamp) => {
        calls.push(`payment:${cartId}:${timestamp.toISOString()}`)
      },
      invalidateShippingQuote: async (cartId, timestamp) => {
        calls.push(`quote:${cartId}:${timestamp.toISOString()}`)
      },
      invalidateShippingSelection: async (cartId, timestamp) => {
        calls.push(`selection:${cartId}:${timestamp.toISOString()}`)
      },
    })

    expect(calls).toEqual([
      "payment:cart_01:2026-08-21T12:00:00.000Z",
      "quote:cart_01:2026-08-21T12:00:00.000Z",
      "selection:cart_01:2026-08-21T12:00:00.000Z",
    ])
  })

  it("atravessa os seams default de quote e selection quando o runtime injeta somente PaymentAttempt", async () => {
    const calls: string[] = []
    const at = new Date("2026-08-21T12:00:00.000Z")
    const runWithObservedDefaults = createStructuralCartInvalidationRunner({
      invalidateShippingQuote: async () => {
        calls.push("quote")
      },
      invalidateShippingSelection: async () => {
        calls.push("selection")
      },
    })

    await runWithObservedDefaults("cart_02", at, {
      invalidateActivePaymentAttemptForCartChange: async () => {
        calls.push("payment")
      },
    })

    expect(calls).toEqual(["payment", "quote", "selection"])
    await expect(
      applyStructuralCartInvalidation("cart_03", at, {
        paymentAttemptModule: {
          listPaymentAttempts: async () => [],
        },
      })
    ).resolves.toBeUndefined()
  })

  it("mantém os defaults locais sem network nem Gelato", () => {
    const source = readFileSync(
      resolve(__dirname, "../shipping-invalidation.ts"),
      "utf8"
    )

    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/gelato/i)
  })

  it("rejeita com PAYMENT_ATTEMPT_FINANCIAL_FREEZE_ACTIVE quando existe freeze não resolvido", async () => {
    const trx = {
      raw: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes("pg_advisory_xact_lock")) {
          return Promise.resolve({ rows: [] })
        }
        if (sql.includes("from payment_attempt") && sql.includes("financial_freeze_started_at is not null")) {
          return Promise.resolve({
            rows: [
              {
                id: "payatt_frozen",
                order_id: null,
                financial_freeze_started_at: new Date(),
                provider_canceled_confirmed_at: null,
              },
            ],
          })
        }
        return Promise.resolve({ rows: [] })
      }),
    }

    await expect(
      applyStructuralCartInvalidation("cart_frozen", new Date(), {
        transaction: trx as never,
      })
    ).rejects.toMatchObject({
      code: "PAYMENT_ATTEMPT_FINANCIAL_FREEZE_ACTIVE",
      status: 409,
    })
  })
})
