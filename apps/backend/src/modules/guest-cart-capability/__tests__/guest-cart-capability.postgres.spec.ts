import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import {
  GUEST_CART_CAPABILITY_LOOKUP_INVALID,
  GUEST_CART_CAPABILITY_MODULE,
  GUEST_CART_CAPABILITY_STATUS,
  type GuestCartCapabilityModuleService,
} from ".."
import { generateGuestCartCapability, hashGuestCartCapability } from "../hash"
import { GUEST_CART_CAPABILITY_TTL_MAX_MS, GUEST_CART_CAPABILITY_TTL_ROLLING_MS } from "../service"

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
            { column_name: "consumed_at", udt_name: "timestamptz" },
            { column_name: "revoked_at", udt_name: "timestamptz" },
            { column_name: "last_used_at", udt_name: "timestamptz" },
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
            insert into guest_cart_capability (id, cart_id, token_hash, status, expires_at)
            values (?, ?, ?, 'active', ?)
          `,
          [
            "gccap_canary_1",
            "cart_canary_1",
            tokenHash,
            expiresAt,
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

      it("persists mintGuestCartCapability and retrieves via persistent lookup with rolling touch", async () => {
        const service = resolveService()
        const baseNow = new Date("2026-08-01T00:00:00.000Z")

        const mintResult = await service.mintGuestCartCapability({
          cart_id: "cart_integration_persist_01",
          now: baseNow,
        })

        expect(mintResult.plaintext_token).toBeDefined()
        expect(mintResult.plaintext_token).toHaveLength(43)
        expect(mintResult.record.id).toMatch(/^gccap_/)
        expect(mintResult.record.cart_id).toBe("cart_integration_persist_01")
        expect(mintResult.record.status).toBe(GUEST_CART_CAPABILITY_STATUS.ACTIVE)
        expect(mintResult.record.last_used_at).toBeNull()

        // Verify row is physically in PostgreSQL
        const dbRows = await dbConnection.raw(
          `select * from guest_cart_capability where id = ?`,
          [mintResult.record.id]
        )
        expect(dbRows.rows).toHaveLength(1)
        expect(dbRows.rows[0].token_hash).toBe(mintResult.record.token_hash)
        expect(dbRows.rows[0].cart_id).toBe("cart_integration_persist_01")
        expect(dbRows.rows[0].status).toBe("active")

        // Perform lookup with touch 3 days later
        const touchNow = new Date("2026-08-04T12:00:00.000Z")
        const lookedUp = await service.lookupGuestCartCapabilityByPresentedToken(
          mintResult.plaintext_token,
          { now: touchNow, touch: true }
        )

        expect(lookedUp.id).toBe(mintResult.record.id)
        expect(lookedUp.cart_id).toBe("cart_integration_persist_01")

        // Verify touch updated last_used_at and rolling expires_at in DB
        const updatedDbRows = await dbConnection.raw(
          `select * from guest_cart_capability where id = ?`,
          [mintResult.record.id]
        )
        expect(new Date(updatedDbRows.rows[0].last_used_at).toISOString()).toBe(
          touchNow.toISOString()
        )
        const expectedExpires = new Date(touchNow.getTime() + GUEST_CART_CAPABILITY_TTL_ROLLING_MS)
        expect(new Date(updatedDbRows.rows[0].expires_at).toISOString()).toBe(
          expectedExpires.toISOString()
        )
      })

      it("enforces 30-day absolute hard cap on rolling touch", async () => {
        const service = resolveService()
        const createdAt = new Date()

        const mintResult = await service.mintGuestCartCapability({
          cart_id: "cart_integration_cap_01",
          now: createdAt,
        })

        // Fetch actual created_at from DB
        const createdRow = await dbConnection.raw(
          `select created_at from guest_cart_capability where id = ?`,
          [mintResult.record.id]
        )
        const dbCreatedAt = new Date(createdRow.rows[0].created_at)

        // Simulate active usage every 5 days within the 7d TTL: Day 5, 10, 15, 20, 25
        for (const day of [5, 10, 15, 20, 25]) {
          const touchDate = new Date(dbCreatedAt.getTime() + day * 86400 * 1000)
          await service.lookupGuestCartCapabilityByPresentedToken(
            mintResult.plaintext_token,
            { now: touchDate, touch: true }
          )
        }

        // On day 25 (25d + 7d = 32d > 30d cap), expires_at must be strictly capped at dbCreatedAt + 30 days
        const maxExpires = new Date(dbCreatedAt.getTime() + GUEST_CART_CAPABILITY_TTL_MAX_MS)
        const updatedDbRows = await dbConnection.raw(
          `select * from guest_cart_capability where id = ?`,
          [mintResult.record.id]
        )
        expect(new Date(updatedDbRows.rows[0].expires_at).toISOString()).toBe(
          maxExpires.toISOString()
        )

        // Attempting to lookup on Day 31 (past 30-day cap) must fail
        const day31 = new Date(dbCreatedAt.getTime() + 31 * 86400 * 1000)
        await expect(
          service.lookupGuestCartCapabilityByPresentedToken(
            mintResult.plaintext_token,
            { now: day31 }
          )
        ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
      })

      it("rejects token with whitespace padding (exact byte matching, no trim)", async () => {
        const service = resolveService()
        const mintResult = await service.mintGuestCartCapability({
          cart_id: "cart_integration_exact_token",
        })

        await expect(
          service.lookupGuestCartCapabilityByPresentedToken(` ${mintResult.plaintext_token}`)
        ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)

        await expect(
          service.lookupGuestCartCapabilityByPresentedToken(`${mintResult.plaintext_token} `)
        ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
      })

      it("persists consume, revoke, and expire transitions", async () => {
        const service = resolveService()

        // 1. Consume
        const mintConsume = await service.mintGuestCartCapability({
          cart_id: "cart_to_consume",
        })
        const consumedTime = new Date("2026-08-02T10:00:00.000Z")
        const consumed = await service.consumeGuestCartCapability(mintConsume.record.id, {
          now: consumedTime,
        })
        expect(consumed.status).toBe(GUEST_CART_CAPABILITY_STATUS.CONSUMED)

        const consumedDb = await dbConnection.raw(
          `select * from guest_cart_capability where id = ?`,
          [mintConsume.record.id]
        )
        expect(consumedDb.rows[0].status).toBe("consumed")
        expect(new Date(consumedDb.rows[0].consumed_at).toISOString()).toBe(
          consumedTime.toISOString()
        )

        // Lookup on consumed token must fail
        await expect(
          service.lookupGuestCartCapabilityByPresentedToken(mintConsume.plaintext_token)
        ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)

        // 2. Revoke
        const mintRevoke = await service.mintGuestCartCapability({
          cart_id: "cart_to_revoke",
        })
        const revokedTime = new Date("2026-08-02T11:00:00.000Z")
        const revoked = await service.revokeGuestCartCapability(mintRevoke.record.id, {
          now: revokedTime,
        })
        expect(revoked.status).toBe(GUEST_CART_CAPABILITY_STATUS.REVOKED)

        const revokedDb = await dbConnection.raw(
          `select * from guest_cart_capability where id = ?`,
          [mintRevoke.record.id]
        )
        expect(revokedDb.rows[0].status).toBe("revoked")
        expect(new Date(revokedDb.rows[0].revoked_at).toISOString()).toBe(
          revokedTime.toISOString()
        )

        // Lookup on revoked token must fail
        await expect(
          service.lookupGuestCartCapabilityByPresentedToken(mintRevoke.plaintext_token)
        ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)

        // 3. Expire
        const mintExpire = await service.mintGuestCartCapability({
          cart_id: "cart_to_expire",
        })
        const expired = await service.expireGuestCartCapability(mintExpire.record.id)
        expect(expired.status).toBe(GUEST_CART_CAPABILITY_STATUS.EXPIRED)

        const expiredDb = await dbConnection.raw(
          `select * from guest_cart_capability where id = ?`,
          [mintExpire.record.id]
        )
        expect(expiredDb.rows[0].status).toBe("expired")

        // Lookup on expired token must fail
        await expect(
          service.lookupGuestCartCapabilityByPresentedToken(mintExpire.plaintext_token)
        ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
      })
    },
  })
}
