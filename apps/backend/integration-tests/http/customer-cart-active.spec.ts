import {
  GET as getActiveCart,
  POST as postActiveCart,
} from "../../src/api/store/carts/active/route"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../src/modules/guest-cart-capability/types"
import {
  createCartWorkflow,
} from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  assertNoPaymentOrOrderFields,
} from "../../src/modules/checkout/active-cart"
import {
  issueCustomerAuthAccessToken,
} from "../../src/modules/customer-auth/jwt"
import {
  CUSTOMER_AUTH_BFF_AUTH_HEADER,
} from "../../src/modules/customer-auth/bff-service-auth"
import {
  createCustomerAuthBffServiceGuardMiddleware,
  createSentryErrorHandler,
} from "../../src/api/middlewares"
import { env } from "../../src/config/env"

jest.mock("@medusajs/core-flows", () => ({
  createCartWorkflow: jest.fn(),
}))

const VALID_TEST_BFF_SECRET = "test_secret_must_be_at_least_32_characters_long_for_bff_auth"

function createMockResponse() {
  const json = jest.fn().mockReturnThis()
  const status = jest.fn().mockReturnThis()
  const setHeader = jest.fn()
  return {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code
      status(code)
      return this
    },
    json(body: unknown) {
      this.body = body
      json(body)
      this.headersSent = true
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
      setHeader(name, value)
    },
    statusMock: status,
    jsonMock: json,
    setHeaderMock: setHeader,
  }
}

async function executeStoreCartPipeline(
  req: any,
  res: any,
  handler: (req: any, res: any) => Promise<void>
) {
  const bffGuard = createCustomerAuthBffServiceGuardMiddleware({
    expectedSecret: VALID_TEST_BFF_SECRET,
  })
  const sentryHandler = createSentryErrorHandler({
    medusaErrorHandler: () => {},
    captureException: () => "mock_sentry_id",
  })

  let nextCalled = false
  await new Promise<void>((resolve, reject) => {
    bffGuard(req, res, ((err?: unknown) => {
      if (err) return reject(err)
      nextCalled = true
      resolve()
    }) as never)
    if (!nextCalled && res.headersSent) {
      resolve()
    }
  })

  if (!nextCalled) {
    return
  }

  try {
    await handler(req, res)
  } catch (error) {
    await new Promise<void>((resolve) => {
      sentryHandler(error, req, res, (() => resolve()) as never)
      if (res.headersSent) {
        resolve()
      }
    })
  }
}

type SyntheticLineageRow = {
  lineage_id: string
  sid: string
  auth_identity_id: string
  customer_id: string
  credential_version_snapshot: number
  lineage_status: "active" | "revoked" | "expired"
  original_authenticated_at: Date
  absolute_expires_at: Date
  deleted_at: Date | null
}

type SyntheticCredentialRow = {
  auth_identity_id: string
  customer_id: string
  credential_version: number
  operation_status: "stable" | "pending_password_change"
  deleted_at: Date | null
}

type SyntheticCustomerHarness = {
  carts: Map<string, any>
  lineages: Map<string, SyntheticLineageRow>
  credentials: Map<string, SyntheticCredentialRow>
  setDbUnavailable: (unavailable: boolean) => void
  createCustomerSession: (
    customerId: string,
    options?: {
      credentialVersion?: number
      status?: "active" | "revoked" | "expired"
      operationStatus?: "stable" | "pending_password_change"
      originalAuthenticatedAt?: Date
      absoluteExpiresAt?: Date
    }
  ) => {
    token: string
    sid: string
    authIdentityId: string
    customerId: string
    credentialVersion: number
    originalAuthenticatedAt: Date
    absoluteExpiresAt: Date
  }
  createRequest: (input: {
    method: "GET" | "POST"
    headers?: Record<string, string>
    session?: any
  }) => any
}

