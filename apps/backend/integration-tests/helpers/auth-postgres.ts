import { createHash, randomBytes } from "node:crypto"
import { Client } from "pg"
import {
  normalizeLoopbackHostname,
  redactPostgresText,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"

export const AUTH_TEST_HARNESS_FORBIDDEN = "AUTH_TEST_HARNESS_FORBIDDEN"
export const AUTH_TEST_POSTGRES_DATABASE_FORBIDDEN =
  "AUTH_TEST_POSTGRES_DATABASE_FORBIDDEN"
export const AUTH_TABLE_PREFIX = "p14_auth_"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])
const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"])
const TABLE_NAME_PATTERN = /^p14_auth_(counter|barrier)_[a-f0-9]+$/
const UNDEFINED_CATALOG_CODE = "3D000"

let liveAuthHarnessCount = 0

export class AuthTestHarnessError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = "AuthTestHarnessError"
    this.code = code
  }
}

export type AuthPostgresBarrierResult = {
  winnerId: string
  loserId: string
  winnerCount: number
  acquired: [boolean, boolean]
}

export type AuthPostgresInspection = {
  rowCount: number
  valueHash: string
}

export type AuthPostgresCleanupResult = {
  droppedTables: string[]
}

export type AuthPostgresHarness = {
  readonly databaseName: string
  readonly hostname: string
  readonly port: string
  readonly counterTable: string
  readonly barrierTable: string
  contendForExclusiveClaim(
    lockName: string,
    contestantIds: [string, string]
  ): Promise<AuthPostgresBarrierResult>
  incrementSharedCounter(): Promise<void>
  inspectSharedCounter(): Promise<AuthPostgresInspection>
  ownedTables(): string[]
  ownedTablesExist(): Promise<boolean>
  cleanup(): Promise<AuthPostgresCleanupResult>
}

export type AuthPostgresBinding = {
  databaseUrl: string
  databaseName: string
  hostname: string
  port: string
  counterTable: string
}

const postgresBindings = new WeakMap<AuthPostgresHarness, AuthPostgresBinding>()

function assertAuthTestHarness(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new AuthTestHarnessError(AUTH_TEST_HARNESS_FORBIDDEN)
  }
}

assertAuthTestHarness()

export function hashAuthInspection(value: string): string {
  assertAuthTestHarness()
  return createHash("sha256").update(value, "utf8").digest("hex")
}

export function validateAuthPostgresUrl(rawUrl: unknown): URL {
  assertAuthTestHarness()

  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_URL_REQUIRED")
  }

  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_URL_INVALID")
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_PROTOCOL_FORBIDDEN")
  }

  const hostname = normalizeLoopbackHostname(url.hostname)

  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_HOST_FORBIDDEN")
  }

  return url
}

function quoteTable(name: string): string {
  if (!TABLE_NAME_PATTERN.test(name)) {
    throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_IDENTIFIER_FORBIDDEN")
  }

  return `"${name}"`
}

function advisoryKey(lockName: string): { classid: number; objid: number } {
  const digest = createHash("sha256")
    .update(`p14-auth-barrier:${lockName}`)
    .digest()

  return {
    classid: digest.readInt32BE(0),
    objid: digest.readInt32BE(4),
  }
}

function redactError(): AuthTestHarnessError {
  return new AuthTestHarnessError("AUTH_TEST_POSTGRES_CONNECT_FAILED")
}

function isPgErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === code
  )
}

function pathnameDatabase(url: URL): string {
  return decodeURIComponent(url.pathname.replace(/^\//, "")).trim()
}

function assertAuthStateDatabaseName(
  actual: string | undefined,
  expected: string
): string {
  if (
    !actual ||
    SYSTEM_DATABASES.has(actual) ||
    actual !== expected
  ) {
    throw new AuthTestHarnessError(AUTH_TEST_POSTGRES_DATABASE_FORBIDDEN)
  }

  return actual
}

function quoteDisposableDatabase(name: string): string {
  const validated = requireDisposableDatabaseName(name)

  if (SYSTEM_DATABASES.has(validated)) {
    throw new AuthTestHarnessError(AUTH_TEST_POSTGRES_DATABASE_FORBIDDEN)
  }

  return `"${validated}"`
}

function buildMaintenanceUrl(authStateUrl: URL): string {
  const maintenanceUrl = new URL(authStateUrl.toString())
  maintenanceUrl.pathname = "/postgres"
  maintenanceUrl.search = ""
  maintenanceUrl.hash = ""
  return maintenanceUrl.toString()
}

async function readCurrentDatabase(client: Client): Promise<string | undefined> {
  const result = await client.query<{ name: string }>(
    "select current_database() as name"
  )
  return result.rows[0]?.name
}

async function connectClient(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString })
  client.on("error", () => undefined)

  try {
    await client.connect()
    return client
  } catch (error) {
    try {
      await client.end()
    } catch {
      undefined
    }
    throw redactError()
  }
}

