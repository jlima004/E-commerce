import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  CustomerRegistrationError,
  type CustomerRegistrationResult,
} from "../../src/modules/customer-auth/registration"
import { loginCustomer } from "../../src/modules/customer-auth/login"
import type { AuthSessionEnvelope } from "../../src/modules/customer-auth/session"
import {
  InMemoryAtomicRateLimitStore,
  type AtomicRateLimitStore,
  type DerivedRateLimitBucket,
  type RateLimitBucketResult,
} from "../../src/modules/customer-auth/security/rate-limit"
import { handleCustomerAuthSignup } from "../../src/api/auth/customer/emailpass/register/route"
import { handleCustomerAuthLogin } from "../../src/api/auth/customer/emailpass/route"
import { handleCustomerAuthCurrentCustomer } from "../../src/api/store/customers/me/route"
import {
  AUTH_SURFACE_LOCAL_OPERATIONS,
  AUTH_SURFACE_NATIVE_OPERATIONS,
} from "../../src/api/auth-surface/manifest"
import { decideAuthSurfaceAccess } from "../../src/api/auth-surface/guard"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  storeSurfaceOperationKey,
  validateStoreSurfaceManifest,
} from "../../src/api/store-surface/manifest"
import { decideStoreSurfaceAccess } from "../../src/api/store-surface/guard"
import defaultMiddlewares, {
  createCustomerAuthAccessGuardMiddleware,
  customerAuthAccessGuardMiddleware,
  isExactCustomerAuthVerificationRequest,
} from "../../src/api/middlewares"
import { serializeAuthSessionEnvelope } from "../../src/api/auth-surface/contracts"
import { env } from "../../src/config/env"
import { issueCustomerAuthAccessToken } from "../../src/modules/customer-auth/jwt"
import type { CustomerAuthAccessContext } from "../../src/modules/customer-auth/access-guard"
import type { CapabilityKeyring } from "../../src/modules/customer-auth/security/capabilities"

jest.setTimeout(180_000)

const BASE = new Date("2026-01-01T00:00:00.000Z")
const KEYRING: CapabilityKeyring = {
  active: {
    version: 7,
    secret: "customer-auth-http-capability-secret-32-bytes",
  },
  previous: [],
}
const JWT_SECRET = "customer-auth-http-jwt-secret-32-bytes-min"
const EMAIL = "customer@example.invalid"
const PASSWORD = "correct-password"
const IP = "198.51.100.27"

type ResponseState = {
  statusCode: number
  headers: Record<string, string>
  body: unknown
}

const commerce = {
  order: 0,
  payment: 0,
  stripe: 0,
  gelato: 0,
  cart: 0,
  checkout: 0,
  fulfillment: 0,
}

function responseRecorder(): {
  response: Record<string, unknown>
  state: ResponseState
} {
  const state: ResponseState = {
    statusCode: 200,
    headers: {},
    body: undefined,
  }
  const response = {
    headersSent: false,
    status(code: number) {
      state.statusCode = code
      return response
    },
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = String(value)
      return response
    },
    json(body: unknown) {
      state.body = body
      response.headersSent = true
      return response
    },
    end() {
      response.headersSent = true
      return response
    },
  }
  return { response, state }
}

function requestOf(input: {
  body?: unknown
  ip?: string
  customerAuth?: Partial<CustomerAuthAccessContext> & { authorized?: boolean }
  authorization?: string
} = {}): Record<string, unknown> {
  return {
    body: input.body ?? {},
    ip: input.ip ?? IP,
    headers: {
      ...(input.authorization
        ? { authorization: input.authorization }
        : {}),
    },
    correlationId: "auth-customer-http-correlation",
    customerAuth: input.customerAuth,
  }
}

class RecordingRateLimitStore implements AtomicRateLimitStore {
  readonly calls: DerivedRateLimitBucket[][] = []
  private readonly delegate: AtomicRateLimitStore

  constructor(
    delegate: AtomicRateLimitStore = new InMemoryAtomicRateLimitStore()
  ) {
    this.delegate = delegate
  }

  increment(
    buckets: readonly DerivedRateLimitBucket[]
  ): Promise<RateLimitBucketResult[]> {
    this.calls.push([...buckets])
    return this.delegate.increment(buckets)
  }
}

class OutageRateLimitStore implements AtomicRateLimitStore {
  calls = 0

