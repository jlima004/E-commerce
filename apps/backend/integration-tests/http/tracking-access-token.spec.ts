import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import defaultMiddlewares, {
  createCorrelationAndAccessLogMiddleware,
  storeTrackingLookupGuardMiddleware,
} from "../../src/api/middlewares"
import { POST as trackingLookupRoute } from "../../src/api/store/tracking/lookup/route"
import {
  assertPublicTrackingLookupResponseAllowlisted,
  getPublicTrackingLookupResponseKeys,
} from "../../src/api/store/tracking/serializers"
import { normalizeRouteOrJob } from "../../src/observability/logger"
import { GELATO_FULFILLMENT_MODULE } from "../../src/modules/gelato-fulfillment"
import { GELATO_FULFILLMENT_STATUS } from "../../src/modules/gelato-fulfillment/types"
import { TRACKING_ACCESS_TOKEN_MODULE } from "../../src/modules/tracking-access-token"
import {
  buildTrackingLookupInvalidTokenResponseBody,
  TRACKING_LOOKUP_INVALID_TOKEN_MESSAGE,
} from "../../src/modules/tracking-access-token/lookup"
import {
  getTrackingLookupBodyOnlyTokenMessage,
  parseTrackingLookupRequestBody,
} from "../../src/modules/tracking-access-token/lookup-body"
import {
  hashTrackingAccessToken,
  mintTrackingAccessToken,
} from "../../src/modules/tracking-access-token/service"
import {
  TRACKING_ACCESS_TOKEN_STATUS,
  type TrackingAccessTokenRecord,
} from "../../src/modules/tracking-access-token/types"

const TEST_PEPPER = "test-tracking-pepper-with-32-characters-minimum"
const TRACKING_LOOKUP_ROUTE = "/store/tracking/lookup"

const SENSITIVE_CANARIES = {
  token: "super-secret-tracking-token-value",
  tokenHash: hashTrackingAccessToken("super-secret-tracking-token-value", TEST_PEPPER),
  email: "cliente@compras.test",
  phone: "+55 11 98888-7777",
  cpf: "529.982.247-25",
  cnpj: "12.345.678/0001-99",
  address: "Rua A, 100 - Sao Paulo",
  trackingCode: "TRACK_HTTP_SECRET",
  trackingUrl: "https://carrier.example/track/secret",
  clientSecret: "pi_test_client_secret_value",
  pixQr: "00020126580014BR.GOV.BCB.PIX",
  orderId: "order_tracking_http_01",
} as const

const INVALID_TOKEN_BODY = buildTrackingLookupInvalidTokenResponseBody()

function joinKey(...parts: string[]): string {
  return parts.join("")
}

