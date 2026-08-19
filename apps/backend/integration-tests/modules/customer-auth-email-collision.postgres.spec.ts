import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { Client } from "pg"
import {
  type CustomerAuthEmailCollisionReport,
} from "../../scripts/audit-customer-auth-email-collisions"

const databaseUrl = process.env.DATABASE_URL?.trim()
const databaseName = process.env.DB_TEMP_NAME?.trim()
const scenario = process.env.P14_EMAIL_COLLISION_SCENARIO?.trim()
const AUDIT_SECRET = "test-customer-auth-audit-secret-32-bytes-0000"
jest.setTimeout(30000)
const BACKEND_ROOT = process.cwd().endsWith("/apps/backend")
  ? resolve(process.cwd())
  : resolve(process.cwd(), "apps/backend")
const REPOSITORY_ROOT = resolve(BACKEND_ROOT, "../..")
const DISPOSABLE_RUNNER = resolve(
  REPOSITORY_ROOT,
  "apps/backend/scripts/run-disposable-postgres-tests.mjs"
)
const AUDIT_CLI = resolve(
  REPOSITORY_ROOT,
  "apps/backend/scripts/audit-customer-auth-email-collisions.ts"
)
const COLLISION_SPEC =
  "integration-tests/modules/customer-auth-email-collision.postgres.spec.ts"

type ChildProcessResult = {
  code: number
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

function runChildProcess(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<ChildProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: REPOSITORY_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      resolveResult({
        code: code ?? 1,
        signal,
        stdout,
        stderr,
      })
    })
  })
}

async function runAuditCli(): Promise<ChildProcessResult> {
  return runChildProcess(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", AUDIT_CLI],
    {
      ...process.env,
      CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY: AUDIT_SECRET,
    }
  )
}

function parseAuditCliReport(
  result: ChildProcessResult,
  expectedStatus: CustomerAuthEmailCollisionReport["status"],
  expectedExit: number,
  forbidden: string[]
): CustomerAuthEmailCollisionReport {
  if (result.code !== expectedExit) {
    const sanitize = (value: string): string => {
      let sanitized = value
      for (const forbiddenValue of forbidden) {
        sanitized = sanitized.split(forbiddenValue).join("[REDACTED]")
      }
      return sanitized
        .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://[REDACTED]")
        .replace(/[\w.+-]+@[\w.-]+/g, "[REDACTED]")
    }
    throw new Error(
      `audit CLI unexpected exit: ${JSON.stringify({
        code: result.code,
        stdout: sanitize(result.stdout),
        stderr: sanitize(result.stderr),
      })}`
    )
  }
  expect(result.code).toBe(expectedExit)
  expect(result.signal).toBeNull()

  const output = `${result.stdout}\n${result.stderr}`
  for (const value of forbidden) {
    expect(output).not.toContain(value)
  }
  expect(output).not.toMatch(/user|example\.com|bücher|例え/i)
  expect(output).not.toMatch(/winner|merge|correct/i)
  expect(result.stderr).toBe("")

  const lines = result.stdout.trim().split(/\r?\n/)
  expect(lines).toHaveLength(1)
  const report = JSON.parse(lines[0]) as CustomerAuthEmailCollisionReport
  expect(report.status).toBe(expectedStatus)
  return report
}

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
    await client.query("drop table if exists provider_identity, customer")
    await client.query(`
      create table provider_identity (
        id text not null,
        entity_id text not null,
        provider text not null,
        deleted_at timestamptz null
      )
    `)
    await client.query(`
      create table customer (
        id text not null,
        email text not null,
        deleted_at timestamptz null
      )
    `)
    return await fn(client)
  } finally {
    await client
      .query("drop table if exists provider_identity, customer")
      .catch(() => undefined)
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

function requireNestedScenario(): "zero-collision" | "collision-invalid" {
  if (scenario === "zero-collision" || scenario === "collision-invalid") {
    return scenario
  }
  throw new Error("P14_EMAIL_COLLISION_SCENARIO is required")
}

async function runIsolatedScenario(
  isolatedScenario: "zero-collision" | "collision-invalid"
): Promise<string> {
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY: AUDIT_SECRET,
    P14_EMAIL_COLLISION_SCENARIO: isolatedScenario,
  }
  delete childEnv.P12_DISPOSABLE_DATABASE_URL
  delete childEnv.P12_DISPOSABLE_DB_NAME

  const result = await runChildProcess(
    process.execPath,
    [
      DISPOSABLE_RUNNER,
      "--",
      "npm",
      "run",
      "test:integration:modules",
      "-w",
      "@dtc/backend",
      "--",
      "--runTestsByPath",
      COLLISION_SPEC,
    ],
    childEnv
  )

  expect(result.code).toBe(0)
  expect(result.signal).toBeNull()
  const marker = result.stdout.match(
    /\[P12_DISPOSABLE_POSTGRES_READY\] mode=(\w+) target=(p12_disposable_[a-z0-9_]+)/
  )
  expect(marker?.[1]).toBe("docker")
  expect(result.stdout).toMatch(/\[P12_DISPOSABLE_POSTGRES_CLEAN\]/)
  return marker?.[2] ?? ""
}

