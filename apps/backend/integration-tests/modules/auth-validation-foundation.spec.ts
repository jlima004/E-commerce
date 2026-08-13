import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  AUTH_TEST_HARNESS_FORBIDDEN,
  createAuthPostgresHarness,
  hashAuthInspection,
  validateAuthPostgresUrl,
  type AuthPostgresHarness,
} from "../helpers/auth-postgres"
import {
  createAuthRedisHarness,
  validateAuthRedisUrl,
  type AuthRedisHarness,
} from "../helpers/auth-redis"
import { runTwoProcessSharedStateProof } from "../helpers/auth-multiprocess"
import {
  AUTH_CANARIES,
  createAuthLeakageCollector,
} from "../helpers/auth-leakage"

jest.mock(
  "pg-god",
  () => {
    const { Client } = jest.requireActual("pg") as typeof import("pg")

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
      return new Client({
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

const POSTGRES_HELPER_SOURCE = readFileSync(
  resolve(__dirname, "../helpers/auth-postgres.ts"),
  "utf8"
)
const REDIS_HELPER_SOURCE = readFileSync(
  resolve(__dirname, "../helpers/auth-redis.ts"),
  "utf8"
)
const MULTIPROCESS_HELPER_SOURCE = readFileSync(
  resolve(__dirname, "../helpers/auth-multiprocess.ts"),
  "utf8"
)

const requestedDatabaseName = process.env.DB_TEMP_NAME
const requestedDatabaseUrl = process.env.DATABASE_URL

describe("auth validation foundation", () => {
  it.each(["0.0.0.0", "host.docker.internal", "db.example.com", "db.abcd.supabase.co"])(
    "rejects non-loopback postgres host %s",
    (hostname) => {
      expect(() =>
        validateAuthPostgresUrl(`postgres://u:p@${hostname}:5432/postgres`)
      ).toThrow("AUTH_TEST_POSTGRES_HOST_FORBIDDEN")
    }
  )

  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "accepts loopback postgres host %s",
    (hostname) => {
      expect(() =>
        validateAuthPostgresUrl(`postgres://u:p@${hostname}:5432/postgres`)
      ).not.toThrow()
    }
  )

  it.each([
    "redis://example.com:6380",
    "redis://host.docker.internal:6380",
    "redis://0.0.0.0:6380",
    "rediss://127.0.0.1:6380",
    "redis://h:p@ec2.compute-1.amazonaws.com:6380",
  ])("rejects non-loopback or remote cache url %s", (rawUrl) => {
    expect(() => validateAuthRedisUrl(rawUrl)).toThrow(
      /AUTH_TEST_REDIS_(HOST|PROTOCOL)_FORBIDDEN/
    )
  })

  it.each(["redis://127.0.0.1:6380", "redis://localhost:6380", "redis://[::1]:6380"])(
    "accepts loopback cache url %s",
    (rawUrl) => {
      expect(() => validateAuthRedisUrl(rawUrl)).not.toThrow()
    }
  )

  it("refuses harness use when NODE_ENV is not test", () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = "production"
    try {
      expect(() =>
        validateAuthPostgresUrl("postgres://u:p@127.0.0.1:5432/postgres")
      ).toThrow(AUTH_TEST_HARNESS_FORBIDDEN)
      expect(() => validateAuthRedisUrl("redis://127.0.0.1:6380")).toThrow(
        AUTH_TEST_HARNESS_FORBIDDEN
      )
    } finally {
      process.env.NODE_ENV = previous
    }
  })

  it("does not expose glob or destructive cleanup APIs", () => {
    expect(POSTGRES_HELPER_SOURCE).not.toMatch(
      /drop database if exists "(postgres|template0|template1)"/i
    )
    expect(POSTGRES_HELPER_SOURCE).toMatch(/requireDisposableDatabaseName/)
    expect(POSTGRES_HELPER_SOURCE).toMatch(
      /pg_terminate_backend\(pid\) from pg_stat_activity where datname = \$1/
    )
    expect(REDIS_HELPER_SOURCE).not.toMatch(/\bFLUSHALL\b/i)
    expect(REDIS_HELPER_SOURCE).not.toMatch(/\bFLUSHDB\b/i)
    expect(REDIS_HELPER_SOURCE).not.toMatch(/\bKEYS\b/)
    expect(MULTIPROCESS_HELPER_SOURCE).not.toMatch(/\bpkill\b/)
    expect(MULTIPROCESS_HELPER_SOURCE).not.toMatch(/\bkillall\b/)
    expect(MULTIPROCESS_HELPER_SOURCE).not.toMatch(/node -e/)
    expect(MULTIPROCESS_HELPER_SOURCE).not.toMatch(/["']-e["']/)
    expect(MULTIPROCESS_HELPER_SOURCE).toMatch(/@medusajs\/cli\/cli\.js/)
    expect(MULTIPROCESS_HELPER_SOURCE).toMatch(/medusa-backend/)
  })
})

if (!requestedDatabaseName || !requestedDatabaseUrl) {
  describe("auth validation foundation disposable runner", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(requestedDatabaseName && requestedDatabaseUrl).toBeTruthy()
    })
  })
} else {
  jest.setTimeout(300_000)

  describe("auth validation foundation disposable runner", () => {
    let postgres: AuthPostgresHarness
    let redis: AuthRedisHarness

    beforeAll(async () => {
      postgres = await createAuthPostgresHarness()
      redis = await createAuthRedisHarness()
    })

    afterAll(async () => {
      await redis?.cleanup()
      await postgres?.cleanup()
    })

    it("binds auth state to DB_TEMP_NAME and rejects system catalogs", () => {
      expect(requestedDatabaseName).toBeTruthy()
      expect(postgres.databaseName).toBe(requestedDatabaseName)
      expect(["postgres", "template0", "template1"]).not.toContain(
        postgres.databaseName
      )
      expect(POSTGRES_HELPER_SOURCE).toMatch(/current_database\(\)/)
      expect(POSTGRES_HELPER_SOURCE).toMatch(
        /AUTH_TEST_POSTGRES_DATABASE_FORBIDDEN/
      )
      expect(POSTGRES_HELPER_SOURCE).not.toMatch(
        /maintenanceUrl\.pathname = "\/postgres"[\s\S]{0,300}create table/
      )
    })

    it("produces a postgres barrier with controlled interleaving and one winner", async () => {
      const result = await postgres.contendForExclusiveClaim("signup-claim", [
        "contestant-a",
        "contestant-b",
      ])

      expect(result.winnerCount).toBe(1)
      expect(result.acquired.filter(Boolean)).toHaveLength(1)
      expect(["contestant-a", "contestant-b"]).toContain(result.winnerId)
      expect(result.loserId).not.toBe(result.winnerId)
      expect(["contestant-a", "contestant-b"]).toContain(result.loserId)
    })

    it("lets two processes observe shared postgres and cache state", async () => {
      const proof = await runTwoProcessSharedStateProof({
        postgres,
        redis,
      })

      expect(proof.processType).toBe("MEDUSA")
      expect(proof.liveService).toBe("medusa-backend")
      expect(proof.pids).toHaveLength(2)
      expect(proof.pids[0]).not.toBe(proof.pids[1])
      expect(proof.pids[0]).toBeGreaterThan(0)
      expect(proof.pids[1]).toBeGreaterThan(0)
      expect(proof.pids[0]).not.toBe(process.pid)
      expect(proof.pids[1]).not.toBe(process.pid)
      expect(proof.listeners[0].host).toBe("127.0.0.1")
      expect(proof.listeners[1].host).toBe("127.0.0.1")
      expect(proof.listeners[0].port).not.toBe(proof.listeners[1].port)
      expect(proof.listeners[0].port).toBeGreaterThan(0)
      expect(proof.listeners[1].port).toBeGreaterThan(0)
      expect(proof.databaseName).toBe(postgres.databaseName)
      expect(proof.databaseName).toBe(requestedDatabaseName)
      expect(proof.redisNamespace).toBe(redis.namespace)
      expect(proof.observationOrigin).toEqual([
        "medusa-process",
        "medusa-process",
      ])
      expect(proof.observations[0]?.origin).toBe("medusa-process")
      expect(proof.observations[1]?.origin).toBe("medusa-process")
      expect(proof.observations[0]?.pid).toBe(proof.pids[0])
      expect(proof.observations[1]?.pid).toBe(proof.pids[1])
      expect(proof.observations[0]?.postgres).toBe(2)
      expect(proof.observations[1]?.postgres).toBe(2)
      expect(proof.observations[0]?.redis).toBe("2")
      expect(proof.observations[1]?.redis).toBe("2")
      expect(proof.postgresObserved).toEqual([
        proof.observations[0].postgres,
        proof.observations[1].postgres,
      ])
      expect(proof.cacheObserved).toEqual([
        proof.observations[0].redis,
        proof.observations[1].redis,
      ])
      expect(proof.postgresObserved).toEqual([2, 2])
      expect(proof.cacheObserved).toEqual(["2", "2"])
      expect(proof.readyChecks).toEqual([
        { postgres: "up", redis: "up" },
        { postgres: "up", redis: "up" },
      ])
      expect(MULTIPROCESS_HELPER_SOURCE).not.toMatch(
        /postgresObserved:\s*\[\s*2\s*,\s*2\s*\]/
      )
      expect(MULTIPROCESS_HELPER_SOURCE).toMatch(/stdio: \["ignore", "pipe", "pipe", "ipc"\]/)
      expect(MULTIPROCESS_HELPER_SOURCE).toMatch(/origin: "medusa-process"/)
      expect(MULTIPROCESS_HELPER_SOURCE).toMatch(/P14_AUTH_OBSERVER_ENABLED/)
      expect(MULTIPROCESS_HELPER_SOURCE).toMatch(/type: "observe"/)
      expect(MULTIPROCESS_HELPER_SOURCE).toMatch(/current_database\(\)/)

      console.info(
        `[P14_AUTH_MULTIPROCESS] type=${proof.processType} pidA=${proof.pids[0]} pidB=${proof.pids[1]} originA=${proof.observations[0].origin} originB=${proof.observations[1].origin} pgA=${proof.observations[0].postgres} pgB=${proof.observations[1].postgres} redisA=${proof.observations[0].redis} redisB=${proof.observations[1].redis} listenA=${proof.listeners[0].host}:${proof.listeners[0].port} listenB=${proof.listeners[1].host}:${proof.listeners[1].port} db=${proof.databaseName} redisHost=${redis.hostname} redisPort=${redis.port} redis=${proof.redisNamespace}`
      )

      const inspection = await postgres.inspectSharedCounter()
      expect(inspection.rowCount).toBe(1)
      expect(inspection.valueHash).toBe(hashAuthInspection("shared:2"))
      expect(inspection.valueHash).toBe(
        createHash("sha256").update("shared:2", "utf8").digest("hex")
      )
    })

    it("keeps synthetic canaries out of postgres and redis sinks", async () => {
      const collector = createAuthLeakageCollector()
      const inspection = await postgres.inspectSharedCounter()
      const keys = await redis.inspectNamespaceKeys()
      collector.record("db_plaintext", inspection)
      collector.record("redis_keys_jobs", keys)
      collector.assertNoCanaries()

      const serialized = `${JSON.stringify(inspection)}\n${JSON.stringify(keys)}`
      for (const canary of Object.values(AUTH_CANARIES)) {
        expect(serialized).not.toContain(canary)
      }
    })

    it("injects cache outage without granting access", async () => {
      await redis.setKey("probe", "sealed")
      redis.enableOutage()
      try {
        await expect(redis.getKey("probe")).rejects.toThrow(
          "AUTH_TEST_REDIS_OUTAGE"
        )
        await expect(redis.setKey("probe", "opened")).rejects.toThrow(
          "AUTH_TEST_REDIS_OUTAGE"
        )
      } finally {
        redis.disableOutage()
      }
      expect(await redis.getKey("probe")).toBe("sealed")
    })

    it("flushes only the isolated namespace and deletes the outside key exactly", async () => {
      await redis.setKey("inside", "namespace-value")
      const outsideKey = await redis.plantOutsideKey("outside1", "outside-value")
      expect(outsideKey.startsWith(redis.namespace)).toBe(false)

      await redis.flushNamespace()

      expect(await redis.getKey("inside")).toBeNull()
      expect(await redis.readExactKey(outsideKey)).toBe("outside-value")

      await redis.deleteExactKey(outsideKey)
      expect(await redis.readExactKey(outsideKey)).toBeNull()
    })

    it("runs exact cleanup after a simulated failure", async () => {
      const isolatedPostgres = await createAuthPostgresHarness()
      const isolatedRedis = await createAuthRedisHarness()
      const tables = isolatedPostgres.ownedTables()
      const containerName = isolatedRedis.containerName

      try {
        expect(tables.length).toBeGreaterThan(0)
        expect(containerName.startsWith("p14-auth-redis-")).toBe(true)
        throw new Error("AUTH_TEST_SIMULATED_FAILURE")
      } catch (error) {
        expect((error as Error).message).toBe("AUTH_TEST_SIMULATED_FAILURE")
      } finally {
        const postgresCleanup = await isolatedPostgres.cleanup()
        const redisCleanup = await isolatedRedis.cleanup()
        expect(postgresCleanup.droppedTables).toEqual(tables)
        expect(await isolatedPostgres.ownedTablesExist()).toBe(false)
        expect(redisCleanup.containerName).toBe(containerName)
        expect(redisCleanup.containerRemoved).toBe(true)
      }
    })
  })
}
