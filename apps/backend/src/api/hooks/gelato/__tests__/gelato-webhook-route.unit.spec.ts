import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { GELATO_FULFILLMENT_STATUS } from "../../../../modules/gelato-fulfillment/types"
import { createGelatoWebhookPostHandler } from "../route"

type RequestWithCorrelation = MedusaRequest & {
  correlationId?: string
}

type WebhookRecord = {
  id: string
  provider: string
  external_event_id: string | null
  deduplication_key: string
  event_type: string
  status: string
  entity_type?: string
  entity_id?: string | null
}

const WEBHOOK_SECRET = ["gelato", "webhook", "secret", "test"].join("_")
const AUTH_HEADER = "X-GELATO-WEBHOOK-SECRET"

function buildPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "gel_evt_001",
    event: "order_status_updated",
    orderId: "gel_order_001",
    orderReferenceId: "order_123",
    fulfillmentStatus: "shipped",
    connectedOrderIds: ["gel_order_002"],
    items: [
      {
        itemReferenceId: "line_1",
        fulfillmentStatus: "shipped",
        fulfillments: [
          {
            trackingCode: "TRACK123",
            trackingUrl: "https://example.com/track/secret",
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

function createWebhookService(records: WebhookRecord[] = []) {
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
      const record = {
        id: `whlog_${records.length + 1}`,
        provider: row.provider,
        external_event_id: row.external_event_id ?? null,
        deduplication_key: row.deduplication_key,
        event_type: row.event_type,
        status: row.status ?? "received",
        entity_type: row.entity_type,
        entity_id: row.entity_id ?? null,
      }
      records.push(record)
      return [record]
    }),
    updateWebhookEventLogs: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = records.findIndex((record) => record.id === row.id)

      if (index >= 0) {
        records[index] = {
          ...records[index],
          ...row,
        }
      }

      return index >= 0 ? [records[index]] : []
    }),
    records,
  }
}

