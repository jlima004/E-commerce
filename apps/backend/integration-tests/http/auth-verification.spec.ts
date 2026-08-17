import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  AuthVerificationError,
  type AuthVerificationDatabase,
} from "../../src/modules/customer-auth/verification"
import {
  InMemoryAtomicRateLimitStore,
  type AtomicRateLimitStore,
  type AuthRateLimitKeyring,
  type DerivedRateLimitBucket,
  type RateLimitBucketResult,
} from "../../src/modules/customer-auth/security/rate-limit"
import {
  handleCustomerAuthVerificationRequest,
  handleCustomerAuthVerificationStatus,
  runCustomerAuthVerificationResendRoute,
  type CustomerAuthVerificationDependencies,
} from "../../src/api/store/customers/me/verify/route"
import { handleCustomerAuthVerificationResend } from "../../src/api/store/customers/verify/resend/route"
import { handleCustomerAuthVerificationConfirm } from "../../src/api/store/customers/verify/route"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  storeSurfaceOperationKey,
  validateStoreSurfaceManifest,
} from "../../src/api/store-surface/manifest"
import { decideStoreSurfaceAccess } from "../../src/api/store-surface/guard"
import { decideAuthSurfaceAccess } from "../../src/api/auth-surface/guard"
import { createCustomerAuthAccessGuardMiddleware } from "../../src/api/middlewares"
import { env } from "../../src/config/env"
import { issueCustomerAuthAccessToken } from "../../src/modules/customer-auth/jwt"
import { applyAuthTimingEnvelope } from "../../src/modules/customer-auth/security/timing"
import type { CustomerAuthAccessContext } from "../../src/modules/customer-auth/access-guard"

jest.setTimeout(180_000)

const BASE = new Date("2026-01-01T00:00:00.000Z")
const KEYRING: AuthRateLimitKeyring = {
  active: {
    version: 7,
    secret: "verification-http-rate-secret-32-bytes-minimum",
  },
}
const CAPABILITY_KEYRING = {
  active: {
    version: 1,
    secret: "verification-http-capability-secret-32-bytes-minimum",
  },
  previous: [],
} as const
const EMAIL = "customer@example.invalid"

type ResponseState = {
  statusCode: number
  headers: Record<string, string>
  body: unknown
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
  customerAuth?: Partial<CustomerAuthAccessContext>
  authorization?: string
} = {}): Record<string, unknown> {
  return {
    body: input.body,
    ip: input.ip ?? "198.51.100.27",
    headers: {
      ...(input.authorization
        ? { authorization: input.authorization }
        : {}),
    },
    correlationId: "verification-http-correlation",
    customerAuth: input.customerAuth,
  }
}

function fakeDatabase(): AuthVerificationDatabase {
  return {
    async transaction(callback) {
      return callback({
        async raw() {
          return { rows: [] }
        },
      })
    },
  }
}

class RecordingRateLimitStore implements AtomicRateLimitStore {
  readonly calls: DerivedRateLimitBucket[][] = []
  private readonly delegate: AtomicRateLimitStore

  constructor(delegate: AtomicRateLimitStore = new InMemoryAtomicRateLimitStore()) {
    this.delegate = delegate
  }

  increment(
    buckets: readonly DerivedRateLimitBucket[]
  ): Promise<RateLimitBucketResult[]> {
    this.calls.push([...buckets])
    return this.delegate.increment(buckets)
  }
}

class BlockedRateLimitStore implements AtomicRateLimitStore {
  calls = 0

  async increment(
    buckets: readonly DerivedRateLimitBucket[]
  ): Promise<RateLimitBucketResult[]> {
    this.calls += 1
    return buckets.map((bucket) => ({
      ...bucket,
      count: bucket.limit + 1,
      retryAfterSeconds: 60,
    }))
  }
}

class OutageRateLimitStore implements AtomicRateLimitStore {
  calls = 0

  async increment(): Promise<RateLimitBucketResult[]> {
    this.calls += 1
    throw new Error("synthetic Redis outage")
  }
}

