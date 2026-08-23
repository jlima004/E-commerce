import { createHash, randomBytes } from "node:crypto"
import { Client } from "pg"
import {
  normalizeLoopbackHostname,
  redactPostgresText,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"

export const GUEST_CART_TEST_HARNESS_FORBIDDEN =
  "GUEST_CART_TEST_HARNESS_FORBIDDEN"
export const GUEST_CART_TABLE_PREFIX = "p15_guest_cart_"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])
const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"])
const TABLE_NAME_PATTERN = /^p15_guest_cart_[a-z0-9_]+$/

export class GuestCartPostgresHarnessError extends Error {
  readonly code: string

  constructor(code: string, message = code) {
    super(message)
    this.name = "GuestCartPostgresHarnessError"
    this.code = code
  }
}

export type GuestCartProbeRow = {
  id: string
  cart_id: string
  token_hash: string
  status?: string
  expires_at?: Date | string
  metadata?: Record<string, unknown> | null
}

export type GuestCartPostgresHarness = {
  readonly databaseName: string
  readonly hostname: string
  readonly port: string
  readonly probeTable: string
  readonly client: Client
  insertProbeRow(row: GuestCartProbeRow): Promise<void>
  assertHashOnly(input: {
    plaintextCanary: string
    tokenHash: string
  }): Promise<void>
  assertUniqueTokenHash(
    rowA: GuestCartProbeRow,
    rowB: GuestCartProbeRow
  ): Promise<void>
  cleanup(): Promise<{ droppedTables: string[] }>
}

function assertGuestCartTestHarnessAllowed(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new GuestCartPostgresHarnessError(GUEST_CART_TEST_HARNESS_FORBIDDEN)
  }
}

assertGuestCartTestHarnessAllowed()

export function validateGuestCartPostgresUrl(rawUrl: unknown): URL {
  assertGuestCartTestHarnessAllowed()

  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new GuestCartPostgresHarnessError(
      "GUEST_CART_POSTGRES_URL_REQUIRED"
    )
  }

  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new GuestCartPostgresHarnessError("GUEST_CART_POSTGRES_URL_INVALID")
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new GuestCartPostgresHarnessError(
      "GUEST_CART_POSTGRES_PROTOCOL_FORBIDDEN"
    )
  }

  const hostname = normalizeLoopbackHostname(url.hostname)

  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new GuestCartPostgresHarnessError(
      "GUEST_CART_POSTGRES_HOST_FORBIDDEN"
    )
  }

  return url
}

function quoteTable(name: string): string {
  if (!TABLE_NAME_PATTERN.test(name)) {
    throw new GuestCartPostgresHarnessError(
      "GUEST_CART_POSTGRES_IDENTIFIER_FORBIDDEN"
    )
  }

  return `"${name}"`
}

export async function assertGuestCartHashOnlyPersistence(
  client: Client,
  input: {
    tableName: string
    plaintextCanary: string
    tokenHash: string
  }
): Promise<void> {
  assertGuestCartTestHarnessAllowed()
  const tableName = quoteTable(input.tableName)

  const result = await client.query<{
    id: string
    cart_id: string
    token_hash: string
    status: string
    expires_at: string
    metadata_text: string | null
    created_at: string
  }>(`
    select id, cart_id, token_hash, status,
           expires_at::text as expires_at,
           metadata::text as metadata_text,
           created_at::text as created_at
    from ${tableName}
  `)

  let foundTokenHash = false

  for (const row of result.rows) {
    const serialized = JSON.stringify(row)
    if (serialized.includes(input.plaintextCanary)) {
      throw new GuestCartPostgresHarnessError(
        "GUEST_CART_POSTGRES_PLAINTEXT_LEAKAGE_DETECTED"
      )
    }

    if (row.token_hash === input.tokenHash) {
      foundTokenHash = true
    }
  }

  if (!foundTokenHash) {
    throw new GuestCartPostgresHarnessError(
      "GUEST_CART_POSTGRES_TOKEN_HASH_MISSING"
    )
  }
}

export async function assertTokenHashUnique(
  client: Client,
  input: {
    tableName: string
    rowA: GuestCartProbeRow
    rowB: GuestCartProbeRow
  }
): Promise<void> {
  assertGuestCartTestHarnessAllowed()
  const tableName = quoteTable(input.tableName)

  const insertSql = `
    insert into ${tableName} (id, cart_id, token_hash, status, expires_at, metadata)
    values ($1, $2, $3, $4, $5, $6)
  `

  await client.query(insertSql, [
    input.rowA.id,
    input.rowA.cart_id,
    input.rowA.token_hash,
    input.rowA.status ?? "active",
    input.rowA.expires_at ?? new Date(Date.now() + 7 * 86400 * 1000),
    input.rowA.metadata ? JSON.stringify(input.rowA.metadata) : null,
  ])

  let uniqueViolationCaught = false

  try {
    await client.query(insertSql, [
      input.rowB.id,
      input.rowB.cart_id,
      input.rowB.token_hash,
      input.rowB.status ?? "active",
      input.rowB.expires_at ?? new Date(Date.now() + 7 * 86400 * 1000),
      input.rowB.metadata ? JSON.stringify(input.rowB.metadata) : null,
    ])
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "23505"
    ) {
      uniqueViolationCaught = true
    } else {
      throw error
    }
  }

  if (!uniqueViolationCaught) {
    throw new GuestCartPostgresHarnessError(
      "GUEST_CART_POSTGRES_UNIQUE_CONSTRAINT_NOT_ENFORCED"
    )
  }
}