async function tryConnect(
  connectionString: string
): Promise<{ ok: true; client: Client } | { ok: false; error: unknown }> {
  const client = new Client({ connectionString })
  client.on("error", () => undefined)

  try {
    await client.connect()
    return { ok: true, client }
  } catch (error) {
    try {
      await client.end()
    } catch {
      undefined
    }
    return { ok: false, error }
  }
}

async function provisionDisposableDatabase(
  authStateUrl: URL,
  disposableName: string
): Promise<void> {
  const quoted = quoteDisposableDatabase(disposableName)
  const maintenance = await connectClient(buildMaintenanceUrl(authStateUrl))

  try {
    const current = await readCurrentDatabase(maintenance)

    if (current !== "postgres" || SYSTEM_DATABASES.has(disposableName)) {
      throw new AuthTestHarnessError(AUTH_TEST_POSTGRES_DATABASE_FORBIDDEN)
    }

    const existing = await maintenance.query(
      "select 1 from pg_database where datname = $1",
      [disposableName]
    )

    if ((existing.rowCount ?? 0) === 0) {
      try {
        await maintenance.query(`create database ${quoted}`)
      } catch (error) {
        if (!isPgErrorCode(error, "42P04")) {
          throw error
        }
      }
    }
  } catch (error) {
    if (error instanceof AuthTestHarnessError) {
      throw error
    }
    throw redactError()
  } finally {
    await maintenance.end()
  }
}

async function dropDisposableDatabase(
  authStateUrl: URL,
  disposableName: string
): Promise<void> {
  const quoted = quoteDisposableDatabase(disposableName)
  const maintenance = await connectClient(buildMaintenanceUrl(authStateUrl))

  try {
    const current = await readCurrentDatabase(maintenance)

    if (current !== "postgres" || current === disposableName) {
      throw new AuthTestHarnessError(AUTH_TEST_POSTGRES_DATABASE_FORBIDDEN)
    }

    try {
      await maintenance.query(`drop database if exists ${quoted}`)
    } catch (error) {
      if (error instanceof AuthTestHarnessError) {
        throw error
      }

      await maintenance.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
        [disposableName]
      )
      await maintenance.query(`drop database if exists ${quoted}`)
    }
  } catch (error) {
    if (error instanceof AuthTestHarnessError) {
      throw error
    }
    throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_CLEANUP_FAILED")
  } finally {
    await maintenance.end()
  }
}

async function connectAndAssertAuthState(
  connectionString: string,
  disposableName: string
): Promise<string> {
  const attempt = await tryConnect(connectionString)

  if (!attempt.ok) {
    throw attempt.error
  }

  try {
    const current = await readCurrentDatabase(attempt.client)
    return assertAuthStateDatabaseName(current, disposableName)
  } finally {
    await attempt.client.end()
  }
}

