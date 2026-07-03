import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { POST as adminCreateRefundRequestRoute } from "../../src/api/admin/refunds/request/route"
import { handleAdminCreateRefundRequest } from "../../src/api/admin/refunds/request/route"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { withOrderRefundReservationClaim } from "../../src/modules/refund-request/reservation-claim"
import { createFakeStripeRefundCreationLayer } from "../../src/modules/refund-request/stripe-refund-boundary"
import { REFUND_REQUEST_STATUS } from "../../src/modules/refund-request/types"
import type { RefundRequestRecord } from "../../src/modules/refund-request/types"

const ORDER_ID = "order_admin_refund_01"
const PAYMENT_INTENT_ID = "pi_admin_refund_01"

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const SENSITIVE_CANARIES = {
  email: joinKey("cliente", "@", "compras", ".", "test"),
  clientSecret: joinKey("pi_test", "_", "secret_value"),
  webhookSecret: joinKey("whsec_", "test_canary_value"),
} as const

function buildPaymentAttempt(): PaymentAttemptRecord {
  return {
    id: "payatt_admin_refund_01",
    cart_id: "cart_admin_refund_01",
    payment_collection_id: "paycol_admin_refund_01",
    payment_session_id: "payses_admin_refund_01",
    provider: "stripe",
    provider_payment_intent_id: PAYMENT_INTENT_ID,
    provider_payment_session_id: "ps_admin_refund_01",
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: ORDER_ID,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-07-01T00:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
  }
}

function createResponse() {
  const response = {
    statusCode: 200,
    status: jest.fn(function status(code: number) {
      response.statusCode = code
      return response
    }),
    json: jest.fn(function json(body: unknown) {
      return body
    }),
  }

  return response as MedusaResponse & {
    statusCode: number
    status: jest.Mock
    json: jest.Mock
  }
}

function createInMemoryAdminRefundHarness() {
  const orders = new Map([
    [
      ORDER_ID,
      {
        id: ORDER_ID,
        metadata: {
          order_status: "confirmed",
          payment_status: "captured",
        },
      },
    ],
  ])

  const paymentAttempts = [buildPaymentAttempt()]
  const refundRequests: RefundRequestRecord[] = []
  let nextId = 1

  const req = {
    body: {},
    scope: {
      resolve: jest.fn((key: string) => {
        if (key === "order") {
          return {
            retrieveOrder: async (id: string) => orders.get(id) ?? null,
          }
        }

        if (key === "paymentAttempt") {
          return {
            listPaymentAttempts: async (filters?: { order_id?: string }) =>
              paymentAttempts.filter(
                (attempt) => attempt.order_id === filters?.order_id
              ),
          }
        }

        if (key === "refund_request") {
          return {
            listRefundRequests: async (filters?: {
              order_id?: string
              idempotency_key?: string
            }) =>
              refundRequests.filter((request) => {
                if (
                  filters?.idempotency_key &&
                  request.idempotency_key !== filters.idempotency_key
                ) {
                  return false
                }

                if (filters?.order_id && request.order_id !== filters.order_id) {
                  return false
                }

                return true
              }),
            createRefundRequests: async (records: RefundRequestRecord[]) => {
              for (const record of records) {
                refundRequests.push(record)
              }

              return records
            },
          }
        }

        throw new Error(`unexpected resolve key: ${key}`)
      }),
    },
  } as unknown as MedusaRequest

  return {
    req,
    refundRequests,
    orders,
    nextIdRef: () => `refreq_http_${nextId++}`,
  }
}

