import {
  AuthResetError,
  type AuthResetConfirmResult,
  type AuthResetDatabase,
  type AuthResetPasswordProvider,
} from "../../src/modules/customer-auth/reset"
import {
  InMemoryAtomicRateLimitStore,
  type AtomicRateLimitStore,
  type DerivedRateLimitBucket,
  type RateLimitBucketResult,
} from "../../src/modules/customer-auth/security/rate-limit"
import {
  handleCustomerAuthResetRequest,
  runCustomerAuthResetRequestRoute,
  type CustomerAuthResetRequestDependencies,
} from "../../src/api/auth/customer/emailpass/reset-password/route"
import { handleCustomerAuthResetConfirm } from "../../src/api/auth/customer/emailpass/update/route"
import {
  AUTH_SURFACE_LOCAL_OPERATIONS,
  AUTH_SURFACE_NATIVE_OPERATIONS,
} from "../../src/api/auth-surface/manifest"
import {
  authSurfaceGuardMiddleware,
  decideAuthSurfaceAccess,
} from "../../src/api/auth-surface/guard"
import defaultMiddlewares, {
  createCustomerAuthBffServiceGuardMiddleware,
  customerAuthAccessGuardMiddleware,
  customerAuthBffServiceGuardMiddleware,
} from "../../src/api/middlewares"
import {
  CUSTOMER_AUTH_BFF_AUTH_HEADER,
  CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS,
} from "../../src/modules/customer-auth/bff-service-auth"
import { applyAuthTimingEnvelope } from "../../src/modules/customer-auth/security/timing"

jest.setTimeout(180_000)

const BASE = new Date("2026-01-01T00:00:00.000Z")
const CAPABILITY_KEYRING = {
  active: {
    version: 1,
    secret: "reset-http-capability-secret-32-bytes-minimum",
  },
  previous: [],
} as const
const EMAIL = "customer@example.invalid"
const NEW_PASSWORD = "synthetic-new-password-12"
const VALID_TOKEN = "r".repeat(43)
const IDEMPOTENCY_KEY = "reset-http-idempotency-1"
const BFF_SERVICE_SECRET = "indicio-bff-service-secret-synthetic-32b"
const WRONG_BFF_SERVICE_SECRET = "indicio-bff-service-secret-synthetic-other"
const RESET_REQUEST_PATH = "/auth/customer/emailpass/reset-password"
const RESET_CONFIRM_PATH = "/auth/customer/emailpass/update"

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
  idempotencyKey?: string
  headers?: Record<string, string>
} = {}): Record<string, unknown> {
  return {
    body: input.body,
    ip: input.ip ?? "198.51.100.27",
    headers: {
      ...(input.idempotencyKey
        ? { "idempotency-key": input.idempotencyKey }
        : {}),
      ...(input.headers ?? {}),
    },
    correlationId: "reset-http-correlation",
  }
}

function fakeDatabase(): AuthResetDatabase {
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
  readonly keys: string[] = []

  async increment(
    buckets: readonly DerivedRateLimitBucket[]
  ): Promise<RateLimitBucketResult[]> {
    this.calls += 1
    this.keys.push(...buckets.map((bucket) => bucket.key))
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

function silentProvider(): AuthResetPasswordProvider {
  return {
    async updatePassword() {
      return "updated"
    },
    async verifyPassword() {
      return true
    },
  }
}

function requestDependencies(
  overrides: Partial<CustomerAuthResetRequestDependencies> = {}
): CustomerAuthResetRequestDependencies {
  return {
    database: fakeDatabase(),
    keyring: CAPABILITY_KEYRING,
    rateLimitStore: new RecordingRateLimitStore(),
    now: () => BASE,
    timing: async () => 0,
    resolveIdentityByEmail: async () => ({
      authIdentityId: "identity-1",
      recipientIdentityId: "identity-1",
      normalizedEmail: EMAIL,
    }),
    requestPasswordReset: async () => ({
      accepted: true,
      created: true,
      intent: null,
      outbox: null,
    }),
    ...overrides,
  }
}

function confirmDependencies(
  overrides: Partial<Parameters<typeof handleCustomerAuthResetConfirm>[2]> = {}
): Parameters<typeof handleCustomerAuthResetConfirm>[2] {
  return {
    database: fakeDatabase(),
    keyring: CAPABILITY_KEYRING,
    rateLimitStore: new RecordingRateLimitStore(),
    provider: silentProvider(),
    now: () => BASE,
    timing: async () => 0,
    dummyWork: () => "dummy-digest",
    resolveResetIntentId: async () => "intent-1",
    confirmPasswordReset: async () => ({
      outcome: "completed",
      intentId: "intent-1",
      generation: 1,
      credentialVersion: 2,
    }),
    ...overrides,
  }
}

function confirmBody(overrides: Record<string, unknown> = {}) {
  return {
    token: VALID_TOKEN,
    newPassword: NEW_PASSWORD,
    ...overrides,
  }
}

function serialize(value: unknown): string {
  return JSON.stringify(value)
}

function expectNoPasswordSink(value: unknown): void {
  const encoded = serialize(value)
  expect(encoded).not.toContain(NEW_PASSWORD)
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) {
    return 0
  }
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  )
  return sorted[index] ?? 0
}

