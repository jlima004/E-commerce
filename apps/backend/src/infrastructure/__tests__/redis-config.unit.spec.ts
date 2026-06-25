import { parseEnv } from "../../config/env"
import type { AppEnv } from "../../config/env"
import type { MedusaModuleDescriptor } from "../redis-config"
import {
  assertNoInMemoryInfrastructure,
  buildRedisModules,
  hasRedisModuleContracts,
  resolveProjectRedisUrl,
  shouldWireRedisModules,
  uniqueRedisUrls,
} from "../redis-config"

const productionSecret = "a".repeat(32)
const sharedRedisUrl = "redis://redis.example.com:6379"
const cacheRedisUrl = "redis://cache.example.com:6379"
const eventsRedisUrl = "redis://events.example.com:6379"
const workflowRedisUrl = "redis://workflow.example.com:6379"
const sharedRedissUrl = "rediss://redis.example.com:6379"
const cacheRedissUrl = "rediss://cache.example.com:6379"
const eventsRedissUrl = "rediss://events.example.com:6379"
const workflowRedissUrl = "rediss://workflow.example.com:6379"

type RedisModuleOptions = {
  redisUrl: string
  redisOptions?: {
    tls: {
      rejectUnauthorized: boolean
    }
  }
}

const originalRedisTlsRejectUnauthorized =
  process.env.REDIS_TLS_REJECT_UNAUTHORIZED

function productionFixture(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://runtime-user:runtime-pass@db.example.com:5432/postgres",
    DATABASE_MIGRATION_URL:
      "postgresql://migrate-user:migrate-pass@db.example.com:5432/postgres",
    API_PUBLIC_URL: "https://api.example.com",
    STORE_CORS: "https://store.example.com",
    ADMIN_CORS: "https://admin.example.com",
    AUTH_CORS: "https://auth.example.com",
    REDIS_URL: sharedRedisUrl,
    CACHE_REDIS_URL: sharedRedisUrl,
    EVENTS_REDIS_URL: sharedRedisUrl,
    WE_REDIS_URL: sharedRedisUrl,
    JWT_SECRET: productionSecret,
    COOKIE_SECRET: productionSecret,
    SENTRY_DSN: "https://examplePublicKey@o0.ingest.sentry.io/0",
    APP_VERSION: "2026.06.24+abc1234",
    WORKER_MODE: "server",
    ADMIN_DISABLED: "false",
    ...overrides,
  }
}

function localFixture(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/medusa",
    JWT_SECRET: "supersecret",
    COOKIE_SECRET: "supersecret",
    STORE_CORS: "http://localhost:8000",
    ADMIN_CORS: "http://localhost:9000",
    AUTH_CORS: "http://localhost:9000",
    WORKER_MODE: "shared",
    ADMIN_DISABLED: "false",
    ...overrides,
  }
}

function parseProductionEnv(
  overrides: Record<string, string | undefined> = {}
): AppEnv {
  return parseEnv(productionFixture(overrides))
}

function expectErrorWithoutValues(
  fn: () => unknown,
  variableName: string,
  forbiddenValues: string[] = []
) {
  try {
    fn()
    throw new Error("Expected function to throw")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toContain(variableName)
    for (const value of forbiddenValues) {
      expect(message).not.toContain(value)
    }
  }
}

function restoreRedisTlsEnv() {
  if (originalRedisTlsRejectUnauthorized === undefined) {
    delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED
    return
  }

  process.env.REDIS_TLS_REJECT_UNAUTHORIZED =
    originalRedisTlsRejectUnauthorized
}

function getRedisModuleOptions(modules: MedusaModuleDescriptor[]) {
  const cachingProviders = modules[0].options?.providers as Array<{
    resolve: string
    id: string
    is_default: boolean
    options: RedisModuleOptions
  }>
  const lockingProviders = modules[1].options?.providers as Array<{
    resolve: string
    id: string
    is_default: boolean
    options: RedisModuleOptions
  }>
  const workflowOptions = modules[3].options as {
    redis: RedisModuleOptions
  }

  return {
    cache: cachingProviders[0].options,
    locking: lockingProviders[0].options,
    events: modules[2].options as RedisModuleOptions,
    workflow: workflowOptions.redis,
  }
}

afterEach(() => {
  restoreRedisTlsEnv()
})