  async increment(): Promise<RateLimitBucketResult[]> {
    this.calls += 1
    throw new Error("synthetic Redis outage")
  }
}

function sessionEnvelope(
  overrides: Partial<AuthSessionEnvelope> = {}
): AuthSessionEnvelope {
  return {
    accessToken: "synthetic-access-token",
    accessExpiresAt: new Date(BASE.getTime() + 10 * 60 * 1000),
    refreshToken: "synthetic-refresh-token",
    refreshExpiresAt: new Date(BASE.getTime() + 7 * 24 * 60 * 60 * 1000),
    originalAuthenticatedAt: BASE,
    absoluteExpiresAt: new Date(BASE.getTime() + 30 * 24 * 60 * 60 * 1000),
    lineageId: "lineage-initial",
    refreshCredentialId: "refresh-1",
    sid: "sid-1",
    generation: 0,
    authIdentityId: "identity-1",
    customerId: "customer-1",
    credentialVersion: 1,
    rotation: "initial",
    ...overrides,
  }
}

function completedRegistration(
  overrides: Partial<CustomerRegistrationResult> = {}
): CustomerRegistrationResult {
  return {
    status: "completed",
    registrationIntentId: "regint-1",
    authIdentityId: "identity-1",
    customerId: "customer-1",
    session: sessionEnvelope(),
    verification: {
      state: "pending",
      intentId: "verint-1",
      outboxId: "outbox-1",
    },
    ...overrides,
  }
}

function signupBody(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    email: EMAIL,
    password: PASSWORD,
    firstName: "Ada",
    lastName: "Lovelace",
    ...overrides,
  }
}

function loginBody(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    email: EMAIL,
    password: PASSWORD,
    ...overrides,
  }
}

function signupDependencies(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    keyring: KEYRING,
    jwtSecret: JWT_SECRET,
    rateLimitStore: new RecordingRateLimitStore(),
    now: () => BASE,
    registerCustomer: async () => completedRegistration(),
    bffAuthorized: true,
    ...overrides,
  }
}

function loginAdapters(input: {
  identity?: { id: string; app_metadata?: Record<string, unknown> } | null
  authenticate?: { id: string; app_metadata?: Record<string, unknown> } | null
  customer?: {
    id: string
    email?: string
    first_name?: string | null
    last_name?: string | null
  } | null
  credential?: {
    customerId: string
    credentialVersion: number
    emailVerifiedAt: Date | null
    operationStatus: string
  } | null
  session?: AuthSessionEnvelope
} = {}) {
  const identity =
    input.identity === undefined
      ? { id: "identity-1", app_metadata: { customer_id: "customer-1" } }
      : input.identity
  return {
    auth: {
      findIdentity: jest.fn(async () => identity),
      authenticate: jest.fn(
        async () =>
          input.authenticate === undefined ? identity : input.authenticate
      ),
    },
    customer: {
      find: jest.fn(
        async () =>
          input.customer === undefined
            ? {
                id: "customer-1",
                email: EMAIL,
                first_name: "Ada",
                last_name: "Lovelace",
              }
            : input.customer
      ),
    },
    credential: {
      load: jest.fn(
        async () =>
          input.credential === undefined
            ? {
                customerId: "customer-1",
                credentialVersion: 1,
                emailVerifiedAt: null,
                operationStatus: "stable",
              }
            : input.credential
      ),
    },
    session: {
      issue: jest.fn(
        async () => input.session ?? sessionEnvelope({ rotation: "initial" })
      ),
    },
  }
}

function loginDependencies(
  overrides: Record<string, unknown> = {},
  adapters = loginAdapters()
): Record<string, unknown> {
  return {
    keyring: KEYRING,
    jwtSecret: JWT_SECRET,
    rateLimitStore: new RecordingRateLimitStore(),
    now: () => BASE,
    timing: async () => 0,
    dummyPasswordWork: jest.fn(async () => undefined),
    login: loginCustomer,
    bffAuthorized: true,
    ...adapters,
    ...overrides,
  }
}

function accessContext(
  overrides: Partial<CustomerAuthAccessContext> = {}
): CustomerAuthAccessContext {
  return {
    lineageId: "lineage-1",
    sid: "sid-1",
    authIdentityId: "identity-1",
    customerId: "customer-1",
    credentialVersion: 1,
    originalAuthenticatedAt: BASE,
    absoluteExpiresAt: new Date(BASE.getTime() + 30 * 24 * 60 * 60 * 1000),
    claims: {} as CustomerAuthAccessContext["claims"],
    ...overrides,
  }
}