function controlledTiming() {
  const elapsed: number[] = []
  const timing = jest.fn(async (startedAtMs: number) => {
    const measured = await applyAuthTimingEnvelope({
      startedAtMs,
      now: () => startedAtMs + 350,
      randomInt: () => 0,
      sleep: async () => undefined,
    })
    elapsed.push(measured)
    return measured
  })
  return { timing, elapsed }
}

describe("Phase 14 reset HTTP request contract", () => {
  it("keeps known, unknown, limited, outage and provider failure as uniform 202", async () => {
    const timing = jest.fn(async () => 350)
    const requestPasswordReset = jest.fn(async () => ({
      accepted: true as const,
      created: true,
      intent: null,
      outbox: null,
    }))
    const outcomes = [
      {
        name: "known",
        dependencies: requestDependencies({ timing, requestPasswordReset }),
      },
      {
        name: "unknown",
        dependencies: requestDependencies({
          timing,
          resolveIdentityByEmail: async () => null,
          requestPasswordReset,
        }),
      },
      {
        name: "limited",
        dependencies: requestDependencies({
          timing,
          rateLimitStore: new BlockedRateLimitStore(),
          requestPasswordReset,
        }),
      },
      {
        name: "outage",
        dependencies: requestDependencies({
          timing,
          rateLimitStore: new OutageRateLimitStore(),
          requestPasswordReset,
        }),
      },
      {
        name: "provider failure",
        dependencies: requestDependencies({
          timing,
          requestPasswordReset: async () => {
            throw new Error("synthetic provider delivery failure")
          },
        }),
      },
    ]

    const responses: Array<{ statusCode: number; body: unknown; headers: Record<string, string> }> = []
    for (const outcome of outcomes) {
      const { response, state } = responseRecorder()
      await handleCustomerAuthResetRequest(
        requestOf({ body: { email: `  ${EMAIL}  ` } }),
        response,
        outcome.dependencies
      )
      responses.push({
        statusCode: state.statusCode,
        body: state.body,
        headers: state.headers,
      })
    }

    expect(new Set(responses.map((entry) => entry.statusCode))).toEqual(new Set([202]))
    expect(new Set(responses.map((entry) => serialize(entry.body)))).toEqual(
      new Set([serialize({ code: "REQUEST_ACCEPTED" })])
    )
    expect(responses.every((entry) => !("retry-after" in entry.headers))).toBe(true)
    expect(requestPasswordReset).toHaveBeenCalledTimes(1)
    expect(timing).toHaveBeenCalledTimes(outcomes.length)
  })

  it("applies the timing envelope exactly once even when timing itself rejects", async () => {
    const cases = [
      {
        name: "known",
        dependencies: (timing: jest.Mock) => requestDependencies({ timing }),
      },
      {
        name: "provider failure",
        dependencies: (timing: jest.Mock) =>
          requestDependencies({
            timing,
            requestPasswordReset: async () => {
              throw new Error("synthetic provider delivery failure")
            },
          }),
      },
    ] as const

    for (const entry of cases) {
      const timing = jest
        .fn()
        .mockRejectedValue(new Error("synthetic timing failure"))
      const { response, state } = responseRecorder()
      await handleCustomerAuthResetRequest(
        requestOf({ body: { email: EMAIL } }),
        response,
        entry.dependencies(timing)
      )
      expect(timing).toHaveBeenCalledTimes(1)
      expect(state.statusCode).toBe(202)
      expect(state.body).toEqual({ code: "REQUEST_ACCEPTED" })
      expect(state.headers).not.toHaveProperty("retry-after")
    }
  })

  it("creates an intent only for an eligible known identity", async () => {
    const requestPasswordReset = jest.fn(async () => ({
      accepted: true as const,
      created: true,
      intent: null,
      outbox: null,
    }))
    const known = responseRecorder()
    await handleCustomerAuthResetRequest(
      requestOf({ body: { email: EMAIL } }),
      known.response,
      requestDependencies({ requestPasswordReset })
    )
    expect(known.state.statusCode).toBe(202)
    expect(requestPasswordReset).toHaveBeenCalledTimes(1)
    expect(requestPasswordReset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        authIdentityId: "identity-1",
        normalizedEmail: EMAIL,
      })
    )

    const unknown = responseRecorder()
    await handleCustomerAuthResetRequest(
      requestOf({ body: { email: EMAIL } }),
      unknown.response,
      requestDependencies({
        resolveIdentityByEmail: async () => null,
        requestPasswordReset,
      })
    )
    expect(unknown.state.statusCode).toBe(202)
    expect(requestPasswordReset).toHaveBeenCalledTimes(1)
  })

  it("rejects invalid request schema without creating an intent", async () => {
    const requestPasswordReset = jest.fn()
    const resolveIdentityByEmail = jest.fn()
    const invalid = responseRecorder()
    await handleCustomerAuthResetRequest(
      requestOf({ body: { email: "not-an-email", extra: true } }),
      invalid.response,
      requestDependencies({ requestPasswordReset, resolveIdentityByEmail })
    )
    expect(invalid.state.statusCode).toBe(400)
    expect(invalid.state.body).toMatchObject({ code: "INVALID_REQUEST" })
    expect(requestPasswordReset).not.toHaveBeenCalled()
    expect(resolveIdentityByEmail).not.toHaveBeenCalled()
  })

  it("absorbs runtime acquisition failure as 202 without lookup or write", async () => {
    const { timing, elapsed } = controlledTiming()
    const handleRequest = jest.fn()
    const openRuntime = jest.fn(async () => {
      throw new Error("synthetic runtime acquisition failure")
    })
    const { response, state } = responseRecorder()

    await runCustomerAuthResetRequestRoute(
      requestOf({ body: { email: EMAIL } }) as never,
      response as never,
      { openRuntime, timing, handleRequest }
    )

    expect(state.statusCode).toBe(202)
    expect(state.body).toEqual({ code: "REQUEST_ACCEPTED" })
    expect(handleRequest).not.toHaveBeenCalled()
    expect(openRuntime).toHaveBeenCalledTimes(1)
    expect(elapsed).toEqual([350])
  })

  it("never returns a session or verification state from reset request", async () => {
    const { response, state } = responseRecorder()
    await handleCustomerAuthResetRequest(
      requestOf({ body: { email: EMAIL } }),
      response,
      requestDependencies()
    )
    expect(state.statusCode).toBe(202)
    expect(state.body).toEqual({ code: "REQUEST_ACCEPTED" })
    expect(state.body).not.toHaveProperty("accessToken")
    expect(state.body).not.toHaveProperty("refreshToken")
    expect(state.body).not.toHaveProperty("verificationState")
    expect(state.body).not.toHaveProperty("customer")
  })

  it("keeps email and secrets out of limiter keys", async () => {
    const rateLimitStore = new RecordingRateLimitStore()
    const { response, state } = responseRecorder()
    await handleCustomerAuthResetRequest(
      requestOf({ body: { email: EMAIL } }),
      response,
      requestDependencies({ rateLimitStore })
    )
    expect(state.statusCode).toBe(202)
    const keys = rateLimitStore.calls.flat().map((bucket) => bucket.key).join(" ")
    expect(keys).not.toContain(EMAIL)
    expect(keys).not.toContain("198.51.100.27")
    expect(keys).not.toContain(NEW_PASSWORD)
  })
})

