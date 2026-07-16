import type { AppEnv } from "../../config/env"

type FinalConfig = {
  projectConfig: Record<string, unknown>
  modules: Array<{
    resolve?: string
    options?: Record<string, unknown>
  }>
}

const canaryRedisUrls = {
  REDIS_URL: "rediss://shared-user:shared-password@shared-canary.invalid:6379",
  CACHE_REDIS_URL:
    "rediss://cache-user:cache-password@cache-canary.invalid:6379",
  EVENTS_REDIS_URL:
    "rediss://events-user:events-password@events-canary.invalid:6379",
  WE_REDIS_URL:
    "rediss://workflow-user:workflow-password@workflow-canary.invalid:6379",
}

function productionEnv(workerMode: "server" | "worker" | "shared"): AppEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://db.invalid/app",
    DATABASE_MIGRATION_URL: "postgresql://db.invalid/app",
    API_PUBLIC_URL: "https://api.invalid",
    STORE_CORS: "https://store.invalid",
    ADMIN_CORS: "https://admin.invalid",
    AUTH_CORS: "https://auth.invalid",
    ...canaryRedisUrls,
    JWT_SECRET: "j".repeat(32),
    COOKIE_SECRET: "c".repeat(32),
    SENTRY_DSN: undefined,
    APP_VERSION: "test",
    APP_VERSION_SOURCE: "app_version",
    WORKER_MODE: workerMode,
    ADMIN_DISABLED: true,
    S3_ENDPOINT: undefined,
    S3_REGION: undefined,
    S3_BUCKET: undefined,
    S3_ACCESS_KEY_ID: undefined,
    S3_SECRET_ACCESS_KEY: undefined,
    S3_FILE_URL: undefined,
    STRIPE_REAL_INITIATION_ENABLED: false,
    STRIPE_SECRET_KEY: undefined,
    STRIPE_PIX_EXPIRES_AFTER_SECONDS: 86_400,
    STRIPE_WEBHOOK_SECRET: undefined,
    STRIPE_WEBHOOK_INGESTION_ENABLED: false,
    RESEND_API_KEY: undefined,
    RESEND_FROM_EMAIL: undefined,
    RESEND_ORDER_CONFIRMATION_ENABLED: false,
    RESEND_REPLY_TO: undefined,
    GELATO_DISPATCH_ENABLED: false,
    GELATO_API_KEY: undefined,
    GELATO_SHIPMENT_METHOD_UID: undefined,
    GELATO_WEBHOOK_AUTH_HEADER_NAME: "X-GELATO-WEBHOOK-SECRET",
    GELATO_WEBHOOK_SECRET: undefined,
    TRACKING_TOKEN_PEPPER: undefined,
    ADMIN_REFUND_REQUEST_ENABLED: true,
    ADMIN_EXCHANGE_REQUEST_ENABLED: true,
  }
}

function loadFinalConfig(env: AppEnv): FinalConfig {
  let loaded: FinalConfig | undefined

  jest.resetModules()
  jest.doMock("@medusajs/framework/utils", () => ({
    defineConfig: (config: FinalConfig) => config,
  }))
  jest.doMock("../../config/env", () => ({ env }))
  jest.doMock("../storage-config", () => ({
    buildStorageModule: () => [],
  }))
  jest.doMock("../../observability/medusa-logger", () => ({
    medusaLogger: {},
  }))
  jest.isolateModules(() => {
    loaded = require("../../../medusa-config") as FinalConfig
  })

  return loaded!
}

function expectSanitizedFailure(fn: () => unknown) {
  try {
    fn()
    throw new Error("Expected configuration to fail")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    expect(message).toContain("Production Redis infrastructure is incomplete")
    for (const forbidden of [
      "redis://",
      "rediss://",
      "user",
      "password",
      "canary.invalid",
    ]) {
      expect(message).not.toContain(forbidden)
    }
  }
}

describe("medusa-config final Redis wiring", () => {
  const originalMigrationMode = process.env.DTC_RELEASE_MIGRATION_MODE
  const originalChildMarker = process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS
  const originalCacheDisabled = process.env.REDIS_CACHE_PROVIDER_DISABLED

  beforeEach(() => {
    delete process.env.DTC_RELEASE_MIGRATION_MODE
    delete process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS
    delete process.env.REDIS_CACHE_PROVIDER_DISABLED
  })

  afterAll(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
    restore("DTC_RELEASE_MIGRATION_MODE", originalMigrationMode)
    restore("DTC_RELEASE_MIGRATION_CHILD_PROCESS", originalChildMarker)
    restore("REDIS_CACHE_PROVIDER_DISABLED", originalCacheDisabled)
  })

  it.each(["server", "worker"] as const)(
    "exports projectConfig and four Redis modules for WORKER_MODE=%s",
    (workerMode) => {
      const config = loadFinalConfig(productionEnv(workerMode))
      const redisModules = config.modules.filter((module) =>
        [
          "@medusajs/medusa/caching",
          "@medusajs/medusa/locking",
          "@medusajs/medusa/event-bus-redis",
          "@medusajs/medusa/workflow-engine-redis",
        ].includes(module.resolve ?? "")
      )

      expect(config.projectConfig.redisUrl).toBe(canaryRedisUrls.REDIS_URL)
      expect(redisModules).toHaveLength(4)
      expect(JSON.stringify(redisModules)).toContain("@medusajs/caching-redis")
      expect(JSON.stringify(redisModules)).toContain(
        "@medusajs/medusa/locking-redis"
      )
      expect(JSON.stringify(redisModules)).not.toContain("event-bus-local")
      expect(JSON.stringify(redisModules)).not.toContain("inmemory")
    }
  )

  it("exports DB-only configuration for the valid migration child", () => {
    process.env.DTC_RELEASE_MIGRATION_MODE = "true"
    process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS = "true"

    const config = loadFinalConfig(productionEnv("shared"))
    const serialized = JSON.stringify(config.modules)

    expect(config.projectConfig.redisUrl).toBeUndefined()
    expect(serialized).not.toContain("@medusajs/medusa/caching")
    expect(serialized).not.toContain("@medusajs/medusa/locking")
    expect(serialized).not.toContain("event-bus-redis")
    expect(serialized).not.toContain("workflow-engine-redis")
  })

  it.each(["server", "worker"] as const)(
    "rejects both migration flags on permanent WORKER_MODE=%s",
    (workerMode) => {
      process.env.DTC_RELEASE_MIGRATION_MODE = "true"
      process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS = "true"

      expect(() => loadFinalConfig(productionEnv(workerMode))).toThrow(
        "Release migration mode is restricted to the migration child process"
      )
    }
  )

  it("rejects an incomplete production contract safely", () => {
    expectSanitizedFailure(() =>
      loadFinalConfig({
        ...productionEnv("server"),
        EVENTS_REDIS_URL: undefined,
      })
    )
  })

  it("rejects the production cache-disable escape safely", () => {
    process.env.REDIS_CACHE_PROVIDER_DISABLED = "true"

    expectSanitizedFailure(() => loadFinalConfig(productionEnv("worker")))
  })
})