function accessToken(input: {
  now?: Date
  absoluteExpiresAt?: Date
  credentialVersion?: number
} = {}): string {
  return issueCustomerAuthAccessToken({
    secret: env.JWT_SECRET,
    authIdentityId: "identity-1",
    customerId: "customer-1",
    sid: "sid-1",
    credentialVersion: input.credentialVersion ?? 1,
    originalAuthenticatedAt: BASE,
    absoluteExpiresAt:
      input.absoluteExpiresAt ??
      new Date(BASE.getTime() + 30 * 24 * 60 * 60 * 1000),
    now: input.now ?? BASE,
  }).token
}

function guardRequest(
  connection: {
    raw: (
      sql: string,
      bindings?: unknown[]
    ) => Promise<{ rows?: Array<Record<string, unknown>> }>
  },
  token: string | undefined
): Record<string, unknown> {
  return {
    method: "GET",
    originalUrl: "/store/customers/me",
    url: "/store/customers/me",
    path: "/store/customers/me",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    scope: {
      resolve(key: unknown) {
        expect(key).toBe(ContainerRegistrationKeys.PG_CONNECTION)
        return connection
      },
    },
    correlationId: "guard-correlation",
  }
}

function assertOpaqueRateLimitKeys(
  store: RecordingRateLimitStore,
  secrets: string[]
): void {
  expect(store.calls.length).toBeGreaterThan(0)
  for (const batch of store.calls) {
    for (const bucket of batch) {
      expect(bucket.key).toMatch(/^auth-rate:v7:[a-z-]+:[a-f0-9]{64}$/)
      for (const secret of secrets) {
        expect(bucket.key).not.toContain(secret)
      }
    }
  }
}

function publicError(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)
    : {}
}

beforeEach(() => {
  commerce.order = 0
  commerce.payment = 0
  commerce.stripe = 0
  commerce.gelato = 0
  commerce.cart = 0
  commerce.checkout = 0
  commerce.fulfillment = 0
})