function createFulfillmentModule(
  fulfillments: Array<Record<string, unknown>> | null = null
) {
  const source = fulfillments ?? [{}]
  const store = source.map((entry, index) => ({
    id: `gelful_${index + 1}`,
    order_id: "order_123",
    order_reference_id: "order_123",
    status: GELATO_FULFILLMENT_STATUS.ACCEPTED,
    gelato_primary_order_id: "gel_order_001",
    connected_order_ids: ["gel_order_002"],
    response_summary: null,
    tracking_summary: null,
    ...entry,
  }))

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

function createRequest(overrides: Partial<RequestWithCorrelation> = {}) {
  return {
    headers: {
      [AUTH_HEADER]: WEBHOOK_SECRET,
    },
    body: buildPayload(),
    scope: {
      resolve: jest.fn(),
    },
    correlationId: "corr_gelato_01",
    ...overrides,
  } as RequestWithCorrelation
}

function createHandlerEnv(overrides: Record<string, unknown> = {}) {
  return {
    GELATO_WEBHOOK_AUTH_HEADER_NAME: AUTH_HEADER,
    GELATO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ...overrides,
  } as never
}

function createScopeResolve(input: {
  webhookService: ReturnType<typeof createWebhookService>
  fulfillmentModule: ReturnType<typeof createFulfillmentModule>
}) {
  return jest.fn((key: string) => {
    if (key === "webhooks") {
      return input.webhookService
    }

    if (key === "gelato-fulfillment" || key === "gelato_fulfillment") {
      return input.fulfillmentModule
    }

    return undefined
  })
}

describe("gelato webhook route", () => {
  it("rejeita sem header antes de qualquer side effect de DB", async () => {
    const webhookService = createWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const req = createRequest({
      headers: {},
    })
    req.scope.resolve = createScopeResolve({
      webhookService,
      fulfillmentModule,
    })

    const handler = createGelatoWebhookPostHandler({
      appEnv: createHandlerEnv(),
    })
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(401)
    expect(webhookService.listWebhookEventLogs).not.toHaveBeenCalled()
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(fulfillmentModule.updateGelatoFulfillments).not.toHaveBeenCalled()
  })

  it("rejeita header incorreto antes de qualquer side effect de DB", async () => {
    const webhookService = createWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const req = createRequest({
      headers: {
        [AUTH_HEADER]: "wrong-secret",
      },
    })
    req.scope.resolve = createScopeResolve({
      webhookService,
      fulfillmentModule,
    })

    const handler = createGelatoWebhookPostHandler({
      appEnv: createHandlerEnv(),
    })
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(403)
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(fulfillmentModule.updateGelatoFulfillments).not.toHaveBeenCalled()
  })

  it("falha fechada quando GELATO_WEBHOOK_SECRET esta ausente", async () => {
    const webhookService = createWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const req = createRequest()
    req.scope.resolve = createScopeResolve({
      webhookService,
      fulfillmentModule,
    })

    const handler = createGelatoWebhookPostHandler({
      appEnv: createHandlerEnv({
        GELATO_WEBHOOK_SECRET: undefined,
      }),
    })
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(503)
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
  })

  it("persiste WebhookEventLog e atualiza fulfillment com header valido", async () => {
    const webhookService = createWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const req = createRequest()
    req.scope.resolve = createScopeResolve({
      webhookService,
      fulfillmentModule,
    })

    const handler = createGelatoWebhookPostHandler({
      appEnv: createHandlerEnv(),
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    })
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(webhookService.createWebhookEventLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "gelato",
        external_event_id: "gel_evt_001",
        deduplication_key: "gel_evt_001",
        entity_type: "fulfillment",
      })
    )
    expect(fulfillmentModule.updateGelatoFulfillments).toHaveBeenCalledTimes(1)
    expect(fulfillmentModule.store[0]).toEqual(
      expect.objectContaining({
        status: GELATO_FULFILLMENT_STATUS.SHIPPED,
        tracking_summary: expect.objectContaining({
          tracking_status: "shipped",
        }),
      })
    )
    expect(JSON.stringify(webhookService.records)).not.toContain("TRACK123")
    expect(JSON.stringify(webhookService.records)).not.toContain(WEBHOOK_SECRET)
  })

  it("trata payload.id duplicado como no-op idempotente", async () => {
    const webhookService = createWebhookService([
      {
        id: "whlog_existing",
        provider: "gelato",
        external_event_id: "gel_evt_001",
        deduplication_key: "gel_evt_001",
        event_type: "order_status_updated",
        status: "processed",
        entity_type: "fulfillment",
        entity_id: "gelful_1",
      },
    ])
    const fulfillmentModule = createFulfillmentModule()
    const req = createRequest()
    req.scope.resolve = createScopeResolve({
      webhookService,
      fulfillmentModule,
    })

    const handler = createGelatoWebhookPostHandler({
      appEnv: createHandlerEnv(),
    })
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

  it("ignora evento fora do MVP sem side effect persistente", async () => {
    const webhookService = createWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const req = createRequest({
      body: buildPayload({
        event: "order_item_status_updated",
      }),
    })
    req.scope.resolve = createScopeResolve({
      webhookService,
      fulfillmentModule,
    })

    const handler = createGelatoWebhookPostHandler({
      appEnv: createHandlerEnv(),
    })
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(fulfillmentModule.updateGelatoFulfillments).not.toHaveBeenCalled()
  })

  it("rejeita payload malformado sem side effect persistente", async () => {
    const webhookService = createWebhookService()
    const fulfillmentModule = createFulfillmentModule()
    const req = createRequest({
      body: {
        id: "gel_evt_bad",
        event: "order_status_updated",
      },
    })
    req.scope.resolve = createScopeResolve({
      webhookService,
      fulfillmentModule,
    })

    const handler = createGelatoWebhookPostHandler({
      appEnv: createHandlerEnv(),
    })
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(400)
    expect(webhookService.createWebhookEventLogs).not.toHaveBeenCalled()
    expect(fulfillmentModule.updateGelatoFulfillments).not.toHaveBeenCalled()
  })

  it("trata replay concorrente com um unico efeito persistente", async () => {
    const existingRecord = {
      id: "whlog_existing",
      provider: "gelato",
      external_event_id: "gel_evt_001",
      deduplication_key: "gel_evt_001",
      event_type: "order_status_updated",
      status: "processed",
      entity_type: "fulfillment",
      entity_id: "gelful_1",
    }
    const webhookService = createWebhookService([existingRecord])
    let listCalls = 0
    webhookService.listWebhookEventLogs = jest.fn(async (filters) => {
      listCalls += 1

      if (listCalls === 1) {
        return []
      }

      return [existingRecord].filter((record) => {
        return (
          (!filters?.provider || record.provider === filters.provider) &&
          (!filters?.deduplication_key ||
            record.deduplication_key === filters.deduplication_key)
        )
      })
    })
    webhookService.createWebhookEventLogs = jest.fn(async (_input) => {
      throw new Error("duplicate key value violates unique constraint")
    })

    const fulfillmentModule = createFulfillmentModule()
    const req = createRequest()
    req.scope.resolve = createScopeResolve({
      webhookService,
      fulfillmentModule,
    })

    const handler = createGelatoWebhookPostHandler({
      appEnv: createHandlerEnv(),
    })
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(fulfillmentModule.updateGelatoFulfillments).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        duplicate: true,
        status: "processed",
      })
    )
  })

  it("marca fulfillment desconhecido como ignored de forma idempotente", async () => {
    const webhookService = createWebhookService()
    const fulfillmentModule = createFulfillmentModule([])
    const req = createRequest()
    req.scope.resolve = createScopeResolve({
      webhookService,
      fulfillmentModule,
    })

    const handler = createGelatoWebhookPostHandler({
      appEnv: createHandlerEnv(),
      now: () => new Date("2026-07-02T12:00:00.000Z"),
    })
    const res = createResponse()

    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(webhookService.createWebhookEventLogs).toHaveBeenCalledTimes(1)
    expect(fulfillmentModule.updateGelatoFulfillments).not.toHaveBeenCalled()
    expect(webhookService.records[0]?.status).toBe("ignored")
  })
})
