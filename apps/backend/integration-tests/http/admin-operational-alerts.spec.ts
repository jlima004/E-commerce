import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  handleAdminListOperationalAlerts,
} from "../../src/api/admin/operational-alerts/route"
import {
  handleAdminRetrieveOperationalAlert,
} from "../../src/api/admin/operational-alerts/[id]/route"
import type {
  ListSafeInput,
  OperationalAlertSafe,
} from "../../src/modules/operational-alert/service"

const SAFE_ALERT: OperationalAlertSafe = {
  id: "opalert_http_01",
  type: "payment_stuck",
  severity: "high",
  status: "open",
  entity_type: "payment_attempt",
  entity_id: "payatt_http_01",
  message_code: "PAYMENT_CONFIRMED_CHECKOUT_STALE",
  message: "Pagamento confirmado sem pedido",
  error_code: "CHECKOUT_COMPLETION_STALE",
  metadata: { payment_attempt_id: "payatt_http_01" },
  first_seen_at: "2026-07-20T12:00:00.000Z",
  last_seen_at: "2026-07-20T12:05:00.000Z",
  occurrence_count: 2,
  acknowledged_at: null,
  acknowledged_by: null,
  resolved_at: null,
  resolved_by: null,
  ignored_at: null,
  ignored_by: null,
  created_at: "2026-07-20T12:00:00.000Z",
  updated_at: "2026-07-20T12:05:00.000Z",
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
  return response as unknown as MedusaResponse & {
    statusCode: number
    status: jest.Mock
    json: jest.Mock
  }
}

function createRequest(input: {
  query?: Record<string, unknown>
  id?: string
  authenticated?: boolean
} = {}) {
  const service = {
    listSafe: jest.fn(async (_filters: ListSafeInput) => ({
      rows: [SAFE_ALERT],
      count: 1,
    })),
    retrieveSafe: jest.fn(async (id: string) =>
      id === SAFE_ALERT.id ? SAFE_ALERT : null
    ),
  }
  const req = {
    query: input.query ?? {},
    params: { id: input.id ?? SAFE_ALERT.id },
    auth_context:
      input.authenticated === false
        ? undefined
        : { actor_id: "usr_admin_01", actor_type: "user" },
    scope: {
      resolve: jest.fn(() => service),
    },
  } as unknown as MedusaRequest

  return { req, service }
}

function expectInvalidData(promise: Promise<void>, code: string) {
  return expect(promise).rejects.toMatchObject({
    type: MedusaError.Types.INVALID_DATA,
    message: code,
  })
}