function createCustomerHarness(): SyntheticCustomerHarness {
  const carts = new Map<string, any>()
  const lineages = new Map<string, SyntheticLineageRow>()
  const credentials = new Map<string, SyntheticCredentialRow>()
  let cartSequence = 1
  let sessionSequence = 1
  let isDbUnavailable = false

  const mockGuestCapService = {
    async lookupGuestCartCapabilityByPresentedToken(token: string) {
      throw new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID")
    },
    async mintGuestCartCapability() {
      throw new Error("MINT_SHOULD_NOT_BE_CALLED_FOR_CUSTOMER")
    },
  }

  const mockRemoteQuery = jest.fn(async (queryObj: any) => {
    const entry = queryObj?.__value ? Object.keys(queryObj.__value)[0] : undefined
    const filters =
      (entry && queryObj.__value[entry]?.__args?.filters) ??
      queryObj?.variables?.filters ??
      queryObj?.filters ??
      {}
    if (filters.id) {
      const cart = carts.get(filters.id)
      return cart ? [cart] : []
    }
    if (filters.customer_id) {
      const matched = Array.from(carts.values()).filter(
        (c) => c.customer_id === filters.customer_id && !c.completed_at
      )
      return matched
    }
    return []
  })

  const mockPgConnection = {
    async raw(sql: string, bindings: any[] = []) {
      if (isDbUnavailable) {
        throw new Error("PG_CONNECTION_UNAVAILABLE")
      }
      if (sql.includes("auth_session_lineage")) {
        const sid = bindings[0]
        const lineage = Array.from(lineages.values()).find(
          (l) => l.sid === sid && !l.deleted_at
        )
        if (!lineage) {
          return { rows: [] }
        }
        const credential = Array.from(credentials.values()).find(
          (c) => c.auth_identity_id === lineage.auth_identity_id && !c.deleted_at
        )
        if (!credential) {
          return { rows: [] }
        }
        return {
          rows: [
            {
              lineage_id: lineage.lineage_id,
              sid: lineage.sid,
              lineage_auth_identity_id: lineage.auth_identity_id,
              lineage_customer_id: lineage.customer_id,
              credential_version_snapshot: lineage.credential_version_snapshot,
              lineage_status: lineage.lineage_status,
              original_authenticated_at: lineage.original_authenticated_at,
              absolute_expires_at: lineage.absolute_expires_at,
              credential_auth_identity_id: credential.auth_identity_id,
              credential_customer_id: credential.customer_id,
              credential_version: credential.credential_version,
              operation_status: credential.operation_status,
            },
          ],
        }
      }
      return { rows: [] }
    },
  }

  ;(createCartWorkflow as unknown as jest.Mock).mockImplementation((scope: any) => ({
    run: async ({ input }: any) => {
      const id = `cart_cus_${cartSequence++}`
      const newCart = {
        id,
        currency_code: input.currency_code ?? "brl",
        customer_id: input.customer_id ?? null,
        metadata: { active_for_checkout: true },
        items: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
      }
      carts.set(id, newCart)
      return { result: { id } }
    },
  }))

  function createCustomerSession(
    customerId: string,
    options: {
      credentialVersion?: number
      status?: "active" | "revoked" | "expired"
      operationStatus?: "stable" | "pending_password_change"
      originalAuthenticatedAt?: Date
      absoluteExpiresAt?: Date
    } = {}
  ) {
    const seq = sessionSequence++
    const sid = `sid_${customerId}_${seq}`
    const authIdentityId = `ident_${customerId}_${seq}`
    const credentialVersion = options.credentialVersion ?? 1
    const originalAuthenticatedAt =
      options.originalAuthenticatedAt ??
      new Date(Math.floor((Date.now() - 60000) / 1000) * 1000)
    const absoluteExpiresAt =
      options.absoluteExpiresAt ??
      new Date(originalAuthenticatedAt.getTime() + 30 * 24 * 60 * 60 * 1000)

    const lineageRow: SyntheticLineageRow = {
      lineage_id: `lin_${seq}`,
      sid,
      auth_identity_id: authIdentityId,
      customer_id: customerId,
      credential_version_snapshot: credentialVersion,
      lineage_status: options.status ?? "active",
      original_authenticated_at: originalAuthenticatedAt,
      absolute_expires_at: absoluteExpiresAt,
      deleted_at: null,
    }
    lineages.set(sid, lineageRow)

    const credentialRow: SyntheticCredentialRow = {
      auth_identity_id: authIdentityId,
      customer_id: customerId,
      credential_version: credentialVersion,
      operation_status: options.operationStatus ?? "stable",
      deleted_at: null,
    }
    credentials.set(authIdentityId, credentialRow)

    const { token } = issueCustomerAuthAccessToken({
      secret: env.JWT_SECRET,
      authIdentityId,
      customerId,
      sid,
      credentialVersion,
      originalAuthenticatedAt,
      absoluteExpiresAt,
      now: new Date(),
    })

    return {
      token,
      sid,
      authIdentityId,
      customerId,
      credentialVersion,
      originalAuthenticatedAt,
      absoluteExpiresAt,
    }
  }

  function createRequest(input: {
    method: "GET" | "POST"
    headers?: Record<string, string>
    session?: any
  }) {
    return {
      method: input.method,
      url: "/store/carts/active",
      originalUrl: "/store/carts/active",
      headers: {
        [CUSTOMER_AUTH_BFF_AUTH_HEADER]: VALID_TEST_BFF_SECRET,
        ...(input.headers ?? {}),
      },
      session: input.session,
      scope: {
        resolve: (key: any) => {
          if (key === GUEST_CART_CAPABILITY_MODULE) {
            return mockGuestCapService
          }
          if (key === ContainerRegistrationKeys.REMOTE_QUERY) {
            return mockRemoteQuery
          }
          if (key === ContainerRegistrationKeys.PG_CONNECTION) {
            return mockPgConnection
          }
          throw new Error(`Unrecognized container key: ${String(key)}`)
        },
      },
    }
  }

  return {
    carts,
    lineages,
    credentials,
    setDbUnavailable: (val: boolean) => {
      isDbUnavailable = val
    },
    createCustomerSession,
    createRequest,
  }
}