async function resolveConnectionString(databaseUrl: string): Promise<{
  connectionString: string
  databaseName: string
  hostname: string
  port: string
}> {
  const url = validateAuthPostgresUrl(databaseUrl)
  const disposableName = requireDisposableDatabaseName(process.env.DB_TEMP_NAME)
  const hostname = normalizeLoopbackHostname(url.hostname)
  const port = url.port || "5432"
  const connectionString = url.toString()

  assertAuthStateDatabaseName(pathnameDatabase(url), disposableName)

  try {
    const databaseName = await connectAndAssertAuthState(
      connectionString,
      disposableName
    )
    return { connectionString, databaseName, hostname, port }
  } catch (error) {
    if (error instanceof AuthTestHarnessError) {
      throw error
    }
    if (!isPgErrorCode(error, UNDEFINED_CATALOG_CODE)) {
      throw redactError()
    }
  }

  await provisionDisposableDatabase(url, disposableName)

  try {
    const databaseName = await connectAndAssertAuthState(
      connectionString,
      disposableName
    )
    return { connectionString, databaseName, hostname, port }
  } catch (error) {
    await dropDisposableDatabase(url, disposableName).catch(() => undefined)
    if (error instanceof AuthTestHarnessError) {
      throw error
    }
    throw redactError()
  }
}

