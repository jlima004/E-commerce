import fs from "node:fs"
import path from "node:path"
import jwt from "jsonwebtoken"
import type { AxiosResponse } from "axios"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  API_DOCS_CONTENT_SECURITY_POLICY,
  API_DOCS_CONTENT_TYPE_HTML,
  API_DOCS_CONTENT_TYPE_JSON,
} from "../../src/api-docs/runtime/security-headers"
import { SWAGGER_ASSET_NAMES } from "../../src/api-docs/runtime/swagger-assets"
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

const generatedDir = path.resolve(
  __dirname,
  "../../src/api-docs/generated"
)

function loadArtifact(name: "store" | "admin" | "webhooks") {
  return JSON.parse(
    fs.readFileSync(path.join(generatedDir, `${name}.openapi.json`), "utf8")
  )
}

const INLINE_SCRIPT_BODY_PATTERN =
  /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i
const INLINE_STYLE_BODY_PATTERN =
  /<style(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/style>/i
const REMOTE_ASSET_URL_PATTERN =
  /(?:src|href)\s*=\s*["']https?:\/\//i

const API_DOCS_FLAGS_ON = {
  API_DOCS_ENABLED: "true",
  API_DOCS_UI_ENABLED: "true",
  API_DOCS_PUBLIC_ENABLED: "true",
  API_DOCS_INTERNAL_ENABLED: "true",
} as const

function expectSecurityHeaders(
  headers: AxiosResponse["headers"],
  contentType?: string
): void {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      Array.isArray(value) ? value.join(", ") : String(value),
    ])
  )

  if (contentType) {
    expect(normalized["content-type"]).toBe(contentType)
  }

  expect(normalized["content-security-policy"]).toBe(
    API_DOCS_CONTENT_SECURITY_POLICY
  )
  expect(normalized["x-content-type-options"]).toBe("nosniff")
  expect(normalized["referrer-policy"]).toBe("no-referrer")
  expect(normalized["cache-control"]).toBe("no-store")

  for (const name of Object.keys(normalized)) {
    expect(name).not.toMatch(/^access-control-/)
  }
}

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
  userId: string
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

  const email = "api-docs-runtime@medusa.test"
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

  return { bearerToken, sessionCookie: "", userId: user.id }
}

