import {
  applyStripePaymentIntentWebhookInTransaction,
  invalidatePaymentAttemptsForCartChangeInTransaction,
} from "../transactional-authority"
import { createStructuralCartInvalidationRunner } from "../../checkout/shipping-invalidation"
import type { PaymentAttemptRecord } from "../types"
import type { StripePaymentIntentWebhookObject } from "../service"

type ProbeState = {
  cartItems: string[]
  resourceVersion: number
  attempt: PaymentAttemptRecord
}

function buildAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_hr01_01",
    cart_id: "cart_hr01_01",
    payment_collection_id: "paycol_hr01_01",
    payment_session_id: "payses_hr01_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_hr01_01",
    provider_payment_session_id: "ps_hr01_01",
    payment_method_type: "card",
    status: "awaiting_webhook_confirmation",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: null,
    metadata: { cart_resource_version: 1 },
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-08-22T10:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: "2026-08-22T09:00:00.000Z",
    updated_at: "2026-08-22T09:00:00.000Z",
    ...overrides,
  }
}

function toRow(attempt: PaymentAttemptRecord): Record<string, unknown> {
  return { ...attempt }
}

function paymentIntent(): StripePaymentIntentWebhookObject {
  return {
    id: "pi_hr01_01",
    object: "payment_intent",
    amount: 9900,
    amount_received: 9900,
    currency: "brl",
    metadata: { cart_id: "cart_hr01_01" },
    payment_method_types: ["card"],
  }
}

function createProbe(state: ProbeState, blockFirstLock = false) {
  let lockHeld = false
  let firstLockSeen = false
  let firstLockReached: (() => void) | undefined
  let releaseFirstLock: (() => void) | undefined
  const firstLockReachedPromise = new Promise<void>((resolve) => {
    firstLockReached = resolve
  })
  const firstLockReleasePromise = new Promise<void>((resolve) => {
    releaseFirstLock = resolve
  })

  const acquire = async () => {
    if (lockHeld) {
      await new Promise<void>((resolve) => {
        const poll = () => {
          if (!lockHeld) {
            resolve()
          } else {
            queueMicrotask(poll)
          }
        }
        poll()
      })
    }
    lockHeld = true
    if (!firstLockSeen) {
      firstLockSeen = true
      firstLockReached?.()
      if (blockFirstLock) {
        await firstLockReleasePromise
      }
    }
  }

  const release = () => {
    lockHeld = false
  }

  const executeRaw = async (
    sql: string,
    bindings: unknown[] = [],
    owner: { writes: number } = { writes: 0 }
  ) => {
    if (sql.includes("pg_advisory_xact_lock")) {
      await acquire()
      return { rows: [] }
    }

    if (sql.includes("select cart_id from payment_attempt")) {
      return { rows: [{ cart_id: state.attempt.cart_id }] }
    }

    if (sql.includes("from store_resource_version")) {
      return { rows: [{ version: state.resourceVersion }] }
    }

    if (sql.trimStart().startsWith("select") && sql.includes("from payment_attempt")) {
      return { rows: [toRow(state.attempt)] }
    }

    if (sql.trimStart().startsWith("update payment_attempt")) {
      owner.writes += 1
      if (sql.includes("invalidated_by_cart_change")) {
        state.attempt = {
          ...state.attempt,
          status: "invalidated_by_cart_change",
          invalidated_at: String(bindings[0]),
          updated_at: String(bindings[1]),
        }
      } else {
        state.attempt = {
          ...state.attempt,
          status: String(bindings[0]) as PaymentAttemptRecord["status"],
          updated_at: String(bindings[1]),
        }
      }
      return { rows: [toRow(state.attempt)] }
    }

    return { rows: [] }
  }

  const transaction = { raw: executeRaw }
  const connection = {
    transaction: async <T>(callback: (trx: typeof transaction) => Promise<T>) => {
      const owner = { writes: 0 }
      const trx = {
        raw: (sql: string, bindings: unknown[] = []) =>
          executeRaw(sql, bindings, owner),
      }
      const snapshot = structuredClone(state)
      try {
        return await callback(trx)
      } catch (error) {
        if (owner.writes > 0) {
          Object.assign(state, snapshot)
        }
        throw error
      } finally {
        release()
      }
    },
  }

  return {
    transaction,
    connection,
    waitForFirstLock: firstLockReachedPromise,
    releaseFirstLock: () => releaseFirstLock?.(),
  }
}