describe("Phase 14 signup HTTP", () => {
  it("rejects invalid signup schema before limiter or coordinator", async () => {
    const rateLimitStore = new RecordingRateLimitStore()
    const registerCustomer = jest.fn()
    const { response, state } = responseRecorder()

    await handleCustomerAuthSignup(
      requestOf({ body: { email: "not-an-email", password: "short" } }),
      response,
      signupDependencies({ rateLimitStore, registerCustomer })
    )

    expect(state.statusCode).toBe(400)
    expect(state.body).toMatchObject({ code: "INVALID_REQUEST" })
    expect(rateLimitStore.calls).toHaveLength(0)
    expect(registerCustomer).not.toHaveBeenCalled()
  })

  it("serializes AuthSessionEnvelope only after Customer, lineage and verification", async () => {
    const rateLimitStore = new RecordingRateLimitStore()
    const registerCustomer = jest.fn(async () => completedRegistration())
    const { response, state } = responseRecorder()

    await handleCustomerAuthSignup(
      requestOf({ body: signupBody() }),
      response,
      signupDependencies({ rateLimitStore, registerCustomer })
    )

    expect(registerCustomer).toHaveBeenCalledTimes(1)
    expect(state.statusCode).toBe(201)
    expect(state.body).toEqual({
      accessToken: "synthetic-access-token",
      accessExpiresAt: sessionEnvelope().accessExpiresAt.toISOString(),
      refreshToken: "synthetic-refresh-token",
      refreshExpiresAt: sessionEnvelope().refreshExpiresAt.toISOString(),
      originalAuthenticatedAt: BASE.toISOString(),
      absoluteExpiresAt: sessionEnvelope().absoluteExpiresAt.toISOString(),
      customer: {
        id: "customer-1",
        email: EMAIL,
        firstName: "Ada",
        lastName: "Lovelace",
      },
      verificationState: "pending",
    })
    expect(JSON.stringify(state.body)).not.toContain("identity-1")
    expect(JSON.stringify(state.body)).not.toContain("lineage-initial")
    expect(JSON.stringify(state.body)).not.toContain("regint-1")
    expect(JSON.stringify(state.body)).not.toContain("verint-1")
    expect(JSON.stringify(state.body)).not.toContain("outbox-1")
    assertOpaqueRateLimitKeys(rateLimitStore, [EMAIL, IP, PASSWORD])
  })

  it("does not serialize success when lineage or verification is missing", async () => {
    const registerCustomer = jest.fn(async () =>
      completedRegistration({
        verification: { state: "unknown", intentId: null, outboxId: null },
      })
    )
    const { response, state } = responseRecorder()

    await handleCustomerAuthSignup(
      requestOf({ body: signupBody() }),
      response,
      signupDependencies({ registerCustomer })
    )

    expect(state.statusCode).toBe(503)
    expect(state.body).toMatchObject({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
    })
    expect(state.headers["retry-after"]).toBe("60")
    expect(JSON.stringify(state.body)).not.toContain("synthetic-access-token")
  })

  it("allows signup IP hits 1..5 and blocks hit 6 with 429 before coordinator", async () => {
    const store = new InMemoryAtomicRateLimitStore()
    const registerCustomer = jest.fn(async () => completedRegistration())

    for (let hit = 1; hit <= 5; hit += 1) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthSignup(
        requestOf({
          body: signupBody({ email: `user${hit}@example.invalid` }),
        }),
        response,
        signupDependencies({ rateLimitStore: store, registerCustomer })
      )
      expect(state.statusCode).toBe(201)
    }

    const blocked = responseRecorder()
    await handleCustomerAuthSignup(
      requestOf({ body: signupBody({ email: "user6@example.invalid" }) }),
      blocked.response,
      signupDependencies({ rateLimitStore: store, registerCustomer })
    )
    expect(blocked.state.statusCode).toBe(429)
    expect(blocked.state.body).toMatchObject({ code: "RATE_LIMITED" })
    expect(registerCustomer).toHaveBeenCalledTimes(5)
  })

  it("allows signup email hits 1..3 and blocks hit 4 with 429 before coordinator", async () => {
    const store = new InMemoryAtomicRateLimitStore()
    const registerCustomer = jest.fn(async () => completedRegistration())

    for (let hit = 1; hit <= 3; hit += 1) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthSignup(
        requestOf({
          ip: `198.51.100.${hit}`,
          body: signupBody(),
        }),
        response,
        signupDependencies({ rateLimitStore: store, registerCustomer })
      )
      expect(state.statusCode).toBe(201)
    }

    const blocked = responseRecorder()
    await handleCustomerAuthSignup(
      requestOf({ ip: "198.51.100.9", body: signupBody() }),
      blocked.response,
      signupDependencies({ rateLimitStore: store, registerCustomer })
    )
    expect(blocked.state.statusCode).toBe(429)
    expect(blocked.state.body).toMatchObject({ code: "RATE_LIMITED" })
    expect(registerCustomer).toHaveBeenCalledTimes(3)
  })

  it("fails closed on Redis outage before coordinator write", async () => {
    const registerCustomer = jest.fn()
    const { response, state } = responseRecorder()

    await handleCustomerAuthSignup(
      requestOf({ body: signupBody() }),
      response,
      signupDependencies({
        rateLimitStore: new OutageRateLimitStore(),
        registerCustomer,
      })
    )

    expect(state.statusCode).toBe(503)
    expect(state.body).toMatchObject({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
    })
    expect(state.headers["retry-after"]).toBe("60")
    expect(registerCustomer).not.toHaveBeenCalled()
  })

  it("maps completed registration to AUTH_REQUEST_REJECTED without login or session recovery", async () => {
    const registerCustomer = jest.fn(async () => {
      throw new CustomerRegistrationError(
        "CUSTOMER_REGISTRATION_ALREADY_COMPLETED",
        "regint-completed"
      )
    })
    const { response, state } = responseRecorder()

    await handleCustomerAuthSignup(
      requestOf({ body: signupBody() }),
      response,
      signupDependencies({ registerCustomer })
    )

    expect(state.statusCode).toBe(409)
    expect(state.body).toMatchObject({ code: "AUTH_REQUEST_REJECTED" })
    expect(JSON.stringify(state.body)).not.toContain("regint-completed")
    expect(JSON.stringify(state.body)).not.toContain(
      "CUSTOMER_REGISTRATION_ALREADY_COMPLETED"
    )
    expect(JSON.stringify(state.body)).not.toContain("synthetic-access-token")
  })

  it("maps semantic and password mismatches to the same public 409", async () => {
    for (const code of [
      "CUSTOMER_REGISTRATION_SEMANTIC_MISMATCH",
      "CUSTOMER_REGISTRATION_PASSWORD_MISMATCH",
    ] as const) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthSignup(
        requestOf({ body: signupBody() }),
        response,
        signupDependencies({
          registerCustomer: async () => {
            throw new CustomerRegistrationError(code, "regint-hidden")
          },
        })
      )
      expect(state.statusCode).toBe(409)
      expect(publicError(state.body).code).toBe("AUTH_REQUEST_REJECTED")
      expect(JSON.stringify(state.body)).not.toContain(code)
      expect(JSON.stringify(state.body)).not.toContain("regint-hidden")
    }
  })

  it("does not leak tokens when BFF serialization is unauthorized", async () => {
    const { response, state } = responseRecorder()
    await handleCustomerAuthSignup(
      requestOf({ body: signupBody() }),
      response,
      signupDependencies({ bffAuthorized: false })
    )
    expect(state.statusCode).not.toBe(201)
    expect(JSON.stringify(state.body ?? {})).not.toContain(
      "synthetic-access-token"
    )
    expect(
      serializeAuthSessionEnvelope(
        { accessToken: "synthetic-access-token" },
        { bffAuthorized: false }
      )
    ).toBeNull()
  })
})