describe("redis module wiring", () => {
  it("builds caching, locking, event bus, and workflow engine Redis modules", () => {
    const modules = buildRedisModules(parseProductionEnv())

    expect(modules).toHaveLength(4)
    expect(modules.map((module) => module.resolve)).toEqual([
      "@medusajs/medusa/caching",
      "@medusajs/medusa/locking",
      "@medusajs/medusa/event-bus-redis",
      "@medusajs/medusa/workflow-engine-redis",
    ])

    const cachingModule = modules[0]
    const cachingProviders = cachingModule.options?.providers as Array<{
      resolve: string
      id: string
      is_default: boolean
      options: RedisModuleOptions
    }>

    expect(cachingProviders).toHaveLength(1)
    expect(cachingProviders[0]).toMatchObject({
      resolve: "@medusajs/caching-redis",
      id: "caching-redis",
      is_default: true,
      options: { redisUrl: sharedRedisUrl },
    })

    const lockingModule = modules[1]
    const lockingProviders = lockingModule.options?.providers as Array<{
      resolve: string
      id: string
      is_default: boolean
      options: RedisModuleOptions
    }>

    expect(lockingProviders).toHaveLength(1)
    expect(lockingProviders[0]).toMatchObject({
      resolve: "@medusajs/medusa/locking-redis",
      id: "locking-redis",
      is_default: true,
      options: { redisUrl: sharedRedisUrl },
    })

    expect(modules[2].options).toEqual({ redisUrl: sharedRedisUrl })
    expect(modules[3].options).toEqual({
      redis: { redisUrl: sharedRedisUrl },
    })
  })

  it("does not add redisOptions for redis:// URLs", () => {
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = "false"

    const modules = buildRedisModules(parseProductionEnv())
    const options = getRedisModuleOptions(modules)

    expect(options.cache).toEqual({ redisUrl: sharedRedisUrl })
    expect(options.locking).toEqual({ redisUrl: sharedRedisUrl })
    expect(options.events).toEqual({ redisUrl: sharedRedisUrl })
    expect(options.workflow).toEqual({ redisUrl: sharedRedisUrl })
  })

  it("does not relax TLS for rediss:// URLs without explicit Redis TLS override", () => {
    delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED

    const env = parseProductionEnv({
      REDIS_URL: sharedRedissUrl,
      CACHE_REDIS_URL: cacheRedissUrl,
      EVENTS_REDIS_URL: eventsRedissUrl,
      WE_REDIS_URL: workflowRedissUrl,
    })
    const modules = buildRedisModules(env)
    const options = getRedisModuleOptions(modules)

    expect(options.cache).toEqual({ redisUrl: cacheRedissUrl })
    expect(options.locking).toEqual({ redisUrl: sharedRedissUrl })
    expect(options.events).toEqual({ redisUrl: eventsRedissUrl })
    expect(options.workflow).toEqual({ redisUrl: workflowRedissUrl })
  })

  it("relaxes TLS for rediss:// URLs when Redis TLS verification is disabled", () => {
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = "false"

    const env = parseProductionEnv({
      REDIS_URL: sharedRedissUrl,
      CACHE_REDIS_URL: cacheRedissUrl,
      EVENTS_REDIS_URL: eventsRedissUrl,
      WE_REDIS_URL: workflowRedissUrl,
    })
    const modules = buildRedisModules(env)
    const options = getRedisModuleOptions(modules)
    const redisOptions = {
      tls: {
        rejectUnauthorized: false,
      },
    }

    expect(options.cache).toEqual({
      redisUrl: cacheRedissUrl,
      redisOptions,
    })
    expect(options.locking).toEqual({
      redisUrl: sharedRedissUrl,
      redisOptions,
    })
    expect(options.events).toEqual({
      redisUrl: eventsRedissUrl,
      redisOptions,
    })
    expect(options.workflow).toEqual({
      redisUrl: workflowRedissUrl,
      redisOptions,
    })
  })

  it("uses module-specific Redis contracts even when they share the same endpoint", () => {
    const env = parseProductionEnv({
      REDIS_URL: sharedRedisUrl,
      CACHE_REDIS_URL: cacheRedisUrl,
      EVENTS_REDIS_URL: eventsRedisUrl,
      WE_REDIS_URL: workflowRedisUrl,
    })

    const modules = buildRedisModules(env)
    const cachingProviders = modules[0].options?.providers as Array<{
      options: RedisModuleOptions
    }>
    const lockingProviders = modules[1].options?.providers as Array<{
      options: RedisModuleOptions
    }>

    expect(cachingProviders[0].options.redisUrl).toBe(cacheRedisUrl)
    expect(lockingProviders[0].options.redisUrl).toBe(sharedRedisUrl)
    expect(modules[2].options).toEqual({ redisUrl: eventsRedisUrl })
    expect(modules[3].options).toEqual({
      redis: { redisUrl: workflowRedisUrl },
    })
  })

  it("does not select in-memory infrastructure for production wiring", () => {
    const modules = buildRedisModules(parseProductionEnv())

    expect(() => assertNoInMemoryInfrastructure(modules)).not.toThrow()
    expect(
      modules.some((module) =>
        module.resolve.includes("inmemory") || module.resolve.includes("local")
      )
    ).toBe(false)
  })

  it("returns no modules in local development when Redis contracts are omitted", () => {
    const env = parseEnv(localFixture())

    expect(hasRedisModuleContracts(env)).toBe(false)
    expect(shouldWireRedisModules(env)).toBe(false)
    expect(buildRedisModules(env)).toEqual([])
    expect(resolveProjectRedisUrl(env)).toBeUndefined()
  })

  it("wires Redis in local development when all module contracts are provided", () => {
    const env = parseEnv(
      localFixture({
        REDIS_URL: sharedRedisUrl,
        CACHE_REDIS_URL: sharedRedisUrl,
        EVENTS_REDIS_URL: sharedRedisUrl,
        WE_REDIS_URL: sharedRedisUrl,
      })
    )

    expect(shouldWireRedisModules(env)).toBe(true)
    expect(buildRedisModules(env)).toHaveLength(4)
    expect(resolveProjectRedisUrl(env)).toBe(sharedRedisUrl)
  })

  it("requires REDIS_URL when wiring Redis modules without leaking URL values", () => {
    expectErrorWithoutValues(
      () =>
        buildRedisModules(
          parseEnv(
            localFixture({
              CACHE_REDIS_URL: sharedRedisUrl,
              EVENTS_REDIS_URL: sharedRedisUrl,
              WE_REDIS_URL: sharedRedisUrl,
            })
          )
        ),
      "REDIS_URL",
      [sharedRedisUrl]
    )
  })
})

