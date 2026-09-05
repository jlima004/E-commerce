import { Client } from "pg"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Migration20260901130000 } from "../../src/modules/payment-attempt/migrations/Migration20260901130000"
import { Migration20260901130100 } from "../../src/modules/checkout-completion/migrations/Migration20260901130100"
import { readCheckoutCompletionLogHistory } from "../../src/modules/checkout-completion/service"
import { requireDisposableDatabaseName, buildDisposableMedusaEnvironment, assertDisposableMedusaEnvironment } from "../postgres/disposable-postgres-harness"

jest.mock("pg-god", () => {
  const { Client: PgClient } = jest.requireActual("pg") as typeof import("pg")
  const safe = (name: unknown) => {
    if (typeof name !== "string" || !/^p12_disposable_[a-z0-9_]+$/.test(name)) {
      throw new Error("P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN")
    }
    return name
  }
  const maintenance = () => new PgClient({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: "postgres",
  })
  return {
    createDatabase: async ({ databaseName }: { databaseName: string }) => {
      const name = safe(databaseName); const db = maintenance(); await db.connect()
      try {
        const found = await db.query("select 1 from pg_database where datname=$1", [name])
        if (found.rowCount === 0) await db.query(`create database "${name}"`)
      } finally { await db.end() }
    },
    dropDatabase: async ({ databaseName }: { databaseName: string }) => {
      const name = safe(databaseName); const db = maintenance(); await db.connect()
      try {
        await db.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()", [name])
        await db.query(`drop database if exists "${name}"`)
      } finally { await db.end() }
    },
  }
}, { virtual: true })

const requestedDatabaseName = process.env.DB_TEMP_NAME