describe("Phase 14 login HTTP", () => {
  it("rejects invalid login schema before limiter or provider lookup", async () => {
    const adapters = loginAdapters({ identity: null })
    const rateLimitStore = new RecordingRateLimitStore()
    const { response, state } = responseRecorder()

    await handleCustomerAuthLogin(
      requestOf({ body: { email: "bad", password: "x" } }),
      response,
      loginDependencies({ rateLimitStore }, adapters)
    )

    expect(state.statusCode).toBe(400)
    expect(state.body).toMatchObject({ code: "INVALID_REQUEST" })
    expect(rateLimitStore.calls).toHaveLength(0)
    expect(adapters.auth.findIdentity).not.toHaveBeenCalled()
  })

  it("uses dummy password work for a missing account and returns INVALID_CREDENTIALS", async () => {
    const adapters = loginAdapters({ identity: null })
    const dummyPasswordWork = jest.fn(async () => undefined)
    const timing = jest.fn(async () => 350)
    const rateLimitStore = new RecordingRateLimitStore()
    const { response, state } = responseRecorder()

    await handleCustomerAuthLogin(
      requestOf({ body: loginBody() }),
      response,
      loginDependencies({ dummyPasswordWork, timing, rateLimitStore }, adapters)
    )

    expect(state.statusCode).toBe(401)
    expect(state.body).toMatchObject({ code: "INVALID_CREDENTIALS" })
    expect(adapters.auth.findIdentity).toHaveBeenCalledTimes(1)
    expect(dummyPasswordWork).toHaveBeenCalledTimes(1)
    expect(adapters.auth.authenticate).not.toHaveBeenCalled()
    expect(adapters.session.issue).not.toHaveBeenCalled()
    expect(timing).toHaveBeenCalled()
    assertOpaqueRateLimitKeys(rateLimitStore, [EMAIL, IP, PASSWORD])
  })

  it("uses provider authentication for a wrong password and does not create lineage", async () => {
    const adapters = loginAdapters({ authenticate: null })
    const dummyPasswordWork = jest.fn(async () => undefined)
    const timing = jest.fn(async () => 350)
    const { response, state } = responseRecorder()

    await handleCustomerAuthLogin(
      requestOf({ body: loginBody() }),
      response,
      loginDependencies({ dummyPasswordWork, timing }, adapters)
    )

    expect(state.statusCode).toBe(401)
    expect(state.body).toMatchObject({ code: "INVALID_CREDENTIALS" })
    expect(adapters.auth.authenticate).toHaveBeenCalledTimes(1)
    expect(dummyPasswordWork).not.toHaveBeenCalled()
    expect(adapters.session.issue).not.toHaveBeenCalled()
    expect(timing).toHaveBeenCalled()
  })

  it("returns EMAIL_VERIFICATION_REQUIRED for unverified valid credentials without a new lineage", async () => {
    const adapters = loginAdapters({
      credential: {
        customerId: "customer-1",
        credentialVersion: 1,
        emailVerifiedAt: null,
        operationStatus: "stable",
      },
    })
    const { response, state } = responseRecorder()

    await handleCustomerAuthLogin(
      requestOf({ body: loginBody() }),
      response,
      loginDependencies({}, adapters)
    )

    expect(state.statusCode).toBe(403)
    expect(state.body).toMatchObject({
      code: "EMAIL_VERIFICATION_REQUIRED",
    })
    expect(adapters.session.issue).not.toHaveBeenCalled()
    expect(JSON.stringify(state.body)).not.toContain("synthetic-access-token")
    expect(JSON.stringify(state.body)).not.toContain("identity-1")
  })

  it("issues a new lineage only for a verified login", async () => {
    const adapters = loginAdapters({
      credential: {
        customerId: "customer-1",
        credentialVersion: 1,
        emailVerifiedAt: BASE,
        operationStatus: "stable",
      },
    })
    const { response, state } = responseRecorder()

    await handleCustomerAuthLogin(
      requestOf({ body: loginBody() }),
      response,
      loginDependencies({}, adapters)
    )

    expect(adapters.session.issue).toHaveBeenCalledTimes(1)
    expect(state.statusCode).toBe(200)
    expect(state.body).toMatchObject({
      accessToken: "synthetic-access-token",
      refreshToken: "synthetic-refresh-token",
      verificationState: "verified",
      customer: {
        id: "customer-1",
        email: EMAIL,
        firstName: "Ada",
        lastName: "Lovelace",
      },
    })
    expect(JSON.stringify(state.body)).not.toContain("lineage-initial")
    expect(JSON.stringify(state.body)).not.toContain("identity-1")
  })

  it("treats identity without Customer as INVALID_CREDENTIALS, not verification required", async () => {
    const adapters = loginAdapters({ customer: null })
    const { response, state } = responseRecorder()

    await handleCustomerAuthLogin(
      requestOf({ body: loginBody() }),
      response,
      loginDependencies({}, adapters)
    )

    expect(state.statusCode).toBe(401)
    expect(state.body).toMatchObject({ code: "INVALID_CREDENTIALS" })
    expect(adapters.session.issue).not.toHaveBeenCalled()
  })

  it("applies login 10/(IP,email)/15m before provider lookup", async () => {
    const store = new InMemoryAtomicRateLimitStore()
    const adapters = loginAdapters({ identity: null })

    for (let hit = 1; hit <= 10; hit += 1) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthLogin(
        requestOf({ body: loginBody() }),
        response,
        loginDependencies({ rateLimitStore: store }, adapters)
      )
      expect(state.statusCode).toBe(401)
    }

    const blocked = responseRecorder()
    await handleCustomerAuthLogin(
      requestOf({ body: loginBody() }),
      blocked.response,
      loginDependencies({ rateLimitStore: store }, adapters)
    )
    expect(blocked.state.statusCode).toBe(429)
    expect(blocked.state.body).toMatchObject({ code: "RATE_LIMITED" })
    expect(adapters.auth.findIdentity).toHaveBeenCalledTimes(10)
  })

  it("applies login 30/IP/15m before provider lookup", async () => {
    const store = new InMemoryAtomicRateLimitStore()
    const adapters = loginAdapters({ identity: null })

    for (let hit = 1; hit <= 30; hit += 1) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthLogin(
        requestOf({
          body: loginBody({ email: `user${hit}@example.invalid` }),
        }),
        response,
        loginDependencies({ rateLimitStore: store }, adapters)
      )
      expect(state.statusCode).toBe(401)
    }

    const blocked = responseRecorder()
    await handleCustomerAuthLogin(
      requestOf({
        body: loginBody({ email: "user31@example.invalid" }),
      }),
      blocked.response,
      loginDependencies({ rateLimitStore: store }, adapters)
    )
    expect(blocked.state.statusCode).toBe(429)
    expect(adapters.auth.findIdentity).toHaveBeenCalledTimes(30)
  })

  it("fails closed on Redis outage before provider lookup or lineage", async () => {
    const adapters = loginAdapters()
    const { response, state } = responseRecorder()

    await handleCustomerAuthLogin(
      requestOf({ body: loginBody() }),
      response,
      loginDependencies(
        { rateLimitStore: new OutageRateLimitStore() },
        adapters
      )
    )

    expect(state.statusCode).toBe(503)
    expect(state.body).toMatchObject({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
    })
    expect(state.headers["retry-after"]).toBe("60")
    expect(adapters.auth.findIdentity).not.toHaveBeenCalled()
    expect(adapters.auth.authenticate).not.toHaveBeenCalled()
    expect(adapters.session.issue).not.toHaveBeenCalled()
  })
})