function buildMaintenanceUrl(targetUrl: URL): string {
  const maintenanceUrl = new URL(targetUrl.toString())
  maintenanceUrl.pathname = "/postgres"
  maintenanceUrl.search = ""
  maintenanceUrl.hash = ""
  return maintenanceUrl.toString()
}

async function ensureDatabaseProvisioned(
  url: URL,
  disposableDatabase: string
): Promise<void> {
  const maintenanceUrl = buildMaintenanceUrl(url)
  const maintenanceClient = new Client({ connectionString: maintenanceUrl })
  await maintenanceClient.connect()

  try {
    const existing = await maintenanceClient.query(
      "select 1 from pg_database where datname = $1",
      [disposableDatabase]
    )

    if ((existing.rowCount ?? 0) === 0) {
      await maintenanceClient.query(`create database "${disposableDatabase}"`)
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: unknown }).code === "42P04"
    ) {
      // Database already exists
    } else {
      throw error
    }
  } finally {
    await maintenanceClient.end().catch(() => undefined)
  }
}

async function dropDisposableDatabase(
  url: URL,
  disposableDatabase: string
): Promise<void> {
  const maintenanceUrl = buildMaintenanceUrl(url)
  const maintenanceClient = new Client({ connectionString: maintenanceUrl })
  await maintenanceClient.connect()

  try {
    await maintenanceClient.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [disposableDatabase]
    )
    await maintenanceClient.query(
      `drop database if exists "${disposableDatabase}"`
    )
  } finally {
    await maintenanceClient.end().catch(() => undefined)
  }
}

export async function createGuestCartPostgresProbeHarness(options?: {
  databaseUrl?: string
  databaseName?: string
}): Promise<GuestCartPostgresHarness> {
  assertGuestCartTestHarnessAllowed()

  const rawUrl = options?.databaseUrl || process.env.DATABASE_URL
  if (!rawUrl) {
    throw new GuestCartPostgresHarnessError("GUEST_CART_POSTGRES_URL_REQUIRED")
  }

  const url = validateGuestCartPostgresUrl(rawUrl)
  const disposableDatabase = requireDisposableDatabaseName(
    options?.databaseName ||
      process.env.DB_TEMP_NAME ||
      decodeURIComponent(url.pathname.replace(/^\//, ""))
  )

  if (SYSTEM_DATABASES.has(disposableDatabase)) {
    throw new GuestCartPostgresHarnessError(
      "GUEST_CART_POSTGRES_DATABASE_FORBIDDEN"
    )
  }

  await ensureDatabaseProvisioned(url, disposableDatabase)

  const connectionUrl = new URL(url.toString())
  connectionUrl.pathname = `/${disposableDatabase}`

  const client = new Client({ connectionString: connectionUrl.toString() })
  await client.connect()

  const runId = randomBytes(6).toString("hex")
  const probeTable = `${GUEST_CART_TABLE_PREFIX}probe_${runId}`
  const owned = [probeTable]
  let cleaned = false

  try {
    await client.query(`
      create table ${quoteTable(probeTable)} (
        id text primary key,
        cart_id text not null,
        token_hash text not null,
        status text not null default 'active',
        expires_at timestamptz not null,
        metadata jsonb,
        created_at timestamptz not null default now(),
        constraint "UQ_${probeTable}_token_hash" unique (token_hash)
      )
    `)
  } catch (error) {
    await client.end().catch(() => undefined)
    throw error
  }

  return {
    databaseName: disposableDatabase,
    hostname: normalizeLoopbackHostname(url.hostname),
    port: url.port || "5432",
    probeTable,
    client,
    async insertProbeRow(row: GuestCartProbeRow): Promise<void> {
      assertGuestCartTestHarnessAllowed()
      await client.query(
        `
          insert into ${quoteTable(probeTable)} (
            id, cart_id, token_hash, status, expires_at, metadata
          ) values ($1, $2, $3, $4, $5, $6)
        `,
        [
          row.id,
          row.cart_id,
          row.token_hash,
          row.status ?? "active",
          row.expires_at ?? new Date(Date.now() + 7 * 86400 * 1000),
          row.metadata ? JSON.stringify(row.metadata) : null,
        ]
      )
    },
    async assertHashOnly(input: {
      plaintextCanary: string
      tokenHash: string
    }): Promise<void> {
      return assertGuestCartHashOnlyPersistence(client, {
        tableName: probeTable,
        plaintextCanary: input.plaintextCanary,
        tokenHash: input.tokenHash,
      })
    },
    async assertUniqueTokenHash(
      rowA: GuestCartProbeRow,
      rowB: GuestCartProbeRow
    ): Promise<void> {
      return assertTokenHashUnique(client, {
        tableName: probeTable,
        rowA,
        rowB,
      })
    },
    async cleanup(): Promise<{ droppedTables: string[] }> {
      assertGuestCartTestHarnessAllowed()
      if (cleaned) {
        return { droppedTables: [...owned] }
      }

      try {
        for (const table of owned) {
          await client.query(`drop table if exists ${quoteTable(table)}`).catch(() => undefined)
        }
        await client.end().catch(() => undefined)
        await dropDisposableDatabase(url, disposableDatabase)
        cleaned = true
        return { droppedTables: [...owned] }
      } catch (error) {
        throw new GuestCartPostgresHarnessError(
          "GUEST_CART_POSTGRES_CLEANUP_FAILED"
        )
      }
    },
  }
}
