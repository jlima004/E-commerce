import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AppEnv } from "../../src/config/env"
import type {
  ProbeLogger,
  RedisProbeClient,
  RedisProbeClientFactory,
} from "../../src/infrastructure/health"
import {
  CHECK_TIMEOUT_MS,
  GLOBAL_READINESS_TIMEOUT_MS,
  checkPostgres,
  checkReadiness,
  checkRedis,
  withTimeout,
} from "../../src/infrastructure/health"

const CANARIES = {
  postgresUrl: "postgresql://user:secret@db.internal.example:5432/medusa",
  redisUrl: "redis://:secret@redis.internal.example:6379/0",
  stack: "Error: boom\n    at secret-host.internal/path.ts:10:1",
  credential: "super-secret-token",
} as const

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function createEnv(overrides: Partial<AppEnv> = {}): AppEnv {
  return {
    NODE_ENV: "test",
    DATABASE_URL: undefined,
    DATABASE_MIGRATION_URL: undefined,
    API_PUBLIC_URL: undefined,
    STORE_CORS: "http://localhost:8000",
    ADMIN_CORS: "http://localhost:9000",
    AUTH_CORS: "http://localhost:9000",
    REDIS_URL: undefined,
    CACHE_REDIS_URL: undefined,
    EVENTS_REDIS_URL: undefined,
    WE_REDIS_URL: undefined,
    JWT_SECRET: "supersecret",
    COOKIE_SECRET: "supersecret",
    SENTRY_DSN: undefined,
    APP_VERSION: "2026.06.25+health-test",
    WORKER_MODE: "server",
    ADMIN_DISABLED: false,
    ...overrides,
  }
}

function createLogger(): ProbeLogger & { warnings: unknown[] } {
  const warnings: unknown[] = []

  return {
    warnings,
    warn: jest.fn((payload: unknown) => {
      warnings.push(payload)
    }),
  }
}

