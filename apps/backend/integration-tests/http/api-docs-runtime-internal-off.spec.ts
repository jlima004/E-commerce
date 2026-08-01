import jwt from "jsonwebtoken"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"

jest.mock(
  "pg-god",
  () => {
    const { Client: PgClient } = jest.requireActual("pg") as typeof import("pg")

    function requireSafeName(databaseName: unknown): string {
      if (
        typeof databaseName !== "string" ||
        !/^p12_disposable_[a-z0-9_]+$/.test(databaseName)
      ) {
        throw new Error("P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN")
      }
      return databaseName
    }

    function maintenanceClient() {
      return new PgClient({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: "postgres",
      })
    }

    return {
      createDatabase: async ({ databaseName }: { databaseName: string }) => {
        const safeName = requireSafeName(databaseName)
        const client = maintenanceClient()
        await client.connect()
        try {
          const existing = await client.query(
            "select 1 from pg_database where datname = $1",
            [safeName]
          )
          if (existing.rowCount === 0) {
            await client.query(`create database "${safeName}"`)
          }
        } finally {
          await client.end()
        }
      },
      dropDatabase: async ({ databaseName }: { databaseName: string }) => {
        const safeName = requireSafeName(databaseName)
        const client = maintenanceClient()
        await client.connect()
        try {
          await client.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
            [safeName]
          )
          await client.query(`drop database if exists "${safeName}"`)
        } finally {
          await client.end()
        }
      },
    }
  },
  { virtual: true }
)

const requestedDatabaseName = process.env.DB_TEMP_NAME

const API_DOCS_FLAGS_INTERNAL_OFF = {
  API_DOCS_ENABLED: "true",
  API_DOCS_PUBLIC_ENABLED: "true",
  API_DOCS_INTERNAL_ENABLED: "false",
  API_DOCS_UI_ENABLED: "true",
} as const

function expectOpaqueNotFound(status: number): void {
  expect(status).toBe(404)
  expect(status).not.toBe(401)
  expect(status).not.toBe(403)
}

function extractSessionCookie(
  setCookieHeader: string | string[] | undefined
): string | undefined {
  const entries = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : []

  const pairs = entries
    .map((entry) => entry.split(";")[0]?.trim())
    .filter((entry): entry is string => Boolean(entry))

  return pairs.length > 0 ? pairs.join("; ") : undefined
}

type AdminAuth = {
  bearerToken: string
  sessionCookie: string
}

async function bootstrapAdminAuth(
  getContainer: () => {
    resolve: (key: string) => unknown
  }
): Promise<AdminAuth> {
  const container = getContainer()
  const userModule = container.resolve(Modules.USER) as {
    createUsers: (input: { email: string }) => Promise<{ id: string }>
  }
  const authModule = container.resolve(Modules.AUTH) as {
    createAuthIdentities: (input: {
      provider_identities: Array<{
        provider: string
        entity_id: string
        provider_metadata: { password: string }
      }>
      app_metadata: { user_id: string }
    }) => Promise<{ id: string }>
  }

  const email = "api-docs-runtime-internal-off@medusa.test"
  const password = "runtime-test-password"
  const user = await userModule.createUsers({ email })
  const authIdentity = await authModule.createAuthIdentities({
    provider_identities: [
      {
        provider: "emailpass",
        entity_id: email,
        provider_metadata: { password },
      },
    ],
    app_metadata: { user_id: user.id },
  })

  const {
    projectConfig: { http },
  } = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as {
    projectConfig: { http: { jwtSecret: string } }
  }

  const bearerToken = jwt.sign(
    {
      actor_id: user.id,
      actor_type: "user",
      auth_identity_id: authIdentity.id,
    },
    http.jwtSecret,
    { expiresIn: "1d" }
  )

  return { bearerToken, sessionCookie: "" }
}

if (!requestedDatabaseName) {
  describe("API docs runtime internal-off HTTP integration", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(() =>
        requireDisposableDatabaseName(requestedDatabaseName)
      ).toThrow("P12_DISPOSABLE_DATABASE_NAME_REQUIRED")
    })
  })
} else {
  const disposableEnvironment = buildDisposableMedusaEnvironment(process.env)
  assertDisposableMedusaEnvironment(disposableEnvironment)

  const runnerEnvironment = {
    ...disposableEnvironment,
    ...API_DOCS_FLAGS_INTERNAL_OFF,
  }

  for (const [name, value] of Object.entries(runnerEnvironment)) {
    if (typeof value === "string") {
      process.env[name] = value
    }
  }

  const { medusaIntegrationTestRunner } = jest.requireActual(
    "@medusajs/test-utils"
  ) as typeof import("@medusajs/test-utils")

  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  jest.setTimeout(120_000)

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: runnerEnvironment,
    cwd: process.cwd(),
    testSuite: ({ api, getContainer }) => {
      let adminAuth: AdminAuth

      beforeAll(async () => {
        adminAuth = await bootstrapAdminAuth(getContainer)

        const sessionResponse = await api.post(
          "/auth/session",
          {},
          {
            headers: { authorization: `Bearer ${adminAuth.bearerToken}` },
            validateStatus: () => true,
          }
        )

        expect(sessionResponse.status).toBe(200)
        adminAuth.sessionCookie =
          extractSessionCookie(sessionResponse.headers["set-cookie"]) ?? ""
        expect(adminAuth.sessionCookie.length).toBeGreaterThan(0)
      })

      describe("internal disabled", () => {
        it("returns 200 for anonymous GET /openapi/store.json", async () => {
          const response = await api.get("/openapi/store.json", {
            validateStatus: () => true,
          })

          expect(response.status).toBe(200)
        })

        it.each(["/openapi/admin.json", "/openapi/webhooks.json"])(
          "returns opaque 404 for bearer GET %s",
          async (routePath) => {
            const response = await api.get(routePath, {
              headers: { authorization: `Bearer ${adminAuth.bearerToken}` },
              validateStatus: () => true,
            })

            expectOpaqueNotFound(response.status)
          }
        )

        it.each(["/openapi/admin.json", "/openapi/webhooks.json"])(
          "returns opaque 404 for session GET %s",
          async (routePath) => {
            const response = await api.get(routePath, {
              headers: { cookie: adminAuth.sessionCookie },
              validateStatus: () => true,
            })

            expectOpaqueNotFound(response.status)
          }
        )

        it("returns 200 for anonymous GET /docs", async () => {
          const response = await api.get("/docs", {
            validateStatus: () => true,
          })

          expect(response.status).toBe(200)
        })

        it("returns 200 for anonymous GET /docs/assets/swagger-ui.css", async () => {
          const response = await api.get("/docs/assets/swagger-ui.css", {
            validateStatus: () => true,
          })

          expect(response.status).toBe(200)
        })
      })
    },
  })
}