describe("Phase 14 reset HTTP confirm contract", () => {
  it("returns 200 PASSWORD_RESET_COMPLETED without session or email verification", async () => {
    const confirmPasswordReset = jest.fn(async () => ({
      outcome: "completed" as const,
      intentId: "intent-internal",
      generation: 3,
      credentialVersion: 8,
    }))
    const { response, state } = responseRecorder()
    await handleCustomerAuthResetConfirm(
      requestOf({
        body: confirmBody(),
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      response,
      confirmDependencies({ confirmPasswordReset })
    )
    expect(state.statusCode).toBe(200)
    expect(state.body).toEqual({ code: "PASSWORD_RESET_COMPLETED" })
    expect(state.body).not.toHaveProperty("accessToken")
    expect(state.body).not.toHaveProperty("refreshToken")
    expect(state.body).not.toHaveProperty("intentId")
    expect(state.body).not.toHaveProperty("verificationState")
    expect(state.body).not.toHaveProperty("emailVerifiedAt")
    expectNoPasswordSink(state.body)
    expect(confirmPasswordReset).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        capability: VALID_TOKEN,
        newPassword: NEW_PASSWORD,
        idempotencyKey: IDEMPOTENCY_KEY,
      })
    )
  })

  it("maps missing, malformed, expired, used, superseded and unknown to equivalent 400 RESET_INVALID_OR_EXPIRED", async () => {
    const dummyWork = jest.fn(() => "dummy")
    const timing = jest.fn(async () => 350)
    const states = new Map([
      ["expired".repeat(8), "expired"],
      ["used".repeat(11), "used"],
      ["superseded".repeat(5), "superseded"],
    ])
    const resolveResetIntentId = jest.fn(
      async (_database: AuthResetDatabase, capability: string) => {
        if (capability === VALID_TOKEN || states.has(capability)) {
          return "intent-internal"
        }
        return null
      }
    )
    const confirmPasswordReset = jest.fn(
      async (
        _database: AuthResetDatabase,
        input: { capability: string }
      ): Promise<AuthResetConfirmResult> => {
        if (states.has(input.capability)) {
          throw new AuthResetError("AUTH_RESET_INVALID_OR_EXPIRED")
        }
        return {
          outcome: "completed",
          intentId: "intent-internal",
          generation: 1,
          credentialVersion: 2,
        }
      }
    )
    const cases: Array<[string, unknown, number, string]> = [
      ["valid", VALID_TOKEN, 200, "PASSWORD_RESET_COMPLETED"],
      ["expired", "expired".repeat(8), 400, "RESET_INVALID_OR_EXPIRED"],
      ["used", "used".repeat(11), 400, "RESET_INVALID_OR_EXPIRED"],
      ["superseded", "superseded".repeat(5), 400, "RESET_INVALID_OR_EXPIRED"],
      ["unknown", "u".repeat(43), 400, "RESET_INVALID_OR_EXPIRED"],
      ["missing", undefined, 400, "RESET_INVALID_OR_EXPIRED"],
      ["malformed", "not a capability", 400, "RESET_INVALID_OR_EXPIRED"],
    ]
    const invalidBodies: Array<{ name: string; statusCode: number; body: unknown; headers: Record<string, string> }> = []

    for (const [name, token, expectedStatus, expectedCode] of cases) {
      const rateLimitStore = new RecordingRateLimitStore()
      const { response, state } = responseRecorder()
      await handleCustomerAuthResetConfirm(
        requestOf({
          body: token === undefined ? { newPassword: NEW_PASSWORD } : confirmBody({ token }),
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
        response,
        confirmDependencies({
          rateLimitStore,
          dummyWork,
          timing,
          resolveResetIntentId,
          confirmPasswordReset,
        })
      )
      expect(state.statusCode).toBe(expectedStatus)
      expect(state.body).toEqual(
        expectedStatus === 200
          ? { code: "PASSWORD_RESET_COMPLETED" }
          : expect.objectContaining({ code: expectedCode })
      )
      expect(serialize(state.body)).not.toContain(NEW_PASSWORD)
      if (typeof token === "string") {
        expect(serialize(state.body)).not.toContain(token)
      }
      if (name !== "valid") {
        invalidBodies.push({
          name,
          statusCode: state.statusCode,
          body: state.body,
          headers: state.headers,
        })
        expect(rateLimitStore.calls).toHaveLength(2)
        expect(rateLimitStore.calls[0]).toHaveLength(2)
        expect(rateLimitStore.calls[1]).toHaveLength(1)
      }
    }

    expect(new Set(invalidBodies.map((entry) => entry.statusCode))).toEqual(new Set([400]))
    expect(new Set(invalidBodies.map((entry) => (entry.body as { code: string }).code))).toEqual(
      new Set(["RESET_INVALID_OR_EXPIRED"])
    )
    expect(invalidBodies.every((entry) => !("retry-after" in entry.headers))).toBe(true)
    expect(confirmPasswordReset).toHaveBeenCalledTimes(4)
  })

  it("never maps missing Idempotency-Key or invalid token to AUTH_RECOVERY_PENDING", async () => {
    const confirmPasswordReset = jest.fn(async () => ({
      outcome: "recovery_pending" as const,
      intentId: "intent-1",
      generation: 1,
    }))
    const missingKey = responseRecorder()
    await handleCustomerAuthResetConfirm(
      requestOf({ body: confirmBody() }),
      missingKey.response,
      confirmDependencies({ confirmPasswordReset })
    )
    expect(missingKey.state.statusCode).toBe(400)
    expect(missingKey.state.body).toMatchObject({ code: "RESET_INVALID_OR_EXPIRED" })
    expect(confirmPasswordReset).not.toHaveBeenCalled()

    const unknown = responseRecorder()
    await handleCustomerAuthResetConfirm(
      requestOf({
        body: confirmBody({ token: "u".repeat(43) }),
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      unknown.response,
      confirmDependencies({
        resolveResetIntentId: async () => null,
        confirmPasswordReset,
      })
    )
    expect(unknown.state.statusCode).toBe(400)
    expect(unknown.state.body).toMatchObject({ code: "RESET_INVALID_OR_EXPIRED" })
    expect(confirmPasswordReset).not.toHaveBeenCalled()
  })

  it("returns AUTH_RECOVERY_PENDING only for a correlated ambiguous operation", async () => {
    const confirmPasswordReset = jest.fn(async () => ({
      outcome: "recovery_pending" as const,
      intentId: "intent-1",
      generation: 2,
    }))
    const { response, state } = responseRecorder()
    await handleCustomerAuthResetConfirm(
      requestOf({
        body: confirmBody(),
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      response,
      confirmDependencies({ confirmPasswordReset })
    )
    expect(state.statusCode).toBe(503)
    expect(state.body).toMatchObject({ code: "AUTH_RECOVERY_PENDING" })
    expect(state.headers["retry-after"]).toBeUndefined()
    expect(confirmPasswordReset).toHaveBeenCalledTimes(1)
  })

  it("blocks confirm on pre limiter or Redis outage before lookup, claim, provider or write", async () => {
    const resolveResetIntentId = jest.fn(async () => "intent-1")
    const confirmPasswordReset = jest.fn()
    const provider = {
      updatePassword: jest.fn(),
      verifyPassword: jest.fn(),
    }
    const limited = responseRecorder()
    await handleCustomerAuthResetConfirm(
      requestOf({
        body: confirmBody(),
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      limited.response,
      confirmDependencies({
        rateLimitStore: new BlockedRateLimitStore(),
        resolveResetIntentId,
        confirmPasswordReset,
        provider,
      })
    )
    expect(limited.state.statusCode).toBe(429)
    expect(limited.state.body).toMatchObject({ code: "RATE_LIMITED" })
    expect(resolveResetIntentId).not.toHaveBeenCalled()
    expect(confirmPasswordReset).not.toHaveBeenCalled()
    expect(provider.updatePassword).not.toHaveBeenCalled()

    const outage = responseRecorder()
    await handleCustomerAuthResetConfirm(
      requestOf({
        body: confirmBody(),
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      outage.response,
      confirmDependencies({
        rateLimitStore: new OutageRateLimitStore(),
        resolveResetIntentId,
        confirmPasswordReset,
        provider,
      })
    )
    expect(outage.state.statusCode).toBe(503)
    expect(outage.state.headers["retry-after"]).toBe("60")
    expect(outage.state.body).toMatchObject({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
    })
    expect(resolveResetIntentId).not.toHaveBeenCalled()
    expect(confirmPasswordReset).not.toHaveBeenCalled()
    expect(provider.updatePassword).not.toHaveBeenCalled()
  })

  it("equalizes Redis, dummy, HTTP and timing operations across the 40-sample public matrix", async () => {
    const classes: Array<{
      name: string
      token?: string
      resolve: string | null
      confirm?: AuthResetConfirmResult | "invalid"
    }> = [
      { name: "missing", resolve: null },
      { name: "malformed", token: "not a capability", resolve: null },
      { name: "unknown", token: "u".repeat(43), resolve: null },
      { name: "expired", token: "e".repeat(43), resolve: "intent-expired", confirm: "invalid" },
      { name: "used", token: "d".repeat(43), resolve: "intent-used", confirm: "invalid" },
      { name: "superseded", token: "s".repeat(43), resolve: "intent-superseded", confirm: "invalid" },
      { name: "revoked", token: "v".repeat(43), resolve: "intent-revoked", confirm: "invalid" },
      {
        name: "provider-rejected",
        token: VALID_TOKEN,
        resolve: "intent-1",
        confirm: "invalid",
      },
      {
        name: "real",
        token: VALID_TOKEN,
        resolve: "intent-1",
        confirm: {
          outcome: "completed",
          intentId: "intent-1",
          generation: 1,
          credentialVersion: 2,
        },
      },
    ]

    const samples = new Map<string, number[]>()
    const opCounts = new Map<string, Set<string>>()

    for (const testClass of classes) {
      for (let index = 0; index < 40; index += 1) {
        const dummyWork = jest.fn(() => "dummy")
        const { timing, elapsed } = controlledTiming()
        const rateLimitStore = new RecordingRateLimitStore()
        const { response, state } = responseRecorder()
        await handleCustomerAuthResetConfirm(
          requestOf({
            body:
              testClass.token === undefined
                ? { newPassword: NEW_PASSWORD }
                : confirmBody({ token: testClass.token }),
            idempotencyKey: IDEMPOTENCY_KEY,
            ip: `198.51.100.${(index % 200) + 1}`,
          }),
          response,
          confirmDependencies({
            rateLimitStore,
            dummyWork,
            timing,
            resolveResetIntentId: async () => testClass.resolve,
            confirmPasswordReset: async () => {
              if (testClass.confirm === "invalid") {
                throw new AuthResetError("AUTH_RESET_INVALID_OR_EXPIRED")
              }
              return testClass.confirm as AuthResetConfirmResult
            },
          })
        )
        expect(state.statusCode).toBe(testClass.name === "real" ? 200 : 400)
        expect(serialize(state)).not.toContain(NEW_PASSWORD)
        const measured = elapsed[0] ?? 0
        samples.set(testClass.name, [...(samples.get(testClass.name) ?? []), measured])
        opCounts.set(
          testClass.name,
          new Set([
            ...(opCounts.get(testClass.name) ?? []),
            [
              rateLimitStore.calls.length,
              rateLimitStore.calls.reduce((sum, call) => sum + call.length, 0),
              dummyWork.mock.calls.length,
              timing.mock.calls.length,
              1,
            ].join(":"),
          ])
        )
      }
    }

    const medians = [...samples.values()].map((values) => percentile(values, 50))
    const p95s = [...samples.values()].map((values) => percentile(values, 95))
    expect(Math.max(...medians) - Math.min(...medians)).toBeLessThanOrEqual(50)
    expect(Math.max(...p95s) - Math.min(...p95s)).toBeLessThanOrEqual(75)
    for (const counts of opCounts.values()) {
      expect([...counts]).toEqual(["2:3:1:1:1"])
    }
  })

  it("keeps newPassword out of limiter keys, errors and confirm metadata", async () => {
    const rateLimitStore = new RecordingRateLimitStore()
    const { response, state } = responseRecorder()
    await handleCustomerAuthResetConfirm(
      requestOf({
        body: confirmBody(),
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
      response,
      confirmDependencies({ rateLimitStore })
    )
    expect(state.statusCode).toBe(200)
    const keys = rateLimitStore.calls.flat().map((bucket) => `${bucket.key}:${bucket.digest}`).join(" ")
    expect(keys).not.toContain(NEW_PASSWORD)
    expect(keys).not.toContain(VALID_TOKEN)
    expect(keys).not.toContain(IDEMPOTENCY_KEY)
    expectNoPasswordSink(state.body)
    expectNoPasswordSink(rateLimitStore.calls)
  })
})

describe("Phase 14 reset surface and BFF service boundary", () => {
  const bffGuard = createCustomerAuthBffServiceGuardMiddleware({
    expectedSecret: BFF_SERVICE_SECRET,
  })

  function applyAuthBff(
    req: Record<string, unknown>,
    res: Record<string, unknown>,
    next: () => void
  ): void {
    authSurfaceGuardMiddleware(req as never, res as never, () => {
      bffGuard(req as never, res as never, next)
    })
  }

  it("elevates exactly the two custom reset contracts and keeps native reset DENY", () => {
    const enabledLocal = AUTH_SURFACE_LOCAL_OPERATIONS.filter(
      (entry) => entry.runtimePolicy === "PHASE14_ENABLED"
    ).map((entry) => `${entry.method} ${entry.pathTemplate}`)

    expect(enabledLocal).toEqual([
      "POST /auth/customer/emailpass/register",
      "POST /auth/customer/emailpass",
      "POST /auth/token/refresh",
      "POST /auth/customer/emailpass/revoke-current-lineage",
      "POST /auth/customer/emailpass/reset-password",
      "POST /auth/customer/emailpass/update",
    ])
    expect(
      decideAuthSurfaceAccess("POST", RESET_REQUEST_PATH).action
    ).toBe("allow")
    expect(decideAuthSurfaceAccess("POST", RESET_CONFIRM_PATH).action).toBe(
      "allow"
    )
    expect(
      AUTH_SURFACE_NATIVE_OPERATIONS.filter((entry) =>
        [
          "/auth/{actor_type}/{auth_provider}/reset-password",
          "/auth/{actor_type}/{auth_provider}/update",
          "/auth/session",
        ].includes(entry.pathTemplate)
      ).every((entry) => entry.runtimePolicy === "DENY")
    ).toBe(true)
    expect(
      decideAuthSurfaceAccess("POST", "/store/customers/me/password").action
    ).toBe("deny")
    expect(
      decideAuthSurfaceAccess("POST", "/auth/customer/emailpass/reset-password/").action
    ).toBe("deny")
    expect(
      decideAuthSurfaceAccess("POST", "/auth/customer/emailpass/Update").action
    ).toBe("deny")
  })

  it("protects the two reset contracts with the BFF exact-set before limiter, lookup, claim or provider", async () => {
    const requestPasswordReset = jest.fn()
    const confirmPasswordReset = jest.fn()
    const resolveResetIntentId = jest.fn()
    const rateLimitStore = new RecordingRateLimitStore()

    for (const path of [RESET_REQUEST_PATH, RESET_CONFIRM_PATH]) {
      const recorded = responseRecorder()
      const handler = jest.fn(async () => {
        if (path === RESET_REQUEST_PATH) {
          await handleCustomerAuthResetRequest(
            requestOf({ body: { email: EMAIL } }),
            recorded.response,
            requestDependencies({ requestPasswordReset, rateLimitStore })
          )
          return
        }
        await handleCustomerAuthResetConfirm(
          requestOf({
            body: confirmBody(),
            idempotencyKey: IDEMPOTENCY_KEY,
          }),
          recorded.response,
          confirmDependencies({
            confirmPasswordReset,
            resolveResetIntentId,
            rateLimitStore,
          })
        )
      })
      applyAuthBff(
        {
          method: "POST",
          originalUrl: path,
          url: path,
          path,
          headers: {},
          correlationId: "reset-bff-deny",
        },
        recorded.response,
        () => {
          void handler()
        }
      )
      expect(handler).not.toHaveBeenCalled()
      expect(recorded.state.statusCode).toBe(404)
      expect(recorded.state.body).toEqual({
        type: "not_found",
        message: "Not Found",
      })
      expect(serialize(recorded.state.body)).not.toContain(BFF_SERVICE_SECRET)
      expect(serialize(recorded.state.body)).not.toContain(
        "CUSTOMER_AUTH_BFF_SERVICE_SECRET"
      )
    }

    expect(requestPasswordReset).not.toHaveBeenCalled()
    expect(confirmPasswordReset).not.toHaveBeenCalled()
    expect(resolveResetIntentId).not.toHaveBeenCalled()
    expect(rateLimitStore.calls).toHaveLength(0)
    expect([...CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS]).toEqual(
      expect.arrayContaining([
        "POST /auth/customer/emailpass/reset-password",
        "POST /auth/customer/emailpass/update",
      ])
    )
  })

  it("starts the reset protocol after a valid BFF service credential", async () => {
    const requestPasswordReset = jest.fn(async () => ({
      accepted: true as const,
      created: true,
      intent: null,
      outbox: null,
    }))
    const recorded = responseRecorder()
    const request = {
      ...requestOf({ body: { email: EMAIL } }),
      method: "POST",
      originalUrl: RESET_REQUEST_PATH,
      url: RESET_REQUEST_PATH,
      path: RESET_REQUEST_PATH,
      headers: {
        [CUSTOMER_AUTH_BFF_AUTH_HEADER]: BFF_SERVICE_SECRET,
      },
    }

    await new Promise<void>((resolve, reject) => {
      applyAuthBff(request, recorded.response, () => {
        void handleCustomerAuthResetRequest(
          request,
          recorded.response,
          requestDependencies({ requestPasswordReset })
        ).then(resolve, reject)
      })
    })

    expect(requestPasswordReset).toHaveBeenCalledTimes(1)
    expect(recorded.state.statusCode).toBe(202)
  })

  it("mounts BFF-only guards on the two reset paths and does not add customer access", () => {
    const routes = defaultMiddlewares.routes ?? []
    for (const path of [RESET_REQUEST_PATH, RESET_CONFIRM_PATH]) {
      const route = routes.find((candidate) => String(candidate.matcher) === path)
      expect(route).toBeDefined()
      expect(route?.middlewares).toEqual([customerAuthBffServiceGuardMiddleware])
      expect(route?.middlewares).not.toContain(customerAuthAccessGuardMiddleware)
    }
  })

  it("denies an invalid BFF credential with the same generic envelope", () => {
    const recorded = responseRecorder()
    const handler = jest.fn()
    applyAuthBff(
      {
        method: "POST",
        originalUrl: RESET_CONFIRM_PATH,
        url: RESET_CONFIRM_PATH,
        path: RESET_CONFIRM_PATH,
        headers: {
          [CUSTOMER_AUTH_BFF_AUTH_HEADER]: WRONG_BFF_SERVICE_SECRET,
        },
        correlationId: "reset-bff-invalid",
      },
      recorded.response,
      handler
    )
    expect(handler).not.toHaveBeenCalled()
    expect(recorded.state.statusCode).toBe(404)
    expect(recorded.state.body).toEqual({
      type: "not_found",
      message: "Not Found",
    })
  })
})