describe("Phase 14 GET /store/customers/me", () => {
  it("returns the allowlisted current-state DTO after access context", async () => {
    const resolveCustomer = jest.fn(async () => ({
      id: "customer-1",
      email: EMAIL,
      firstName: "Ada",
      lastName: "Lovelace",
      metadata: { providerIdentityId: "forbidden" },
      password_hash: "forbidden",
    }))
    const resolveVerificationState = jest.fn(async () => "pending" as const)
    const { response, state } = responseRecorder()

    await handleCustomerAuthCurrentCustomer(
      requestOf({
        customerAuth: { ...accessContext(), authorized: true },
      }),
      response,
      { resolveCustomer, resolveVerificationState }
    )

    expect(state.statusCode).toBe(200)
    expect(state.body).toEqual({
      customer: {
        id: "customer-1",
        email: EMAIL,
        firstName: "Ada",
        lastName: "Lovelace",
      },
      auth: {
        verificationState: "pending",
        originalAuthenticatedAt: BASE.toISOString(),
        absoluteExpiresAt: accessContext().absoluteExpiresAt.toISOString(),
      },
    })
    expect(JSON.stringify(state.body)).not.toContain("forbidden")
    expect(JSON.stringify(state.body)).not.toContain("identity-1")
    expect(JSON.stringify(state.body)).not.toContain("lineage-1")
    expect(JSON.stringify(state.body)).not.toContain("sid-1")
  })

  it("denies missing access context before customer lookup", async () => {
    const resolveCustomer = jest.fn()
    const { response, state } = responseRecorder()

    await handleCustomerAuthCurrentCustomer(requestOf(), response, {
      resolveCustomer,
      resolveVerificationState: async () => "pending",
    })

    expect(state.statusCode).toBe(401)
    expect(state.body).toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
    expect(resolveCustomer).not.toHaveBeenCalled()
  })

  it("enforces the PostgreSQL access guard before the me handler", async () => {
    const row = {
      lineage_id: "lineage-1",
      sid: "sid-1",
      lineage_auth_identity_id: "identity-1",
      lineage_customer_id: "customer-1",
      credential_version_snapshot: 1,
      lineage_status: "active",
      credential_auth_identity_id: "identity-1",
      credential_customer_id: "customer-1",
      credential_version: 1,
      operation_status: "stable",
      original_authenticated_at: BASE,
      absolute_expires_at: new Date(BASE.getTime() + 30 * 24 * 60 * 60 * 1000),
    }
    const cases: Array<{
      token?: string
      connection: {
        raw: (
          sql: string,
          bindings?: unknown[]
        ) => Promise<{ rows?: Array<Record<string, unknown>> }>
      }
      expected: number
    }> = [
      {
        connection: { raw: async () => ({ rows: [row] }) },
        expected: 401,
      },
      {
        token: accessToken(),
        connection: {
          raw: async () => ({
            rows: [{ ...row, lineage_status: "revoked" }],
          }),
        },
        expected: 401,
      },
      {
        token: accessToken(),
        connection: {
          raw: async () => ({
            rows: [{ ...row, credential_version: 2 }],
          }),
        },
        expected: 401,
      },
      {
        token: accessToken(),
        connection: {
          raw: async () => ({
            rows: [
              {
                ...row,
                absolute_expires_at: new Date(BASE.getTime() - 1),
              },
            ],
          }),
        },
        expected: 401,
      },
      {
        token: accessToken(),
        connection: {
          raw: async () => {
            throw new Error("synthetic PostgreSQL outage")
          },
        },
        expected: 503,
      },
    ]

    for (const testCase of cases) {
      const request = guardRequest(testCase.connection, testCase.token)
      const { response, state } = responseRecorder()
      const handler = jest.fn(async () => undefined)
      const guard = createCustomerAuthAccessGuardMiddleware({
        now: () => BASE,
      })
      await guard(request, response, handler)
      expect(state.statusCode).toBe(testCase.expected)
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it("fails closed when customer lookup is unavailable", async () => {
    const { response, state } = responseRecorder()
    await handleCustomerAuthCurrentCustomer(
      requestOf({
        customerAuth: { ...accessContext(), authorized: true },
      }),
      response,
      {
        resolveCustomer: async () => {
          throw new Error("synthetic customer outage")
        },
        resolveVerificationState: async () => "pending",
      }
    )
    expect(state.statusCode).toBe(503)
    expect(state.body).toMatchObject({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
    })
  })
})

describe("Phase 14 auth-customer deny matrix and commerce negatives", () => {
  it("keeps raw Customer, native session, callback, MFA and aliases denied", () => {
    expect(validateStoreSurfaceManifest()).toEqual([])
    expect(
      decideStoreSurfaceAccess("POST", "/store/customers").action
    ).toBe("deny")
    expect(
      decideStoreSurfaceAccess("POST", "/store/customers/me").action
    ).toBe("deny")
    expect(
      AUTH_SURFACE_NATIVE_OPERATIONS.every(
        (entry) => entry.runtimePolicy === "DENY"
      )
    ).toBe(true)

    for (const [method, path] of [
      ["POST", "/auth/session"],
      ["DELETE", "/auth/session"],
      ["GET", "/auth/customer/emailpass/callback"],
      ["POST", "/auth/customer/emailpass/callback"],
      ["POST", "/auth/mfa/challenges/synthetic-id/verify"],
      ["POST", "/auth/customer/emailpass/"],
      ["POST", "/Auth/customer/emailpass"],
      ["GET", "/auth/customer/emailpass"],
      ["POST", "/auth/customer/emailpass/register/"],
      ["GET", "/auth/customer/emailpass/register"],
      ["POST", "/auth/customer/unknown"],
    ] as const) {
      expect(decideAuthSurfaceAccess(method, path).action).toBe("deny")
    }

    for (const [method, path] of [
      ["GET", "/store/customers/me/"],
      ["POST", "/store/customers/Me"],
      ["GET", "/store/customers/unknown"],
    ] as const) {
      expect(decideStoreSurfaceAccess(method, path).action).toBe("deny")
    }
  })

  it("elevates exactly signup, login and GET me", () => {
    const enabledLocal = AUTH_SURFACE_LOCAL_OPERATIONS.filter(
      (entry) => entry.runtimePolicy === "PHASE14_ENABLED"
    ).map((entry) => `${entry.method} ${entry.pathTemplate}`)

    expect(enabledLocal).toEqual([
      "POST /auth/customer/emailpass/register",
      "POST /auth/customer/emailpass",
      "POST /auth/token/refresh",
      "POST /auth/customer/emailpass/revoke-current-lineage",
    ])
    expect(
      decideAuthSurfaceAccess(
        "POST",
        "/auth/customer/emailpass/register"
      ).action
    ).toBe("allow")
    expect(
      decideAuthSurfaceAccess("POST", "/auth/customer/emailpass").action
    ).toBe("allow")
    expect(decideStoreSurfaceAccess("GET", "/store/customers/me").action).toBe(
      "allow"
    )
    expect(validateStoreSurfaceManifest()).toEqual([])
    expect(
      STORE_SURFACE_MANIFEST.filter(
        (entry) => entry.runtime_policy === "M1_ENABLED"
      ).map((entry) => storeSurfaceOperationKey(entry.method, entry.pathTemplate))
    ).toEqual([...STORE_SURFACE_PHASE14_ENABLED_OPERATIONS])
  })

  it("binds GET /store/customers/me to the access guard and auth error envelope", () => {
    const routes = defaultMiddlewares.routes ?? []
    const meGuard = routes.find(
      (route) => String(route.matcher) === "/store/customers/me"
    )
    expect(meGuard).toBeDefined()
    expect(meGuard?.middlewares).toContain(customerAuthAccessGuardMiddleware)
    expect(
      isExactCustomerAuthVerificationRequest({
        method: "GET",
        originalUrl: "/store/customers/me",
        url: "/store/customers/me",
        path: "/store/customers/me",
        baseUrl: "",
      } as never)
    ).toBe(true)
  })

  it("creates zero Order, Payment, Stripe, Gelato, cart, checkout and fulfillment side effects", () => {
    expect(commerce).toEqual({
      order: 0,
      payment: 0,
      stripe: 0,
      gelato: 0,
      cart: 0,
      checkout: 0,
      fulfillment: 0,
    })
  })
})