function accessContext(
  overrides: Partial<CustomerAuthAccessContext> = {}
): CustomerAuthAccessContext {
  return {
    authorized: true,
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

function dependencies(
  overrides: Partial<CustomerAuthVerificationDependencies> = {}
): CustomerAuthVerificationDependencies {
  return {
    database: fakeDatabase(),
    keyring: CAPABILITY_KEYRING,
    rateLimitStore: new RecordingRateLimitStore(),
    now: () => BASE,
    timing: async () => 0,
    resolveEmailByIdentityId: async () => EMAIL,
    resolveIdentityByEmail: async () => ({
      authIdentityId: "identity-1",
      recipientIdentityId: "identity-1",
      normalizedEmail: EMAIL,
    }),
    requestVerification: async () => ({
      accepted: true,
      created: true,
      state: "pending",
      intent: null,
      outbox: null,
    }),
    resendVerification: async () => ({
      accepted: true,
      created: true,
      state: "pending",
      intent: null,
      outbox: null,
    }),
    resolveVerificationIntentId: async () => "intent-1",
    confirmVerification: async () => ({
      success: true,
      state: "verified",
      intentId: "intent-1",
      generation: 1,
    }),
    getVerificationStatus: async () => ({ state: "pending" }),
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
    method: "POST",
    originalUrl: "/store/customers/me/verify",
    url: "/store/customers/me/verify",
    path: "/store/customers/me/verify",
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

describe("Phase 14 verification HTTP contracts", () => {
  it("denies authenticated request without guard context before limiter or service", async () => {
    const rateLimitStore = new RecordingRateLimitStore()
    const requestVerification = jest.fn()
    const { response, state } = responseRecorder()

    await handleCustomerAuthVerificationRequest(
      requestOf(),
      response,
      dependencies({ rateLimitStore, requestVerification })
    )

    expect(state.statusCode).toBe(401)
    expect(state.body).toMatchObject({ code: "AUTHENTICATION_REQUIRED" })
    expect(rateLimitStore.calls).toHaveLength(0)
    expect(requestVerification).not.toHaveBeenCalled()
  })

  it("allows authenticated request hits 1..3 per lineage and blocks hit 4", async () => {
    const rateLimitStore = new RecordingRateLimitStore()
    const requestVerification = jest.fn(async () => ({
      accepted: true as const,
      created: true,
      state: "pending" as const,
      intent: null,
      outbox: null,
    }))
    const deps = dependencies({ rateLimitStore, requestVerification })

    for (let index = 0; index < 4; index += 1) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthVerificationRequest(
        requestOf({
          ip: `198.51.100.${index + 1}`,
          customerAuth: accessContext({ lineageId: "lineage-threshold" }),
        }),
        response,
        deps
      )

      expect(state.statusCode).toBe(index < 3 ? 202 : 429)
    }

    expect(requestVerification).toHaveBeenCalledTimes(3)
    expect(rateLimitStore.calls[0]?.[0]?.key).not.toContain("lineage-threshold")
    expect(rateLimitStore.calls[0]?.[0]?.key).not.toContain("198.51.100.1")
  })

  it("allows ten lineages per IP and blocks the eleventh before service", async () => {
    const rateLimitStore = new RecordingRateLimitStore()
    const requestVerification = jest.fn(async () => ({
      accepted: true as const,
      created: true,
      state: "pending" as const,
      intent: null,
      outbox: null,
    }))
    const deps = dependencies({ rateLimitStore, requestVerification })

    for (let index = 0; index < 11; index += 1) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthVerificationRequest(
        requestOf({
          customerAuth: accessContext({ lineageId: `lineage-${index}` }),
        }),
        response,
        deps
      )

      expect(state.statusCode).toBe(index < 10 ? 202 : 429)
    }

    expect(requestVerification).toHaveBeenCalledTimes(10)
  })

  it("fails authenticated request closed on Redis outage with Retry-After 60", async () => {
    const rateLimitStore = new OutageRateLimitStore()
    const requestVerification = jest.fn()
    const { response, state } = responseRecorder()

    await handleCustomerAuthVerificationRequest(
      requestOf({ customerAuth: accessContext() }),
      response,
      dependencies({ rateLimitStore, requestVerification })
    )

    expect(state.statusCode).toBe(503)
    expect(state.headers["retry-after"]).toBe("60")
    expect(state.body).toMatchObject({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
    })
    expect(requestVerification).not.toHaveBeenCalled()
  })

  it("returns only the sanitized status DTO", async () => {
    const { response, state } = responseRecorder()

    await handleCustomerAuthVerificationStatus(
      requestOf({ customerAuth: accessContext() }),
      response,
      dependencies({
        getVerificationStatus: async () =>
          ({
            state: "verified",
            hash: "must-not-leak",
            intentId: "must-not-leak",
            createdAt: BASE,
          }) as never,
      })
    )

    expect(state.statusCode).toBe(200)
    expect(state.body).toEqual({ state: "verified" })
  })

  it("enforces the PostgreSQL access guard before the authenticated handler", async () => {
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
      name: string
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
        name: "missing bearer",
        connection: { raw: async () => ({ rows: [row] }) },
        expected: 401,
      },
      {
        name: "revoked lineage",
        token: accessToken(),
        connection: {
          raw: async () => ({
            rows: [{ ...row, lineage_status: "revoked" }],
          }),
        },
        expected: 401,
      },
      {
        name: "stale credential version",
        token: accessToken(),
        connection: {
          raw: async () => ({
            rows: [{ ...row, credential_version: 2 }],
          }),
        },
        expected: 401,
      },
      {
        name: "expired absolute deadline",
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
        name: "database outage",
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
      const guard = createCustomerAuthAccessGuardMiddleware({ now: () => BASE })

      await guard(request, response, handler)

      expect(state.statusCode).toBe(testCase.expected)
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it("keeps public resend uniform for unknown, verified, accepted, limited, and provider failure", async () => {
    const timing = jest.fn(async () => 350)
    const outcomes: Array<{
      name: string
      dependencies: CustomerAuthVerificationDependencies
    }> = [
      {
        name: "unknown",
        dependencies: dependencies({
          timing,
          resolveIdentityByEmail: async () => null,
        }),
      },
      {
        name: "verified",
        dependencies: dependencies({
          timing,
          resendVerification: async () => ({
            accepted: true,
            created: false,
            state: "verified",
            intent: null,
            outbox: null,
          }),
        }),
      },
      {
        name: "accepted",
        dependencies: dependencies({ timing }),
      },
      {
        name: "limited",
        dependencies: dependencies({
          timing,
          rateLimitStore: new BlockedRateLimitStore(),
        }),
      },
      {
        name: "provider failure",
        dependencies: dependencies({
          timing,
          resendVerification: async () => {
            throw new Error("synthetic provider failure")
          },
        }),
      },
    ]

    const responses: Array<{
      name: string
      statusCode: number
      body: unknown
      headers: Record<string, string>
    }> = []

    for (const outcome of outcomes) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthVerificationResend(
        requestOf({
          body: { email: "  Customer@Example.Invalid  " },
        }),
        response,
        outcome.dependencies
      )
      responses.push({
        name: outcome.name,
        statusCode: state.statusCode,
        body: state.body,
        headers: state.headers,
      })
    }

    expect(new Set(responses.map((entry) => entry.statusCode))).toEqual(
      new Set([202])
    )
    expect(new Set(responses.map((entry) => JSON.stringify(entry.body)))).toEqual(
      new Set([JSON.stringify({ code: "REQUEST_ACCEPTED" })])
    )
    expect(responses.every((entry) => !("retry-after" in entry.headers))).toBe(true)
    expect(timing).toHaveBeenCalledTimes(outcomes.length)
  })

  it("applies the resend timing envelope when runtime acquisition fails before the handler", async () => {
    const events: string[] = []
    const openRuntime = jest.fn(async () => {
      events.push("runtime")
      throw new Error("synthetic runtime acquisition failure")
    })
    const verificationLookup = jest.fn()
    const verificationWrite = jest.fn()
    const providerCall = jest.fn()
    const sessionCreation = jest.fn()
    const jwtIssue = jest.fn()
    const refreshCreation = jest.fn()
    const lineageCreation = jest.fn()
    const orderMutation = jest.fn()
    const paymentMutation = jest.fn()
    const cartMutation = jest.fn()
    const checkoutMutation = jest.fn()
    const handleResend = jest.fn(async () => {
      verificationLookup()
      verificationWrite()
      providerCall()
      sessionCreation()
      jwtIssue()
      refreshCreation()
      lineageCreation()
      orderMutation()
      paymentMutation()
      cartMutation()
      checkoutMutation()
    })
    const elapsed: number[] = []
    const timing = jest.fn(async (startedAtMs: number) => {
      events.push("timing")
      const measured = await applyAuthTimingEnvelope({
        startedAtMs,
        now: () => startedAtMs + 350,
        randomInt: () => 0,
        sleep: async () => undefined,
      })
      elapsed.push(measured)
      return measured
    })
    const { response, state } = responseRecorder()

    await runCustomerAuthVerificationResendRoute(
      requestOf({
        body: { email: ` ${EMAIL} ` },
      }) as never,
      response as never,
      {
        openRuntime,
        timing,
        handleResend,
      }
    )

    expect(state.statusCode).toBe(202)
    expect(state.body).toEqual({ code: "REQUEST_ACCEPTED" })
    expect(openRuntime).toHaveBeenCalledTimes(1)
    expect(openRuntime).toHaveBeenCalledWith(expect.anything(), true)
    expect(handleResend).not.toHaveBeenCalled()
    expect(timing).toHaveBeenCalledTimes(1)
    expect(timing.mock.calls[0]?.[0]).toEqual(expect.any(Number))
    expect(elapsed).toEqual([350])
    expect(events).toEqual(["runtime", "timing"])

    for (const sideEffect of [
      verificationLookup,
      verificationWrite,
      providerCall,
      sessionCreation,
      jwtIssue,
      refreshCreation,
      lineageCreation,
      orderMutation,
      paymentMutation,
      cartMutation,
      checkoutMutation,
    ]) {
      expect(sideEffect).not.toHaveBeenCalled()
    }
  })

  it("normalizes resend input before domain resolution and rejects invalid schema", async () => {
    const resolveIdentityByEmail = jest.fn(async () => null)
    const deps = dependencies({ resolveIdentityByEmail })
    const accepted = responseRecorder()

    await handleCustomerAuthVerificationResend(
      requestOf({ body: { email: " Customer@Example.Invalid " } }),
      accepted.response,
      deps
    )
    expect(accepted.state.statusCode).toBe(202)
    expect(resolveIdentityByEmail).toHaveBeenCalledWith(
      "customer@example.invalid"
    )

    const invalid = responseRecorder()
    await handleCustomerAuthVerificationResend(
      requestOf({ body: { email: "not-an-email", extra: true } }),
      invalid.response,
      deps
    )
    expect(invalid.state.statusCode).toBe(400)
    expect(invalid.state.body).toMatchObject({ code: "INVALID_REQUEST" })
  })

  it("keeps public confirm no-session and uniform for valid, expired, used, superseded, unknown, and malformed capability", async () => {
    const validToken = "v".repeat(43)
    const states = new Map([
      ["expired".repeat(8), "expired"],
      ["used".repeat(11), "used"],
      ["superseded".repeat(5), "superseded"],
    ])
    const confirmVerification = jest.fn(async (
      _database: AuthVerificationDatabase,
      input: { capability: string }
    ) => {
      const state = states.get(input.capability)
      if (state) {
        throw new AuthVerificationError(
          "AUTH_VERIFICATION_INVALID_OR_EXPIRED"
        )
      }
      return {
        success: true as const,
        state: "verified" as const,
        intentId: "intent-internal",
        generation: 7,
      }
    })
    const resolveVerificationIntentId = jest.fn(
      async (
        _database: AuthVerificationDatabase,
        capability: string
      ): Promise<string | null> => {
        if (
          capability === validToken ||
          states.has(capability)
        ) {
          return "intent-internal"
        }
        return null
      }
    )
    const cases: Array<[string, unknown, number, string]> = [
      ["valid", validToken, 200, "EMAIL_VERIFIED"],
      ["expired", "expired".repeat(8), 400, "VERIFICATION_INVALID_OR_EXPIRED"],
      ["used", "used".repeat(11), 400, "VERIFICATION_INVALID_OR_EXPIRED"],
      [
        "superseded",
        "superseded".repeat(5),
        400,
        "VERIFICATION_INVALID_OR_EXPIRED",
      ],
      ["unknown", "u".repeat(43), 400, "VERIFICATION_INVALID_OR_EXPIRED"],
      ["missing", undefined, 400, "VERIFICATION_INVALID_OR_EXPIRED"],
      ["malformed", "not a capability", 400, "VERIFICATION_INVALID_OR_EXPIRED"],
    ]

    for (const [name, token, expectedStatus, expectedCode] of cases) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthVerificationConfirm(
        requestOf({ body: token === undefined ? {} : { token } }),
        response,
        dependencies({
          resolveVerificationIntentId,
          confirmVerification,
        })
      )

      expect(state.statusCode).toBe(expectedStatus)
      expect(state.body).toEqual(
        expectedStatus === 200
          ? { code: "EMAIL_VERIFIED", state: "verified" }
          : expect.objectContaining({ code: expectedCode })
      )
      if (typeof token === "string") {
        expect(JSON.stringify(state.body)).not.toContain(token)
      }
      if (name === "valid") {
        expect(state.body).not.toHaveProperty("intentId")
        expect(state.body).not.toHaveProperty("generation")
      }
    }

    expect(confirmVerification).toHaveBeenCalledTimes(4)
  })

  it("blocks confirm on pre-token limiter hit or Redis outage before lookup/write", async () => {
    const validToken = "v".repeat(43)
    const resolveVerificationIntentId = jest.fn(async () => "intent-1")
    const confirmVerification = jest.fn()
    const limited = responseRecorder()
    await handleCustomerAuthVerificationConfirm(
      requestOf({ body: { token: validToken } }),
      limited.response,
      dependencies({
        rateLimitStore: new BlockedRateLimitStore(),
        resolveVerificationIntentId,
        confirmVerification,
      })
    )
    expect(limited.state.statusCode).toBe(429)
    expect(resolveVerificationIntentId).not.toHaveBeenCalled()
    expect(confirmVerification).not.toHaveBeenCalled()

    const outage = responseRecorder()
    await handleCustomerAuthVerificationConfirm(
      requestOf({ body: { token: validToken } }),
      outage.response,
      dependencies({
        rateLimitStore: new OutageRateLimitStore(),
        resolveVerificationIntentId,
        confirmVerification,
      })
    )
    expect(outage.state.statusCode).toBe(503)
    expect(outage.state.headers["retry-after"]).toBe("60")
    expect(resolveVerificationIntentId).not.toHaveBeenCalled()
    expect(confirmVerification).not.toHaveBeenCalled()
  })

  it("elevates GET /store/customers/me plus the four Store verification paths and keeps the deny matrix closed", () => {
    expect(validateStoreSurfaceManifest()).toEqual([])

    const enabled = STORE_SURFACE_MANIFEST.filter(
      (entry) => entry.runtime_policy === "M1_ENABLED"
    ).map((entry) => storeSurfaceOperationKey(entry.method, entry.pathTemplate))

    expect(enabled).toEqual([
      "GET /store/customers/me",
      "POST /store/customers/me/verify",
      "POST /store/customers/verify/resend",
      "POST /store/customers/verify",
      "GET /store/customers/me/verify/status",
    ])
    expect(enabled).toEqual([...STORE_SURFACE_PHASE14_ENABLED_OPERATIONS])

    for (const [method, path] of [
      ["GET", "/store/customers/me"],
      ["POST", "/store/customers/me/verify"],
      ["POST", "/store/customers/verify/resend"],
      ["POST", "/store/customers/verify"],
      ["GET", "/store/customers/me/verify/status"],
    ] as const) {
      expect(decideStoreSurfaceAccess(method, path).action).toBe("allow")
    }

    for (const [method, path] of [
      ["POST", "/store/customers"],
      ["POST", "/store/customers/me"],
      ["POST", "/store/customers/me/verify/"],
      ["POST", "/store/customers/verify/"],
      ["POST", "/store/customers/Verify"],
      ["POST", "/store/customers/unknown"],
      ["POST", "/store/customers/verify/resend/alias"],
    ] as const) {
      expect(decideStoreSurfaceAccess(method, path).action).toBe("deny")
    }

    for (const [method, path] of [
      ["POST", "/auth/verification/request"],
      ["POST", "/auth/verification/confirm"],
      ["POST", "/auth/verification/request/"],
    ] as const) {
      expect(decideAuthSurfaceAccess(method, path).action).toBe("deny")
    }
  })
})
