import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { handleAdminCreateExchangeRequest } from "../../src/api/admin/exchanges/route"
import { handleAdminUpdateExchangeRequest } from "../../src/api/admin/exchanges/[id]/route"
import {
  EXCHANGE_REQUEST_REASON,
  EXCHANGE_REQUEST_STATUS,
  REVERSE_LOGISTICS_PROVIDER,
  type ExchangeRequestRecord,
} from "../../src/modules/exchange-request/types"

const ORDER_ID = "order_admin_exchange_01"

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const SENSITIVE_CANARIES = {
  email: joinKey("cliente", "@", "compras", ".", "test"),
  clientSecret: joinKey("pi_test", "_", "secret_value"),
  webhookSecret: joinKey("whsec_", "test_canary_value"),
} as const

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

function createInMemoryAdminExchangeHarness() {
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

  const exchangeRequests: ExchangeRequestRecord[] = []
  let nextId = 1

  const req = {
    body: {},
    params: {},
    scope: {
      resolve: jest.fn((key: string) => {
        if (key === "order") {
          return {
            retrieveOrder: async (id: string) => orders.get(id) ?? null,
          }
        }

        if (key === "exchange_request") {
          return {
            createExchangeRequests: async (records: ExchangeRequestRecord[]) => {
              for (const record of records) {
                exchangeRequests.push(record)
              }

              return records
            },
            listExchangeRequests: async (filters?: { id?: string }) =>
              exchangeRequests.filter((request) => {
                if (filters?.id && request.id !== filters.id) {
                  return false
                }

                return true
              }),
            updateExchangeRequests: async (
              data: ExchangeRequestRecord | ExchangeRequestRecord[]
            ) => {
              const records = Array.isArray(data) ? data : [data]

              for (const record of records) {
                const index = exchangeRequests.findIndex(
                  (entry) => entry.id === record.id
                )

                if (index >= 0) {
                  exchangeRequests[index] = record
                }
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
    exchangeRequests,
    orders,
    nextIdRef: () => `excreq_http_${nextId++}`,
  }
}

function expectNoCanaries(value: unknown) {
  const serialized = JSON.stringify(value)

  for (const canary of Object.values(SENSITIVE_CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

describe("admin exchanges routes", () => {
  const originalAdminExchangeEnabled =
    process.env.ADMIN_EXCHANGE_REQUEST_ENABLED

  beforeEach(() => {
    process.env.ADMIN_EXCHANGE_REQUEST_ENABLED = "true"
  })

  afterAll(() => {
    if (originalAdminExchangeEnabled === undefined) {
      delete process.env.ADMIN_EXCHANGE_REQUEST_ENABLED
    } else {
      process.env.ADMIN_EXCHANGE_REQUEST_ENABLED = originalAdminExchangeEnabled
    }
  })

  it("creates defect exchange without refund or financial mutation", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const res = createResponse()
    const initialPaymentStatus =
      harness.orders.get(ORDER_ID)?.metadata.payment_status

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [
        {
          line_item_id: "li_defect_01",
          product_title: "Camiseta Defeito",
          quantity: 1,
        },
      ],
      operator_note: "Defeito na estampa",
      created_by_operator_id: "operator_01",
    }

    await handleAdminCreateExchangeRequest(harness.req, res, {
      resolveOrderModule: () => ({
        retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
      }),
      resolveExchangeRequestModule: () =>
        harness.req.scope.resolve("exchange_request"),
      generateId: harness.nextIdRef,
    })

    expect(res.statusCode).toBe(201)
    expect(harness.exchangeRequests).toHaveLength(1)
    expect(harness.exchangeRequests[0]?.reason).toBe("defect")
    expect(harness.exchangeRequests[0]?.status).toBe("opened")
    expect(harness.orders.get(ORDER_ID)?.metadata.payment_status).toBe(
      initialPaymentStatus
    )
    expectNoCanaries(res.json.mock.calls[0]?.[0])
  })

  it("creates wrong_product exchange with manual Correios fields", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const res = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.WRONG_PRODUCT,
      affected_items: [{ product_title: "Camiseta P", quantity: 1 }],
      reverse_logistics_provider: REVERSE_LOGISTICS_PROVIDER.CORREIOS_MANUAL,
      reverse_tracking_code: "BR123456789BR",
      reverse_authorization_code: "AUTH123456",
      reverse_label_reference: "label-001",
    }

    await handleAdminCreateExchangeRequest(harness.req, res, {
      resolveOrderModule: () => ({
        retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
      }),
      resolveExchangeRequestModule: () =>
        harness.req.scope.resolve("exchange_request"),
      generateId: harness.nextIdRef,
    })

    expect(res.statusCode).toBe(201)
    expect(harness.exchangeRequests[0]?.reverse_tracking_code).toBe(
      "BR123456789BR"
    )
    expect(harness.exchangeRequests[0]?.reverse_logistics_provider).toBe(
      "correios_manual"
    )
  })

  it("updates exchange status and reverse logistics through admin update route", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const createRes = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await handleAdminCreateExchangeRequest(harness.req, createRes, {
      resolveOrderModule: () => ({
        retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
      }),
      resolveExchangeRequestModule: () =>
        harness.req.scope.resolve("exchange_request"),
      generateId: harness.nextIdRef,
    })

    const exchangeId = harness.exchangeRequests[0]?.id ?? ""
    const updateRes = createResponse()

    harness.req.params = { id: exchangeId }
    harness.req.body = {
      status: EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
      reverse_logistics_provider: REVERSE_LOGISTICS_PROVIDER.CORREIOS_MANUAL,
      reverse_tracking_code: "BR555666777BR",
    }

    await handleAdminUpdateExchangeRequest(harness.req, updateRes, {
      resolveExchangeRequestModule: () =>
        harness.req.scope.resolve("exchange_request"),
    })

    expect(updateRes.statusCode).toBe(200)
    expect(harness.exchangeRequests[0]?.status).toBe("awaiting_customer_return")
    expect(harness.exchangeRequests[0]?.reverse_tracking_code).toBe(
      "BR555666777BR"
    )
  })

  it("rejects invalid status transition via admin update route", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const createRes = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await handleAdminCreateExchangeRequest(harness.req, createRes, {
      resolveOrderModule: () => ({
        retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
      }),
      resolveExchangeRequestModule: () =>
        harness.req.scope.resolve("exchange_request"),
      generateId: harness.nextIdRef,
    })

    const exchangeId = harness.exchangeRequests[0]?.id ?? ""
    const updateRes = createResponse()

    harness.req.params = { id: exchangeId }
    harness.req.body = {
      status: EXCHANGE_REQUEST_STATUS.RESOLVED,
    }

    await expect(
      handleAdminUpdateExchangeRequest(harness.req, updateRes, {
        resolveExchangeRequestModule: () =>
          harness.req.scope.resolve("exchange_request"),
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "EXCHANGE_REQUEST_STATUS_TRANSITION_INVALID",
    })
  })

  it.each([
    ["metadata", { source: "admin" }],
    ["payload", { raw: true }],
    ["headers", { authorization: "Bearer x" }],
    ["payment_status", "refunded"],
    ["refund", { amount: 100 }],
  ])(
    "rejects create body with top-level forbidden %s",
    async (_label, forbiddenValue) => {
      const harness = createInMemoryAdminExchangeHarness()
      const res = createResponse()

      harness.req.body = {
        order_id: ORDER_ID,
        reason: EXCHANGE_REQUEST_REASON.DEFECT,
        affected_items: [{ product_title: "Camiseta", quantity: 1 }],
        [_label]: forbiddenValue,
      }

      await expect(
        handleAdminCreateExchangeRequest(harness.req, res, {
          resolveOrderModule: () => ({
            retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
          }),
          resolveExchangeRequestModule: () =>
            harness.req.scope.resolve("exchange_request"),
          generateId: harness.nextIdRef,
        })
      ).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
        message: "EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD",
      })

      expect(harness.exchangeRequests).toHaveLength(0)
    }
  )

  it("rejects update body with forbidden payload even when status is valid", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const createRes = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await handleAdminCreateExchangeRequest(harness.req, createRes, {
      resolveOrderModule: () => ({
        retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
      }),
      resolveExchangeRequestModule: () =>
        harness.req.scope.resolve("exchange_request"),
      generateId: harness.nextIdRef,
    })

    const exchangeId = harness.exchangeRequests[0]?.id ?? ""
    const updateRes = createResponse()

    harness.req.params = { id: exchangeId }
    harness.req.body = {
      status: EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
      gelato_payload: { order_id: "gel_123" },
    }

    await expect(
      handleAdminUpdateExchangeRequest(harness.req, updateRes, {
        resolveExchangeRequestModule: () =>
          harness.req.scope.resolve("exchange_request"),
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD",
    })

    expect(harness.exchangeRequests[0]?.status).toBe("opened")
  })

  it("rejects forbidden payload in operator_note", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const res = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
      operator_note: `contato ${SENSITIVE_CANARIES.email}`,
    }

    await expect(
      handleAdminCreateExchangeRequest(harness.req, res, {
        resolveOrderModule: () => ({
          retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
        }),
        resolveExchangeRequestModule: () =>
          harness.req.scope.resolve("exchange_request"),
        generateId: harness.nextIdRef,
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD",
    })
  })

  it("does not create RefundRequest side effects in harness", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const res = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.WRONG_PRODUCT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await handleAdminCreateExchangeRequest(harness.req, res, {
      resolveOrderModule: () => ({
        retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
      }),
      resolveExchangeRequestModule: () =>
        harness.req.scope.resolve("exchange_request"),
      generateId: harness.nextIdRef,
    })

    expect(harness.exchangeRequests).toHaveLength(1)
    expect(JSON.stringify(harness.exchangeRequests)).not.toContain("refund_request")
    expect(JSON.stringify(harness.exchangeRequests)).not.toContain("stripe_refund")
  })

  it("returns NOT_ALLOWED when admin exchange route is disabled", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const res = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await expect(
      handleAdminCreateExchangeRequest(harness.req, res, {
        resolveOrderModule: () => ({
          retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
        }),
        resolveExchangeRequestModule: () =>
          harness.req.scope.resolve("exchange_request"),
        generateId: harness.nextIdRef,
        isEnabled: () => false,
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: "ADMIN_EXCHANGE_REQUEST_DISABLED",
    })
  })
})
