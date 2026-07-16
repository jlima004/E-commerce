import { parseEnv } from "../../config/env"
import type { AppEnv } from "../../config/env"
import type { MedusaModuleDescriptor } from "../redis-config"
import {
  assertNoInMemoryInfrastructure,
  buildCachingRedisProviderOptions,
  buildRedisModules,
  buildStandardRedisModuleOptions,
  hasRedisModuleContracts,
  redisOptionsForUrl,
  resolveProjectRedisUrl,
  shouldWireRedisCachingProvider,
  shouldWireRedisModules,
  uniqueRedisUrls,
} from "../redis-config"

const productionSecret = "a".repeat(32)
const sharedRedisUrl = "redis://redis.example.com:6379"
const storageEndpoint =
  "https://exampleproject.storage.supabase.co/storage/v1/s3"
const storagePublicUrl =
  "https://exampleproject.supabase.co/storage/v1/object/public/product-images"
const cacheRedisUrl = "redis://cache.example.com:6379"
const eventsRedisUrl = "redis://events.example.com:6379"
const workflowRedisUrl = "redis://workflow.example.com:6379"
const sharedRedissUrl = "rediss://redis.example.com:6379"
const cacheRedissUrl = "rediss://cache.example.com:6379"
const eventsRedissUrl = "rediss://events.example.com:6379"
const workflowRedissUrl = "rediss://workflow.example.com:6379"
const canaryRedisUsername = "cache-contract-user"
const canaryRedisPassword = "cache-contract-password"
const canaryRedisHostname = "cache-contract.invalid"
const credentialedCanaryRedissUrl =
  `rediss://${canaryRedisUsername}:${canaryRedisPassword}@${canaryRedisHostname}:6379`

type RedisTlsOptions = {
  tls: {
    rejectUnauthorized: boolean
  }
}

type StandardRedisModuleOptions = {
  redisUrl: string
  redisOptions?: RedisTlsOptions
}

type CachingRedisProviderOptions = {
  redisUrl: string
  tls?: RedisTlsOptions["tls"]
}

const originalRedisTlsRejectUnauthorized =
  process.env.REDIS_TLS_REJECT_UNAUTHORIZED
const originalRedisCacheProviderDisabled =
  process.env.REDIS_CACHE_PROVIDER_DISABLED
const originalReleaseMigrationMode = process.env.DTC_RELEASE_MIGRATION_MODE

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
    S3_ENDPOINT: storageEndpoint,
    S3_REGION: "auto",
    S3_BUCKET: "product-images",
    S3_ACCESS_KEY_ID: "example-access-key-id",
    S3_SECRET_ACCESS_KEY: "example-secret-access-key-value",
    S3_FILE_URL: storagePublicUrl,
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

  process.env.REDIS_TLS_REJECT_UNAUTHORIZED = originalRedisTlsRejectUnauthorized
}

function restoreRedisCacheProviderDisabledEnv() {
  if (originalRedisCacheProviderDisabled === undefined) {
    delete process.env.REDIS_CACHE_PROVIDER_DISABLED
    return
  }

  process.env.REDIS_CACHE_PROVIDER_DISABLED = originalRedisCacheProviderDisabled
}

function getRedisModuleOptions(modules: MedusaModuleDescriptor[]) {
  const cachingModule = modules.find(
    (module) => module.resolve === "@medusajs/medusa/caching"
  )
  const lockingModule = modules.find(
    (module) => module.resolve === "@medusajs/medusa/locking"
  )
  const eventsModule = modules.find(
    (module) => module.resolve === "@medusajs/medusa/event-bus-redis"
  )
  const workflowModule = modules.find(
    (module) => module.resolve === "@medusajs/medusa/workflow-engine-redis"
  )

  expect(lockingModule).toBeDefined()
  expect(eventsModule).toBeDefined()
  expect(workflowModule).toBeDefined()

  const cachingProviders = cachingModule?.options?.providers as
    | Array<{
        resolve: string
        id: string
        is_default: boolean
        options: CachingRedisProviderOptions
      }>
    | undefined
  const lockingProviders = lockingModule!.options?.providers as Array<{
    resolve: string
    id: string
    is_default: boolean
    options: StandardRedisModuleOptions
  }>
  const workflowOptions = workflowModule!.options as {
    redis: StandardRedisModuleOptions
  }

  return {
    cache: cachingProviders?.[0]?.options,
    locking: lockingProviders[0].options,
    events: eventsModule!.options as StandardRedisModuleOptions,
    workflow: workflowOptions.redis,
  }
}

