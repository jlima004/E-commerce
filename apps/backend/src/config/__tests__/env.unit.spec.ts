import fs from "fs"
import path from "path"
import {
  env,
  parseEnv,
  STORE_IDEMPOTENCY_KEY_PEPPER_DEV_DEFAULT,
} from "../env"
import {
  STORE_IDEMPOTENCY_HASH_VERSION,
  STORE_IDEMPOTENCY_PEPPER_VERSION,
} from "../../modules/store-idempotency/models/store-idempotency-record"
import {
  STORE_IDEMPOTENCY_ALLOWED_TRANSITIONS,
  STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS,
  STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS,
  StoreIdempotencyModuleService,
  assertNoSensitiveStoreIdempotencyPersistence,
  assertStoreIdempotencyTransitionAllowed,
  assertValidRawIdempotencyKey,
  assertValidStoreIdempotencyResponseStatus,
  buildStoreIdempotencyRequestFingerprint,
  hashStoreIdempotencyKey,
  hashStoreIdempotencyScope,
  isStoreIdempotencyLifecycleLeaseActive,
  sanitizeStoreIdempotencySafeMetadata,
  storeIdempotencyLifecycleLeaseCutoff,
} from "../../modules/store-idempotency/service"
import type { StoreIdempotencyState } from "../../modules/store-idempotency/models/store-idempotency-record"

const syntheticStoreIdempotencyPepper = Buffer.alloc(32, 9).toString(
  "base64url"
)
const alternateStoreIdempotencyPepper = Buffer.alloc(32, 11).toString(
  "base64url"
)
const shortStoreIdempotencyPepper = Buffer.alloc(16, 1).toString("base64url")

const backendRoot = path.resolve(__dirname, "../../..")
const templatePath = path.join(backendRoot, ".env.template")

