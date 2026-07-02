import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createGelatoWebhookPostHandler } from "../../src/api/hooks/gelato/route"
import { GELATO_FULFILLMENT_MODULE } from "../../src/modules/gelato-fulfillment"
import { GELATO_FULFILLMENT_STATUS } from "../../src/modules/gelato-fulfillment/types"
import { WEBHOOKS_MODULE } from "../../src/modules/webhooks"

type RequestWithCorrelation = MedusaRequest & {
  correlationId?: string
}

type StoredWebhookRecord = {
  id: string
  provider: string
  external_event_id: string | null
  deduplication_key: string
  event_type: string
  status: string
  entity_type?: string
  entity_id?: string | null
  metadata?: Record<string, unknown> | null
}

const AUTH_HEADER = "X-GELATO-WEBHOOK-SECRET"
const WEBHOOK_SECRET = ["gelato", "webhook", "secret", "http"].join("_")

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const FORBIDDEN_STRINGS = [
  joinKey("Tracking", "Access", "Token"),
  joinKey("tracking", "_", "token"),
  joinKey("/store/", "tracking"),
  joinKey("re", "fund"),
  joinKey("Re", "fund"),
  joinKey("Exchange", "Request"),
  joinKey("stripe ", "listen"),
  joinKey("stripe ", "trigger"),
] as const

function buildPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "gel_evt_http_001",
    event: "order_status_updated",
    orderId: "gel_order_http_001",
    orderReferenceId: "order_http_123",
    fulfillmentStatus: "shipped",
    connectedOrderIds: ["gel_order_http_002"],
    items: [
      {
        itemReferenceId: "line_http_1",
        fulfillmentStatus: "shipped",
        fulfillments: [
          {
            trackingCode: "TRACK_HTTP_SECRET",
            trackingUrl: "https://example.com/track/http-secret",
          },
        ],
      },
    ],
    ...overrides,
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

      const created: StoredWebhookRecord = {
        id: `whlog_${records.length + 1}`,
        provider: row.provider,
        external_event_id: row.external_event_id ?? null,
        deduplication_key: row.deduplication_key,
        event_type: row.event_type,
        status: row.status ?? "received",
        entity_type: row.entity_type ?? "fulfillment",
        entity_id: row.entity_id ?? null,
        metadata: row.metadata ?? null,
      }
      records.push(created)
      return [created]
    }),
    updateWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = records.findIndex((record) => record.id === row.id)

      if (index < 0) {
        throw new Error("webhook record not found")
      }

      records[index] = {
        ...records[index],
        ...row,
      }

      return [records[index]]
    }),
    records,
  }
}

function createFulfillmentModule() {
  const store = [
    {
      id: "gelful_http_01",
      order_id: "order_http_123",
      order_reference_id: "order_http_123",
      status: GELATO_FULFILLMENT_STATUS.ACCEPTED,
      gelato_primary_order_id: "gel_order_http_001",
      connected_order_ids: ["gel_order_http_002"],
      response_summary: {
        provider: "gelato",
        status: GELATO_FULFILLMENT_STATUS.ACCEPTED,
        connected_order_ids: ["gel_order_http_002"],
        gelato_primary_order_id: "gel_order_http_001",
        provider_status: "accepted",
        provider_reference_id: "gel_order_http_001",
      },
      tracking_summary: null,
    },
  ]

  return {
    listGelatoFulfillments: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((entry) => {
        return !filters?.order_id || entry.order_id === filters.order_id
      })
    }),
    updateGelatoFulfillments: jest.fn(async (input) => {
      const rows = Array.isArray(input) ? input : [input]

      for (const row of rows) {
        const index = store.findIndex((entry) => entry.id === row.id)

        if (index >= 0) {
          store[index] = row
        }
      }

      return rows
    }),
    store,
  }
}

function createScopeResolve(input: {
  webhookService: ReturnType<typeof createStatefulWebhookService>
  fulfillmentModule: ReturnType<typeof createFulfillmentModule>
}) {
  return jest.fn((key: string) => {
    if (key === WEBHOOKS_MODULE) {
      return input.webhookService
    }

    if (key === GELATO_FULFILLMENT_MODULE || key === "gelato_fulfillment") {
      return input.fulfillmentModule
    }

    return undefined
  })
}

function createRequest(
  scopeResolve: jest.Mock,
  overrides: Partial<RequestWithCorrelation> = {}
) {
  return {
    headers: {
      [AUTH_HEADER]: WEBHOOK_SECRET,
    },
    body: buildPayload(),
    scope: {
      resolve: scopeResolve,
    },
    correlationId: "corr_gelato_http_01",
    ...overrides,
  } as RequestWithCorrelation
}