if (!requestedDatabaseName) {
  describe("API docs runtime HTTP integration", () => {
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
    ...API_DOCS_FLAGS_ON,
  }

  // medusa-config imports the env singleton during configLoaderOverride,
  // which runs before the runner applies `env` — set flags early.
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
      let secretApiKeyToken: string
      let secretApiKeyActorType: string | undefined

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

        const apiKeyModule = getContainer().resolve(Modules.API_KEY) as {
          createApiKeys: (input: {
            title: string
            type: "secret"
            created_by: string
          }) => Promise<{ id: string; token?: string }>
          authenticate: (
            token: string
          ) => Promise<{ id: string } | false>
        }

        const created = await apiKeyModule.createApiKeys({
          title: "api-docs-runtime-secret",
          type: "secret",
          created_by: adminAuth.userId,
        })
        const record = Array.isArray(created) ? created[0] : created

        expect(record?.id).toBeTruthy()
        expect(typeof record?.token).toBe("string")
        expect(record.token!.length).toBeGreaterThan(0)

        secretApiKeyToken = record.token!

        const authenticated = await apiKeyModule.authenticate(secretApiKeyToken)
        expect(authenticated).toBeTruthy()
        expect(authenticated && typeof authenticated === "object" && authenticated.id).toBe(
          record.id
        )
        secretApiKeyActorType = "api-key"
      })

      describe("GET /openapi/store.json", () => {
        it("returns committed store artifact for anonymous callers", async () => {
          const response = await api.get("/openapi/store.json", {
            validateStatus: () => true,
          })

          expect(response.status).toBe(200)
          expectSecurityHeaders(response.headers, API_DOCS_CONTENT_TYPE_JSON)
          expect(response.data).toEqual(loadArtifact("store"))
        })
      })

      describe.each([
        ["/openapi/admin.json", "admin"],
        ["/openapi/webhooks.json", "webhooks"],
      ] as const)("GET %s", (routePath, artifactName) => {
        it("returns committed artifact for session-authenticated admin user", async () => {
          const response = await api.get(routePath, {
            headers: { cookie: adminAuth.sessionCookie },
            validateStatus: () => true,
          })

          expect(response.status).toBe(200)
          expectSecurityHeaders(response.headers, API_DOCS_CONTENT_TYPE_JSON)
          expect(response.data).toEqual(loadArtifact(artifactName))
        })

        it("returns committed artifact for bearer-authenticated admin user", async () => {
          const response = await api.get(routePath, {
            headers: { authorization: `Bearer ${adminAuth.bearerToken}` },
            validateStatus: () => true,
          })

          expect(response.status).toBe(200)
          expectSecurityHeaders(response.headers, API_DOCS_CONTENT_TYPE_JSON)
          expect(response.data).toEqual(loadArtifact(artifactName))
        })

        it("returns opaque 404 for anonymous callers", async () => {
          const response = await api.get(routePath, {
            validateStatus: () => true,
          })

          expectOpaqueNotFound(response.status)
        })

        it("returns opaque 404 for invalid bearer tokens", async () => {
          const response = await api.get(routePath, {
            headers: { authorization: "Bearer not-a-valid-token" },
            validateStatus: () => true,
          })

          expectOpaqueNotFound(response.status)
        })

        it("returns opaque 404 for invalid session cookies", async () => {
          const response = await api.get(routePath, {
            headers: { cookie: "connect.sid=invalid-session-value" },
            validateStatus: () => true,
          })

          expectOpaqueNotFound(response.status)
        })

        it("returns opaque 404 for missing session cookies", async () => {
          const response = await api.get(routePath, {
            headers: { cookie: "" },
            validateStatus: () => true,
          })

          expectOpaqueNotFound(response.status)
        })

      })

      describe.each([
        ["/openapi/admin.json"],
        ["/openapi/webhooks.json"],
      ] as const)(
        "GET %s secret API key concealment",
        (routePath) => {
          it("returns opaque 404 for real Medusa secret API key concealment", async () => {
            expect(secretApiKeyToken.length).toBeGreaterThan(0)
            expect(secretApiKeyActorType).toBe("api-key")

            const response = await api.get(routePath, {
              headers: {
                authorization: `Basic ${Buffer.from(`${secretApiKeyToken}:`).toString("base64")}`,
              },
              validateStatus: () => true,
            })

            expectOpaqueNotFound(response.status)
          })
        }
      )

      describe("GET /docs", () => {
        it("returns Swagger UI shell with security headers and no inline executable assets", async () => {
          const response = await api.get("/docs", {
            validateStatus: () => true,
          })

          expect(response.status).toBe(200)
          expectSecurityHeaders(response.headers, API_DOCS_CONTENT_TYPE_HTML)

          const html = String(response.data)
          expect(html).toContain("/docs/assets/swagger-ui.css")
          expect(html).toContain("/docs/assets/swagger-ui-bundle.js")
          expect(html).not.toMatch(INLINE_SCRIPT_BODY_PATTERN)
          expect(html).not.toMatch(INLINE_STYLE_BODY_PATTERN)
          expect(html).not.toMatch(REMOTE_ASSET_URL_PATTERN)
        })
      })

      describe("GET /docs/assets/{asset}", () => {
        it.each(SWAGGER_ASSET_NAMES)(
          "returns non-empty 200 for allowlisted asset %s",
          async (assetName) => {
            const response = await api.get(`/docs/assets/${assetName}`, {
              validateStatus: () => true,
            })

            expect(response.status).toBe(200)
            expect(String(response.data ?? "").length).toBeGreaterThan(0)

            const expectedContentType = assetName.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/javascript; charset=utf-8"
            expectSecurityHeaders(response.headers, expectedContentType)
          }
        )

        it.each([
          "swagger-initializer.js",
          "oauth2-redirect.html",
          "index.html",
          "favicon-32x32.png",
          "swagger-ui.css.map",
          "swagger-ui-bundle.js.map",
          "unknown.js",
          "nested/path.js",
        ])("returns opaque 404 for blocked asset %s", async (assetName) => {
          const response = await api.get(`/docs/assets/${assetName}`, {
            validateStatus: () => true,
          })

          expectOpaqueNotFound(response.status)
        })

        it.each([
          "../package.json",
          "%2e%2e%2fpackage.json",
          "%252e%252e%252fpackage.json",
        ])("returns opaque 404 for traversal asset %s", async (assetName) => {
          const response = await api.get(`/docs/assets/${assetName}`, {
            validateStatus: () => true,
          })

          expectOpaqueNotFound(response.status)
        })
      })

      describe("alias routes", () => {
        it.each([
          "/openapi/store",
          "/openapi/admin",
          "/openapi/webhooks",
          "/docs/index.html",
          "/docs/assets",
        ])("returns opaque 404 for alias %s", async (aliasPath) => {
          const response = await api.get(aliasPath, {
            validateStatus: () => true,
          })

          expectOpaqueNotFound(response.status)
        })
      })
    },
  })
}