describe("Customer Cart Active HTTP Tracer Matrix (Task 15-03-03 — Real Authority & NO SKIP)", () => {
  it("PROVA 1: Valid Customer — BFF + Authorization + PostgreSQL lineage cria cart 201 associado ao customer_id sem emitir x-indicio-guest-cart-token", async () => {
    const harness = createCustomerHarness()
    const session = harness.createCustomerSession("cus_maria_123")

    // Request resolves Customer via Authorization header + PostgreSQL lineage
    const req = harness.createRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    })
    const res = createMockResponse()

    await postActiveCart(req as never, res as never)

    expect(res.statusCode).toBe(201)
    const body = res.body as any
    expect(body.cart).toBeDefined()
    expect(body.cart.customer_id).toBe("cus_maria_123")
    expect(body.cart.currency_code).toBe("brl")
    assertNoPaymentOrOrderFields(body.cart)

    // NUNCA emite capability token para Customer
    expect(res.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
  })

  it("PROVA 2: Customer Reuse — mesmo Customer reaproveita cart existente (200) sem criar duplicatas", async () => {
    const harness = createCustomerHarness()
    const session = harness.createCustomerSession("cus_joao_456")

    // 1. Criar primeiro cart
    const req1 = harness.createRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    })
    const res1 = createMockResponse()
    await postActiveCart(req1 as never, res1 as never)
    expect(res1.statusCode).toBe(201)
    const cartId = (res1.body as any).cart.id

    // 2. Segundo POST com o mesmo customer token
    const req2 = harness.createRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    })
    const res2 = createMockResponse()
    await postActiveCart(req2 as never, res2 as never)

    expect(res2.statusCode).toBe(200)
    expect((res2.body as any).cart.id).toBe(cartId)
    expect(harness.carts.size).toBe(1)
    expect(res2.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
  })

  it("PROVA 3: Customer GET — valid authority devolve 200 com cart do Customer", async () => {
    const harness = createCustomerHarness()
    const session = harness.createCustomerSession("cus_ana_789")

    // Criar cart via POST
    const postReq = harness.createRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    })
    const postRes = createMockResponse()
    await postActiveCart(postReq as never, postRes as never)
    const cartId = (postRes.body as any).cart.id

    // GET cart
    const getReq = harness.createRequest({
      method: "GET",
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    })
    const getRes = createMockResponse()
    await getActiveCart(getReq as never, getRes as never)

    expect(getRes.statusCode).toBe(200)
    expect((getRes.body as any).cart.id).toBe(cartId)
    expect((getRes.body as any).cart.customer_id).toBe("cus_ana_789")
    expect(getRes.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
  })

  it("PROVA 4: Invalid Authorization — BFF valido + Authorization invalida/expirada/revogada retorna 401 e zero cart", async () => {
    const harness = createCustomerHarness()

    const origAuth = new Date(Math.floor((Date.now() - 60000) / 1000) * 1000)
    const forgedToken = issueCustomerAuthAccessToken({
      secret: "forged_secret_must_be_different_and_long_enough_for_test",
      authIdentityId: "ident_forged",
      customerId: "cus_forged",
      sid: "sid_forged",
      credentialVersion: 1,
      originalAuthenticatedAt: origAuth,
      absoluteExpiresAt: new Date(origAuth.getTime() + 30 * 24 * 60 * 60 * 1000),
      now: new Date(),
    }).token

    const reqForged = harness.createRequest({
      method: "POST",
      headers: { authorization: `Bearer ${forgedToken}` },
    })
    const resForged = createMockResponse()
    await expect(postActiveCart(reqForged as never, resForged as never)).rejects.toMatchObject({
      type: MedusaError.Types.UNAUTHORIZED,
    })
    expect(harness.carts.size).toBe(0)
    expect(resForged.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()

    // 4.2 Malformed token
    const reqMalformed = harness.createRequest({
      method: "POST",
      headers: { authorization: "Bearer invalid.jwt.garbage" },
    })
    const resMalformed = createMockResponse()
    await expect(postActiveCart(reqMalformed as never, resMalformed as never)).rejects.toMatchObject({
      type: MedusaError.Types.UNAUTHORIZED,
    })
    expect(harness.carts.size).toBe(0)

    // 4.3 Lineage revogada no PostgreSQL
    const revokedSession = harness.createCustomerSession("cus_revoked", {
      status: "revoked",
    })
    const reqRevoked = harness.createRequest({
      method: "POST",
      headers: { authorization: `Bearer ${revokedSession.token}` },
    })
    const resRevoked = createMockResponse()
    await expect(postActiveCart(reqRevoked as never, resRevoked as never)).rejects.toMatchObject({
      type: MedusaError.Types.UNAUTHORIZED,
    })
    expect(harness.carts.size).toBe(0)

    // 4.4 Credential version desatualizada (token cv=1, db cv=2)
    const staleSession = harness.createCustomerSession("cus_stale", {
      credentialVersion: 1,
    })
    const cred = harness.credentials.get(staleSession.authIdentityId)!
    cred.credential_version = 2 // DB avançou para 2

    const reqStale = harness.createRequest({
      method: "POST",
      headers: { authorization: `Bearer ${staleSession.token}` },
    })
    const resStale = createMockResponse()
    await expect(postActiveCart(reqStale as never, resStale as never)).rejects.toMatchObject({
      type: MedusaError.Types.UNAUTHORIZED,
    })
    expect(harness.carts.size).toBe(0)
  })

  it("PROVA 5: Authority Unavailable — PostgreSQL indisponivel resulta em HTTP 503 publico, envelope SERVICE_UNAVAILABLE e zero cart", async () => {
    const harness = createCustomerHarness()
    const session = harness.createCustomerSession("cus_unavail")

    harness.setDbUnavailable(true)

    // 5.1 POST /store/carts/active through full Store public pipeline (BFF guard -> active handler -> Store error boundary)
    const reqPost = harness.createRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    })
    const resPost = createMockResponse()

    await executeStoreCartPipeline(reqPost, resPost, postActiveCart)

    expect(resPost.statusCode).toBe(503)
    expect(resPost.body).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "Service Unavailable",
      retryable: false,
      correlationId: expect.any(String),
    })
    expect(resPost.headers["x-correlation-id"]).toBeDefined()
    expect(harness.carts.size).toBe(0)
    expect(resPost.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()

    // 5.2 GET /store/carts/active through full Store public pipeline on authority outage
    const reqGet = harness.createRequest({
      method: "GET",
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    })
    const resGet = createMockResponse()

    await executeStoreCartPipeline(reqGet, resGet, getActiveCart)

    expect(resGet.statusCode).toBe(503)
    expect(resGet.body).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "Service Unavailable",
      retryable: false,
      correlationId: expect.any(String),
    })
    expect(resGet.headers["x-correlation-id"]).toBeDefined()
    expect(harness.carts.size).toBe(0)
    expect(resGet.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
  })

  it("PROVA 6: XOR Guest Precedence — capability PRESENTE mas invalida + Authorization valida retorna 404 e nao cai para Customer", async () => {
    const harness = createCustomerHarness()
    const session = harness.createCustomerSession("cus_victor_999")

    // Cria um cart prévio para o customer
    const postReq = harness.createRequest({
      method: "POST",
      headers: { authorization: `Bearer ${session.token}` },
    })
    const postRes = createMockResponse()
    await postActiveCart(postReq as never, postRes as never)
    expect(postRes.statusCode).toBe(201)

    // Request envia simultaneamente Authorization Customer valida E header de guest invalido
    const req = harness.createRequest({
      method: "GET",
      headers: {
        authorization: `Bearer ${session.token}`,
        [GUEST_CART_CAPABILITY_HEADER]: "invalid_guest_token_xyz",
      },
    })
    const res = createMockResponse()

    // O branch Guest tem precedencia estrita e falha closed -> 404! Nunca devolve o cart do Customer!
    await expect(getActiveCart(req as never, res as never)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
  })

  it("PROVA 7: GET Customer devolve 404 quando Customer nao possui cart ativo", async () => {
    const harness = createCustomerHarness()
    const session = harness.createCustomerSession("cus_novo_sem_cart")

    const req = harness.createRequest({
      method: "GET",
      headers: {
        authorization: `Bearer ${session.token}`,
      },
    })
    const res = createMockResponse()

    await expect(getActiveCart(req as never, res as never)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_FOUND,
    })
    expect(harness.carts.size).toBe(0)
  })

  it("PROVA 8: BFF Pipeline Integration — requisicao sem credencial BFF e barrada no middleware antes do handler de active cart", () => {
    const bffMiddleware = createCustomerAuthBffServiceGuardMiddleware({
      expectedSecret: VALID_TEST_BFF_SECRET,
    })

    const reqMissingBff = {
      method: "POST",
      originalUrl: "/store/carts/active",
      url: "/store/carts/active",
      headers: {
        // sem CUSTOMER_AUTH_BFF_AUTH_HEADER
        authorization: "Bearer some_jwt_token",
      },
      params: {},
      customerAuthBff: undefined,
    }
    const resMissingBff = createMockResponse()
    const next = jest.fn()

    bffMiddleware(reqMissingBff as never, resMissingBff as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(resMissingBff.statusCode).toBe(404)
    expect(resMissingBff.jsonMock).toHaveBeenCalledWith({
      type: "not_found",
      message: "Not Found",
    })
  })
})