function expectNoCanaries(value: unknown) {
  const serialized = JSON.stringify(value)

  for (const canary of Object.values(SENSITIVE_CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

describe("admin refunds request route", () => {
  const originalAdminRefundEnabled = process.env.ADMIN_REFUND_REQUEST_ENABLED

  beforeEach(() => {
    process.env.ADMIN_REFUND_REQUEST_ENABLED = "true"
  })

  afterAll(() => {
    if (originalAdminRefundEnabled === undefined) {
      delete process.env.ADMIN_REFUND_REQUEST_ENABLED
    } else {
      process.env.ADMIN_REFUND_REQUEST_ENABLED = originalAdminRefundEnabled
    }
  })

  it("creates a local requested refund reservation without financial truth", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const res = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 2500,
      currency_code: "brl",
      idempotency_key: "admin-refund/order_admin_refund_01/1",
      reason: "customer_request",
      operator_note: "partial refund",
      requested_by_operator_id: "operator_01",
      metadata: { source: "admin" },
    }

    await handleAdminCreateRefundRequest(harness.req, res, {
      resolveOrderModule: () => ({
        retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
      }),
      resolvePaymentAttemptModule: () => ({
        listPaymentAttempts: async (filters?: { order_id?: string }) =>
          [buildPaymentAttempt()].filter(
            (attempt) => attempt.order_id === filters?.order_id
          ),
      }),
      resolveRefundRequestModule: () => ({
        listRefundRequests: async (filters?: {
          order_id?: string
          idempotency_key?: string
        }) =>
          harness.refundRequests.filter((request) => {
            if (
              filters?.idempotency_key &&
              request.idempotency_key !== filters.idempotency_key
            ) {
              return false
            }

            if (filters?.order_id && request.order_id !== filters.order_id) {
              return false
            }

            return true
          }),
        createRefundRequests: async (records: RefundRequestRecord[]) => {
          harness.refundRequests.push(...records)
          return records
        },
      }),
      generateId: harness.nextIdRef,
    })

    expect(res.statusCode).toBe(201)
    expect(harness.refundRequests).toHaveLength(1)
    expect(harness.refundRequests[0]?.status).toBe(REFUND_REQUEST_STATUS.REQUESTED)
    expect(harness.refundRequests[0]?.confirmed_at).toBeNull()
    expect(harness.refundRequests[0]?.stripe_refund_id).toBeNull()

    const body = res.json.mock.calls[0]?.[0]
    expect(body.reused_idempotency).toBe(false)
    expect(body.availability.available_amount).toBe(7400)
    expectNoCanaries(body)
  })

  it("reuses idempotent admin refund request without duplicating reservation", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const res = createResponse()
    const idempotencyKey = "admin-refund/order_admin_refund_01/replay"

    const bodyInput = {
      order_id: ORDER_ID,
      amount: 2500,
      currency_code: "brl",
      idempotency_key: idempotencyKey,
    }

    const deps = {
      resolveOrderModule: () => ({
        retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
      }),
      resolvePaymentAttemptModule: () => ({
        listPaymentAttempts: async () => [buildPaymentAttempt()],
      }),
      resolveRefundRequestModule: () => ({
        listRefundRequests: async (filters?: {
          order_id?: string
          idempotency_key?: string
        }) =>
          harness.refundRequests.filter((request) => {
            if (
              filters?.idempotency_key &&
              request.idempotency_key !== filters.idempotency_key
            ) {
              return false
            }

            if (filters?.order_id && request.order_id !== filters.order_id) {
              return false
            }

            return true
          }),
        createRefundRequests: async (records: RefundRequestRecord[]) => {
          harness.refundRequests.push(...records)
          return records
        },
      }),
      generateId: harness.nextIdRef,
    }

    harness.req.body = bodyInput
    await handleAdminCreateRefundRequest(harness.req, createResponse(), deps)

    harness.req.body = bodyInput
    await handleAdminCreateRefundRequest(harness.req, res, deps)

    expect(harness.refundRequests).toHaveLength(1)
    expect(res.statusCode).toBe(200)

    const body = res.json.mock.calls[0]?.[0]
    expect(body.reused_idempotency).toBe(true)
  })

  it("rejects concurrent over-captured reservations with different idempotency keys", async () => {
    const harness = createInMemoryAdminRefundHarness()

    const deps = {
      resolveOrderModule: () => ({
        retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
      }),
      resolvePaymentAttemptModule: () => ({
        listPaymentAttempts: async () => [buildPaymentAttempt()],
      }),
      resolveRefundRequestModule: () => ({
        listRefundRequests: async (filters?: {
          order_id?: string
          idempotency_key?: string
        }) =>
          harness.refundRequests.filter((request) => {
            if (
              filters?.idempotency_key &&
              request.idempotency_key !== filters.idempotency_key
            ) {
              return false
            }

            if (filters?.order_id && request.order_id !== filters.order_id) {
              return false
            }

            return true
          }),
        createRefundRequests: async (records: RefundRequestRecord[]) => {
          harness.refundRequests.push(...records)
          return records
        },
      }),
      generateId: harness.nextIdRef,
      withOrderRefundReservationClaim,
    }

    const firstRequest = handleAdminCreateRefundRequest(
      {
        ...harness.req,
        body: {
          order_id: ORDER_ID,
          amount: 6000,
          currency_code: "brl",
          idempotency_key: "admin-refund/order_admin_refund_01/concurrent-a",
        },
      } as MedusaRequest,
      createResponse(),
      deps
    )

    const secondRequest = handleAdminCreateRefundRequest(
      {
        ...harness.req,
        body: {
          order_id: ORDER_ID,
          amount: 6000,
          currency_code: "brl",
          idempotency_key: "admin-refund/order_admin_refund_01/concurrent-b",
        },
      } as MedusaRequest,
      createResponse(),
      deps
    )

    const [first, second] = await Promise.allSettled([
      firstRequest,
      secondRequest,
    ])

    const fulfilled = [first, second].filter((result) => result.status === "fulfilled")
    const rejected = [first, second].filter((result) => result.status === "rejected")

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        type: MedusaError.Types.INVALID_DATA,
      }),
    })
    expect(harness.refundRequests).toHaveLength(1)
    expect(harness.refundRequests[0]?.amount).toBe(6000)
  })

  it("rejects zero and negative refund amounts", async () => {
    const harness = createInMemoryAdminRefundHarness()

    for (const amount of [0, -100]) {
      const res = createResponse()
      harness.req.body = {
        order_id: ORDER_ID,
        amount,
        currency_code: "brl",
        idempotency_key: `admin-refund/${ORDER_ID}/invalid-${amount}`,
      }

      await expect(
        handleAdminCreateRefundRequest(harness.req, res, {
          resolveOrderModule: () => ({
            retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
          }),
          resolvePaymentAttemptModule: () => ({
            listPaymentAttempts: async () => [buildPaymentAttempt()],
          }),
          resolveRefundRequestModule: () => ({
            listRefundRequests: async () => [],
            createRefundRequests: async () => [],
          }),
          generateId: harness.nextIdRef,
        })
      ).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })
    }
  })

  it("rejects over-captured and currency mismatch requests", async () => {
    const harness = createInMemoryAdminRefundHarness()

    const overCapturedRes = createResponse()
    harness.req.body = {
      order_id: ORDER_ID,
      amount: 9901,
      currency_code: "brl",
      idempotency_key: "admin-refund/over-captured",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, overCapturedRes, {
        resolveOrderModule: () => ({
          retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
        }),
        resolvePaymentAttemptModule: () => ({
          listPaymentAttempts: async () => [buildPaymentAttempt()],
        }),
        resolveRefundRequestModule: () => ({
          listRefundRequests: async () => [],
          createRefundRequests: async () => [],
        }),
        generateId: harness.nextIdRef,
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })

    const currencyMismatchRes = createResponse()
    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1000,
      currency_code: "usd",
      idempotency_key: "admin-refund/currency-mismatch",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, currencyMismatchRes, {
        resolveOrderModule: () => ({
          retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
        }),
        resolvePaymentAttemptModule: () => ({
          listPaymentAttempts: async () => [buildPaymentAttempt()],
        }),
        resolveRefundRequestModule: () => ({
          listRefundRequests: async () => [],
          createRefundRequests: async () => [],
        }),
        generateId: harness.nextIdRef,
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
  })

  it("does not create Order or mutate order metadata", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const orderBefore = harness.orders.get(ORDER_ID)

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/no-order-create",
    }

    await handleAdminCreateRefundRequest(harness.req, createResponse(), {
      resolveOrderModule: () => ({
        retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
      }),
      resolvePaymentAttemptModule: () => ({
        listPaymentAttempts: async () => [buildPaymentAttempt()],
      }),
      resolveRefundRequestModule: () => ({
        listRefundRequests: async () => [],
        createRefundRequests: async (records: RefundRequestRecord[]) => {
          harness.refundRequests.push(...records)
          return records
        },
      }),
      generateId: harness.nextIdRef,
    })

    expect(harness.orders.get(ORDER_ID)).toEqual(orderBefore)
    expect(harness.orders.size).toBe(1)
  })

  it("uses injectable fake Stripe boundary only in tests", async () => {
    const layer = createFakeStripeRefundCreationLayer()
    const result = await layer.createRefund({
      payment_intent_id: PAYMENT_INTENT_ID,
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/fake-stripe",
    })

    expect(result.stripe_refund_id).toMatch(/^re_fake_/)
    expect(result.status).toBe("pending")
  })

  it("exports POST route handler", async () => {
    expect(typeof adminCreateRefundRequestRoute).toBe("function")
  })
})
