import fs from "fs"
import path from "path"
import { spawnSync } from "child_process"
import { parseEnv } from "../env"

const backendRoot = path.resolve(__dirname, "../../..")
const templatePath = path.join(backendRoot, ".env.template")

const productionSecret = "a".repeat(32)
const runtimeDatabaseUrl =
  "postgresql://runtime-user:runtime-pass@db.example.com:5432/postgres"
const migrationDatabaseUrl =
  "postgresql://migrate-user:migrate-pass@db.example.com:5432/postgres"
const poolerMigrationUrl =
  "postgresql://migrate-user:migrate-pass@db.example.com:6543/postgres"

function productionFixture(
  overrides: Record<string, string | undefined> = {}
): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    DATABASE_URL: runtimeDatabaseUrl,
    DATABASE_MIGRATION_URL: migrationDatabaseUrl,
    API_PUBLIC_URL: "https://api.example.com",
    STORE_CORS: "https://store.example.com",
    ADMIN_CORS: "https://admin.example.com",
    AUTH_CORS: "https://auth.example.com",
    REDIS_URL: "redis://redis.example.com:6379",
    CACHE_REDIS_URL: "redis://redis.example.com:6379",
    EVENTS_REDIS_URL: "redis://redis.example.com:6379",
    WE_REDIS_URL: "redis://redis.example.com:6379",
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

function expectErrorWithoutValues(
  fn: () => unknown,
  variableName: string,
  forbiddenValues: string[] = []
) {
  try {
    fn()
    throw new Error("Expected parseEnv to throw")
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error)
    expect(message).toContain(variableName)
    for (const value of forbiddenValues) {
      expect(message).not.toContain(value)
    }
  }
}

describe("environment configuration", () => {
  describe("production fail-fast", () => {
    it("requires DATABASE_MIGRATION_URL without leaking runtime DATABASE_URL", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              DATABASE_MIGRATION_URL: undefined,
            })
          ),
        "DATABASE_MIGRATION_URL",
        [runtimeDatabaseUrl]
      )
    })

    it("requires SENTRY_DSN without leaking the canary DSN value", () => {
      const canaryDsn = "https://canaryPublicKey@o999.ingest.sentry.io/999"
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              SENTRY_DSN: undefined,
            })
          ),
        "SENTRY_DSN",
        [canaryDsn]
      )
    })

    it("requires APP_VERSION and rejects dev/unknown placeholders", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              APP_VERSION: undefined,
            })
          ),
        "APP_VERSION"
      )

      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              APP_VERSION: "dev",
            })
          ),
        "APP_VERSION",
        ["dev"]
      )

      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              APP_VERSION: "unknown",
            })
          ),
        "APP_VERSION",
        ["unknown"]
      )
    })

    it("rejects weak or placeholder secrets in production", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              JWT_SECRET: "supersecret",
            })
          ),
        "JWT_SECRET",
        ["supersecret"]
      )
    })

    it.each([
      "REDIS_URL",
      "CACHE_REDIS_URL",
      "EVENTS_REDIS_URL",
      "WE_REDIS_URL",
    ] as const)("requires %s without leaking Redis URL values", (variableName) => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              [variableName]: undefined,
            })
          ),
        variableName,
        ["redis://redis.example.com:6379"]
      )
    })
  })

  describe("local defaults", () => {
    it("allows missing SENTRY_DSN", () => {
      const env = parseEnv(
        localFixture({
          SENTRY_DSN: undefined,
        })
      )

      expect(env.SENTRY_DSN).toBeUndefined()
    })

    it("defaults APP_VERSION to dev when omitted", () => {
      const env = parseEnv(
        localFixture({
          APP_VERSION: undefined,
        })
      )

      expect(env.APP_VERSION).toBe("dev")
    })
  })

  describe("WORKER_MODE and ADMIN_DISABLED contracts", () => {
    it("accepts shared, server, and worker modes", () => {
      for (const mode of ["shared", "server", "worker"] as const) {
        const env = parseEnv(localFixture({ WORKER_MODE: mode }))
        expect(env.WORKER_MODE).toBe(mode)
      }
    })

    it("rejects invalid WORKER_MODE values", () => {
      expectErrorWithoutValues(
        () => parseEnv(localFixture({ WORKER_MODE: "invalid-mode" })),
        "WORKER_MODE"
      )
    })

    it("parses ADMIN_DISABLED as a boolean", () => {
      expect(parseEnv(localFixture({ ADMIN_DISABLED: "true" })).ADMIN_DISABLED).toBe(
        true
      )
      expect(
        parseEnv(localFixture({ ADMIN_DISABLED: "false" })).ADMIN_DISABLED
      ).toBe(false)
    })

    it("rejects invalid ADMIN_DISABLED values", () => {
      expectErrorWithoutValues(
        () => parseEnv(localFixture({ ADMIN_DISABLED: "maybe" })),
        "ADMIN_DISABLED"
      )
    })
  })
})

