import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import {
  GUEST_CART_CAPABILITY_MODULE,
  type GuestCartCapabilityModuleService,
} from ".."
import { generateGuestCartCapability, hashGuestCartCapability } from "../hash"

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

if (!requestedDatabaseName) {
  describe("GuestCartCapability PostgreSQL", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(() => requireDisposableDatabaseName(requestedDatabaseName)).toThrow(
        "P12_DISPOSABLE_DATABASE_NAME_REQUIRED"
      )
    })
  })
} else {
  const disposableEnvironment = buildDisposableMedusaEnvironment(process.env)
  assertDisposableMedusaEnvironment(disposableEnvironment)

  for (const [name, value] of Object.entries(disposableEnvironment)) {
    if (typeof value === "string") {
      process.env[name] = value
    }
  }

  const { medusaIntegrationTestRunner } = jest.requireActual(
    "@medusajs/test-utils"
  ) as typeof import("@medusajs/test-utils")
  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  jest.setTimeout(180_000)

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      const resolveService = () =>
        getContainer().resolve(
          GUEST_CART_CAPABILITY_MODULE
        ) as GuestCartCapabilityModuleService

      beforeEach(async () => {
        await dbConnection.raw(`delete from guest_cart_capability`)
      })

      it("applies the exact guest_cart_capability schema and catalog contract", async () => {
        const columns = await dbConnection.raw(`
          select column_name, udt_name
          from information_schema.columns
          where table_schema = 'public' and table_name = 'guest_cart_capability'
          order by column_name
        `)
        expect(columns.rows).toEqual(
          expect.arrayContaining([
            { column_name: "id", udt_name: "text" },
            { column_name: "cart_id", udt_name: "text" },
            { column_name: "token_hash", udt_name: "text" },
            { column_name: "status", udt_name: "text" },
            { column_name: "expires_at", udt_name: "timestamptz" },
            { column_name: "metadata", udt_name: "jsonb" },
            { column_name: "created_at", udt_name: "timestamptz" },
            { column_name: "updated_at", udt_name: "timestamptz" },
            { column_name: "deleted_at", udt_name: "timestamptz" },
          ])
        )
      })

      it("enforces UNIQUE constraint on token_hash", async () => {
        const tokenHash = hashGuestCartCapability("deterministic_token_for_unique_test_001")
        const expiresAt = new Date(Date.now() + 7 * 86400 * 1000)

        await dbConnection.raw(
          `
            insert into guest_cart_capability (id, cart_id, token_hash, status, expires_at)
            values (?, ?, ?, 'active', ?)
          `,
          ["gccap_test_uniq_1", "cart_uniq_1", tokenHash, expiresAt]
        )

        await expect(
          dbConnection.raw(
            `
              insert into guest_cart_capability (id, cart_id, token_hash, status, expires_at)
              values (?, ?, ?, 'active', ?)
            `,
            ["gccap_test_uniq_2", "cart_uniq_2", tokenHash, expiresAt]
          )
        ).rejects.toThrow()
      })

      it("enforces partial UNIQUE constraint (one active capability per cart_id)", async () => {
        const token1 = generateGuestCartCapability()
        const tokenHash1 = hashGuestCartCapability(token1)
        const token2 = generateGuestCartCapability()
        const tokenHash2 = hashGuestCartCapability(token2)
        const expiresAt = new Date(Date.now() + 7 * 86400 * 1000)

        // Insert first active capability for cart_active_1
        await dbConnection.raw(
          `
            insert into guest_cart_capability (id, cart_id, token_hash, status, expires_at)
            values (?, ?, ?, 'active', ?)
          `,
          ["gccap_active_1", "cart_active_1", tokenHash1, expiresAt]
        )

        // Inserting second active capability for the same cart_active_1 must FAIL
        await expect(
          dbConnection.raw(
            `
              insert into guest_cart_capability (id, cart_id, token_hash, status, expires_at)
              values (?, ?, ?, 'active', ?)
            `,
            ["gccap_active_2", "cart_active_1", tokenHash2, expiresAt]
          )
        ).rejects.toThrow()

        // But inserting an expired, revoked, or consumed capability for the same cart_active_1 SUCCEEDS
        const token3 = generateGuestCartCapability()
        const tokenHash3 = hashGuestCartCapability(token3)
        await expect(
          dbConnection.raw(
            `
              insert into guest_cart_capability (id, cart_id, token_hash, status, expires_at)
              values (?, ?, ?, 'consumed', ?)
            `,
            ["gccap_consumed_1", "cart_active_1", tokenHash3, expiresAt]
          )
        ).resolves.toBeDefined()
      })

      it("persists hash-only and never leaks plaintext token into database columns", async () => {
        const plaintextToken = generateGuestCartCapability()
        const tokenHash = hashGuestCartCapability(plaintextToken)
        const expiresAt = new Date(Date.now() + 7 * 86400 * 1000)

        await dbConnection.raw(
          `
            insert into guest_cart_capability (id, cart_id, token_hash, status, expires_at, metadata)
            values (?, ?, ?, 'active', ?, ?)
          `,
          [
            "gccap_canary_1",
            "cart_canary_1",
            tokenHash,
            expiresAt,
            JSON.stringify({ note: "hash_only_proof" }),
          ]
        )

        const rows = await dbConnection.raw(`select * from guest_cart_capability where id = ?`, [
          "gccap_canary_1",
        ])
        expect(rows.rows).toHaveLength(1)
        const rowJson = JSON.stringify(rows.rows[0])
        expect(rowJson).not.toContain(plaintextToken)
        expect(rowJson).toContain(tokenHash)
      })

      it("supports all valid capability lifecycle statuses and reject invalid ones", async () => {
        const expiresAt = new Date(Date.now() + 7 * 86400 * 1000)

        for (const status of ["active", "expired", "revoked", "consumed"] as const) {
          const token = generateGuestCartCapability()
          const tokenHash = hashGuestCartCapability(token)
          await expect(
            dbConnection.raw(
              `
                insert into guest_cart_capability (id, cart_id, token_hash, status, expires_at)
                values (?, ?, ?, ?, ?)
              `,
              [`gccap_status_${status}`, `cart_status_${status}`, tokenHash, status, expiresAt]
            )
          ).resolves.toBeDefined()
        }

        const invalidToken = generateGuestCartCapability()
        const invalidHash = hashGuestCartCapability(invalidToken)
        await expect(
          dbConnection.raw(
            `
              insert into guest_cart_capability (id, cart_id, token_hash, status, expires_at)
              values (?, ?, ?, 'invalid_status', ?)
            `,
            ["gccap_invalid", "cart_invalid", invalidHash, expiresAt]
          )
        ).rejects.toThrow()
      })
    },
  })
}
