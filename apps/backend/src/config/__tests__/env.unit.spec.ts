import fs from "fs"
import path from "path"
import { parseEnv } from "../env"

const backendRoot = path.resolve(__dirname, "../../..")
const templatePath = path.join(backendRoot, ".env.template")

const productionSecret = "a".repeat(32)
const storageEndpoint =
  "https://exampleproject.storage.supabase.co/storage/v1/s3"
const storagePublicUrl =
  "https://exampleproject.supabase.co/storage/v1/object/public/product-images"
const storageAccessKeyId = "example-access-key-id"
const storageSecretAccessKey = "example-secret-access-key-value"
const runtimeDatabaseUrl =
  "postgresql://runtime-user:runtime-pass@db.example.com:5432/postgres"
const migrationDatabaseUrl =
  "postgresql://migrate-user:migrate-pass@db.example.com:5432/postgres"
const poolerMigrationUrl =
  "postgresql://migrate-user:migrate-pass@db.example.com:6543/postgres"
const staleAppVersion = "eceedd375374b45462384f091b0920bdd5f08005"
const herokuBuildCommit = "b7cd48f000000000000000000000000000000000"
const herokuSlugCommit = "a1b2c3d"

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
    S3_ENDPOINT: storageEndpoint,
    S3_REGION: "auto",
    S3_BUCKET: "product-images",
    S3_ACCESS_KEY_ID: storageAccessKeyId,
    S3_SECRET_ACCESS_KEY: storageSecretAccessKey,
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

  describe("runtime version resolution", () => {
    it("prefers HEROKU_BUILD_COMMIT over a stale APP_VERSION", () => {
      const env = parseEnv(
        productionFixture({
          APP_VERSION: staleAppVersion,
          HEROKU_BUILD_COMMIT: herokuBuildCommit,
        })
      )

      expect(env.APP_VERSION).toBe(herokuBuildCommit)
      expect(env.APP_VERSION_SOURCE).toBe("heroku_build_commit")
    })

    it("prefers HEROKU_BUILD_COMMIT over HEROKU_SLUG_COMMIT", () => {
      const env = parseEnv(
        productionFixture({
          APP_VERSION: staleAppVersion,
          HEROKU_BUILD_COMMIT: herokuBuildCommit,
          HEROKU_SLUG_COMMIT: herokuSlugCommit,
        })
      )

      expect(env.APP_VERSION).toBe(herokuBuildCommit)
      expect(env.APP_VERSION_SOURCE).toBe("heroku_build_commit")
    })

    it("prefers HEROKU_SLUG_COMMIT over APP_VERSION", () => {
      const env = parseEnv(
        productionFixture({
          APP_VERSION: staleAppVersion,
          HEROKU_SLUG_COMMIT: herokuSlugCommit,
        })
      )

      expect(env.APP_VERSION).toBe(herokuSlugCommit)
      expect(env.APP_VERSION_SOURCE).toBe("heroku_slug_commit")
    })

    it("uses APP_VERSION when Heroku metadata is absent", () => {
      const env = parseEnv(
        productionFixture({
          APP_VERSION: "  2026.07.15+abc1234  ",
        })
      )

      expect(env.APP_VERSION).toBe("2026.07.15+abc1234")
      expect(env.APP_VERSION_SOURCE).toBe("app_version")
    })

    it("accepts each runtime version source independently", () => {
      expect(
        parseEnv(
          productionFixture({
            APP_VERSION: undefined,
            HEROKU_BUILD_COMMIT: herokuBuildCommit,
          })
        )
      ).toMatchObject({
        APP_VERSION: herokuBuildCommit,
        APP_VERSION_SOURCE: "heroku_build_commit",
      })

      expect(
        parseEnv(
          productionFixture({
            APP_VERSION: undefined,
            HEROKU_SLUG_COMMIT: herokuSlugCommit,
          })
        )
      ).toMatchObject({
        APP_VERSION: herokuSlugCommit,
        APP_VERSION_SOURCE: "heroku_slug_commit",
      })

      expect(
        parseEnv(
          productionFixture({
            APP_VERSION: "v1.0.0",
          })
        )
      ).toMatchObject({
        APP_VERSION: "v1.0.0",
        APP_VERSION_SOURCE: "app_version",
      })
    })

    it("falls through invalid Heroku metadata to the next valid source", () => {
      const env = parseEnv(
        productionFixture({
          APP_VERSION: staleAppVersion,
          HEROKU_BUILD_COMMIT: "not-a-valid-sha",
          HEROKU_SLUG_COMMIT: herokuSlugCommit,
        })
      )

      expect(env.APP_VERSION).toBe(herokuSlugCommit)
      expect(env.APP_VERSION_SOURCE).toBe("heroku_slug_commit")
    })

    it.each(["", " ", "dev", "unknown", "null", "undefined"])(
      "rejects invalid production APP_VERSION %p when no metadata is valid",
      (invalidVersion) => {
        const parse = () =>
          parseEnv(
            productionFixture({
              APP_VERSION: invalidVersion,
              HEROKU_BUILD_COMMIT: undefined,
              HEROKU_SLUG_COMMIT: undefined,
            })
          )

        expect(parse).toThrow(
          "Missing required runtime version: HEROKU_BUILD_COMMIT, HEROKU_SLUG_COMMIT or APP_VERSION"
        )

        if (invalidVersion.trim()) {
          expectErrorWithoutValues(parse, "HEROKU_BUILD_COMMIT", [invalidVersion])
        }
      }
    )

    it("does not leak rejected runtime version canaries in errors", () => {
      const rejectedBuild = "build-sha-canary-not-hex"
      const rejectedSlug = "slug-sha-canary-not-hex"
      const rejectedAppVersion = "undefined"

      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              APP_VERSION: rejectedAppVersion,
              HEROKU_BUILD_COMMIT: rejectedBuild,
              HEROKU_SLUG_COMMIT: rejectedSlug,
            })
          ),
        "HEROKU_BUILD_COMMIT",
        [rejectedBuild, rejectedSlug, rejectedAppVersion]
      )
    })
  })

  describe("storage / s3 / supabase public url contract", () => {
    it.each([
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_BUCKET",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_FILE_URL",
    ] as const)(
      "requires %s in production without leaking configured values",
      (variableName) => {
        expectErrorWithoutValues(
          () =>
            parseEnv(
              productionFixture({
                [variableName]: undefined,
              })
            ),
          variableName,
          [
            storageEndpoint,
            storagePublicUrl,
            storageAccessKeyId,
            storageSecretAccessKey,
            "product-images",
          ]
        )
      }
    )

    it("requires S3_FILE_URL to use a public https catalog URL shape", () => {
      const env = parseEnv(productionFixture())

      expect(env.S3_FILE_URL).toMatch(/^https:\/\//)
      expect(env.S3_FILE_URL).toContain("/storage/v1/object/public/")
    })

    it("rejects signed or expiring storage URLs in production", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              S3_FILE_URL:
                "https://exampleproject.supabase.co/storage/v1/object/sign/product-images/file.jpg?token=abc",
            })
          ),
        "S3_FILE_URL",
        ["token=abc"]
      )
    })

    it("allows missing storage env in local development", () => {
      const env = parseEnv(
        localFixture({
          S3_ENDPOINT: undefined,
          S3_REGION: undefined,
          S3_BUCKET: undefined,
          S3_ACCESS_KEY_ID: undefined,
          S3_SECRET_ACCESS_KEY: undefined,
          S3_FILE_URL: undefined,
        })
      )

      expect(env.S3_ENDPOINT).toBeUndefined()
      expect(env.S3_REGION).toBeUndefined()
      expect(env.S3_BUCKET).toBeUndefined()
      expect(env.S3_ACCESS_KEY_ID).toBeUndefined()
      expect(env.S3_SECRET_ACCESS_KEY).toBeUndefined()
      expect(env.S3_FILE_URL).toBeUndefined()
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
      expect(env.APP_VERSION_SOURCE).toBe("development_default")
    })
  })

  describe("Stripe real initiation config", () => {
    it("keeps real initiation disabled by default", () => {
      const env = parseEnv(localFixture())

      expect(env.STRIPE_REAL_INITIATION_ENABLED).toBe(false)
      expect(env.STRIPE_SECRET_KEY).toBeUndefined()
      expect(env.STRIPE_PIX_EXPIRES_AFTER_SECONDS).toBe(86_400)
    })

    it("requires test-mode key when real initiation is enabled", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            localFixture({
              STRIPE_REAL_INITIATION_ENABLED: "true",
              STRIPE_SECRET_KEY: undefined,
            })
          ),
        "STRIPE_SECRET_KEY"
      )
    })

    it("rejects live Stripe key without leaking the value", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            localFixture({
              STRIPE_REAL_INITIATION_ENABLED: "true",
              STRIPE_SECRET_KEY: "sk_live_forbidden_secret",
            })
          ),
        "STRIPE_SECRET_KEY",
        ["sk_live_forbidden_secret"]
      )
    })

    it("accepts explicit test-mode activation and Pix TTL bounds", () => {
      const env = parseEnv(
        localFixture({
          STRIPE_REAL_INITIATION_ENABLED: "true",
          STRIPE_SECRET_KEY: "sk_test_safe_placeholder",
          STRIPE_PIX_EXPIRES_AFTER_SECONDS: "3600",
        })
      )

      expect(env.STRIPE_REAL_INITIATION_ENABLED).toBe(true)
      expect(env.STRIPE_SECRET_KEY).toBe("sk_test_safe_placeholder")
      expect(env.STRIPE_PIX_EXPIRES_AFTER_SECONDS).toBe(3600)
    })

    it("rejects invalid Pix TTL", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            localFixture({
              STRIPE_PIX_EXPIRES_AFTER_SECONDS: "1",
            })
          ),
        "STRIPE_PIX_EXPIRES_AFTER_SECONDS"
      )
    })
  })

  describe("Stripe webhook ingestion config", () => {
    it("keeps webhook ingestion disabled by default", () => {
      const env = parseEnv(localFixture())

      expect(env.STRIPE_WEBHOOK_INGESTION_ENABLED).toBe(false)
      expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined()
    })

    it("requires STRIPE_WEBHOOK_SECRET when ingestion is enabled locally", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            localFixture({
              STRIPE_WEBHOOK_INGESTION_ENABLED: "true",
              STRIPE_WEBHOOK_SECRET: undefined,
            })
          ),
        "STRIPE_WEBHOOK_SECRET"
      )
    })

    it("rejects webhook secret with invalid format", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            localFixture({
              STRIPE_WEBHOOK_INGESTION_ENABLED: "true",
              STRIPE_WEBHOOK_SECRET: "secret",
            })
          ),
        "STRIPE_WEBHOOK_SECRET",
        ["secret"]
      )
    })

    it("fails closed in production when ingestion is enabled without a safe secret", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              STRIPE_WEBHOOK_INGESTION_ENABLED: "true",
              STRIPE_WEBHOOK_SECRET: undefined,
            })
          ),
        "STRIPE_WEBHOOK_SECRET"
      )
    })

    it("accepts an explicit webhook secret when ingestion is enabled", () => {
      const env = parseEnv(
        localFixture({
          STRIPE_WEBHOOK_INGESTION_ENABLED: "true",
          STRIPE_WEBHOOK_SECRET: "whsec_safe_placeholder",
        })
      )

      expect(env.STRIPE_WEBHOOK_INGESTION_ENABLED).toBe(true)
      expect(env.STRIPE_WEBHOOK_SECRET).toBe("whsec_safe_placeholder")
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
  function assertMigrationUrlForTest(url: string | undefined) {
    if (!url || url.trim().length === 0) {
      throw new Error("Missing required variable: DATABASE_MIGRATION_URL")
    }

    let parsedUrl: URL

    try {
      parsedUrl = new URL(url)
    } catch {
      throw new Error("Invalid DATABASE_MIGRATION_URL: must be a valid URL")
    }

    if (parsedUrl.port === "6543") {
      throw new Error(
        "Invalid DATABASE_MIGRATION_URL: transaction pooler port 6543 is not allowed"
      )
    }
  }

  function buildMigrationChildEnvForTest(
    sourceEnv: Record<string, string | undefined>
  ) {
    const childEnv = { ...sourceEnv }
    const migrationUrl = sourceEnv.DATABASE_MIGRATION_URL

    assertMigrationUrlForTest(migrationUrl)
    childEnv.DATABASE_URL = migrationUrl

    return childEnv
  }

  it("rejects empty migration URLs", () => {
    expect(() => assertMigrationUrlForTest("")).toThrow(/DATABASE_MIGRATION_URL/)
  })

  it("rejects transaction pooler URLs on port 6543", () => {
    expect(() => assertMigrationUrlForTest(poolerMigrationUrl)).toThrow(/6543/)
    expect(() => assertMigrationUrlForTest(poolerMigrationUrl)).not.toThrow(
      /runtime-pass/
    )
    expect(() => assertMigrationUrlForTest(poolerMigrationUrl)).not.toThrow(
      /migrate-pass/
    )
  })

  it("accepts direct/session URLs on port 5432 in check-only mode", () => {
    expect(() => assertMigrationUrlForTest(migrationDatabaseUrl)).not.toThrow()
  })

  it("keeps parent DATABASE_URL unchanged when runMigrations builds subprocess env", () => {
    const originalDatabaseUrl =
      "postgresql://parent:parent@127.0.0.1:5432/parent"
    const migrationUrl =
      "postgresql://migrate:migrate@127.0.0.1:5432/migrate"

    process.env.DATABASE_URL = originalDatabaseUrl
    const childEnv = buildMigrationChildEnvForTest({
      ...process.env,
      DATABASE_URL: originalDatabaseUrl,
      DATABASE_MIGRATION_URL: migrationUrl,
    })

    expect(process.env.DATABASE_URL).toBe(originalDatabaseUrl)
    expect(childEnv.DATABASE_URL).toBe(migrationUrl)
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

  it("documents Stripe real initiation test-mode-only env keys", () => {
    const template = fs.readFileSync(templatePath, "utf8")

    expect(template).toMatch(/STRIPE_REAL_INITIATION_ENABLED=/)
    expect(template).toMatch(/STRIPE_SECRET_KEY=<sk_test_\.\.\.>/)
    expect(template).toMatch(/STRIPE_PIX_EXPIRES_AFTER_SECONDS=/)
    expect(template).not.toMatch(/sk_live_/)
  })

  it("documents Supabase storage env keys without real credentials", () => {
    const template = fs.readFileSync(templatePath, "utf8")

    expect(template).toMatch(/S3_ENDPOINT=/)
    expect(template).toMatch(/S3_REGION=/)
    expect(template).toMatch(/S3_BUCKET=/)
    expect(template).toMatch(/S3_ACCESS_KEY_ID=/)
    expect(template).toMatch(/S3_SECRET_ACCESS_KEY=/)
    expect(template).toMatch(/S3_FILE_URL=/)
    expect(template).not.toMatch(/s3_secret_access_key=[A-Za-z0-9+/]{20,}/)
  })
})