if (!requestedDatabaseName) {
  describe("R3 disposable PostgreSQL routing", () => {
    it("fails closed without the disposable database", () => {
      expect(() => requireDisposableDatabaseName(requestedDatabaseName)).toThrow("P12_DISPOSABLE_DATABASE_NAME_REQUIRED")
    })
  })
} else {
  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)
  const disposableEnvironment = buildDisposableMedusaEnvironment(process.env)
  assertDisposableMedusaEnvironment(disposableEnvironment)
  for (const [name, value] of Object.entries(disposableEnvironment)) {
    if (typeof value === "string") process.env[name] = value
  }

  const client = () => new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: databaseName,
  })

  async function executeMigration(migration: { up(this: { addSql(sql: string): void }): Promise<void> }, db: Client) {
    const sql: string[] = []
    await migration.up.call({ addSql: (statement) => sql.push(statement) })
    for (const statement of sql) await db.query(statement)
  }

  async function executeMigrationInTransaction(
    migration: { up(this: { addSql(sql: string): void }): Promise<void> },
    db: Client
  ) {
    const sql: string[] = []
    await migration.up.call({ addSql: (statement) => sql.push(statement) })
    await db.query("begin")
    try {
      for (const statement of sql) await db.query(statement)
      await db.query("commit")
    } catch (error) {
      await db.query("rollback")
      throw error
    }
  }

  async function captureDown(migration: { down(this: { addSql(sql: string): void }): Promise<void> }) {
    const sql: string[] = []
    await migration.down.call({ addSql: (statement) => sql.push(statement) })
    return sql
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      jest.setTimeout(120_000)

      it("proves fresh baseline→R3 schema, defaults, indexes and module ownership", async () => {
        const pa = await dbConnection.raw(`
          select column_name, is_nullable, column_default
          from information_schema.columns
          where table_schema='public' and table_name='payment_attempt'
            and column_name in ('financial_freeze_started_at','provider_canceled_confirmed_at','provider_discovery_started_at','reconciliation_reason_code','reconciliation_locked_at','last_reconciliation_at')
          order by column_name
        `)
        expect(pa.rows).toHaveLength(6)
        expect(pa.rows.every((row: { is_nullable: string; column_default: unknown }) => row.is_nullable === "YES" && row.column_default === null)).toBe(true)
        const indexes = await dbConnection.raw(`select indexname, indexdef from pg_indexes where tablename='payment_attempt' and indexname like 'IDX_payment_attempt_%financial%' or indexname='IDX_payment_attempt_reconciliation_candidates'`)
        expect(indexes.rows.map((row: { indexname: string }) => row.indexname)).toEqual(expect.arrayContaining([
          "IDX_payment_attempt_unresolved_financial_freeze",
          "IDX_payment_attempt_reconciliation_candidates",
        ]))
        expect(getContainer().resolve(ContainerRegistrationKeys.CONFIG_MODULE)).toBeTruthy()
      })

      it("backfills every historical status conservatively, without Stripe", async () => {
        const db = client(); await db.connect()
        try {
          await db.query("create schema r3_pa_fixture")
          await db.query("set search_path to r3_pa_fixture")
          await db.query("create table payment_attempt (id text primary key,cart_id text not null,payment_collection_id text not null,provider text not null,provider_payment_intent_id text null,payment_method_type text not null,status text not null,amount bigint not null,currency_code text not null,order_id text null,created_at timestamptz not null,updated_at timestamptz not null,deleted_at timestamptz null)")
          const statuses = ["created","provider_session_created","client_action_required","card_client_secret_created","payment_client_confirmed","payment_instructions_displayed","awaiting_pix_payment","awaiting_webhook_confirmation","payment_confirmed_by_webhook","pix_expired","payment_failed","payment_canceled","superseded","invalidated_by_cart_change"]
          for (const [index, status] of statuses.entries()) {
            await db.query(`insert into payment_attempt (id,cart_id,payment_collection_id,provider,provider_payment_intent_id,payment_method_type,status,amount,currency_code,created_at,updated_at) values ($1,'cart_r3_' || $2,'pc_r3','stripe',$3,$4,$5,100,'brl','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')`, [`payatt_r3_${index}`, index, index < 2 ? null : `pi_legacy_${index}`, index === 0 || index === 1 ? (index === 0 ? "card" : "pix") : "card", status])
          }
          await db.query(`insert into payment_attempt (id,cart_id,payment_collection_id,provider,payment_method_type,status,amount,currency_code,order_id,created_at,updated_at) values ('payatt_r3_order','cart_r3_order','pc_r3','stripe','card','created',100,'brl','order_r3','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')`)
          await db.query(`insert into payment_attempt (id,cart_id,payment_collection_id,provider,provider_payment_intent_id,payment_method_type,status,amount,currency_code,created_at,updated_at) values ('payatt_r3_pix_created','cart_r3_pix','pc_r3','stripe',null,'pix','created',100,'brl','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')`)
          await db.query(`insert into payment_attempt (id,cart_id,payment_collection_id,provider,payment_method_type,status,amount,currency_code,created_at,updated_at,deleted_at) values ('payatt_r3_deleted','cart_r3_deleted','pc_r3','stripe','card','payment_failed',100,'brl','2026-09-01T00:00:00Z','2026-09-01T00:00:00Z',now())`)
          await executeMigration(new Migration20260901130000(), db)
          const all = await db.query(`select id, status, provider_payment_intent_id, order_id, financial_freeze_started_at, reconciliation_reason_code from payment_attempt where id like 'payatt_r3_%'`)
          expect(all.rows.filter((row) => row.order_id === null && row.financial_freeze_started_at !== null)).toHaveLength(16)
          expect(all.rows.find((row) => row.order_id === "order_r3")).toMatchObject({ financial_freeze_started_at: null, reconciliation_reason_code: null })
          expect(all.rows.filter((row) => row.order_id === null).every((row) => row.reconciliation_reason_code === "LEGACY_PROVIDER_DISPATCH_UNKNOWN")).toBe(true)
          expect(all.rows.find((row) => row.id === "payatt_r3_0")).toMatchObject({ status: "created", provider_payment_intent_id: null })
          expect(all.rows.find((row) => row.id === "payatt_r3_1")).toMatchObject({ status: "provider_session_created", provider_payment_intent_id: null })
          expect(all.rows.find((row) => row.id === "payatt_r3_pix_created")).toMatchObject({ status: "created", provider_payment_intent_id: null })
          expect(all.rows.find((row) => row.id === "payatt_r3_13")).toMatchObject({ status: "invalidated_by_cart_change", provider_payment_intent_id: "pi_legacy_13" })
        } finally { await db.query("reset search_path").catch(() => undefined); await db.query("drop schema if exists r3_pa_fixture cascade").catch(() => undefined); await db.end() }
      })

      it("executes upgrade fixtures and proves CCL normalization, historical uniqueness and soft-deleted owner reads", async () => {
        const db = client(); await db.connect()
        try {
          await db.query("create schema r3_fixture")
          await db.query("set search_path to r3_fixture")
          await db.query(`create table payment_attempt (id text primary key,cart_id text not null,payment_collection_id text not null,provider text not null,payment_method_type text not null,status text not null,amount bigint not null,currency_code text not null,order_id text null,created_at timestamptz not null,updated_at timestamptz not null,deleted_at timestamptz null)`)
          await executeMigration(new Migration20260901130000(), db)
          const fields = await db.query("select count(*)::int as count from information_schema.columns where table_schema='r3_fixture' and table_name='payment_attempt' and column_name in ('financial_freeze_started_at','provider_canceled_confirmed_at','provider_discovery_started_at','reconciliation_reason_code','reconciliation_locked_at','last_reconciliation_at')")
          expect(fields.rows[0].count).toBe(6)
          const downSql = await captureDown(new Migration20260901130000())
          await expect((async () => { for (const statement of downSql) await db.query(statement) })()).resolves.toBeUndefined()
          await db.query("create table checkout_completion_log (id text primary key,operation text not null,idempotency_key text not null,cart_id text not null,payment_intent_id text not null,payment_attempt_id text null,order_id text null,status text not null,error_code text null,error_message text null,metadata jsonb null,locked_at timestamptz null,completed_at timestamptz null,failed_at timestamptz null,created_at timestamptz not null,updated_at timestamptz not null,deleted_at timestamptz null)")
          type CheckoutCompletionLogRow = {
            id: string
            operation: string
            idempotency_key: string
            cart_id: string
            payment_intent_id: string
            payment_attempt_id: string | null
            order_id: string | null
            status: string
            error_code: string | null
            error_message: string | null
            metadata: object | null
            locked_at: string | null
            completed_at: string | null
            failed_at: string | null
            created_at: string
            updated_at: string
            deleted_at: Date | null
          }
          const insertCheckoutCompletionLogRow = (row: CheckoutCompletionLogRow) => db.query(
            `insert into checkout_completion_log (
              id, operation, idempotency_key, cart_id, payment_intent_id,
              payment_attempt_id, order_id, status, error_code, error_message,
              metadata, locked_at, completed_at, failed_at, created_at,
              updated_at, deleted_at
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              row.id, row.operation, row.idempotency_key, row.cart_id,
              row.payment_intent_id, row.payment_attempt_id, row.order_id,
              row.status, row.error_code, row.error_message, row.metadata,
              row.locked_at, row.completed_at, row.failed_at, row.created_at,
              row.updated_at, row.deleted_at,
            ]
          )
          const baseRow = (id: string, suffix: string): CheckoutCompletionLogRow => ({
            id,
            operation: "complete_checkout_create_order",
            idempotency_key: `idem_${suffix}`,
            cart_id: `cart_${suffix}`,
            payment_intent_id: `pi_${suffix}`,
            payment_attempt_id: null,
            order_id: null,
            status: "completed",
            error_code: null,
            error_message: null,
            metadata: null,
            locked_at: null,
            completed_at: null,
            failed_at: null,
            created_at: "2026-09-01",
            updated_at: "2026-09-01",
            deleted_at: null,
          })
          await insertCheckoutCompletionLogRow({ ...baseRow("c_processing", "p"), status: "processing" })
          await insertCheckoutCompletionLogRow({ ...baseRow("c_failed", "f"), status: "failed" })
          await insertCheckoutCompletionLogRow({ ...baseRow("c_completed_no_order", "c") })
          await insertCheckoutCompletionLogRow({ ...baseRow("c_completed_order", "o"), order_id: "order_o" })
          await insertCheckoutCompletionLogRow({ ...baseRow("c_deleted", "d"), status: "processing", deleted_at: new Date() })
          await insertCheckoutCompletionLogRow({ ...baseRow("c_deleted_authority", "da"), payment_attempt_id: "pa_d", order_id: "order_d" })
          await executeMigration(new Migration20260901130100(), db)
          const normalized = await db.query("select id,status,reconciliation_reason_code from checkout_completion_log order by id")
          expect(normalized.rows).toEqual(expect.arrayContaining([
            { id: "c_processing", status: "reconciliation_required", reconciliation_reason_code: "ORDER_BIRTH_EXECUTION_AMBIGUOUS" },
            { id: "c_failed", status: "reconciliation_required", reconciliation_reason_code: "ORDER_BIRTH_EXECUTION_AMBIGUOUS" },
            { id: "c_completed_no_order", status: "reconciliation_required", reconciliation_reason_code: "ORDER_RECOVERY_INCOMPLETE" },
            { id: "c_completed_order", status: "completed", reconciliation_reason_code: null },
            { id: "c_deleted", status: "reconciliation_required", reconciliation_reason_code: "ORDER_BIRTH_EXECUTION_AMBIGUOUS" },
          ]))
          const authorityCases = [
            ["idempotency_key", "UQ_checkout_completion_log_operation_idempotency_key"],
            ["cart_id", "UQ_checkout_completion_log_operation_cart_id"],
            ["payment_intent_id", "UQ_checkout_completion_log_operation_payment_intent_id"],
            ["payment_attempt_id", "UQ_checkout_completion_log_operation_payment_attempt_id"],
            ["order_id", "UQ_checkout_completion_log_operation_order_id"],
          ] as const
          for (const [column, constraint] of authorityCases) {
            const suffix = `authority_${column}`
            const original = baseRow(`original_${column}`, suffix)
            if (column === "payment_attempt_id") original.payment_attempt_id = `pa_${suffix}`
            if (column === "order_id") original.order_id = `order_${suffix}`
            await insertCheckoutCompletionLogRow(original)
            await db.query("update checkout_completion_log set deleted_at = now() where id = $1", [original.id])
            const deleted = await db.query("select deleted_at from checkout_completion_log where id = $1", [original.id])
            expect(deleted.rows[0].deleted_at).not.toBeNull()

            const duplicate = { ...baseRow(`duplicate_${column}`, `${suffix}_new`) }
            duplicate[column] = original[column]
            await expect(insertCheckoutCompletionLogRow(duplicate)).rejects.toMatchObject({ code: "23505", constraint })
          }
          const tx = { raw: async (sql: string, bindings?: unknown[]) => { let parameter = 0; const result = await db.query(sql.replace(/\?/g, () => `$${++parameter}`), bindings); return { rows: result.rows } } }
          const history = await readCheckoutCompletionLogHistory(tx, { id: "c_deleted" })
          expect(history).toHaveLength(1)
          expect(history[0]).toMatchObject({ id: "c_deleted", deleted_at: expect.anything() })
          const down = await captureDown(new Migration20260901130100())
          await expect((async () => { for (const statement of down) await db.query(statement) })()).rejects.toThrow("CHECKOUT_COMPLETION_R3_AUTHORITY_IN_USE")
        } finally { await db.query("reset search_path").catch(() => undefined); await db.query("drop schema if exists r3_fixture cascade").catch(() => undefined); await db.end() }
      })

      it("aborts the CCL migration before authority creation for every duplicate dimension", async () => {
        const db = client(); await db.connect()
        const collisionCases = [
          ["idempotency_key", "idem_collision", true],
          ["cart_id", "cart_collision", false],
          ["payment_intent_id", "pi_collision", false],
          ["payment_attempt_id", "payatt_collision", false],
          ["order_id", "order_collision", false],
        ] as const

        try {
          for (const [column, value, firstIsDeleted] of collisionCases) {
            const schema = `r3_duplicate_${column}`
            await db.query(`create schema ${schema}`)
            await db.query(`set search_path to ${schema}`)
            await db.query(`
              create table checkout_completion_log (
                id text primary key,
                operation text not null,
                idempotency_key text not null,
                cart_id text not null,
                payment_intent_id text not null,
                payment_attempt_id text null,
                order_id text null,
                status text not null,
                error_code text null,
                error_message text null,
                metadata jsonb null,
                locked_at timestamptz null,
                completed_at timestamptz null,
                failed_at timestamptz null,
                created_at timestamptz not null,
                updated_at timestamptz not null,
                deleted_at timestamptz null,
                constraint checkout_completion_log_status_check
                  check (status in ('processing', 'completed', 'failed'))
              )
            `)
            await db.query(
              `insert into checkout_completion_log (
                id, operation, idempotency_key, cart_id, payment_intent_id,
                payment_attempt_id, order_id, status, created_at, updated_at,
                deleted_at
              ) values
                ($1, 'complete_checkout_create_order', $2, $3, $4, $5, $6,
                 'completed', now(), now(), $7),
                ($8, 'complete_checkout_create_order', $9, $10, $11, $12, $13,
                 'completed', now(), now(), null)
              `,
              [
                `old_${column}`,
                column === "idempotency_key" ? value : `old_idem_${column}`,
                column === "cart_id" ? value : `old_cart_${column}`,
                column === "payment_intent_id" ? value : `old_pi_${column}`,
                column === "payment_attempt_id" ? value : null,
                column === "order_id" ? value : null,
                firstIsDeleted ? new Date() : null,
                `new_${column}`,
                column === "idempotency_key" ? value : `new_idem_${column}`,
                column === "cart_id" ? value : `new_cart_${column}`,
                column === "payment_intent_id" ? value : `new_pi_${column}`,
                column === "payment_attempt_id" ? value : null,
                column === "order_id" ? value : null,
              ]
            )

            await expect(
              executeMigrationInTransaction(new Migration20260901130100(), db)
            ).rejects.toThrow(`CHECKOUT_COMPLETION_DUPLICATE_${column.toUpperCase()}`)

            const authorityColumns = await db.query(
              `select count(*)::int as count
               from information_schema.columns
               where table_schema = $1
                 and table_name = 'checkout_completion_log'
                 and column_name in (
                   'execution_started_at',
                   'last_reconciliation_at',
                   'reconciliation_reason_code'
                 )`,
              [schema]
            )
            expect(authorityColumns.rows[0].count).toBe(0)

            const remaining = await db.query(
              `select count(*)::int as count
               from checkout_completion_log
               where operation = 'complete_checkout_create_order'
                 and "${column}" = $1`,
              [value]
            )
            expect(remaining.rows[0].count).toBe(2)

            const authorityIndexes = await db.query(
              `select count(*)::int as count
               from pg_indexes
               where schemaname = $1
                 and tablename = 'checkout_completion_log'
                 and indexname like 'UQ_checkout_completion_log_%'`,
              [schema]
            )
            expect(authorityIndexes.rows[0].count).toBe(0)

            await db.query("reset search_path")
            await db.query(`drop schema ${schema} cascade`)
          }
        } finally {
          await db.query("reset search_path").catch(() => undefined)
          for (const [column] of collisionCases) {
            await db.query(`drop schema if exists r3_duplicate_${column} cascade`).catch(() => undefined)
          }
          await db.end()
        }
      })
    },
  })
}