describe("migration URL guard", () => {
  function runMigrationCheck(env: Record<string, string | undefined>) {
    return spawnSync("node", ["scripts/run-migrations.mjs", "--check-only"], {
      cwd: backendRoot,
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf8",
    })
  }

  function runMigrationChildEnvProbe(
    env: Record<string, string | undefined>
  ): { parentDatabaseUrl: string; childDatabaseUrl: string } {
    const script = `
      import { buildMigrationChildEnv } from "./scripts/run-migrations.mjs";
      const childEnv = buildMigrationChildEnv(process.env);
      console.log(JSON.stringify({
        parentDatabaseUrl: process.env.DATABASE_URL,
        childDatabaseUrl: childEnv.DATABASE_URL,
      }));
    `

    const result = spawnSync("node", ["--input-type=module", "-e", script], {
      cwd: backendRoot,
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf8",
    })

    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || "child env probe failed")
    }

    return JSON.parse(result.stdout.trim())
  }

  it("rejects empty migration URLs", () => {
    const result = runMigrationCheck({ DATABASE_MIGRATION_URL: "" })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/DATABASE_MIGRATION_URL/)
  })

  it("rejects transaction pooler URLs on port 6543", () => {
    const result = runMigrationCheck({
      DATABASE_MIGRATION_URL: poolerMigrationUrl,
    })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/6543/)
    expect(result.stderr).not.toContain("runtime-pass")
    expect(result.stderr).not.toContain("migrate-pass")
  })

  it("accepts direct/session URLs on port 5432 in check-only mode", () => {
    const result = runMigrationCheck({
      DATABASE_MIGRATION_URL: migrationDatabaseUrl,
    })

    expect(result.status).toBe(0)
  })

  it("keeps parent DATABASE_URL unchanged when runMigrations builds subprocess env", () => {
    const originalDatabaseUrl =
      "postgresql://parent:parent@127.0.0.1:5432/parent"
    const migrationUrl =
      "postgresql://migrate:migrate@127.0.0.1:5432/migrate"

    process.env.DATABASE_URL = originalDatabaseUrl

    const probe = runMigrationChildEnvProbe({
      DATABASE_URL: originalDatabaseUrl,
      DATABASE_MIGRATION_URL: migrationUrl,
    })

    expect(process.env.DATABASE_URL).toBe(originalDatabaseUrl)
    expect(probe.parentDatabaseUrl).toBe(originalDatabaseUrl)
    expect(probe.childDatabaseUrl).toBe(migrationUrl)
  })
})

describe(".env.template contract", () => {
  it("documents SENTRY_DSN and APP_VERSION without real credentials", () => {
    const template = fs.readFileSync(templatePath, "utf8")

    expect(template).toMatch(/SENTRY_DSN=/)
    expect(template).toMatch(/APP_VERSION=/)
    expect(template).not.toMatch(/sk_live_/)
    expect(template).not.toMatch(/whsec_/)
  })
})