if (!databaseUrl || !databaseName) {
  describe("customer auth email collision audit", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(databaseUrl || databaseName).toBeFalsy()
    })
  })
} else if (!scenario) {
  describe("customer auth email collision CLI process gate", () => {
    it("proves each scenario in its own disposable PostgreSQL process", async () => {
      const zeroCollisionDatabase = await runIsolatedScenario("zero-collision")
      const collisionDatabase = await runIsolatedScenario("collision-invalid")

      expect(zeroCollisionDatabase).toBeTruthy()
      expect(collisionDatabase).toBeTruthy()
      expect(zeroCollisionDatabase).not.toBe(collisionDatabase)
    })
  })
} else {
  const activeScenario = requireNestedScenario()

  describe("customer auth email collision audit", () => {
    beforeAll(async () => {
      await ensureDisposableDatabase()
    })

    afterAll(async () => {
      await dropDisposableDatabase()
    })

    it("executes the real CLI as PASS with zero writes and sanitized output", async () => {
      if (activeScenario !== "zero-collision") {
        return
      }
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
        const cliResult = await runAuditCli()
        const report = parseAuditCliReport(
          cliResult,
          "PASS",
          0,
          [
            AUDIT_SECRET,
            "User.Name+tag@Example.COM",
            "user.name+tag@example.com",
            databaseUrl!,
          ]
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

    it("classifies invalid identity and customer inputs in the real CLI", async () => {
      if (activeScenario !== "collision-invalid") {
        return
      }
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
        await client.query(
          "insert into customer (id, email) values ($1, $2)",
          ["customer_invalid", "also-invalid@@example.com"]
        )

        const before = await client.query(
          "select (select count(*) from provider_identity) as identities, (select count(*) from customer) as customers"
        )
        const cliResult = await runAuditCli()
        const report = parseAuditCliReport(
          cliResult,
          "BLOCKED",
          2,
          [
            AUDIT_SECRET,
            "Foo@example.com",
            " foo@EXAMPLE.com ",
            "invalid@@example.com",
            "also-invalid@@example.com",
            databaseUrl!,
          ]
        )
        const after = await client.query(
          "select (select count(*) from provider_identity) as identities, (select count(*) from customer) as customers"
        )

        expect(report.scanned.invalid_inputs).toBe(2)
        expect(report.blockers).toHaveLength(3)
        expect(report.blockers.some((blocker) => blocker.owner_count === 2)).toBe(
          true
        )
        expect(
          report.blockers.find(
            (blocker) => blocker.source === "identity" && blocker.owner_count === 1
          )
        ).toBeDefined()
        expect(
          report.blockers.find(
            (blocker) => blocker.source === "customer" && blocker.owner_count === 1
          )
        ).toBeDefined()
        expect(after.rows).toEqual(before.rows)
        expectSanitizedReport(report, [
          "Foo@example.com",
          "foo@EXAMPLE.com",
          "invalid@@example.com",
          "also-invalid@@example.com",
        ])
      })
    })
  })
}