async function withClient<T>(
  connectionString: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const client = await connectClient(connectionString)
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function withAuthStateClient<T>(
  connectionString: string,
  expectedDatabase: string,
  fn: (client: Client) => Promise<T>
): Promise<T> {
  return withClient(connectionString, async (client) => {
    const current = await readCurrentDatabase(client)
    assertAuthStateDatabaseName(current, expectedDatabase)
    return fn(client)
  })
}

export function getAuthPostgresTestBinding(
  harness: AuthPostgresHarness
): AuthPostgresBinding {
  assertAuthTestHarness()
  const binding = postgresBindings.get(harness)
  if (!binding) {
    throw new AuthTestHarnessError(AUTH_TEST_HARNESS_FORBIDDEN)
  }
  return binding
}

export async function createAuthPostgresHarness(): Promise<AuthPostgresHarness> {
  assertAuthTestHarness()

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_URL_REQUIRED")
  }

  const resolved = await resolveConnectionString(databaseUrl)
  const runId = randomBytes(8).toString("hex")
  const counterTable = `${AUTH_TABLE_PREFIX}counter_${runId}`
  const barrierTable = `${AUTH_TABLE_PREFIX}barrier_${runId}`
  const owned = [counterTable, barrierTable]
  let cleaned = false

  const authStateUrl = validateAuthPostgresUrl(resolved.connectionString)

  try {
    await withAuthStateClient(
      resolved.connectionString,
      resolved.databaseName,
      async (client) => {
        await client.query(
          `create table ${quoteTable(counterTable)} (id text primary key, value integer not null)`
        )
        await client.query(
          `insert into ${quoteTable(counterTable)} (id, value) values ($1, $2)`,
          ["shared", 0]
        )
        await client.query(
          `create table ${quoteTable(barrierTable)} (lock_name text primary key, winner_id text not null)`
        )
      }
    )
  } catch (error) {
    await withAuthStateClient(
      resolved.connectionString,
      resolved.databaseName,
      async (client) => {
        await client.query(`drop table if exists ${quoteTable(counterTable)}`)
        await client.query(`drop table if exists ${quoteTable(barrierTable)}`)
      }
    ).catch(() => undefined)
    if (liveAuthHarnessCount === 0) {
      await dropDisposableDatabase(authStateUrl, resolved.databaseName).catch(
        () => undefined
      )
    }
    if (error instanceof AuthTestHarnessError) {
      throw error
    }
    throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_CONNECT_FAILED")
  }

  liveAuthHarnessCount += 1

  const harness: AuthPostgresHarness = {
    databaseName: resolved.databaseName,
    hostname: resolved.hostname,
    port: resolved.port,
    counterTable,
    barrierTable,
    async contendForExclusiveClaim(lockName, contestantIds) {
      assertAuthTestHarness()
      const key = advisoryKey(lockName)
      const clientA = await connectClient(resolved.connectionString)
      const clientB = await connectClient(resolved.connectionString)

      try {
        assertAuthStateDatabaseName(
          await readCurrentDatabase(clientA),
          resolved.databaseName
        )
        assertAuthStateDatabaseName(
          await readCurrentDatabase(clientB),
          resolved.databaseName
        )
        await clientA.query("begin")
        await clientB.query("begin")

        const [lockA, lockB] = await Promise.all([
          clientA.query<{ acquired: boolean }>(
            "select pg_try_advisory_xact_lock($1, $2) as acquired",
            [key.classid, key.objid]
          ),
          clientB.query<{ acquired: boolean }>(
            "select pg_try_advisory_xact_lock($1, $2) as acquired",
            [key.classid, key.objid]
          ),
        ])

        const acquired: [boolean, boolean] = [
          lockA.rows[0]?.acquired === true,
          lockB.rows[0]?.acquired === true,
        ]
        const clients = [clientA, clientB] as const

        for (let index = 0; index < contestantIds.length; index += 1) {
          if (acquired[index]) {
            await clients[index].query(
              `insert into ${quoteTable(barrierTable)} (lock_name, winner_id) values ($1, $2)`,
              [lockName, contestantIds[index]]
            )
          }
        }

        await clientA.query("commit")
        await clientB.query("commit")

        const winners = contestantIds.filter((_, index) => acquired[index])
        if (winners.length !== 1) {
          throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_BARRIER_FAILED")
        }

        const winnerId = winners[0]!
        const loserId =
          winnerId === contestantIds[0] ? contestantIds[1] : contestantIds[0]

        return {
          winnerId,
          loserId,
          winnerCount: 1,
          acquired,
        }
      } catch (error) {
        try {
          await clientA.query("rollback")
        } catch {
          undefined
        }
        try {
          await clientB.query("rollback")
        } catch {
          undefined
        }
        if (error instanceof AuthTestHarnessError) {
          throw error
        }
        throw new AuthTestHarnessError("AUTH_TEST_POSTGRES_BARRIER_FAILED")
      } finally {
        await clientA.end()
        await clientB.end()
      }
    },
    async incrementSharedCounter() {
      assertAuthTestHarness()
      await withAuthStateClient(
        resolved.connectionString,
        resolved.databaseName,
        async (client) => {
          await client.query(
            `update ${quoteTable(counterTable)} set value = value + 1 where id = $1`,
            ["shared"]
          )
        }
      )
    },
    async inspectSharedCounter() {
      assertAuthTestHarness()
      return withAuthStateClient(
        resolved.connectionString,
        resolved.databaseName,
        async (client) => {
          const result = await client.query<{ id: string; value: string }>(
            `select id::text as id, value::text as value from ${quoteTable(counterTable)} where id = $1`,
            ["shared"]
          )
          const row = result.rows[0]
          return {
            rowCount: result.rowCount ?? 0,
            valueHash: row
              ? hashAuthInspection(`${row.id}:${row.value}`)
              : hashAuthInspection("empty"),
          }
        }
      )
    },
    ownedTables() {
      assertAuthTestHarness()
      return [...owned]
    },
    async ownedTablesExist() {
      assertAuthTestHarness()
      return withAuthStateClient(
        resolved.connectionString,
        resolved.databaseName,
        async (client) => {
          const result = await client.query<{ exists: boolean }>(
            `select exists (
               select 1 from information_schema.tables
               where table_schema = 'public' and table_name = any($1::text[])
             ) as exists`,
            [owned]
          )
          return result.rows[0]?.exists === true
        }
      )
    },
    async cleanup() {
      assertAuthTestHarness()
      if (cleaned) {
        return { droppedTables: [...owned] }
      }

      try {
        await withAuthStateClient(
          resolved.connectionString,
          resolved.databaseName,
          async (client) => {
            for (const table of owned) {
              await client.query(`drop table if exists ${quoteTable(table)}`)
            }
          }
        )
        liveAuthHarnessCount = Math.max(0, liveAuthHarnessCount - 1)
        if (liveAuthHarnessCount === 0) {
          await dropDisposableDatabase(authStateUrl, resolved.databaseName)
        }
        cleaned = true
        return { droppedTables: [...owned] }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "AUTH_TEST_POSTGRES_CLEANUP_FAILED"
        throw new AuthTestHarnessError(
          redactPostgresText(message).includes("AUTH_TEST_POSTGRES")
            ? "AUTH_TEST_POSTGRES_CLEANUP_FAILED"
            : "AUTH_TEST_POSTGRES_CLEANUP_FAILED"
        )
      }
    },
  }

  postgresBindings.set(harness, {
    databaseUrl: resolved.connectionString,
    databaseName: resolved.databaseName,
    hostname: resolved.hostname,
    port: resolved.port,
    counterTable,
  })

  return harness
}