function buildTokenRecord(input: {
  id: string
  plaintextToken: string
  overrides?: Partial<TrackingAccessTokenRecord>
}): { record: TrackingAccessTokenRecord; plaintextToken: string } {
  const record = mintTrackingAccessToken(
    {
      order_id: SENSITIVE_CANARIES.orderId,
      gelato_fulfillment_id: "gelful_tracking_http_01",
      expires_at: new Date("2026-12-01T12:00:00.000Z"),
    },
    {
      id: input.id,
      pepper: TEST_PEPPER,
      at: new Date("2026-07-01T00:00:00.000Z"),
      randomBytesFn: () => Buffer.alloc(32, 7),
    }
  ).record

  return {
    record: {
      ...record,
      token_hash: hashTrackingAccessToken(input.plaintextToken, TEST_PEPPER),
      ...input.overrides,
    },
    plaintextToken: input.plaintextToken,
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

type RemoteQueryShape = {
  __value?: Record<
    string,
    {
      __args?: {
        filters?: Record<string, unknown>
      }
    }
  >
}

function readRemoteQueryTarget(queryObject: RemoteQueryShape): {
  entryPoint?: string
  filters: Record<string, unknown>
} {
  const entryPoint = queryObject.__value
    ? Object.keys(queryObject.__value)[0]
    : undefined
  const filters =
    (entryPoint && queryObject.__value?.[entryPoint]?.__args?.filters) ?? {}

  return { entryPoint, filters }
}

function createTrackingAccessTokenModule(
  records: TrackingAccessTokenRecord[] = []
) {
  const store = [...records]

  return {
    listTrackingAccessTokens: jest.fn(async (filters?: Record<string, unknown>) => {
      return store.filter((record) => {
        return (
          (!filters?.token_hash || record.token_hash === filters.token_hash) &&
          (!filters?.id || record.id === filters.id)
        )
      })
    }),
    updateTrackingAccessTokens: jest.fn(async (input) => {
      const row = Array.isArray(input) ? input[0] : input
      const index = store.findIndex((record) => record.id === row.id)

      if (index < 0) {
        throw new Error("tracking token not found")
      }

      store[index] = {
        ...store[index],
        ...row,
      }

      return [store[index]]
    }),
    store,
  }
}

function createGelatoFulfillmentModule() {
  return {
    listGelatoFulfillments: jest.fn(async (filters?: Record<string, unknown>) => {
      if (filters?.id !== "gelful_tracking_http_01") {
        return []
      }

      return [
        {
          id: "gelful_tracking_http_01",
          order_id: SENSITIVE_CANARIES.orderId,
          order_reference_id: SENSITIVE_CANARIES.orderId,
          status: GELATO_FULFILLMENT_STATUS.SHIPPED,
          tracking_summary: {
            status: GELATO_FULFILLMENT_STATUS.SHIPPED,
            tracking_status: "shipped",
            connected_order_ids: ["gel_order_http_001"],
          },
          request_summary: {
            order_id: SENSITIVE_CANARIES.orderId,
            cart_id: "cart_secret_01",
            payment_attempt_id: "payatt_secret_01",
            checkout_completion_log_id: "ccl_secret_01",
            analytics_event_log_id: "ael_secret_01",
            email_delivery_log_id: "edl_secret_01",
            idempotency_key: "idem_secret",
            request_hash: "reqhash_secret",
            item_count: 2,
            currency_code: "brl",
            status: GELATO_FULFILLMENT_STATUS.SHIPPED,
            connected_order_ids: ["gel_order_http_001"],
          },
          gelato_primary_order_id: "gel_order_http_001",
          updated_at: "2026-07-02T12:00:00.000Z",
        },
      ]
    }),
  }
}

function createRemoteQueryResolver() {
  return jest.fn(async (queryObject: RemoteQueryShape) => {
    const { entryPoint, filters } = readRemoteQueryTarget(queryObject)

    if (entryPoint === "order" && filters.id === SENSITIVE_CANARIES.orderId) {
      return [
        {
          id: SENSITIVE_CANARIES.orderId,
          display_id: 9101,
          updated_at: "2026-07-02T11:00:00.000Z",
          metadata: {
            order_status: "confirmed",
          },
          items: [
            {
              title: "Camiseta Essential",
              product_title: "Camiseta Essential",
            },
            {
              title: "Camiseta Premium",
              product_title: "Camiseta Premium",
            },
          ],
          email: SENSITIVE_CANARIES.email,
          shipping_address: {
            address_1: SENSITIVE_CANARIES.address,
            phone: SENSITIVE_CANARIES.phone,
            metadata: {
              federal_tax_id: "52998224725",
            },
          },
        },
      ]
    }

    return []
  })
}

function createRequest(overrides: Partial<MedusaRequest> = {}) {
  return {
    method: "POST",
    originalUrl: TRACKING_LOOKUP_ROUTE,
    url: TRACKING_LOOKUP_ROUTE,
    baseUrl: "",
    path: TRACKING_LOOKUP_ROUTE,
    route: {
      path: TRACKING_LOOKUP_ROUTE,
    },
    query: {},
    params: {},
    body: {},
    scope: {
      resolve: jest.fn(),
    },
    headers: {},
    ...overrides,
  } as MedusaRequest
}

function wireScope(
  req: MedusaRequest,
  input: {
    trackingModule: ReturnType<typeof createTrackingAccessTokenModule>
    gelatoModule?: ReturnType<typeof createGelatoFulfillmentModule>
    remoteQuery?: ReturnType<typeof createRemoteQueryResolver>
  }
) {
  ;(req.scope.resolve as jest.Mock).mockImplementation((key: string) => {
    if (key === TRACKING_ACCESS_TOKEN_MODULE) {
      return input.trackingModule
    }

    if (key === GELATO_FULFILLMENT_MODULE) {
      return input.gelatoModule ?? createGelatoFulfillmentModule()
    }

    if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
      return input.remoteQuery ?? createRemoteQueryResolver()
    }

    throw new Error(`Unexpected scope key: ${key}`)
  })
}

function expectSameInvalidTokenBody(body: unknown) {
  expect(body).toEqual(INVALID_TOKEN_BODY)
  expect((body as { message: string }).message).toBe(
    TRACKING_LOOKUP_INVALID_TOKEN_MESSAGE
  )
}

function expectResponseDoesNotLeakSensitiveData(body: unknown, token?: string) {
  const serialized = JSON.stringify(body).toLowerCase()

  expect(serialized).not.toContain(SENSITIVE_CANARIES.tokenHash.toLowerCase())
  expect(serialized).not.toContain(SENSITIVE_CANARIES.email.toLowerCase())
  expect(serialized).not.toContain(SENSITIVE_CANARIES.phone.replace(/\s/g, ""))
  expect(serialized).not.toContain("529.982.247-25")
  expect(serialized).not.toContain("52998224725")
  expect(serialized).not.toContain("12.345.678/0001-99")
  expect(serialized).not.toContain(SENSITIVE_CANARIES.address.toLowerCase())
  expect(serialized).not.toContain(SENSITIVE_CANARIES.trackingCode.toLowerCase())
  expect(serialized).not.toContain("trackingurl")
  expect(serialized).not.toContain(SENSITIVE_CANARIES.clientSecret.toLowerCase())
  expect(serialized).not.toContain("00020126")
  expect(serialized).not.toContain(SENSITIVE_CANARIES.orderId.toLowerCase())
  expect(serialized).not.toContain("gelato_primary_order_id")
  expect(serialized).not.toContain("payment_attempt_id")
  expect(serialized).not.toContain("cart_secret_01")

  if (token) {
    expect(serialized).not.toContain(token.toLowerCase())
  }
}

describe("POST /store/tracking/lookup", () => {
  const originalPepper = process.env.TRACKING_TOKEN_PEPPER

  beforeAll(() => {
    process.env.TRACKING_TOKEN_PEPPER = TEST_PEPPER
  })

  afterAll(() => {
    process.env.TRACKING_TOKEN_PEPPER = originalPepper
  })

  it("returns sanitized public tracking for a valid token", async () => {
    const { record, plaintextToken } = buildTokenRecord({
      id: "trkacc_valid_http",
      plaintextToken: SENSITIVE_CANARIES.token,
    })
    const trackingModule = createTrackingAccessTokenModule([record])
    const req = createRequest({
      body: {
        token: plaintextToken,
      },
    })
    wireScope(req, { trackingModule })
    const res = createResponse()

    await trackingLookupRoute(req, res)

    expect(res.statusCode).toBe(200)
    const body = res.json.mock.calls[0][0]
    expect(body.tracking).toEqual({
      order_reference: "9101",
      order_status: "confirmed",
      fulfillment_status: GELATO_FULFILLMENT_STATUS.SHIPPED,
      tracking_status: "shipped",
      item_count: 2,
      item_labels: ["Camiseta Essential", "Camiseta Premium"],
      updated_at: "2026-07-02T12:00:00.000Z",
      message: null,
    })
    assertPublicTrackingLookupResponseAllowlisted(body.tracking)
    expectResponseDoesNotLeakSensitiveData(body, plaintextToken)
    expect(trackingModule.updateTrackingAccessTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        id: record.id,
        last_used_at: expect.any(String),
      })
    )
  })

  it("rejects invalid, unknown, expired and revoked tokens with the same public shape", async () => {
    const expired = buildTokenRecord({
      id: "trkacc_expired_http",
      plaintextToken: "expired-token-value",
      overrides: {
        status: TRACKING_ACCESS_TOKEN_STATUS.EXPIRED,
        expires_at: "2020-01-01T00:00:00.000Z",
      },
    })
    const revoked = buildTokenRecord({
      id: "trkacc_revoked_http",
      plaintextToken: "revoked-token-value",
      overrides: {
        status: TRACKING_ACCESS_TOKEN_STATUS.REVOKED,
        revoked_at: "2026-07-01T00:00:00.000Z",
      },
    })
    const trackingModule = createTrackingAccessTokenModule([
      expired.record,
      revoked.record,
    ])

    const cases = [
      { label: "invalid", body: { token: "totally-unknown-token" } },
      { label: "unknown", body: { token: "missing-record-token-value" } },
      { label: "expired", body: { token: expired.plaintextToken } },
      { label: "revoked", body: { token: revoked.plaintextToken } },
    ]

    for (const testCase of cases) {
      const req = createRequest({ body: testCase.body })
      wireScope(req, { trackingModule })
      const res = createResponse()

      await trackingLookupRoute(req, res)

      expect(res.statusCode).toBe(401)
      expectSameInvalidTokenBody(res.json.mock.calls[0][0])
      expectResponseDoesNotLeakSensitiveData(res.json.mock.calls[0][0])
    }
  })

  it("rejects missing token and lookup attempts by order_id, email, phone, CPF, CNPJ or address", async () => {
    const invalidBodies = [
      {},
      { order_id: SENSITIVE_CANARIES.orderId },
      { email: SENSITIVE_CANARIES.email },
      { phone: SENSITIVE_CANARIES.phone },
      { cpf: SENSITIVE_CANARIES.cpf },
      { cnpj: SENSITIVE_CANARIES.cnpj },
      { shipping_address: { address_1: SENSITIVE_CANARIES.address } },
      { token: SENSITIVE_CANARIES.token, order_id: SENSITIVE_CANARIES.orderId },
    ]

    for (const body of invalidBodies) {
      expect(() => parseTrackingLookupRequestBody(body)).toThrow(MedusaError)
    }

    const trackingModule = createTrackingAccessTokenModule([])
    const req = createRequest({
      body: { order_id: SENSITIVE_CANARIES.orderId },
    })
    wireScope(req, { trackingModule })
    const res = createResponse()

    await expect(trackingLookupRoute(req, res)).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
  })

  it("rejects extra body fields and keeps only token in the contract", () => {
    expect(() =>
      parseTrackingLookupRequestBody({
        token: "abc",
        cart_id: "cart_01",
      })
    ).toThrow(getTrackingLookupBodyOnlyTokenMessage())

    expect(getPublicTrackingLookupResponseKeys()).toEqual([
      "order_reference",
      "order_status",
      "fulfillment_status",
      "tracking_status",
      "item_count",
      "item_labels",
      "updated_at",
      "message",
    ])
  })

  it("does not accept token in path or query and keeps access log route template token-free", async () => {
    const req = createRequest({
      query: {
        token: SENSITIVE_CANARIES.token,
      },
      body: {
        token: SENSITIVE_CANARIES.token,
      },
    })
    const res = createResponse()

    storeTrackingLookupGuardMiddleware(req, res, jest.fn())

    expect(res.statusCode).toBe(401)
    expectSameInvalidTokenBody(res.json.mock.calls[0][0])

    const normalized = normalizeRouteOrJob(TRACKING_LOOKUP_ROUTE)
    expect(normalized).toBe("/store/tracking/lookup")
    expect(normalized).not.toContain(":token")
    expect(normalized).not.toContain(SENSITIVE_CANARIES.token.slice(0, 8))

    const accessLogMiddleware = createCorrelationAndAccessLogMiddleware({
      createChildLogger: () =>
        ({
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
        }) as never,
    })
    const loggedReq = createRequest({
      route: { path: TRACKING_LOOKUP_ROUTE },
      originalUrl: `${TRACKING_LOOKUP_ROUTE}?token=${SENSITIVE_CANARIES.token}`,
    })
    const loggedRes = {
      statusCode: 200,
      setHeader: jest.fn(),
      on: jest.fn(function on(event: string, handler: () => void) {
        if (event === "finish") {
          handler()
        }
      }),
    } as unknown as MedusaResponse

    accessLogMiddleware(loggedReq, loggedRes, jest.fn())

    const routeConfig = defaultMiddlewares.routes.find(
      (route) => route.matcher === "/store/tracking/lookup"
    )

    expect(routeConfig?.middlewares).toContain(storeTrackingLookupGuardMiddleware)
    expect(normalizeRouteOrJob(loggedReq.originalUrl)).toBe("/store/tracking/lookup")
  })

  it("does not expose forbidden production substrings in route sources", () => {
    const forbidden = [
      joinKey("tracking", "Code"),
      joinKey("tracking", "Url"),
      joinKey("client", "_", "secret"),
      joinKey("re", "fund"),
      joinKey("Exchange", "Request"),
      joinKey("stripe ", "listen"),
      joinKey("stripe ", "trigger"),
    ]

    const routeSource = require("fs").readFileSync(
      require("path").join(
        __dirname,
        "../../src/api/store/tracking/lookup/route.ts"
      ),
      "utf8"
    )

    for (const needle of forbidden) {
      expect(routeSource).not.toContain(needle)
    }
  })
})
