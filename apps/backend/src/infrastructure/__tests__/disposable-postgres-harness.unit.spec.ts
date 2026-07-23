import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  POSTGRES_UNAVAILABLE_CODE,
  assertDisposableMedusaEnvironment,
  assertNoRealRedisProcessOutput,
  buildDisposableMedusaEnvironment,
  createCleanupCoordinator,
  normalizeLoopbackHostname,
  redactDisposableProcessOutput,
  redactPostgresText,
  requireDisposableDatabaseName,
  selectProvisioningMode,
  validateMaintenanceTarget,
} from "../../../integration-tests/postgres/disposable-postgres-harness"

const DISPOSABLE_POSTGRES_RUNNER_SOURCE = readFileSync(
  resolve(__dirname, "../../../scripts/run-disposable-postgres-tests.mjs"),
  "utf8"
)

describe("disposable PostgreSQL harness guards", () => {
  it.each(["localhost", "127.0.0.1", "::1", "[::1]"])(
    "normalizes the supported loopback host %s",
    (hostname) => {
      expect(normalizeLoopbackHostname(hostname)).toBe(
        hostname === "[::1]" ? "::1" : hostname
      )
    }
  )

  it("accepts a WHATWG URL with bracketed IPv6 loopback", () => {
    const target = validateMaintenanceTarget(
      "postgres://runner:password@[::1]:5432/postgres",
      "p12_disposable_ipv6"
    )

    expect(target.hostname).toBe("::1")
    expect(target.url.hostname).toBe("[::1]")
  })

  it.each([
    "0.0.0.0",
    "host.docker.internal",
    "[::ffff:127.0.0.1]",
    "[2001:db8::1]",
    "db.example.com",
  ])("rejects the non-loopback maintenance host %s", (hostname) => {
    expect(() =>
      validateMaintenanceTarget(
        `postgres://runner:password@${hostname}:5432/postgres`,
        "p12_disposable_remote"
      )
    ).toThrow("P12_DISPOSABLE_DATABASE_HOST_FORBIDDEN")
  })

  it("rejects an empty or non-prefixed disposable database name", () => {
    expect(() => requireDisposableDatabaseName("")).toThrow(
      "P12_DISPOSABLE_DATABASE_NAME_REQUIRED"
    )
    expect(() => requireDisposableDatabaseName("integration_test")).toThrow(
      "P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN"
    )
  })

  it("rejects the maintenance database as the disposable target", () => {
    expect(() =>
      validateMaintenanceTarget(
        "postgres://runner:password@127.0.0.1:5432/p12_disposable_same",
        "p12_disposable_same"
      )
    ).toThrow("P12_DISPOSABLE_MAINTENANCE_DATABASE_FORBIDDEN")
  })

  it("requires URL and target name together for the external path", () => {
    expect(() =>
      selectProvisioningMode({
        databaseUrl: "postgres://runner@127.0.0.1:5432/postgres",
        dockerAvailable: true,
      })
    ).toThrow("P12_DISPOSABLE_POSTGRES_CONFIG_INCOMPLETE")
  })

  it("fails closed when neither Docker nor an external loopback URL exists", () => {
    expect(() =>
      selectProvisioningMode({
        dockerAvailable: false,
      })
    ).toThrow(POSTGRES_UNAVAILABLE_CODE)
  })

  it("redacts PostgreSQL credentials and explicit secrets", () => {
    const secret = "super-secret-password"
    const redacted = redactPostgresText(
      `postgres://runner:${secret}@127.0.0.1:5432/postgres DB_PASSWORD=${secret}`,
      [secret]
    )

    expect(redacted).not.toContain(secret)
    expect(redacted).not.toContain("runner:")
    expect(redacted).toContain("[REDACTED]")
  })

  it("redacts credentials from a bracketed IPv6 loopback URL", () => {
    const secret = "ipv6-loopback-secret"
    const redacted = redactPostgresText(
      `postgres://runner:${secret}@[::1]:5432/postgres`,
      [secret]
    )

    expect(redacted).toBe("postgres://[REDACTED]@[::1]:5432/postgres")
  })

  it("builds an isolated Medusa environment without mutating the source", () => {
    const source = {
      NODE_ENV: "production",
      WORKER_MODE: "worker",
      REDIS_URL: "rediss://shared.invalid:6379",
      CACHE_REDIS_URL: "rediss://cache.invalid:6379",
      EVENTS_REDIS_URL: "rediss://events.invalid:6379",
      WE_REDIS_URL: "rediss://workflow.invalid:6379",
      DTC_RELEASE_MIGRATION_MODE: "true",
      DTC_RELEASE_MIGRATION_CHILD_PROCESS: "true",
      STRIPE_REAL_INITIATION_ENABLED: "true",
      STRIPE_WEBHOOK_INGESTION_ENABLED: "true",
      RESEND_ORDER_CONFIRMATION_ENABLED: "true",
      GELATO_DISPATCH_ENABLED: "true",
      DATABASE_URL: "postgres://runner@localhost:5432/p12_disposable_env",
      DATABASE_MIGRATION_URL:
        "postgres://runner@localhost:5432/p12_disposable_env",
      DB_HOST: "localhost",
      DB_PORT: "5432",
      DB_USERNAME: "runner",
      DB_PASSWORD: "local-password",
      DB_TEMP_NAME: "p12_disposable_env",
      JWT_SECRET: "local-jwt-secret",
      COOKIE_SECRET: "local-cookie-secret",
    }
    const original = { ...source }

    const isolated = buildDisposableMedusaEnvironment(source)

    expect(isolated).toMatchObject({
      NODE_ENV: "test",
      WORKER_MODE: "shared",
      REDIS_URL: "",
      CACHE_REDIS_URL: "",
      EVENTS_REDIS_URL: "",
      WE_REDIS_URL: "",
      DTC_RELEASE_MIGRATION_MODE: "",
      DTC_RELEASE_MIGRATION_CHILD_PROCESS: "",
      STRIPE_REAL_INITIATION_ENABLED: "false",
      STRIPE_WEBHOOK_INGESTION_ENABLED: "false",
      RESEND_ORDER_CONFIRMATION_ENABLED: "false",
      GELATO_DISPATCH_ENABLED: "false",
      DATABASE_URL: source.DATABASE_URL,
      DATABASE_MIGRATION_URL: source.DATABASE_MIGRATION_URL,
      DB_HOST: source.DB_HOST,
      DB_PORT: source.DB_PORT,
      DB_USERNAME: source.DB_USERNAME,
      DB_PASSWORD: source.DB_PASSWORD,
      DB_TEMP_NAME: source.DB_TEMP_NAME,
      JWT_SECRET: source.JWT_SECRET,
      COOKIE_SECRET: source.COOKIE_SECRET,
    })
    expect(source).toEqual(original)
    expect(() => assertDisposableMedusaEnvironment(isolated)).not.toThrow()
  })

  it("reports only contract names when the Redis preflight fails", () => {
    const unsafeRedisUrl =
      "rediss://redis-user:redis-password@redis-canary.invalid:6379"
    const secretDsn = "https://dsn-secret@sentry-canary.invalid/1"
    const environment = buildDisposableMedusaEnvironment({
      DB_TEMP_NAME: "p12_disposable_safe_error",
      SENTRY_DSN: secretDsn,
    })
    environment.REDIS_URL = unsafeRedisUrl

    let message = ""
    try {
      assertDisposableMedusaEnvironment(environment)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain("P12_REAL_REDIS_FORBIDDEN")
    expect(message).toContain("REDIS_URL")
    expect(message).not.toContain(unsafeRedisUrl)
    expect(message).not.toContain(secretDsn)
    expect(message).not.toContain("redis-password")
  })

  it("fails an unsafe Redis environment before invoking a spawn boundary", () => {
    const spawnBoundary = jest.fn()
    const unsafeEnvironment = {
      NODE_ENV: "test",
      DB_TEMP_NAME: "p12_disposable_pre_spawn",
      REDIS_URL: "redis-contract-present",
      CACHE_REDIS_URL: "cache-contract-present",
      EVENTS_REDIS_URL: "events-contract-present",
      WE_REDIS_URL: "workflow-contract-present",
    }
    const start = () => {
      assertDisposableMedusaEnvironment(unsafeEnvironment)
      spawnBoundary()
    }

    expect(start).toThrow("P12_REAL_REDIS_FORBIDDEN")
    expect(spawnBoundary).not.toHaveBeenCalled()
  })

  it("redacts child output and rejects only Redis evidence from that output", () => {
    const environment = buildDisposableMedusaEnvironment({
      DB_TEMP_NAME: "p12_disposable_output",
      DB_PASSWORD: "output-db-password",
      JWT_SECRET: "output-jwt-secret",
    })
    const output =
      "database ready output-db-password output-jwt-secret postgres://runner:output-db-password@localhost:5432/postgres"
    const redacted = redactDisposableProcessOutput(output, environment)

    expect(redacted).not.toContain("output-db-password")
    expect(redacted).not.toContain("output-jwt-secret")
    expect(() => assertNoRealRedisProcessOutput(redacted)).not.toThrow()
    expect(() =>
      assertNoRealRedisProcessOutput("MaxRetriesPerRequestError")
    ).toThrow("P12_REAL_REDIS_FORBIDDEN")
  })

  it("rejects cleanup outside the exact disposable allowlist", () => {
    expect(() =>
      createCleanupCoordinator({
        databaseName: "production",
        confirmDatabaseAbsent: async () => true,
      })
    ).toThrow("P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN")
  })

  it("runs signal cleanup exactly once and reports the conventional exit code", async () => {
    const confirmDatabaseAbsent = jest.fn(async () => true)
    const removeContainer = jest.fn(async () => undefined)
    const coordinator = createCleanupCoordinator({
      databaseName: "p12_disposable_signal",
      containerName: "p12-pg-signal",
      confirmDatabaseAbsent,
      removeContainer,
    })

    await expect(coordinator.handleSignal("SIGTERM")).resolves.toBe(143)
    await expect(coordinator.cleanup()).resolves.toBeUndefined()
    expect(confirmDatabaseAbsent).toHaveBeenCalledTimes(1)
    expect(removeContainer).toHaveBeenCalledTimes(1)
  })

  it("removes the exact container even when database residue blocks the gate", async () => {
    const removeContainer = jest.fn(async () => undefined)
    const coordinator = createCleanupCoordinator({
      databaseName: "p12_disposable_residue",
      containerName: "p12-pg-residue",
      confirmDatabaseAbsent: async () => false,
      removeContainer,
    })

    await expect(coordinator.cleanup()).rejects.toThrow(
      "P12_DISPOSABLE_DATABASE_RESIDUE"
    )
    expect(removeContainer).toHaveBeenCalledWith("p12-pg-residue")
  })

  it("invokes Docker directly without an agent wrapper or shell", () => {
    expect(DISPOSABLE_POSTGRES_RUNNER_SOURCE).toMatch(
      /run\(\s*["']docker["']\s*,\s*\[["']info["']\]/
    )
    expect(DISPOSABLE_POSTGRES_RUNNER_SOURCE).toMatch(
      /run\(\s*["']docker["']\s*,\s*args/
    )
    expect(DISPOSABLE_POSTGRES_RUNNER_SOURCE).not.toMatch(
      /run\(\s*["']rtk["']/
    )
    expect(DISPOSABLE_POSTGRES_RUNNER_SOURCE).not.toMatch(
      /spawn\(\s*["']rtk["']/
    )
    expect(DISPOSABLE_POSTGRES_RUNNER_SOURCE).not.toMatch(/rtk.*docker/)
    expect(DISPOSABLE_POSTGRES_RUNNER_SOURCE).not.toMatch(/shell\s*:\s*true/)
    expect(DISPOSABLE_POSTGRES_RUNNER_SOURCE).toMatch(
      /spawn\(\s*command\s*,\s*args\s*,/
    )
    expect(DISPOSABLE_POSTGRES_RUNNER_SOURCE).toMatch(
      /selectProvisioningMode\(/
    )
    expect(DISPOSABLE_POSTGRES_RUNNER_SOURCE).toMatch(
      /createCleanupCoordinator\(/
    )
    expect(DISPOSABLE_POSTGRES_RUNNER_SOURCE).toMatch(
      /assertDisposableMedusaEnvironment\(/
    )
  })
})