describe("PaymentAttempt/cart/webhook Order authority HR-01", () => {
  it("invalidação failure rolls back cart mutation e resource-version increment", async () => {
    const state: ProbeState = {
      cartItems: ["line_before"],
      resourceVersion: 1,
      attempt: buildAttempt(),
    }
    const probe = createProbe(state)
    const runner = createStructuralCartInvalidationRunner()

    await expect(
      probe.connection.transaction(async (transaction) => {
        state.cartItems.push("line_new")
        state.resourceVersion += 1
        await runner(state.attempt.cart_id, new Date("2026-08-22T11:00:00.000Z"), {
          transaction,
          invalidateShippingQuote: async () => {
            throw new Error("SHIPPING_INVALIDATION_FAILED")
          },
        })
      })
    ).rejects.toThrow("SHIPPING_INVALIDATION_FAILED")

    expect(state.cartItems).toEqual(["line_before"])
    expect(state.resourceVersion).toBe(1)
    expect(state.attempt.status).toBe("awaiting_webhook_confirmation")
  })

  it("successful structural mutation invalidates the active attempt under the shared authority", async () => {
    const state: ProbeState = {
      cartItems: ["line_before"],
      resourceVersion: 1,
      attempt: buildAttempt(),
    }
    const probe = createProbe(state)

    await probe.connection.transaction(async (transaction) => {
      await invalidatePaymentAttemptsForCartChangeInTransaction(
        transaction,
        state.attempt.cart_id,
        new Date("2026-08-22T11:00:00.000Z")
      )
    })

    expect(state.attempt.status).toBe("invalidated_by_cart_change")
    expect(state.attempt.order_id).toBeNull()
  })

  it("falha closed quando há mais de uma tentativa ativa ou uma tentativa com Order authority", async () => {
    const state: ProbeState = {
      cartItems: [],
      resourceVersion: 1,
      attempt: buildAttempt({ order_id: "order_hr01_01" }),
    }
    const probe = createProbe(state)

    await expect(
      probe.connection.transaction((transaction) =>
        invalidatePaymentAttemptsForCartChangeInTransaction(
          transaction,
          state.attempt.cart_id,
          new Date("2026-08-22T11:00:00.000Z")
        )
      )
    ).rejects.toThrow("PAYMENT_ATTEMPT_ORDER_AUTHORITY_EXISTS")
  })

  it("webhook concorrente não ressuscita tentativa invalidada depois de um read stale", async () => {
    const state: ProbeState = {
      cartItems: [],
      resourceVersion: 1,
      attempt: buildAttempt(),
    }
    // The invalidation owns the shared lock first; the webhook starts from a
    // stale pre-lock read and must observe the committed invalidated state
    // only after the invalidation releases the lock.
    const probe = createProbe(state, true)
    const invalidation = probe.connection.transaction((transaction) =>
      invalidatePaymentAttemptsForCartChangeInTransaction(
        transaction,
        state.attempt.cart_id,
        new Date("2026-08-22T11:00:00.000Z")
      )
    )

    await probe.waitForFirstLock
    const webhook = probe.connection.transaction((transaction) =>
      applyStripePaymentIntentWebhookInTransaction(
        transaction,
        paymentIntent(),
        "payment_intent.succeeded",
        new Date("2026-08-22T11:00:01.000Z")
      )
    )
    probe.releaseFirstLock()

    await invalidation
    await expect(webhook).rejects.toMatchObject({
      code: "PAYMENT_ATTEMPT_WEBHOOK_STALE",
      webhookDisposition: "ignored",
    })
    expect(state.attempt.status).toBe("invalidated_by_cart_change")
  })
})