function expectNoCanaries(value: unknown) {
  const serialized = JSON.stringify(value)

  for (const canary of Object.values(CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

function createRedisClient(ping: () => Promise<unknown>): RedisProbeClient {
  return {
    connect: jest.fn(async () => undefined),
    ping: jest.fn(ping),
    disconnect: jest.fn(),
  }
}

describe("health probes", () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it("starts Postgres and Redis checks before awaiting any result", async () => {
    const postgres = createDeferred<"up">()
    const redis = createDeferred<"up">()
    const starts: string[] = []

    const readinessPromise = checkReadiness(undefined, {
      checkPostgres: () => {
        starts.push("postgres")
        return postgres.promise
      },
      checkRedis: () => {
        starts.push("redis")
        return redis.promise
      },
    })

    expect(starts).toEqual(["postgres", "redis"])

    redis.resolve("up")
    await Promise.resolve()
    expect(starts).toEqual(["postgres", "redis"])

    postgres.resolve("up")

    await expect(readinessPromise).resolves.toEqual({
      status: "ready",
      checks: {
        postgres: "up",
        redis: "up",
      },
    })
  })

  it("times each dependency at 1500 ms and the set at 2000 ms", async () => {
    jest.useFakeTimers()

    const timedCheck = withTimeout(
      new Promise<"up">(() => undefined),
      CHECK_TIMEOUT_MS,
      "down"
    )

    jest.advanceTimersByTime(CHECK_TIMEOUT_MS - 1)
    await Promise.resolve()
    let settled = false
    timedCheck.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    jest.advanceTimersByTime(1)
    await expect(timedCheck).resolves.toBe("down")

    const globalPromise = checkReadiness(undefined, {
      checkPostgres: () => new Promise<"up">(() => undefined),
      checkRedis: () => new Promise<"up">(() => undefined),
      timeoutMs: 10_000,
      globalTimeoutMs: GLOBAL_READINESS_TIMEOUT_MS,
    })

    jest.advanceTimersByTime(GLOBAL_READINESS_TIMEOUT_MS)

    await expect(globalPromise).resolves.toEqual({
      status: "not_ready",
      checks: {
        postgres: "down",
        redis: "down",
      },
    })
  })

  it("executes only SELECT 1 for Postgres", async () => {
    const raw = jest.fn(async () => undefined)
    const scope = {
      resolve: jest.fn(() => ({ raw })),
    }

    await expect(checkPostgres(scope)).resolves.toBe("up")

    expect(scope.resolve).toHaveBeenCalledWith("__pg_connection__")
    expect(raw).toHaveBeenCalledTimes(1)
    expect(raw).toHaveBeenCalledWith("SELECT 1")
  })

  it("deduplicates Redis endpoints before pinging", async () => {
    const factoryCalls: string[] = []
    const createClient: RedisProbeClientFactory = (url) => {
      factoryCalls.push(url)
      return createRedisClient(async () => "PONG")
    }

    await expect(
      checkRedis({
        env: createEnv({
          REDIS_URL: CANARIES.redisUrl,
          CACHE_REDIS_URL: CANARIES.redisUrl,
          EVENTS_REDIS_URL: CANARIES.redisUrl,
          WE_REDIS_URL: CANARIES.redisUrl,
        }),
        createClient,
      })
    ).resolves.toBe("up")

    expect(factoryCalls).toEqual([CANARIES.redisUrl])
  })

  it("keeps expected dependency failure logs sanitized", async () => {
    const logger = createLogger()
    const raw = jest.fn(async () => {
      const error = new Error(
        `${CANARIES.postgresUrl} ${CANARIES.redisUrl} ${CANARIES.credential}`
      )
      error.stack = CANARIES.stack
      throw error
    })

    await expect(
      checkPostgres(
        {
          resolve: jest.fn(() => ({ raw })),
        },
        { correlationId: "corr-health-001", logger }
      )
    ).resolves.toBe("down")

    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warnings[0]).toEqual({
      check: "postgres",
      operation: "health.postgres",
      correlation_id: "corr-health-001",
      error_class: "Error",
    })
    expectNoCanaries(logger.warnings)
  })
})

describe("health HTTP contracts", () => {
  function createResponse() {
    return {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as MedusaResponse
  }

  async function importRouteWithMocks(
    route: "live" | "ready",
    readiness?: { status: "ready" | "not_ready"; checks: { postgres: "up" | "down"; redis: "up" | "down" } }
  ) {
    jest.resetModules()
    jest.doMock("../../src/config/env", () => ({
      env: {
        APP_VERSION: "2026.06.25+route-test",
      },
    }))
    jest.doMock("../../src/infrastructure/health", () => ({
      checkReadiness: jest.fn(async () => readiness),
    }))

    return import(`../../src/api/health/${route}/route`)
  }

  afterEach(() => {
    jest.dontMock("../../src/config/env")
    jest.dontMock("../../src/infrastructure/health")
    jest.resetModules()
  })

  it("GET /health/live returns 200 without probes", async () => {
    const route = await importRouteWithMocks("live")
    const health = await import("../../src/infrastructure/health")
    const res = createResponse()

    await route.GET({} as MedusaRequest, res)

    expect(health.checkReadiness).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({
      status: "live",
      service: "medusa-backend",
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      version: "2026.06.25+route-test",
    })
  })

  it("GET /health/ready returns 200 with minimal ready shape", async () => {
    const route = await importRouteWithMocks("ready", {
      status: "ready",
      checks: {
        postgres: "up",
        redis: "up",
      },
    })
    const res = createResponse()

    await route.GET({ scope: { resolve: jest.fn() } } as unknown as MedusaRequest, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const body = (res.json as jest.Mock).mock.calls[0]?.[0]

    expect(Object.keys(body).sort()).toEqual([
      "checks",
      "service",
      "status",
      "timestamp",
      "version",
    ])
    expect(body).toMatchObject({
      status: "ready",
      service: "medusa-backend",
      version: "2026.06.25+route-test",
      checks: {
        postgres: "up",
        redis: "up",
      },
    })
  })

  it("GET /health/ready returns 503 with not_ready when a required check is down", async () => {
    const route = await importRouteWithMocks("ready", {
      status: "not_ready",
      checks: {
        postgres: "up",
        redis: "down",
      },
    })
    const health = await import("../../src/infrastructure/health")
    const res = createResponse()

    await route.GET({ scope: { resolve: jest.fn() } } as unknown as MedusaRequest, res)

    expect(health.checkReadiness).toHaveBeenCalledTimes(1)
    expect(res.status).toHaveBeenCalledWith(503)
    expect((res.json as jest.Mock).mock.calls[0]?.[0]).toMatchObject({
      status: "not_ready",
      checks: {
        postgres: "up",
        redis: "down",
      },
    })
  })
})