function restoreReleaseMigrationModeEnv() {
  if (originalReleaseMigrationMode === undefined) {
    delete process.env.DTC_RELEASE_MIGRATION_MODE
    return
  }

  process.env.DTC_RELEASE_MIGRATION_MODE = originalReleaseMigrationMode
}

afterEach(() => {
  restoreRedisTlsEnv()
  restoreRedisCacheProviderDisabledEnv()
  restoreReleaseMigrationModeEnv()
})

describe("redisOptionsForUrl", () => {
  it("relaxes TLS for rediss:// URLs when Redis TLS verification is disabled", () => {
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = "false"

    expect(redisOptionsForUrl(sharedRedissUrl)).toEqual({
      tls: {
        rejectUnauthorized: false,
      },
    })
  })

  it("does not add Redis options for redis:// URLs", () => {
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = "false"

    expect(redisOptionsForUrl(sharedRedisUrl)).toBeUndefined()
  })

  it("does not relax TLS when the Redis TLS override is absent", () => {
    delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED

    expect(redisOptionsForUrl(sharedRedissUrl)).toBeUndefined()
  })
})

describe("Redis option builders", () => {
  it("builds a flat TLS contract for caching and a nested contract for standard modules", () => {
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = "false"

    expect(
      buildCachingRedisProviderOptions(`  ${cacheRedissUrl}  `)
    ).toEqual({
      redisUrl: cacheRedissUrl,
      tls: {
        rejectUnauthorized: false,
      },
    })
    expect(
      buildStandardRedisModuleOptions(`  ${sharedRedissUrl}  `)
    ).toEqual({
      redisUrl: sharedRedissUrl,
      redisOptions: {
        tls: {
          rejectUnauthorized: false,
        },
      },
    })
  })

  it("keeps both contracts URL-only for redis:// even with the TLS opt-in", () => {
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = "false"

    expect(buildCachingRedisProviderOptions(sharedRedisUrl)).toEqual({
      redisUrl: sharedRedisUrl,
    })
    expect(buildStandardRedisModuleOptions(sharedRedisUrl)).toEqual({
      redisUrl: sharedRedisUrl,
    })
  })

  it.each([undefined, "", "true", "FALSE", "0"])(
    "keeps rediss:// contracts URL-only for non-opt-in value %p",
    (tlsOverride) => {
      if (tlsOverride === undefined) {
        delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED
      } else {
        process.env.REDIS_TLS_REJECT_UNAUTHORIZED = tlsOverride
      }

      expect(buildCachingRedisProviderOptions(cacheRedissUrl)).toEqual({
        redisUrl: cacheRedissUrl,
      })
      expect(buildStandardRedisModuleOptions(sharedRedissUrl)).toEqual({
        redisUrl: sharedRedissUrl,
      })
    }
  )
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
      options: CachingRedisProviderOptions
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
      options: StandardRedisModuleOptions
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

  it("includes the Redis Caching Provider by default", () => {
    expect(shouldWireRedisCachingProvider()).toBe(true)

    const modules = buildRedisModules(parseProductionEnv())

    expect(modules.map((module) => module.resolve)).toContain(
      "@medusajs/medusa/caching"
    )
    expect(
      modules.some((module) =>
        JSON.stringify(module.options).includes("@medusajs/caching-redis")
      )
    ).toBe(true)
  })

  it("omits the Redis Caching Provider when disabled by environment flag", () => {
    process.env.REDIS_CACHE_PROVIDER_DISABLED = "true"

    expect(shouldWireRedisCachingProvider()).toBe(false)

    const modules = buildRedisModules(parseProductionEnv())

    expect(modules).toHaveLength(3)
    expect(modules.map((module) => module.resolve)).toEqual([
      "@medusajs/medusa/locking",
      "@medusajs/medusa/event-bus-redis",
      "@medusajs/medusa/workflow-engine-redis",
    ])
    expect(
      modules.some((module) =>
        JSON.stringify(module.options).includes("@medusajs/caching-redis")
      )
    ).toBe(false)
  })

  it("keeps locking, event bus, and workflow Redis modules when caching is disabled", () => {
    process.env.REDIS_CACHE_PROVIDER_DISABLED = "true"

    const modules = buildRedisModules(parseProductionEnv())
    const options = getRedisModuleOptions(modules)

    expect(options.cache).toBeUndefined()
    expect(options.locking).toEqual({ redisUrl: sharedRedisUrl })
    expect(options.events).toEqual({ redisUrl: sharedRedisUrl })
    expect(options.workflow).toEqual({ redisUrl: sharedRedisUrl })
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
    const tls = {
      rejectUnauthorized: false,
    }
    const redisOptions = {
      tls,
    }

    expect(options.cache).toEqual({
      redisUrl: cacheRedissUrl,
      tls,
    })
    expect(options.cache).not.toHaveProperty("redisOptions")
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

  it("matches the caching-redis 2.16 loader contract without opening a connection", () => {
    process.env.REDIS_TLS_REJECT_UNAUTHORIZED = "false"

    const env = parseProductionEnv({
      CACHE_REDIS_URL: credentialedCanaryRedissUrl,
    })
    const modules = buildRedisModules(env)
    const cacheOptions = getRedisModuleOptions(modules).cache!
    const { redisUrl, ...ioredisOptions } = cacheOptions

    expect(redisUrl).toEqual(expect.any(String))
    expect(cacheOptions).toEqual({
      redisUrl: expect.any(String),
      tls: {
        rejectUnauthorized: false,
      },
    })
    expect(cacheOptions).not.toHaveProperty("redisOptions")
    expect(ioredisOptions).toEqual({
      tls: {
        rejectUnauthorized: false,
      },
    })

    const capturedEvidence = JSON.stringify(cacheOptions, (key, value) =>
      key === "redisUrl" ? "<redacted>" : value
    )

    expect(JSON.parse(capturedEvidence)).toMatchInlineSnapshot(`
      {
        "redisUrl": "<redacted>",
        "tls": {
          "rejectUnauthorized": false,
        },
      }
    `)

    for (const forbiddenValue of [
      "redis://",
      "rediss://",
      canaryRedisUsername,
      canaryRedisPassword,
      canaryRedisHostname,
    ]) {
      expect(capturedEvidence).not.toContain(forbiddenValue)
    }
  })

  it("keeps Redis contract errors free of credentialed canary URL details", () => {
    expectErrorWithoutValues(
      () =>
        buildRedisModules(
          parseEnv(
            localFixture({
              REDIS_URL: undefined,
              CACHE_REDIS_URL: credentialedCanaryRedissUrl,
              EVENTS_REDIS_URL: credentialedCanaryRedissUrl,
              WE_REDIS_URL: credentialedCanaryRedissUrl,
            })
          )
        ),
      "REDIS_URL",
      [
        "redis://",
        "rediss://",
        canaryRedisUsername,
        canaryRedisPassword,
        canaryRedisHostname,
      ]
    )
  })

  it("keeps redisOptions for supported rediss:// Redis modules when caching is disabled", () => {
    process.env.REDIS_CACHE_PROVIDER_DISABLED = "true"
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

    expect(options.cache).toBeUndefined()
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
      options: CachingRedisProviderOptions
    }>
    const lockingProviders = modules[1].options?.providers as Array<{
      options: StandardRedisModuleOptions
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

  it("skips Redis modules during Heroku release migration mode", () => {
    process.env.DTC_RELEASE_MIGRATION_MODE = "true"

    const env = parseProductionEnv()

    expect(shouldWireRedisModules(env)).toBe(false)
    expect(buildRedisModules(env)).toEqual([])
    expect(resolveProjectRedisUrl(env)).toBeUndefined()
  })

  it("keeps production Redis modules when release migration mode is absent", () => {
    delete process.env.DTC_RELEASE_MIGRATION_MODE

    const env = parseProductionEnv()

    expect(shouldWireRedisModules(env)).toBe(true)
    expect(buildRedisModules(env)).toHaveLength(4)
    expect(resolveProjectRedisUrl(env)).toBe(sharedRedisUrl)
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
