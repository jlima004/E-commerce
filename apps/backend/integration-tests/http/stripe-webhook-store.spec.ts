import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import defaultMiddlewares from "../../src/api/middlewares"
import { createStripeWebhookPostHandler } from "../../src/api/hooks/stripe/route"

type RequestWithRawBody = MedusaRequest & {
  rawBody?: Buffer | string
  correlationId?: string
}

type StoredWebhookRecord = {
  id: string
  provider: string
  external_event_id: string | null
  deduplication_key: string
  event_type: string
  status: string
}

const FORBIDDEN_STRINGS = [
  "completeCartWorkflow",
  "createOrderWorkflow",
  "CheckoutCompletionLog",
  "purchase_completed",
  "order.gelatoapis.com",
  "gelato_order_id",
] as const

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

function createStatefulWebhookService(records: StoredWebhookRecord[] = []) {
  return {
    listWebhookEventLogs: jest.fn(async (filters?: Record<string, unknown>) => {
      return records.filter((record) => {
        return (
          (!filters?.provider || record.provider === filters.provider) &&
          (!filters?.deduplication_key ||
            record.deduplication_key === filters.deduplication_key)
        )
      })
    }),
    createWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const duplicate = records.find(
        (record) =>
          record.provider === row.provider &&
          record.deduplication_key === row.deduplication_key
      )

      if (duplicate) {
        throw new Error("duplicate key value violates unique constraint")
      }

      const created = {
        id: `whlog_${records.length + 1}`,
        provider: row.provider,
        external_event_id: row.external_event_id ?? null,
        deduplication_key: row.deduplication_key,
        event_type: row.event_type,
        status: row.status ?? "received",
      }
      records.push(created)
      return [created]
    }),
    records,
  }
}

function createRequest(
  scopeResolve: jest.Mock,
  overrides: Partial<RequestWithRawBody> = {}
) {
  return {
    headers: {
      "stripe-signature": "t=1,v1=signature",
    },
    scope: {
      resolve: scopeResolve,
    },
    rawBody: Buffer.from('{"id":"evt_default","type":"payment_intent.succeeded"}'),
    correlationId: "corr_http_01",
    ...overrides,
  } as RequestWithRawBody
}

describe("stripe webhook http contract", () => {
  it("registra raw body preserveRawBody para POST /hooks/stripe", () => {
    const route = defaultMiddlewares.routes.find(
      (entry) => entry.matcher === "/hooks/stripe"
    )

    expect(route).toBeDefined()
    expect(route?.method ?? route?.methods).toEqual(
      expect.arrayContaining(["POST"])
    )
    expect(route?.bodyParser).toEqual(
      expect.objectContaining({
        preserveRawBody: true,
      })
    )
  })

  it("processa signature valida e persiste WebhookEventLog", async () => {
    const service = createStatefulWebhookService()
    const scopeResolve = jest.fn(() => service)
    const req = createRequest(scopeResolve)
    const res = createResponse()
    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: "whsec_test_123",
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => ({
            id: "evt_valid_http",
            type: "payment_intent.succeeded",
            livemode: false,
            data: {
              object: {
                id: "pi_http_123",
                object: "payment_intent",
              },
            },
          })),
        },
      },
      now: () => new Date("2026-06-30T12:00:00.000Z"),
    })

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(service.records).toHaveLength(1)
    expect(service.records[0]).toEqual(
      expect.objectContaining({
        provider: "stripe",
        external_event_id: "evt_valid_http",
        event_type: "payment_intent.succeeded",
        status: "received",
      })
    )
    const serialized = JSON.stringify({
      body: res.json.mock.calls[0][0],
      records: service.records,
      writes: service.createWebhookEventLogs.mock.calls,
    })
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it("marca evento nao suportado como ignored e deduplica replay", async () => {
    const service = createStatefulWebhookService()
    const scopeResolve = jest.fn(() => service)
    const handler = createStripeWebhookPostHandler({
      appEnv: {
        STRIPE_WEBHOOK_INGESTION_ENABLED: true,
        STRIPE_WEBHOOK_SECRET: "whsec_test_123",
      } as never,
      stripe: {
        webhooks: {
          constructEvent: jest.fn(() => ({
            id: "evt_ignored_http",
            type: "charge.refunded",
            livemode: false,
            data: {
              object: {
                id: "ch_http_123",
                object: "charge",
              },
            },
          })),
        },
      },
      now: () => new Date("2026-06-30T12:00:00.000Z"),
    })

    const firstReq = createRequest(scopeResolve, {
      rawBody: Buffer.from('{"id":"evt_ignored_http","type":"charge.refunded"}'),
    })
    const firstRes = createResponse()
    await handler(firstReq, firstRes)

    const secondReq = createRequest(scopeResolve, {
      rawBody: Buffer.from('{"id":"evt_ignored_http","type":"charge.refunded"}'),
    })
    const secondRes = createResponse()
    await handler(secondReq, secondRes)

    expect(firstRes.statusCode).toBe(200)
    expect(secondRes.statusCode).toBe(200)
    expect(service.records).toHaveLength(1)
    expect(service.records[0]?.status).toBe("ignored")
    expect(service.createWebhookEventLogs).toHaveBeenCalledTimes(1)
    expect(secondRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: true,
        status: "ignored",
      })
    )
  })
})