describe("Admin OperationalAlert read-only API", () => {
  it("lists for an authenticated Admin with default pagination and envelope", async () => {
    const { req, service } = createRequest()
    const res = createResponse()

    await handleAdminListOperationalAlerts(req, res)

    expect(res.statusCode).toBe(200)
    expect(service.listSafe).toHaveBeenCalledWith({ limit: 20, offset: 0 })
    expect(res.json).toHaveBeenCalledWith({
      operational_alerts: [SAFE_ALERT],
      count: 1,
      limit: 20,
      offset: 0,
    })
  })

  it("rejects unauthenticated list before resolving or consulting the service", async () => {
    const { req, service } = createRequest({ authenticated: false })
    const res = createResponse()

    await expect(handleAdminListOperationalAlerts(req, res)).rejects.toMatchObject({
      type: MedusaError.Types.UNAUTHORIZED,
      message: "UNAUTHORIZED",
    })
    expect(req.scope.resolve).not.toHaveBeenCalled()
    expect(service.listSafe).not.toHaveBeenCalled()
  })

  it("parses every valid filter and pagination input", async () => {
    const { req, service } = createRequest({
      query: {
        type: "fulfillment_failed",
        status: "acknowledged",
        severity: "critical",
        entity_type: "fulfillment",
        entity_id: "gelful_http_01",
        last_seen_at_from: "2026-07-20T10:00:00.000Z",
        last_seen_at_to: "2026-07-20T11:00:00.000Z",
        limit: "100",
        offset: "25",
      },
    })
    const res = createResponse()

    await handleAdminListOperationalAlerts(req, res)

    expect(service.listSafe).toHaveBeenCalledWith({
      type: "fulfillment_failed",
      status: "acknowledged",
      severity: "critical",
      entity_type: "fulfillment",
      entity_id: "gelful_http_01",
      last_seen_at_from: new Date("2026-07-20T10:00:00.000Z"),
      last_seen_at_to: new Date("2026-07-20T11:00:00.000Z"),
      limit: 100,
      offset: 25,
    })
  })

  it.each([
    [{ type: "other" }, "OPERATIONAL_ALERT_QUERY_INVALID"],
    [{ status: "closed" }, "OPERATIONAL_ALERT_QUERY_INVALID"],
    [{ severity: "warning" }, "OPERATIONAL_ALERT_QUERY_INVALID"],
    [{ entity_type: "order" }, "OPERATIONAL_ALERT_QUERY_INVALID"],
    [{ limit: "101" }, "OPERATIONAL_ALERT_QUERY_INVALID"],
    [{ limit: "0" }, "OPERATIONAL_ALERT_QUERY_INVALID"],
    [{ offset: "100001" }, "OPERATIONAL_ALERT_QUERY_INVALID"],
    [{ offset: "-1" }, "OPERATIONAL_ALERT_QUERY_INVALID"],
    [{ last_seen_at_from: "not-a-date" }, "OPERATIONAL_ALERT_QUERY_INVALID"],
    [
      {
        last_seen_at_from: "2026-07-20T12:00:00.000Z",
        last_seen_at_to: "2026-07-20T11:00:00.000Z",
      },
      "OPERATIONAL_ALERT_QUERY_INVALID",
    ],
    [{ sort: "created_at" }, "OPERATIONAL_ALERT_QUERY_INVALID"],
  ])("rejects invalid list query %# with 400 contract", async (query, code) => {
    const { req, service } = createRequest({ query })
    const res = createResponse()

    await expectInvalidData(handleAdminListOperationalAlerts(req, res), code)
    expect(service.listSafe).not.toHaveBeenCalled()
  })

  it("returns an empty collection with count and pagination", async () => {
    const { req, service } = createRequest()
    service.listSafe.mockResolvedValueOnce({ rows: [], count: 0 })
    const res = createResponse()

    await handleAdminListOperationalAlerts(req, res)

    expect(res.json).toHaveBeenCalledWith({
      operational_alerts: [],
      count: 0,
      limit: 20,
      offset: 0,
    })
  })

  it("returns detail for an authenticated Admin", async () => {
    const { req } = createRequest({ id: SAFE_ALERT.id })
    const res = createResponse()

    await handleAdminRetrieveOperationalAlert(req, res)

    expect(res.statusCode).toBe(200)
    expect(res.json).toHaveBeenCalledWith({ operational_alert: SAFE_ALERT })
  })

  it("returns 404 contract for a missing detail", async () => {
    const { req } = createRequest({ id: "opalert_missing" })
    const res = createResponse()

    await expect(handleAdminRetrieveOperationalAlert(req, res)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
      message: "OPERATIONAL_ALERT_NOT_FOUND",
    })
  })

  it.each(["", "alert_wrong_prefix", "opalert_!", `opalert_${"a".repeat(121)}`])(
    "rejects malformed detail id %p with 400 contract",
    async (id) => {
      const { req, service } = createRequest({ id })
      const res = createResponse()

      await expectInvalidData(
        handleAdminRetrieveOperationalAlert(req, res),
        "OPERATIONAL_ALERT_ID_INVALID"
      )
      expect(service.retrieveSafe).not.toHaveBeenCalled()
    }
  )

  it("rejects unauthenticated detail before service lookup", async () => {
    const { req, service } = createRequest({ authenticated: false })
    const res = createResponse()

    await expect(handleAdminRetrieveOperationalAlert(req, res)).rejects.toMatchObject({
      type: MedusaError.Types.UNAUTHORIZED,
      message: "UNAUTHORIZED",
    })
    expect(req.scope.resolve).not.toHaveBeenCalled()
    expect(service.retrieveSafe).not.toHaveBeenCalled()
  })

  it("exposes only the SPEC response allowlist and no sensitive fields", async () => {
    const { req } = createRequest()
    const res = createResponse()

    await handleAdminListOperationalAlerts(req, res)

    const payload = res.json.mock.calls[0]?.[0]
    const serialized = JSON.stringify(payload).toLowerCase()
    expect(Object.keys(payload.operational_alerts[0]).sort()).toEqual(
      Object.keys(SAFE_ALERT).sort()
    )
    for (const forbidden of [
      "raw_payload",
      "request_body",
      "response_body",
      "authorization",
      "cookie",
      "client_secret",
      "pix_qr",
      "cpf",
      "cnpj",
      "full_address",
      "provider_secret",
      "stack",
      "deleted_at",
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
