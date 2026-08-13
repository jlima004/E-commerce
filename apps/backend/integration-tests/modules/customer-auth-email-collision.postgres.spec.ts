import { Client } from "pg"
import {
  runCustomerAuthEmailCollisionAudit,
  type CustomerAuthEmailCollisionReport,
} from "../../scripts/audit-customer-auth-email-collisions"

const databaseUrl = process.env.DATABASE_URL?.trim()
const databaseName = process.env.DB_TEMP_NAME?.trim()
const AUDIT_SECRET = "test-customer-auth-audit-secret-32-bytes-0000"

async function withFixture<T>(
  fn: (client: Client) => Promise<T>
): Promise<T> {
  if (!databaseUrl || !databaseName) {
    throw new Error("disposable PostgreSQL environment is required")
  }

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const current = await client.query<{ name: string }>(
      "select current_database() as name"
    )
    expect(current.rows[0]?.name).toBe(databaseName)
    await client.query(`
      create temporary table provider_identity (
        id text not null,
        entity_id text not null,
        provider text not null,
        deleted_at timestamptz null
      )
    `)
    await client.query(`
      create temporary table customer (
        id text not null,
        email text not null,
        deleted_at timestamptz null
      )
    `)
    return await fn(client)
  } finally {
    await client.end()
  }
}

async function ensureDisposableDatabase(): Promise<void> {
  if (!databaseUrl || !databaseName) {
    throw new Error("disposable PostgreSQL environment is required")
  }

  const target = new URL(databaseUrl)
  const maintenance = new URL(target)
  maintenance.pathname = "/postgres"
  const client = new Client({ connectionString: maintenance.toString() })
  await client.connect()
  try {
    const existing = await client.query(
      "select 1 from pg_database where datname = $1",
      [databaseName]
    )
    if (existing.rowCount === 0) {
      await client.query(`create database "${databaseName}"`)
    }
  } finally {
    await client.end()
  }
}

async function dropDisposableDatabase(): Promise<void> {
  if (!databaseUrl || !databaseName) {
    return
  }

  const target = new URL(databaseUrl)
  const maintenance = new URL(target)
  maintenance.pathname = "/postgres"
  const client = new Client({ connectionString: maintenance.toString() })
  await client.connect()
  try {
    await client.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
      [databaseName]
    )
    await client.query(`drop database if exists "${databaseName}"`)
  } finally {
    await client.end()
  }
}

function expectSanitizedReport(
  report: CustomerAuthEmailCollisionReport,
  forbidden: string[]
): void {
  const serialized = JSON.stringify(report)
  for (const value of forbidden) {
    expect(serialized).not.toContain(value)
  }
  expect(serialized).not.toMatch(/user|example\.com|bücher|例え/i)
  for (const blocker of report.blockers) {
    expect(blocker.fingerprint).toMatch(/^[0-9a-f-]+$/)
    for (const ownerId of blocker.owner_ids) {
      expect(ownerId).toMatch(/^[0-9a-f]{64}$/)
    }
  }
}

if (!databaseUrl || !databaseName) {
  describe("customer auth email collision audit", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(databaseUrl || databaseName).toBeFalsy()
    })
  })
} else {
  describe("customer auth email collision audit", () => {
    beforeAll(async () => {
      await ensureDisposableDatabase()
    })

    afterAll(async () => {
      await dropDisposableDatabase()
    })

    it("passes one identity/customer owner per normalized source without writes", async () => {
      await withFixture(async (client) => {
        await client.query(
          "insert into provider_identity (id, entity_id, provider) values ($1, $2, $3)",
          ["identity_1", "  User.Name+tag@Example.COM ", "emailpass"]
        )
        await client.query(
          "insert into customer (id, email) values ($1, $2)",
          ["customer_1", "user.name+tag@example.com"]
        )

        const before = await client.query(
          "select (select count(*) from provider_identity) as identities, (select count(*) from customer) as customers"
        )
        const report = await runCustomerAuthEmailCollisionAudit(
          client,
          AUDIT_SECRET
        )
        const after = await client.query(
          "select (select count(*) from provider_identity) as identities, (select count(*) from customer) as customers"
        )

        expect(report).toMatchObject({
          status: "PASS",
          scanned: {
            identity: 1,
            customer: 1,
            invalid_inputs: 0,
          },
          blockers: [],
        })
        expect(after.rows).toEqual(before.rows)
        expectSanitizedReport(report, ["User.Name+tag@Example.COM"])
      })
    })

    it("blocks converging variants and invalid inputs without choosing a winner", async () => {
      await withFixture(async (client) => {
        await client.query(
          "insert into provider_identity (id, entity_id, provider) values ($1, $2, $3), ($4, $5, $3), ($6, $7, $3)",
          [
            "identity_a",
            "Foo@example.com",
            "emailpass",
            "identity_b",
            " foo@EXAMPLE.com ",
            "identity_invalid",
            "invalid@@example.com",
          ]
        )

        const report = await runCustomerAuthEmailCollisionAudit(
          client,
          AUDIT_SECRET
        )

        expect(report.status).toBe("BLOCKED")
        expect(report.scanned.invalid_inputs).toBe(1)
        expect(report.blockers).toHaveLength(2)
        expect(report.blockers.some((blocker) => blocker.owner_count === 2)).toBe(
          true
        )
        expectSanitizedReport(report, ["Foo@example.com", "foo@EXAMPLE.com"])
      })
    })
  })
}
