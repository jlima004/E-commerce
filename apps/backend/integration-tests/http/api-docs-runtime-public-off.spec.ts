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

const API_DOCS_FLAGS_PUBLIC_OFF = {
  API_DOCS_ENABLED: "true",
  API_DOCS_PUBLIC_ENABLED: "false",
  API_DOCS_INTERNAL_ENABLED: "true",
  API_DOCS_UI_ENABLED: "true",
} as const

function expectOpaqueNotFound(status: number): void {
  expect(status).toBe(404)
  expect(status).not.toBe(401)
  expect(status).not.toBe(403)
}

async function bootstrapAdminBearerToken(
  getContainer: () => {
    resolve: (key: string) => unknown
  }
): Promise<string> {
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

  const email = "api-docs-runtime-public-off@medusa.test"
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

  return jwt.sign(
    {
      actor_id: user.id,
      actor_type: "user",
      auth_identity_id: authIdentity.id,
    },
    http.jwtSecret,
    { expiresIn: "1d" }
  )
}

if (!requestedDatabaseName) {
  describe("API docs runtime public-off HTTP integration", () => {
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
    ...API_DOCS_FLAGS_PUBLIC_OFF,
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
      let bearerToken: string

      beforeAll(async () => {
        bearerToken = await bootstrapAdminBearerToken(getContainer)
      })

      describe("public disabled", () => {
        it("returns opaque 404 for anonymous GET /openapi/store.json", async () => {
          const response = await api.get("/openapi/store.json", {
            validateStatus: () => true,
          })

          expectOpaqueNotFound(response.status)
        })

        it.each(["/openapi/admin.json", "/openapi/webhooks.json"])(
          "returns 200 for bearer GET %s",
          async (routePath) => {
            const response = await api.get(routePath, {
              headers: { authorization: `Bearer ${bearerToken}` },
              validateStatus: () => true,
            })

            expect(response.status).toBe(200)
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