describe("resolveProjectRedisUrl", () => {
  it("sets projectConfig redisUrl from REDIS_URL when Redis modules are wired", () => {
    const env = parseProductionEnv()

    expect(resolveProjectRedisUrl(env)).toBe(sharedRedisUrl)
  })

  it("omits projectConfig redisUrl when local development skips Redis wiring", () => {
    const env = parseEnv(localFixture())

    expect(resolveProjectRedisUrl(env)).toBeUndefined()
  })
})

describe("uniqueRedisUrls", () => {
  it("deduplicates identical endpoints without losing individual contract validation", () => {
    const env = parseProductionEnv({
      REDIS_URL: sharedRedisUrl,
      CACHE_REDIS_URL: sharedRedisUrl,
      EVENTS_REDIS_URL: sharedRedisUrl,
      WE_REDIS_URL: sharedRedisUrl,
    })

    expect(uniqueRedisUrls(env)).toEqual([sharedRedisUrl])
  })

  it("preserves distinct endpoints for future readiness probes", () => {
    const env = parseProductionEnv({
      REDIS_URL: sharedRedisUrl,
      CACHE_REDIS_URL: cacheRedisUrl,
      EVENTS_REDIS_URL: eventsRedisUrl,
      WE_REDIS_URL: workflowRedisUrl,
    })

    expect(uniqueRedisUrls(env)).toEqual([
      sharedRedisUrl,
      cacheRedisUrl,
      eventsRedisUrl,
      workflowRedisUrl,
    ])
  })
})

describe("production Redis contract fail-fast", () => {
  for (const variableName of [
    "REDIS_URL",
    "CACHE_REDIS_URL",
    "EVENTS_REDIS_URL",
    "WE_REDIS_URL",
  ] as const) {
    it(`requires ${variableName} without leaking URL values`, () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              [variableName]: undefined,
            })
          ),
        variableName,
        [sharedRedisUrl]
      )
    })
  }

  it("allows one explicit URL to populate all four contract names", () => {
    const env = parseProductionEnv({
      REDIS_URL: sharedRedisUrl,
      CACHE_REDIS_URL: sharedRedisUrl,
      EVENTS_REDIS_URL: sharedRedisUrl,
      WE_REDIS_URL: sharedRedisUrl,
    })

    expect(env.REDIS_URL).toBe(sharedRedisUrl)
    expect(env.CACHE_REDIS_URL).toBe(sharedRedisUrl)
    expect(env.EVENTS_REDIS_URL).toBe(sharedRedisUrl)
    expect(env.WE_REDIS_URL).toBe(sharedRedisUrl)
    expect(uniqueRedisUrls(env)).toEqual([sharedRedisUrl])
  })
})