const productionSecret = "a".repeat(32)
const syntheticBffServiceSecret = "b".repeat(32)
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
    STORE_IDEMPOTENCY_KEY_PEPPER: syntheticStoreIdempotencyPepper,
    CUSTOMER_AUTH_BFF_SERVICE_SECRET: syntheticBffServiceSecret,
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

    it("requires CUSTOMER_AUTH_BFF_SERVICE_SECRET without leaking the value", () => {
      const canary = "canary-bff-service-secret-value-32b-xx"
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              CUSTOMER_AUTH_BFF_SERVICE_SECRET: undefined,
            })
          ),
        "CUSTOMER_AUTH_BFF_SERVICE_SECRET",
        [canary, syntheticBffServiceSecret]
      )
    })

    it("rejects a short or placeholder BFF service secret without leaking it", () => {
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              CUSTOMER_AUTH_BFF_SERVICE_SECRET: "supersecret",
            })
          ),
        "CUSTOMER_AUTH_BFF_SERVICE_SECRET",
        ["supersecret"]
      )
      expectErrorWithoutValues(
        () =>
          parseEnv(
            productionFixture({
              CUSTOMER_AUTH_BFF_SERVICE_SECRET: "too-short",
            })
          ),
        "CUSTOMER_AUTH_BFF_SERVICE_SECRET",
        ["too-short"]
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

  describe("API docs exposure flags", () => {
    it("defaults all four flags true in development when unset", () => {
      const env = parseEnv(localFixture({ NODE_ENV: "development" }))

      expect(env.API_DOCS_ENABLED).toBe(true)
      expect(env.API_DOCS_UI_ENABLED).toBe(true)
      expect(env.API_DOCS_PUBLIC_ENABLED).toBe(true)
      expect(env.API_DOCS_INTERNAL_ENABLED).toBe(true)
    })

    it("defaults UI false and the rest true in test when unset", () => {
      const env = parseEnv(localFixture({ NODE_ENV: "test" }))

      expect(env.API_DOCS_ENABLED).toBe(true)
      expect(env.API_DOCS_UI_ENABLED).toBe(false)
      expect(env.API_DOCS_PUBLIC_ENABLED).toBe(true)
      expect(env.API_DOCS_INTERNAL_ENABLED).toBe(true)
    })

    it("defaults all four flags false in production when unset (fail-closed)", () => {
      const env = parseEnv(productionFixture())

      expect(env.API_DOCS_ENABLED).toBe(false)
      expect(env.API_DOCS_UI_ENABLED).toBe(false)
      expect(env.API_DOCS_PUBLIC_ENABLED).toBe(false)
      expect(env.API_DOCS_INTERNAL_ENABLED).toBe(false)
    })

    it("accepts explicit true/false overrides for each flag", () => {
      const env = parseEnv(
        localFixture({
          API_DOCS_ENABLED: "false",
          API_DOCS_UI_ENABLED: "false",
          API_DOCS_PUBLIC_ENABLED: "false",
          API_DOCS_INTERNAL_ENABLED: "false",
        })
      )

      expect(env.API_DOCS_ENABLED).toBe(false)
      expect(env.API_DOCS_UI_ENABLED).toBe(false)
      expect(env.API_DOCS_PUBLIC_ENABLED).toBe(false)
      expect(env.API_DOCS_INTERNAL_ENABLED).toBe(false)

      const enabled = parseEnv(
        productionFixture({
          API_DOCS_ENABLED: "true",
          API_DOCS_UI_ENABLED: "true",
          API_DOCS_PUBLIC_ENABLED: "true",
          API_DOCS_INTERNAL_ENABLED: "true",
        })
      )

      expect(enabled.API_DOCS_ENABLED).toBe(true)
      expect(enabled.API_DOCS_UI_ENABLED).toBe(true)
      expect(enabled.API_DOCS_PUBLIC_ENABLED).toBe(true)
      expect(enabled.API_DOCS_INTERNAL_ENABLED).toBe(true)
    })

    it("rejects invalid boolean values for each API docs flag", () => {
      for (const field of [
        "API_DOCS_ENABLED",
        "API_DOCS_UI_ENABLED",
        "API_DOCS_PUBLIC_ENABLED",
        "API_DOCS_INTERNAL_ENABLED",
      ] as const) {
        expectErrorWithoutValues(
          () => parseEnv(localFixture({ [field]: "maybe" })),
          field
        )
      }
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
  it("documents API docs exposure flags as disabled by default", () => {
    const template = fs.readFileSync(templatePath, "utf8")

    expect(template).toMatch(/^API_DOCS_ENABLED=false$/m)
    expect(template).toMatch(/^API_DOCS_UI_ENABLED=false$/m)
    expect(template).toMatch(/^API_DOCS_PUBLIC_ENABLED=false$/m)
    expect(template).toMatch(/^API_DOCS_INTERNAL_ENABLED=false$/m)
  })

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

  it("documents STORE_IDEMPOTENCY_KEY_PEPPER as synthetic placeholder only", () => {
    const template = fs.readFileSync(templatePath, "utf8")

    expect(template).toMatch(/^STORE_IDEMPOTENCY_KEY_PEPPER=/m)
    expect(template).toMatch(
      /STORE_IDEMPOTENCY_KEY_PEPPER=<base64url-32-plus-random-bytes>/
    )
    expect(template).not.toContain(syntheticStoreIdempotencyPepper)
    expect(template).not.toContain(STORE_IDEMPOTENCY_KEY_PEPPER_DEV_DEFAULT)
  })

  it("documents CUSTOMER_AUTH_BFF_SERVICE_SECRET as an empty placeholder only", () => {
    const template = fs.readFileSync(templatePath, "utf8")
    const assignmentOccurrences =
      template.split("CUSTOMER_AUTH_BFF_SERVICE_SECRET=").length - 1
    const emptyAssignmentLines = template
      .split(/\r?\n/)
      .filter((line) => line === "CUSTOMER_AUTH_BFF_SERVICE_SECRET=")

    expect(assignmentOccurrences).toBe(1)
    expect(emptyAssignmentLines).toHaveLength(1)
    expect(template).not.toContain(syntheticBffServiceSecret)
    expect(template).not.toContain(productionSecret)
  })
})

describe("CUSTOMER_AUTH_BFF_SERVICE_SECRET contract", () => {
  it("leaves the BFF service secret unset in development when absent", () => {
    const parsed = parseEnv(
      localFixture({
        CUSTOMER_AUTH_BFF_SERVICE_SECRET: undefined,
      })
    )

    expect(parsed.CUSTOMER_AUTH_BFF_SERVICE_SECRET).toBeUndefined()
  })

  it("accepts a synthetic high-entropy local secret without returning it in errors", () => {
    const parsed = parseEnv(
      localFixture({
        CUSTOMER_AUTH_BFF_SERVICE_SECRET: syntheticBffServiceSecret,
      })
    )

    expect(parsed.CUSTOMER_AUTH_BFF_SERVICE_SECRET).toBe(syntheticBffServiceSecret)
  })

  it("rejects an inadequate local secret without leaking the value", () => {
    expectErrorWithoutValues(
      () =>
        parseEnv(
          localFixture({
            CUSTOMER_AUTH_BFF_SERVICE_SECRET: "supersecret",
          })
        ),
      "CUSTOMER_AUTH_BFF_SERVICE_SECRET",
      ["supersecret"]
    )
  })
})

describe("STORE_IDEMPOTENCY_KEY_PEPPER contract", () => {
  it("uses deterministic synthetic default in development when unset", () => {
    const parsed = parseEnv(
      localFixture({
        STORE_IDEMPOTENCY_KEY_PEPPER: undefined,
      })
    )

    expect(parsed.STORE_IDEMPOTENCY_KEY_PEPPER).toBe(
      STORE_IDEMPOTENCY_KEY_PEPPER_DEV_DEFAULT
    )
  })

  it("uses deterministic synthetic default in test when unset", () => {
    const parsed = parseEnv(
      localFixture({
        NODE_ENV: "test",
        STORE_IDEMPOTENCY_KEY_PEPPER: undefined,
      })
    )

    expect(parsed.STORE_IDEMPOTENCY_KEY_PEPPER).toBe(
      STORE_IDEMPOTENCY_KEY_PEPPER_DEV_DEFAULT
    )
  })

  it("fails closed in production when pepper is missing without leaking values", () => {
    expectErrorWithoutValues(
      () =>
        parseEnv(
          productionFixture({
            STORE_IDEMPOTENCY_KEY_PEPPER: undefined,
          })
        ),
      "STORE_IDEMPOTENCY_KEY_PEPPER",
      [syntheticStoreIdempotencyPepper]
    )
  })

  it("rejects invalid base64url in production without leaking the value", () => {
    const invalid = "not+valid/base64!!"
    expectErrorWithoutValues(
      () =>
        parseEnv(
          productionFixture({
            STORE_IDEMPOTENCY_KEY_PEPPER: invalid,
          })
        ),
      "STORE_IDEMPOTENCY_KEY_PEPPER",
      [invalid]
    )
  })

  it("rejects decoded pepper shorter than 32 bytes without leaking the value", () => {
    expectErrorWithoutValues(
      () =>
        parseEnv(
          productionFixture({
            STORE_IDEMPOTENCY_KEY_PEPPER: shortStoreIdempotencyPepper,
          })
        ),
      "STORE_IDEMPOTENCY_KEY_PEPPER",
      [shortStoreIdempotencyPepper]
    )
  })

  it("accepts valid base64url pepper with at least 32 decoded bytes in production", () => {
    const parsed = parseEnv(
      productionFixture({
        STORE_IDEMPOTENCY_KEY_PEPPER: syntheticStoreIdempotencyPepper,
      })
    )

    expect(parsed.STORE_IDEMPOTENCY_KEY_PEPPER).toBe(
      syntheticStoreIdempotencyPepper
    )
    expect(JSON.stringify(parsed)).toContain("STORE_IDEMPOTENCY_KEY_PEPPER")
  })

  it("hashes Idempotency-Key with HMAC-SHA-256 byte-for-byte and never embeds plaintext", () => {
    const rawKey = "Retry-Key-ABC"
    const same = hashStoreIdempotencyKey(
      rawKey,
      syntheticStoreIdempotencyPepper
    )
    const again = hashStoreIdempotencyKey(
      rawKey,
      syntheticStoreIdempotencyPepper
    )
    const differentKey = hashStoreIdempotencyKey(
      "Retry-Key-abc",
      syntheticStoreIdempotencyPepper
    )
    const differentPepper = hashStoreIdempotencyKey(
      rawKey,
      alternateStoreIdempotencyPepper
    )

    expect(same).toBe(again)
    expect(same).not.toBe(differentKey)
    expect(same).not.toBe(differentPepper)
    expect(same).not.toContain(rawKey)
    expect(same).toMatch(/^[a-f0-9]{64}$/)
    expect(STORE_IDEMPOTENCY_HASH_VERSION).toBe("hmac-sha256-v1")
    expect(STORE_IDEMPOTENCY_PEPPER_VERSION).toBe(1)

    expect(() => assertValidRawIdempotencyKey(" abc")).toThrow(
      /STORE_IDEMPOTENCY_KEY_CHARSET_INVALID/
    )
    expect(() => assertValidRawIdempotencyKey("abc ")).toThrow(
      /STORE_IDEMPOTENCY_KEY_CHARSET_INVALID/
    )
    expect(() => assertValidRawIdempotencyKey("")).toThrow(
      /STORE_IDEMPOTENCY_KEY_LENGTH_INVALID/
    )
    expect(() => assertValidRawIdempotencyKey("a".repeat(256))).toThrow(
      /STORE_IDEMPOTENCY_KEY_LENGTH_INVALID/
    )
  })
})

describe("P13-13-04-CP-R1 store idempotency foundation regressions", () => {
  const now = new Date("2026-08-08T12:00:00.000Z")

  /**
   * Initial Store claim shape: processing + progress deadline, NO lifecycle lease.
   * locked_at stays null until claimLifecycleRow() succeeds.
   */
  function initialProcessingRow(
    claimAt: Date = now,
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      id: "stidem_1",
      operation: "phase13.local-mutation",
      actor_scope_hash: "a".repeat(64),
      resource_scope_hash: "b".repeat(64),
      idempotency_key_hash: "c".repeat(64),
      hash_version: STORE_IDEMPOTENCY_HASH_VERSION,
      pepper_version: STORE_IDEMPOTENCY_PEPPER_VERSION,
      request_fingerprint: "d".repeat(64),
      state: "processing",
      state_version: 1,
      result_type: null,
      result_id: null,
      response_status: null,
      result_safe_metadata: null,
      locked_at: null,
      state_deadline_at: new Date(
        claimAt.getTime() + STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS
      ).toISOString(),
      next_retry_at: null,
      retry_attempt_count: 0,
      retry_started_at: null,
      terminalized_at: null,
      completed_at: null,
      failure_code: null,
      expires_at: null,
      created_at: claimAt.toISOString(),
      updated_at: claimAt.toISOString(),
      ...overrides,
    }
  }

  /** Row after a successful claimLifecycleRow() at leaseAt (15m exclusive lease). */
  function lifecycleLeasedRow(
    leaseAt: Date,
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return initialProcessingRow(leaseAt, {
      state_version: 2,
      locked_at: leaseAt.toISOString(),
      // Typically already due when a lifecycle worker claims for recovery.
      state_deadline_at: new Date(leaseAt.getTime() - 1).toISOString(),
      updated_at: leaseAt.toISOString(),
      ...overrides,
    })
  }

  /** Lifecycle lease that is stale at/after the exact 15m boundary relative to nowAt. */
  function staleLifecycleLeasedRow(
    nowAt: Date = now,
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    const leaseAt = new Date(
      nowAt.getTime() - STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS
    )
    return lifecycleLeasedRow(leaseAt, {
      state_deadline_at: new Date(
        nowAt.getTime() - STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS
      ).toISOString(),
      ...overrides,
    })
  }

  /** Generic seed helper — defaults to an already-due processing row without a lease. */
  function baseRow(
    overrides: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return initialProcessingRow(now, {
      state_deadline_at: new Date(
        now.getTime() - STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS
      ).toISOString(),
      ...overrides,
    })
  }

  function createServiceHarness(seed: Record<string, unknown>[]) {
    const rows = seed.map((row) => ({ ...row }))
    const sqlCalls: Array<{ sql: string; bindings: unknown[] }> = []

    const knex = {
      async transaction<T>(fn: (trx: typeof knex) => Promise<T>): Promise<T> {
        return fn(knex)
      },
      async raw(sql: string, bindings: unknown[] = []) {
        sqlCalls.push({ sql, bindings })
        const normalized = sql.replace(/\s+/g, " ").toLowerCase()

        if (
          normalized.includes("with doomed as") &&
          normalized.includes("delete from store_idempotency_record")
        ) {
          const expiresCutoff = String(bindings[0])
          const leaseCutoff = String(bindings[1])
          const limit = Number(bindings[2])
          const doomedIds: string[] = []
          const candidates = rows
            .filter((row) => {
              const state = String(row.state)
              const expires = row.expires_at ? String(row.expires_at) : null
              const lockedAt = row.locked_at ? String(row.locked_at) : null
              const terminal =
                state === "completed" ||
                state === "failed_terminal" ||
                state === "reconciliation_unresolved"
              const expired = expires != null && expires <= expiresCutoff
              const leaseOk = lockedAt == null || lockedAt <= leaseCutoff
              return terminal && expired && leaseOk
            })
            .sort((a, b) =>
              String(a.expires_at).localeCompare(String(b.expires_at))
            )
            .slice(0, limit)

          for (const candidate of candidates) {
            const idx = rows.findIndex((row) => row.id === candidate.id)
            if (idx >= 0) {
              doomedIds.push(String(rows[idx].id))
              rows.splice(idx, 1)
            }
          }
          return { rows: doomedIds.map((id) => ({ id })) }
        }

        if (
          normalized.includes("insert into store_idempotency_record") &&
          normalized.includes("on conflict")
        ) {
          const operation = String(bindings[1])
          const actor = String(bindings[2])
          const resource = String(bindings[3])
          const keyHash = String(bindings[4])
          const existing = rows.find(
            (row) =>
              row.operation === operation &&
              row.actor_scope_hash === actor &&
              row.resource_scope_hash === resource &&
              row.idempotency_key_hash === keyHash
          )
          if (existing) {
            return { rows: [] }
          }
          const inserted = {
            id: String(bindings[0]),
            operation,
            actor_scope_hash: actor,
            resource_scope_hash: resource,
            idempotency_key_hash: keyHash,
            hash_version: String(bindings[5]),
            pepper_version: Number(bindings[6]),
            request_fingerprint: String(bindings[7]),
            state: "processing",
            state_version: 1,
            result_type: null,
            result_id: null,
            response_status: null,
            result_safe_metadata: null,
            locked_at: bindings[8] == null ? null : String(bindings[8]),
            state_deadline_at: String(bindings[9]),
            next_retry_at: null,
            retry_attempt_count: 0,
            retry_started_at: null,
            terminalized_at: null,
            completed_at: null,
            failure_code: null,
            expires_at: null,
            created_at: String(bindings[10]),
            updated_at: String(bindings[11]),
          }
          rows.push(inserted)
          return { rows: [inserted] }
        }

        if (
          normalized.includes("select * from store_idempotency_record") &&
          normalized.includes("idempotency_key_hash = ?") &&
          normalized.includes("for update")
        ) {
          const found = rows.find(
            (row) =>
              row.operation === bindings[0] &&
              row.actor_scope_hash === bindings[1] &&
              row.resource_scope_hash === bindings[2] &&
              row.idempotency_key_hash === bindings[3]
          )
          return { rows: found ? [{ ...found }] : [] }
        }

        if (
          normalized.includes("select * from store_idempotency_record") &&
          normalized.includes("order by updated_at asc")
        ) {
          const dueNow = String(bindings[0])
          const leaseCutoff = String(bindings[4])
          const limit = Number(bindings[5])
          const due = rows.filter((row) => {
            const state = String(row.state)
            const deadline = row.state_deadline_at
              ? String(row.state_deadline_at)
              : null
            const nextRetry = row.next_retry_at
              ? String(row.next_retry_at)
              : null
            const expires = row.expires_at ? String(row.expires_at) : null
            const lockedAt = row.locked_at ? String(row.locked_at) : null

            const stateDue =
              ((state === "processing" ||
                state === "reconciliation_required") &&
                deadline != null &&
                deadline <= dueNow) ||
              (state === "failed_retryable" &&
                ((nextRetry != null && nextRetry <= dueNow) ||
                  (deadline != null && deadline <= dueNow))) ||
              ((state === "completed" ||
                state === "failed_terminal" ||
                state === "reconciliation_unresolved") &&
                expires != null &&
                expires <= dueNow)

            const leaseClaimable =
              lockedAt == null || lockedAt <= leaseCutoff
            return stateDue && leaseClaimable
          })
          return { rows: due.slice(0, limit).map((row) => ({ ...row })) }
        }

        if (
          normalized.includes("update store_idempotency_record") &&
          normalized.includes("state_version = state_version + 1") &&
          normalized.includes("locked_at = ?") &&
          normalized.includes("locked_at is null") &&
          !normalized.includes("state = ?,")
        ) {
          const lockedAt = String(bindings[0])
          const updatedAt = String(bindings[1])
          const id = String(bindings[2])
          const expectedState = String(bindings[3])
          const expectedVersion = Number(bindings[4])
          const leaseCutoff = String(bindings[5])
          const idx = rows.findIndex((row) => row.id === id)
          if (idx < 0) {
            return { rows: [] }
          }
          const current = rows[idx]
          const currentLocked = current.locked_at
            ? String(current.locked_at)
            : null
          const leaseOk =
            currentLocked == null || currentLocked <= leaseCutoff
          if (
            String(current.state) !== expectedState ||
            Number(current.state_version) !== expectedVersion ||
            !leaseOk
          ) {
            return { rows: [] }
          }
          const updated = {
            ...current,
            state_version: Number(current.state_version) + 1,
            locked_at: lockedAt,
            updated_at: updatedAt,
          }
          rows[idx] = updated
          return { rows: [{ ...updated }] }
        }

        if (
          normalized.includes("update store_idempotency_record") &&
          normalized.includes("set state = ?")
        ) {
          const nextState = String(bindings[0])
          const id = String(bindings[15])
          const expectedState = String(bindings[16])
          const expectedVersion = Number(bindings[17])
          const idx = rows.findIndex((row) => row.id === id)
          if (idx < 0) {
            return { rows: [] }
          }
          const current = rows[idx]
          if (
            String(current.state) !== expectedState ||
            Number(current.state_version) !== expectedVersion
          ) {
            return { rows: [] }
          }
          const updated = {
            ...current,
            state: nextState,
            state_version: Number(current.state_version) + 1,
            state_deadline_at: bindings[1],
            next_retry_at: bindings[2],
            retry_attempt_count:
              bindings[3] == null
                ? current.retry_attempt_count
                : Number(bindings[3]),
            retry_started_at: bindings[4],
            locked_at: bindings[5],
            result_type: bindings[6],
            result_id: bindings[7],
            response_status: bindings[8],
            result_safe_metadata: bindings[9],
            failure_code: bindings[10],
            completed_at: bindings[11],
            terminalized_at: bindings[12],
            expires_at: bindings[13],
            updated_at: bindings[14],
          }
          rows[idx] = updated
          return { rows: [{ ...updated }] }
        }

        if (
          normalized.includes("select * from store_idempotency_record where id = ?")
        ) {
          const found = rows.find((row) => row.id === bindings[0])
          return { rows: found ? [{ ...found }] : [] }
        }

        throw new Error(`Unexpected SQL in harness: ${sql}`)
      },
    }

    const service = Object.create(
      StoreIdempotencyModuleService.prototype
    ) as StoreIdempotencyModuleService
    Object.defineProperty(service, "baseRepository_", {
      value: {
        getActiveManager: () => ({
          getKnex: () => knex,
        }),
      },
    })

    return { service, rows, sqlCalls }
  }

  it("allows only SPEC §6.5 transitions and forbids the blocked matrix cells", () => {
    const allowed: Array<[StoreIdempotencyState, StoreIdempotencyState]> = [
      ["processing", "completed"],
      ["processing", "failed_retryable"],
      ["processing", "failed_terminal"],
      ["processing", "reconciliation_required"],
      ["failed_retryable", "processing"],
      ["failed_retryable", "completed"],
      ["failed_retryable", "failed_terminal"],
      ["failed_retryable", "reconciliation_required"],
      ["reconciliation_required", "completed"],
      ["reconciliation_required", "failed_terminal"],
      ["reconciliation_required", "reconciliation_unresolved"],
    ]

    for (const [from, to] of allowed) {
      expect(() =>
        assertStoreIdempotencyTransitionAllowed(from, to)
      ).not.toThrow()
      expect(STORE_IDEMPOTENCY_ALLOWED_TRANSITIONS[from]).toContain(to)
    }

    const forbidden: Array<[StoreIdempotencyState, StoreIdempotencyState]> = [
      ["completed", "processing"],
      ["completed", "failed_retryable"],
      ["failed_terminal", "processing"],
      ["failed_terminal", "reconciliation_required"],
      ["reconciliation_required", "processing"],
      ["reconciliation_required", "failed_retryable"],
      ["reconciliation_unresolved", "processing"],
      ["reconciliation_unresolved", "completed"],
      ["reconciliation_unresolved", "failed_retryable"],
      ["reconciliation_unresolved", "failed_terminal"],
      ["reconciliation_unresolved", "reconciliation_required"],
      ["processing", "reconciliation_unresolved"],
      ["failed_retryable", "failed_retryable"],
    ]

    for (const [from, to] of forbidden) {
      expect(() => assertStoreIdempotencyTransitionAllowed(from, to)).toThrow(
        /STORE_IDEMPOTENCY_TRANSITION_FORBIDDEN/
      )
    }
  })

  it("keeps terminal states immutable through transitionWithPredicate", async () => {
    const terminals: StoreIdempotencyState[] = [
      "completed",
      "failed_terminal",
      "reconciliation_unresolved",
    ]

    for (const terminal of terminals) {
      const { service } = createServiceHarness([
        baseRow({
          state: terminal,
          state_version: 4,
          terminalized_at: now.toISOString(),
          expires_at: new Date(now.getTime() + 86400000).toISOString(),
          locked_at: null,
          state_deadline_at: null,
        }),
      ])

      await expect(
        service.transitionWithPredicate({
          id: "stidem_1",
          expectedState: terminal,
          expectedStateVersion: 4,
          at: now,
          next: {
            state: "processing",
            state_deadline_at: new Date(now.getTime() + 60000),
            locked_at: now,
          },
        })
      ).rejects.toThrow(/STORE_IDEMPOTENCY_TRANSITION_FORBIDDEN/)
    }
  })

  it("returns replay for reconciliation_unresolved and does not mutate ownership", async () => {
    const fingerprint = buildStoreIdempotencyRequestFingerprint({
      cart_id: "cart_01HTEST",
      op: "phase13.local-mutation",
    })
    const rawKey = "Retry-Key-ABC"
    const actorScope = { customer_id: "cus_1" }
    const resourceScope = { cart_id: "cart_01HTEST" }
    const keyHash = hashStoreIdempotencyKey(
      rawKey,
      env.STORE_IDEMPOTENCY_KEY_PEPPER
    )
    const seeded = baseRow({
      state: "reconciliation_unresolved",
      state_version: 7,
      request_fingerprint: fingerprint,
      idempotency_key_hash: keyHash,
      actor_scope_hash: hashStoreIdempotencyScope(actorScope),
      resource_scope_hash: hashStoreIdempotencyScope(resourceScope),
      locked_at: null,
      state_deadline_at: null,
      terminalized_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 30 * 86400000).toISOString(),
      updated_at: now.toISOString(),
    })
    const { service, rows } = createServiceHarness([seeded])

    const result = await service.claim({
      operation: "phase13.local-mutation",
      actorScope,
      resourceScope,
      rawIdempotencyKey: rawKey,
      canonicalSemanticObject: {
        cart_id: "cart_01HTEST",
        op: "phase13.local-mutation",
      },
      at: now,
    })

    expect(result.type).toBe("replay")
    expect(result.type).not.toBe("in_progress")
    expect(rows[0].state).toBe("reconciliation_unresolved")
    expect(rows[0].state_version).toBe(7)
    expect(rows[0].locked_at).toBeNull()
  })

  it("pins independent processing-stale and lifecycle-lease clocks", () => {
    // P13-13-04-CP-R4 — clocks must remain distinct; never fuse to one timeout.
    expect(STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS).toBe(5 * 60 * 1000)
    expect(STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS).toBe(300_000)
    expect(STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS).toBe(15 * 60 * 1000)
    expect(STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS).toBe(900_000)
    expect(STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS).not.toBe(
      STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS
    )

    const t0 = new Date("2026-08-08T12:00:00.000Z")
    const lockedAt = t0.toISOString()

    const at14m59s = new Date(t0.getTime() + 14 * 60 * 1000 + 59 * 1000)
    expect(isStoreIdempotencyLifecycleLeaseActive(lockedAt, at14m59s)).toBe(true)

    const atExact15m = new Date(t0.getTime() + 15 * 60 * 1000)
    // Helper + SQL share the same stale boundary: locked_at <= now - 900000.
    expect(isStoreIdempotencyLifecycleLeaseActive(lockedAt, atExact15m)).toBe(
      false
    )

    const at15mPlus1ms = new Date(t0.getTime() + 15 * 60 * 1000 + 1)
    expect(isStoreIdempotencyLifecycleLeaseActive(lockedAt, at15mPlus1ms)).toBe(
      false
    )

    expect(storeIdempotencyLifecycleLeaseCutoff(t0).getTime()).toBe(
      t0.getTime() - 900_000
    )
    expect(storeIdempotencyLifecycleLeaseCutoff(t0).getTime()).toBe(
      t0.getTime() - STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS
    )
  })

  it("P13-13-04-CP-R4: processing recovery at 5m is independent of 15m lifecycle lease", async () => {
    expect(STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS).toBe(5 * 60 * 1000)
    expect(STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS).toBe(15 * 60 * 1000)
    expect(STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS).not.toBe(
      STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS
    )

    const t0 = new Date("2026-08-08T12:00:00.000Z")
    const rawKey = "Retry-Key-R4-Clocks"
    const actorScope = { customer_id: "cus_r4" }
    const resourceScope = { cart_id: "cart_01HR4CLOCK" }
    const semantic = {
      cart_id: "cart_01HR4CLOCK",
      op: "phase13.local-mutation",
    }
    const { service, rows } = createServiceHarness([])

    // T0 — initial Store claim: processing + 5m deadline; NO lifecycle lease.
    const claimed = await service.claim({
      operation: "phase13.local-mutation",
      actorScope,
      resourceScope,
      rawIdempotencyKey: rawKey,
      canonicalSemanticObject: semantic,
      at: t0,
    })
    expect(claimed.type).toBe("claimed")
    if (claimed.type !== "claimed") {
      throw new Error("expected initial claim")
    }
    expect(claimed.record.state).toBe("processing")
    expect(claimed.record.locked_at).toBeNull()
    expect(claimed.record.state_deadline_at).toBe(
      new Date(t0.getTime() + STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS).toISOString()
    )
    expect(rows[0].locked_at).toBeNull()

    // Same-intent retry while processing: in_progress, no ownership transfer.
    const retry = await service.claim({
      operation: "phase13.local-mutation",
      actorScope,
      resourceScope,
      rawIdempotencyKey: rawKey,
      canonicalSemanticObject: semantic,
      at: new Date(t0.getTime() + 30_000),
    })
    expect(retry.type).toBe("in_progress")
    expect(rows[0].locked_at).toBeNull()
    expect(rows[0].state_version).toBe(1)

    // T0 + 4m59s — progress deadline not expired; must NOT be recovery-eligible
    // even with no active lifecycle lease (proves no premature recovery).
    const at4m59s = new Date(t0.getTime() + 4 * 60 * 1000 + 59 * 1000)
    const dueBefore5m = await service.listDueLifecycleRows({ now: at4m59s })
    expect(dueBefore5m).toHaveLength(0)

    // T0 + 5m exact — processing recovery eligible immediately (not delayed to 15m).
    const at5m = new Date(t0.getTime() + STORE_IDEMPOTENCY_CLAIM_STALE_AFTER_MS)
    const dueAt5m = await service.listDueLifecycleRows({ now: at5m })
    expect(dueAt5m).toHaveLength(1)
    expect(dueAt5m[0].id).toBe(rows[0].id)

    // Eligibility ≠ automatic transition: state unchanged until lifecycle claim.
    expect(rows[0].state).toBe("processing")
    expect(rows[0].state_version).toBe(1)
    expect(rows[0].locked_at).toBeNull()

    // Worker A acquires lifecycle lease at T0 + 5m → locked_at = T+5m.
    const workerA = await service.claimLifecycleRow({
      id: String(rows[0].id),
      expectedState: "processing",
      expectedStateVersion: 1,
      at: at5m,
    })
    expect(workerA.type).toBe("claimed")
    if (workerA.type !== "claimed") {
      throw new Error("expected Worker A lifecycle claim at T+5m")
    }
    expect(workerA.record.locked_at).toBe(at5m.toISOString())
    expect(workerA.record.state_version).toBe(2)
    expect(rows[0].locked_at).toBe(at5m.toISOString())

    // T0 + 5m + 14m59s = T+19m59s — Worker B blocked on scan and direct claim.
    const at19m59s = new Date(
      at5m.getTime() + 14 * 60 * 1000 + 59 * 1000
    )
    expect(
      isStoreIdempotencyLifecycleLeaseActive(
        rows[0].locked_at as string,
        at19m59s
      )
    ).toBe(true)
    const dueDuringLease = await service.listDueLifecycleRows({
      now: at19m59s,
    })
    expect(dueDuringLease).toHaveLength(0)
    const workerBDuring = await service.claimLifecycleRow({
      id: String(rows[0].id),
      expectedState: "processing",
      expectedStateVersion: 2,
      at: at19m59s,
    })
    expect(workerBDuring.type).toBe("lost")
    expect(rows[0].state_version).toBe(2)

    // T0 + 5m + 15m = T+20m — lease STALE at exact boundary; B may reclaim.
    const at20m = new Date(at5m.getTime() + STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS)
    expect(
      isStoreIdempotencyLifecycleLeaseActive(rows[0].locked_at as string, at20m)
    ).toBe(false)
    const dueAt20m = await service.listDueLifecycleRows({ now: at20m })
    expect(dueAt20m).toHaveLength(1)
    const workerBReclaim = await service.claimLifecycleRow({
      id: String(rows[0].id),
      expectedState: "processing",
      expectedStateVersion: 2,
      at: at20m,
    })
    expect(workerBReclaim.type).toBe("claimed")
    if (workerBReclaim.type !== "claimed") {
      throw new Error("expected Worker B reclaim at exact T+20m")
    }
    expect(workerBReclaim.record.state_version).toBe(3)
    expect(workerBReclaim.record.locked_at).toBe(at20m.toISOString())
  })

  it("enforces exclusive fresh lifecycle lease and allows stale lease recovery", async () => {
    expect(STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS).toBe(15 * 60 * 1000)
    // Already-due processing row without a lease (not a pre-stale 15m lock).
    const { service, rows } = createServiceHarness([baseRow()])

    const dueBefore = await service.listDueLifecycleRows({ now })
    expect(dueBefore).toHaveLength(1)

    const workerA = await service.claimLifecycleRow({
      id: "stidem_1",
      expectedState: "processing",
      expectedStateVersion: 1,
      at: now,
    })
    expect(workerA.type).toBe("claimed")
    if (workerA.type !== "claimed") {
      throw new Error("expected worker A lifecycle claim")
    }
    expect(workerA.record.state_version).toBe(2)
    expect(isStoreIdempotencyLifecycleLeaseActive(rows[0].locked_at as string, now)).toBe(
      true
    )

    const dueAfterA = await service.listDueLifecycleRows({ now })
    expect(dueAfterA).toHaveLength(0)

    const workerB = await service.claimLifecycleRow({
      id: "stidem_1",
      expectedState: "processing",
      expectedStateVersion: 2,
      at: now,
    })
    expect(workerB.type).toBe("lost")
    expect(rows[0].state_version).toBe(2)

    // Exact T+15m from Worker A's lease is STALE for both scan and claim.
    const atExact15m = new Date(now.getTime() + STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS)
    expect(
      isStoreIdempotencyLifecycleLeaseActive(
        rows[0].locked_at as string,
        atExact15m
      )
    ).toBe(false)
    expect(storeIdempotencyLifecycleLeaseCutoff(atExact15m).getTime()).toBe(
      atExact15m.getTime() - STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS
    )

    const dueAtExact15m = await service.listDueLifecycleRows({
      now: atExact15m,
    })
    expect(dueAtExact15m).toHaveLength(1)

    const workerRecover = await service.claimLifecycleRow({
      id: "stidem_1",
      expectedState: "processing",
      expectedStateVersion: 2,
      at: atExact15m,
    })
    expect(workerRecover.type).toBe("claimed")
    if (workerRecover.type !== "claimed") {
      throw new Error("expected stale lifecycle reclaim at exact T+15m")
    }
    expect(workerRecover.record.state_version).toBe(3)

    // Harness helpers remain distinguishable.
    expect(initialProcessingRow(now).locked_at).toBeNull()
    expect(lifecycleLeasedRow(now).locked_at).toBe(now.toISOString())
    expect(staleLifecycleLeasedRow(now).locked_at).toBe(
      new Date(now.getTime() - STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS).toISOString()
    )
  })

  it("rejects sensitive canaries inside allowlisted metadata and result fields", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signature"
    const cpf = "52998224725"
    const pix = "00020126580014br.gov.bcb.pix0136123"
    const capability = "cap_live_eyJhbGciOiJub25lIn0.payload"
    const providerPayload = "provider_payload:{charge:raw}"
    const rawKey = "Retry-Key-ABC"
    const pepper = STORE_IDEMPOTENCY_KEY_PEPPER_DEV_DEFAULT

    expect(() =>
      sanitizeStoreIdempotencySafeMetadata({
        correlation_ref: jwt,
      })
    ).toThrow(/STORE_IDEMPOTENCY_SAFE_VALUE_INVALID|SENSITIVE_VALUE_FORBIDDEN/)

    expect(() =>
      sanitizeStoreIdempotencySafeMetadata({
        correlation_ref: cpf,
      })
    ).toThrow(/STORE_IDEMPOTENCY_SAFE_VALUE_INVALID/)

    expect(() =>
      sanitizeStoreIdempotencySafeMetadata({
        correlation_ref: "Authorization",
      })
    ).toThrow(/STORE_IDEMPOTENCY_SAFE_VALUE_INVALID/)

    expect(() =>
      sanitizeStoreIdempotencySafeMetadata({
        result_id: "client_secret_value",
      })
    ).toThrow(/STORE_IDEMPOTENCY_SAFE_VALUE_INVALID|SENSITIVE_VALUE_FORBIDDEN/)

    expect(() =>
      sanitizeStoreIdempotencySafeMetadata({
        correlation_ref: pix,
      })
    ).toThrow(/STORE_IDEMPOTENCY_SAFE_VALUE_INVALID|SENSITIVE_VALUE_FORBIDDEN/)

    expect(() =>
      sanitizeStoreIdempotencySafeMetadata({
        correlation_ref: capability,
      })
    ).toThrow(/STORE_IDEMPOTENCY_SAFE_VALUE_INVALID|SENSITIVE_VALUE_FORBIDDEN/)

    expect(() =>
      sanitizeStoreIdempotencySafeMetadata({
        harness: providerPayload,
      })
    ).toThrow(/STORE_IDEMPOTENCY_SAFE_VALUE_INVALID|SENSITIVE_VALUE_FORBIDDEN/)

    expect(() =>
      sanitizeStoreIdempotencySafeMetadata({
        correlation_ref: rawKey,
      })
    ).toThrow(/STORE_IDEMPOTENCY_SAFE_VALUE_INVALID/)

    expect(() =>
      sanitizeStoreIdempotencySafeMetadata({
        correlation_ref: pepper,
      })
    ).toThrow(/STORE_IDEMPOTENCY_SAFE_VALUE_INVALID/)

    expect(() =>
      assertNoSensitiveStoreIdempotencyPersistence({
        result_safe_metadata: { correlation_ref: jwt },
      })
    ).toThrow(/STORE_IDEMPOTENCY_SENSITIVE_VALUE_FORBIDDEN/)

    const safe = sanitizeStoreIdempotencySafeMetadata({
      operation: "phase13.local-mutation",
      result_type: "local_mutation_result",
      result_id: "ord_01HSAFEID",
      failure_code: "timeout",
      harness: "phase13.local-mutation",
      correlation_ref: "corr_01HSAFE",
      response_status: 200,
    })
    expect(safe).toMatchObject({
      result_id: "ord_01HSAFEID",
      correlation_ref: "corr_01HSAFE",
    })
  })

  it("preserves Idempotency-Key HMAC and fingerprint contracts", () => {
    const rawKey = "Retry-Key-ABC"
    const hash = hashStoreIdempotencyKey(
      rawKey,
      STORE_IDEMPOTENCY_KEY_PEPPER_DEV_DEFAULT
    )
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(hash).not.toContain(rawKey)
    expect(STORE_IDEMPOTENCY_HASH_VERSION).toBe("hmac-sha256-v1")
    expect(STORE_IDEMPOTENCY_PEPPER_VERSION).toBe(1)

    const fp = buildStoreIdempotencyRequestFingerprint({
      b: 2,
      a: 1,
      nested: { z: true, m: [1, 2] },
    })
    const fpAgain = buildStoreIdempotencyRequestFingerprint({
      a: 1,
      nested: { m: [1, 2], z: true },
      b: 2,
    })
    expect(fp).toBe(fpAgain)
    expect(fp).toMatch(/^[a-f0-9]{64}$/)
  })

  it("keeps cleanup from deleting terminals under a live lifecycle lease", async () => {
    expect(STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS).toBe(15 * 60 * 1000)
    const expiredAt = new Date(now.getTime() - 60_000).toISOString()
    const { service, rows } = createServiceHarness([
      baseRow({
        id: "stidem_completed_live",
        state: "completed",
        state_version: 3,
        locked_at: null,
        state_deadline_at: null,
        terminalized_at: expiredAt,
        completed_at: expiredAt,
        expires_at: expiredAt,
      }),
    ])

    const due = await service.listDueLifecycleRows({ now })
    expect(due).toHaveLength(1)

    const claimed = await service.claimLifecycleRow({
      id: "stidem_completed_live",
      expectedState: "completed",
      expectedStateVersion: 3,
      at: now,
    })
    expect(claimed.type).toBe("claimed")
    if (claimed.type !== "claimed") {
      throw new Error("expected lifecycle claim on expired terminal")
    }
    expect(claimed.record.state_version).toBe(4)
    expect(isStoreIdempotencyLifecycleLeaseActive(rows[0].locked_at as string, now)).toBe(
      true
    )

    // Before the human 15-minute stale boundary, cleanup must not delete.
    const before15m = new Date(now.getTime() + 14 * 60 * 1000 + 59 * 1000)
    expect(
      isStoreIdempotencyLifecycleLeaseActive(
        rows[0].locked_at as string,
        before15m
      )
    ).toBe(true)
    const deletedDuringLiveLease = await service.cleanupExpiredTerminals({
      now: before15m,
    })
    expect(deletedDuringLiveLease).toBe(0)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe("stidem_completed_live")

    const atExact15m = new Date(now.getTime() + 15 * 60 * 1000)
    expect(
      isStoreIdempotencyLifecycleLeaseActive(
        rows[0].locked_at as string,
        atExact15m
      )
    ).toBe(false)

    const deletedAtBoundary = await service.cleanupExpiredTerminals({
      now: atExact15m,
    })
    expect(deletedAtBoundary).toBe(1)
    expect(rows).toHaveLength(0)

    const secondCleanup = await service.cleanupExpiredTerminals({
      now: atExact15m,
    })
    expect(secondCleanup).toBe(0)
  })

  it("cleanup removes only expired terminals without an active lifecycle lease", async () => {
    const expired = new Date(now.getTime() - 1_000).toISOString()
    const future = new Date(now.getTime() + 3_600_000).toISOString()
    const staleLocked = new Date(
      now.getTime() - STORE_IDEMPOTENCY_LIFECYCLE_LEASE_MS - 1
    ).toISOString()

    const { service, rows } = createServiceHarness([
      baseRow({
        id: "stidem_fresh_completed",
        state: "completed",
        state_version: 2,
        locked_at: null,
        state_deadline_at: null,
        terminalized_at: now.toISOString(),
        completed_at: now.toISOString(),
        expires_at: future,
      }),
      baseRow({
        id: "stidem_expired_completed",
        state: "completed",
        state_version: 2,
        locked_at: null,
        state_deadline_at: null,
        terminalized_at: expired,
        completed_at: expired,
        expires_at: expired,
      }),
      baseRow({
        id: "stidem_expired_failed_terminal",
        state: "failed_terminal",
        state_version: 2,
        locked_at: staleLocked,
        state_deadline_at: null,
        terminalized_at: expired,
        expires_at: expired,
        failure_code: "timeout",
      }),
      baseRow({
        id: "stidem_expired_unresolved",
        state: "reconciliation_unresolved",
        state_version: 2,
        locked_at: null,
        state_deadline_at: null,
        terminalized_at: expired,
        expires_at: expired,
      }),
      baseRow({
        id: "stidem_processing",
        state: "processing",
        state_version: 1,
        locked_at: null,
        state_deadline_at: expired,
        expires_at: expired,
      }),
    ])

    const deleted = await service.cleanupExpiredTerminals({ now })
    expect(deleted).toBe(3)
    expect(rows.map((row) => row.id).sort()).toEqual([
      "stidem_fresh_completed",
      "stidem_processing",
    ])

    const again = await service.cleanupExpiredTerminals({ now })
    expect(again).toBe(0)
  })

  it("rejects invalid top-level response_status before SQL", async () => {
    expect(assertValidStoreIdempotencyResponseStatus(null)).toBeNull()
    expect(assertValidStoreIdempotencyResponseStatus(100)).toBe(100)
    expect(assertValidStoreIdempotencyResponseStatus(200)).toBe(200)
    expect(assertValidStoreIdempotencyResponseStatus(409)).toBe(409)
    expect(assertValidStoreIdempotencyResponseStatus(500)).toBe(500)
    expect(assertValidStoreIdempotencyResponseStatus(599)).toBe(599)

    for (const invalid of [99, 600, 0, -1, 200.5, Number.NaN, Number.POSITIVE_INFINITY, "200"]) {
      expect(() => assertValidStoreIdempotencyResponseStatus(invalid)).toThrow(
        /STORE_IDEMPOTENCY_RESPONSE_STATUS_INVALID/
      )
    }

    const { service, rows, sqlCalls } = createServiceHarness([baseRow()])
    const updateCallsBefore = sqlCalls.filter((call) =>
      call.sql.toLowerCase().includes("update store_idempotency_record")
    ).length

    await expect(
      service.transitionWithPredicate({
        id: "stidem_1",
        expectedState: "processing",
        expectedStateVersion: 1,
        at: now,
        next: {
          state: "completed",
          response_status: 99,
          terminalized_at: now,
          expires_at: new Date(now.getTime() + 86_400_000),
          completed_at: now,
          state_deadline_at: null,
        },
      })
    ).rejects.toThrow(/STORE_IDEMPOTENCY_RESPONSE_STATUS_INVALID/)

    await expect(
      service.transitionWithPredicate({
        id: "stidem_1",
        expectedState: "processing",
        expectedStateVersion: 1,
        at: now,
        next: {
          state: "completed",
          response_status: 600 as unknown as number,
          terminalized_at: now,
          expires_at: new Date(now.getTime() + 86_400_000),
          completed_at: now,
          state_deadline_at: null,
        },
      })
    ).rejects.toThrow(/STORE_IDEMPOTENCY_RESPONSE_STATUS_INVALID/)

    await expect(
      service.transitionWithPredicate({
        id: "stidem_1",
        expectedState: "processing",
        expectedStateVersion: 1,
        at: now,
        next: {
          state: "completed",
          response_status: 200.5 as unknown as number,
          terminalized_at: now,
          expires_at: new Date(now.getTime() + 86_400_000),
          completed_at: now,
          state_deadline_at: null,
        },
      })
    ).rejects.toThrow(/STORE_IDEMPOTENCY_RESPONSE_STATUS_INVALID/)

    await expect(
      service.transitionWithPredicate({
        id: "stidem_1",
        expectedState: "processing",
        expectedStateVersion: 1,
        at: now,
        next: {
          state: "completed",
          response_status: Number.NaN as unknown as number,
          terminalized_at: now,
          expires_at: new Date(now.getTime() + 86_400_000),
          completed_at: now,
          state_deadline_at: null,
        },
      })
    ).rejects.toThrow(/STORE_IDEMPOTENCY_RESPONSE_STATUS_INVALID/)

    await expect(
      service.transitionWithPredicate({
        id: "stidem_1",
        expectedState: "processing",
        expectedStateVersion: 1,
        at: now,
        next: {
          state: "completed",
          response_status: Number.POSITIVE_INFINITY as unknown as number,
          terminalized_at: now,
          expires_at: new Date(now.getTime() + 86_400_000),
          completed_at: now,
          state_deadline_at: null,
        },
      })
    ).rejects.toThrow(/STORE_IDEMPOTENCY_RESPONSE_STATUS_INVALID/)

    const updateCallsAfter = sqlCalls.filter((call) =>
      call.sql.toLowerCase().includes("update store_idempotency_record")
    ).length
    expect(updateCallsAfter).toBe(updateCallsBefore)
    expect(rows[0].state).toBe("processing")
    expect(rows[0].response_status).toBeNull()

    const ok = await service.transitionWithPredicate({
      id: "stidem_1",
      expectedState: "processing",
      expectedStateVersion: 1,
      at: now,
      next: {
        state: "completed",
        response_status: 200,
        terminalized_at: now,
        expires_at: new Date(now.getTime() + 86_400_000),
        completed_at: now,
        state_deadline_at: null,
      },
    })
    expect(ok.type).toBe("claimed")
    expect(rows[0].response_status).toBe(200)
  })
})
