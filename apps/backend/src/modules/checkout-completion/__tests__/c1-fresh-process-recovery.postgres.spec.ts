import fs from "fs"
import path from "path"
import os from "os"
import { spawnSync } from "child_process"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"

jest.mock(
  "pg-god",
  () => {
    const { Client: PgClient } = jest.requireActual("pg") as typeof import("pg")
    const safe = (name: unknown) => {
      if (typeof name !== "string" || !/^p12_disposable_[a-z0-9_]+$/.test(name)) {
        throw new Error("P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN")
      }
      return name
    }
    const maintenance = () =>
      new PgClient({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: "postgres",
      })
    return {
      createDatabase: async ({ databaseName }: { databaseName: string }) => {
        const name = safe(databaseName)
        const client = maintenance()
        await client.connect()
        try {
          const found = await client.query(
            "select 1 from pg_database where datname = $1",
            [name]
          )
          if (found.rowCount === 0) await client.query(`create database "${name}"`)
        } finally {
          await client.end()
        }
      },
      dropDatabase: async ({ databaseName }: { databaseName: string }) => {
        const name = safe(databaseName)
        const client = maintenance()
        await client.connect()
        try {
          await client.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
            [name]
          )
          await client.query(`drop database if exists "${name}"`)
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
  describe("C1 fresh-process PostgreSQL routing", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(() => requireDisposableDatabaseName(requestedDatabaseName)).toThrow(
        "P12_DISPOSABLE_DATABASE_NAME_REQUIRED"
      )
    })
  })
} else {
  const disposableEnvironment = buildDisposableMedusaEnvironment(process.env)
  assertDisposableMedusaEnvironment(disposableEnvironment)
  for (const [key, value] of Object.entries(disposableEnvironment)) {
    if (typeof value === "string") process.env[key] = value
  }

  const { medusaIntegrationTestRunner } = jest.requireActual(
    "@medusajs/test-utils"
  ) as typeof import("@medusajs/test-utils")
  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  jest.setTimeout(300_000)

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection }) => {
      it("C1 — Real post-create-orders crash, fresh-process recovery, exactly-one physical Order", async () => {
        const connSettings = (dbConnection.client as any).connectionSettings
        const dbUrl =
          process.env.DATABASE_URL ??
          `postgres://${connSettings.user}:${connSettings.password}@${connSettings.host}:${connSettings.port}/${connSettings.database}`

        const identity = `c1_fresh_${Date.now()}`
        const tmpDir = os.tmpdir()
        const procAOutput = path.join(tmpDir, `c1_proc_a_${identity}.json`)
        const procBOutput = path.join(tmpDir, `c1_proc_b_${identity}.json`)

        // =========================================================================
        // 1. Process A: Run until C1 (after createOrdersStep, before order_cart link)
        //    Process A crashes with process.exit(42)
        // =========================================================================
        const tsNodeBin = path.resolve(process.cwd(), "../../node_modules/.bin/ts-node")
        const procAScript = path.join(__dirname, "c1-process-a.ts")
        const procAResult = spawnSync(
          tsNodeBin,
          ["--swc", procAScript],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DATABASE_URL: dbUrl,
              C1_PROCESS_A_OUTPUT: procAOutput,
              C1_IDENTITY: identity,
              NODE_ENV: "test",
              ADMIN_DISABLED: "true",
              DISABLE_MEDUSA_ADMIN: "true",
              MEDUSA_ADMIN_DISABLED: "true",
              RESEND_ORDER_CONFIRMATION_ENABLED: "false",
              JWT_SECRET: "test-jwt-secret-canonical-proof",
              COOKIE_SECRET: "test-cookie-secret-canonical-proof",
            },
            encoding: "utf8",
            timeout: 120000,
          }
        )

        if (procAResult.status !== 42) {
          console.error("Process A stdout:", procAResult.stdout)
          console.error("Process A stderr:", procAResult.stderr)
        }
        expect(procAResult.status).toBe(42)

        // Read Process A crash report
        expect(fs.existsSync(procAOutput)).toBe(true)
        const dataA = JSON.parse(fs.readFileSync(procAOutput, "utf8"))
        const {
          crashedOrderId,
          cartId,
          cclId,
          paymentAttemptId,
        } = dataA

        expect(crashedOrderId).toBeTruthy()
        expect(cartId).toBeTruthy()
        expect(cclId).toBeTruthy()
        expect(paymentAttemptId).toBeTruthy()

        // =========================================================================
        // 2. C1 Pre-Recovery Assertions in real PostgreSQL (Sections 26 & 60)
        // =========================================================================

        // Assertion 1: Order X physically exists in DB
        const orderRow = await dbConnection.raw(
          `select id, metadata, currency_code from "order" where id = ?`,
          [crashedOrderId]
        )
        expect(orderRow.rows).toHaveLength(1)
        expect(orderRow.rows[0].id).toBe(crashedOrderId)

        // Assertion 2: Order X marker == CCL.id
        expect(
          orderRow.rows[0].metadata?.order_birth_checkout_completion_log_id
        ).toBe(cclId)

        // Assertion 3: order_cart row for cart: ABSENT (C1 boundary confirmed!)
        const orderCartRows = await dbConnection.raw(
          `select * from "order_cart" where cart_id = ?`,
          [cartId]
        )
        expect(orderCartRows.rows).toHaveLength(0)

        // Assertion 4: CCL.order_id: NULL
        const cclPreRecovery = await dbConnection.raw(
          `select id, status, order_id, execution_started_at from checkout_completion_log where id = ?`,
          [cclId]
        )
        expect(cclPreRecovery.rows[0].order_id).toBeNull()

        // Assertion 5: PaymentAttempt.order_id: NULL
        const paPreRecovery = await dbConnection.raw(
          `select id, status, order_id from payment_attempt where id = ?`,
          [paymentAttemptId]
        )
        expect(paPreRecovery.rows[0].order_id).toBeNull()

        // Assertion 6: CCL.execution_started_at: NON-NULL
        expect(cclPreRecovery.rows[0].execution_started_at).not.toBeNull()

        // Assertion 7: physical Orders matching marker: 1
        const countMatchingPre = await dbConnection.raw(
          `select count(*)::int as count from "order" where metadata->>'order_birth_checkout_completion_log_id' = ?`,
          [cclId]
        )
        expect(countMatchingPre.rows[0].count).toBe(1)

        // =========================================================================
        // 3. Process B: Fresh process, fresh container, unshared memory
        //    Runs canonical recovery without original webhook dependency
        // =========================================================================
        const procBScript = path.join(__dirname, "c1-process-b.ts")
        const procBResult = spawnSync(
          tsNodeBin,
          ["--swc", procBScript],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              DATABASE_URL: dbUrl,
              C1_PROCESS_B_INPUT: procAOutput,
              C1_PROCESS_B_OUTPUT: procBOutput,
              NODE_ENV: "test",
              ADMIN_DISABLED: "true",
              DISABLE_MEDUSA_ADMIN: "true",
              MEDUSA_ADMIN_DISABLED: "true",
              RESEND_ORDER_CONFIRMATION_ENABLED: "false",
              JWT_SECRET: "test-jwt-secret-canonical-proof",
              COOKIE_SECRET: "test-cookie-secret-canonical-proof",
            },
            encoding: "utf8",
            timeout: 120000,
          }
        )

        if (procBResult.status !== 0) {
          console.error("Process B stdout:", procBResult.stdout)
          console.error("Process B stderr:", procBResult.stderr)
        }
        expect(procBResult.status).toBe(0)

        // Read Process B recovery report
        expect(fs.existsSync(procBOutput)).toBe(true)
        const dataB = JSON.parse(fs.readFileSync(procBOutput, "utf8"))

        // Scanner finds exact Order X by marker
        expect(dataB.recoveredOrderId).toBe(crashedOrderId)
        // completeCart calls after restart = 0!
        expect(dataB.completeCartInvocations).toBe(0)
        expect(dataB.status).toBe("reused_existing_order")
        expect(dataB.checkoutCompletionStatus).toBe("completed")

        // =========================================================================
        // 4. C1 Recovery Assertions in real PostgreSQL (Sections 29 & 61)
        // =========================================================================

        // CCL.order_id: X, CCL.status: completed
        const cclPostRecovery = await dbConnection.raw(
          `select id, status, order_id from checkout_completion_log where id = ?`,
          [cclId]
        )
        expect(cclPostRecovery.rows).toEqual([
          {
            id: cclId,
            status: "completed",
            order_id: crashedOrderId,
          },
        ])

        // PaymentAttempt.order_id: X
        const paPostRecovery = await dbConnection.raw(
          `select id, status, order_id from payment_attempt where id = ?`,
          [paymentAttemptId]
        )
        expect(paPostRecovery.rows[0].order_id).toBe(crashedOrderId)

        // physical Order count: exactly 1
        const countMatchingPost = await dbConnection.raw(
          `select count(*)::int as count from "order" where metadata->>'order_birth_checkout_completion_log_id' = ?`,
          [cclId]
        )
        expect(countMatchingPost.rows[0].count).toBe(1)

        // Clean up tmp files
        try {
          fs.unlinkSync(procAOutput)
          fs.unlinkSync(procBOutput)
        } catch {}
      })
    },
  })
}