function createHandler() {
  return createGelatoWebhookPostHandler({
    appEnv: {
      GELATO_WEBHOOK_AUTH_HEADER_NAME: AUTH_HEADER,
      GELATO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    } as never,
    now: () => new Date("2026-07-02T12:00:00.000Z"),
  })
}

function serializeProof(payload: unknown) {
  return JSON.stringify(payload)
}

describe("gelato webhook http contract", () => {
  it("POST /hooks/gelato sem header rejeita antes de DB", async () => {
    const webhookService = createStatefulWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const handler = createHandler()
    const req = createRequest(
      createScopeResolve({
        webhookService,
        fulfillmentModule,
      }),
      {
        headers: {},
      }
    )
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(401)
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(fulfillmentModule.updateGelatoFulfillments).not.toHaveBeenCalled()
  })

  it("POST /hooks/gelato com header incorreto rejeita antes de DB", async () => {
    const webhookService = createStatefulWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const handler = createHandler()
    const req = createRequest(
      createScopeResolve({
        webhookService,
        fulfillmentModule,
      }),
      {
        headers: {
          [AUTH_HEADER]: "wrong-secret",
        },
      }
    )
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(403)
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(fulfillmentModule.updateGelatoFulfillments).not.toHaveBeenCalled()
  })

  it("POST /hooks/gelato com header valido e order_status_updated retorna 2xx e update local", async () => {
    const webhookService = createStatefulWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const handler = createHandler()
    const req = createRequest(
      createScopeResolve({
        webhookService,
        fulfillmentModule,
      })
    )
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        status: "processed",
      })
    )
    expect(webhookService.records[0]).toEqual(
      expect.objectContaining({
        provider: "gelato",
        external_event_id: "gel_evt_http_001",
        status: "processed",
        entity_type: "fulfillment",
        entity_id: "gelful_http_01",
      })
    )
    expect(fulfillmentModule.store[0]).toEqual(
      expect.objectContaining({
        status: GELATO_FULFILLMENT_STATUS.SHIPPED,
        tracking_summary: expect.objectContaining({
          tracking_status: "shipped",
        }),
      })
    )

    const proof = serializeProof({
      body: res.json.mock.calls[0][0],
      webhookRecords: webhookService.records,
      fulfillment: fulfillmentModule.store[0],
    })

    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(proof).not.toContain(forbidden)
    }
    expect(proof).not.toContain("TRACK_HTTP_SECRET")
    expect(proof).not.toContain(WEBHOOK_SECRET)
    expect(proof).not.toContain("trackingUrl")
  })

  it("POST duplicado com mesmo id retorna 2xx/no-op", async () => {
    const webhookService = createStatefulWebhookService([
      {
        id: "whlog_existing",
        provider: "gelato",
        external_event_id: "gel_evt_http_001",
        deduplication_key: "gel_evt_http_001",
        event_type: "order_status_updated",
        status: "processed",
        entity_type: "fulfillment",
        entity_id: "gelful_http_01",
      },
    ])
    const fulfillmentModule = createFulfillmentModule()
    const handler = createHandler()
    const req = createRequest(
      createScopeResolve({
        webhookService,
        fulfillmentModule,
      })
    )
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(fulfillmentModule.updateGelatoFulfillments).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: true,
        status: "processed",
      })
    )
  })

  it("POST com evento fora do MVP ignora sem efeito persistente", async () => {
    const webhookService = createStatefulWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const handler = createHandler()
    const req = createRequest(
      createScopeResolve({
        webhookService,
        fulfillmentModule,
      }),
      {
        body: buildPayload({
          event: "store_product_updated",
        }),
      }
    )
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(fulfillmentModule.updateGelatoFulfillments).not.toHaveBeenCalled()
  })

  it("tracking permanece nao publico no fluxo HTTP", async () => {
    const webhookService = createStatefulWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const handler = createHandler()
    const req = createRequest(
      createScopeResolve({
        webhookService,
        fulfillmentModule,
      })
    )
    const res = createResponse()

    await handler(req, res)

    const proof = serializeProof({
      fulfillment: fulfillmentModule.store[0],
      webhookRecords: webhookService.records,
    })

    expect(proof).not.toContain(joinKey("/store/", "tracking"))
    expect(proof).not.toContain(joinKey("tracking", "_", "token"))
    expect(proof).not.toContain(joinKey("Tracking", "Access", "Token"))
    expect(proof).not.toContain("https://example.com/track/http-secret")
  })
})
