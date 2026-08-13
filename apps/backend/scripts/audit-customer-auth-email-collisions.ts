import { createHmac } from "node:crypto"
import { createRequire } from "node:module"
import { Client } from "pg"

const scriptRequire = createRequire(
  typeof __filename === "string" ? __filename : process.argv[1]!
)
const { normalizeCustomerAuthEmail } = scriptRequire(
  "../src/modules/customer-auth/security/email-normalization.ts"
) as typeof import("../src/modules/customer-auth/security/email-normalization")

type Queryable = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>
}

type OwnerSource = "identity" | "customer"

type OwnerRow = {
  id: string
  email: string
}

export type CustomerAuthEmailCollisionReport = {
  status: "PASS" | "BLOCKED"
  scanned: {
    identity: number
    customer: number
    normalized_groups: number
    invalid_inputs: number
  }
  blockers: Array<{
    source: OwnerSource
    fingerprint: string
    owner_count: number
    owner_ids: string[]
  }>
}

function opaqueDigest(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret)
    .update(`customer-auth-email-collision:v1|${purpose}|${value}`, "utf8")
    .digest("hex")
}

function assertAuditSecret(secret: string): void {
  if (typeof secret !== "string" || secret.trim().length < 32) {
    throw new Error("CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY is required for audit")
  }
}

function addOwner(
  groups: Map<string, Set<string>>,
  source: OwnerSource,
  row: OwnerRow,
  secret: string,
  invalid: { count: number }
): void {
  let normalized: string
  try {
    normalized = normalizeCustomerAuthEmail(row.email)
  } catch {
    invalid.count += 1
    return
  }

  const fingerprint = opaqueDigest(secret, `normalized:${source}`, normalized)
  const owner = opaqueDigest(secret, `owner:${source}`, row.id)
  const groupKey = `${source}:${fingerprint}`
  const owners = groups.get(groupKey) ?? new Set<string>()
  owners.add(owner)
  groups.set(groupKey, owners)
}

export async function auditCustomerAuthEmailCollisions(
  client: Queryable,
  secret: string
): Promise<CustomerAuthEmailCollisionReport> {
  assertAuditSecret(secret)

  const groups = new Map<string, Set<string>>()
  const invalid = { count: 0 }
  const identities = await client.query<OwnerRow>(
    "select id::text as id, entity_id::text as email from provider_identity where deleted_at is null and provider = $1",
    ["emailpass"]
  )
  const customers = await client.query<OwnerRow>(
    "select id::text as id, email::text as email from customer where deleted_at is null"
  )

  for (const row of identities.rows) {
    addOwner(groups, "identity", row, secret, invalid)
  }
  for (const row of customers.rows) {
    addOwner(groups, "customer", row, secret, invalid)
  }

  const blockers = [...groups.entries()]
    .filter(([, owners]) => owners.size > 1)
    .map(([groupKey, owners]) => {
      const separator = groupKey.indexOf(":")
      const source = groupKey.slice(0, separator) as OwnerSource
      const fingerprint = groupKey.slice(separator + 1)
      return {
        source,
        fingerprint,
        owner_count: owners.size,
        owner_ids: [...owners].sort(),
      }
    })
    .sort((left, right) =>
      `${left.source}:${left.fingerprint}`.localeCompare(
        `${right.source}:${right.fingerprint}`
      )
    )

  if (invalid.count > 0) {
    blockers.push({
      source: "identity",
      fingerprint: opaqueDigest(secret, "invalid-input", String(invalid.count)),
      owner_count: invalid.count,
      owner_ids: [],
    })
  }

  return {
    status: blockers.length === 0 ? "PASS" : "BLOCKED",
    scanned: {
      identity: identities.rowCount ?? identities.rows.length,
      customer: customers.rowCount ?? customers.rows.length,
      normalized_groups: groups.size,
      invalid_inputs: invalid.count,
    },
    blockers,
  }
}

export async function runCustomerAuthEmailCollisionAudit(
  client: Queryable,
  secret: string
): Promise<CustomerAuthEmailCollisionReport> {
  await client.query("begin read only")
  try {
    const report = await auditCustomerAuthEmailCollisions(client, secret)
    await client.query("rollback")
    return report
  } catch (error) {
    await client.query("rollback").catch(() => undefined)
    throw error
  }
}

function requireDisposableDatabaseEnvironment(): {
  databaseUrl: string
  databaseName: string
  secret: string
} {
  const databaseUrl = (process.env.DATABASE_URL ?? "").trim()
  const databaseName = (process.env.DB_TEMP_NAME ?? "").trim()
  const secret = (process.env.CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY ?? "").trim()
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL")
  }
  if (!/^p12_disposable_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error("DB_TEMP_NAME must identify a disposable PostgreSQL database")
  }
  assertAuditSecret(secret)
  const parsed = new URL(databaseUrl)
  if (decodeURIComponent(parsed.pathname.slice(1)) !== databaseName) {
    throw new Error("DATABASE_URL must target DB_TEMP_NAME")
  }
  return { databaseUrl, databaseName, secret }
}

const runningAsCli = process.argv[1]?.endsWith(
  "audit-customer-auth-email-collisions.ts"
)

if (runningAsCli) {
  const environment = requireDisposableDatabaseEnvironment()
  const client = new Client({ connectionString: environment.databaseUrl })
  client
    .connect()
    .then(async () => {
      const current = await client.query<{ name: string }>(
        "select current_database() as name"
      )
      if (current.rows[0]?.name !== environment.databaseName) {
        throw new Error("Audit connection is not bound to DB_TEMP_NAME")
      }
      const report = await runCustomerAuthEmailCollisionAudit(
        client,
        environment.secret
      )
      process.stdout.write(`${JSON.stringify(report)}\n`)
      if (report.status !== "PASS") {
        process.exitCode = 2
      }
    })
    .catch(() => {
      process.stdout.write(
        `${JSON.stringify({ status: "ERROR", code: "CUSTOMER_AUTH_EMAIL_AUDIT_FAILED" })}\n`
      )
      process.exitCode = 1
    })
    .finally(() => client.end())
}
