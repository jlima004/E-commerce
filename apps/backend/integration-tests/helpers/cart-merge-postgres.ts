import { randomBytes } from "node:crypto"

type RawResult = { rows?: Array<Record<string, unknown>> }

export type CartMergePostgresRawConnection = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<RawResult>
}

export type CartMergePostgresProbeRow = {
  id: string
  operation: string
  idempotencyKey: string
  stage: "cart" | "version" | "capability" | "idempotency"
  state: "committed" | "processing"
}

export type CartMergePostgresHarness = {
  readonly tableName: string
  record(
    transaction: CartMergePostgresRawConnection,
    row: CartMergePostgresProbeRow
  ): Promise<string>
  read(): Promise<Array<Record<string, unknown>>>
  clear(): Promise<void>
  cleanup(): Promise<{ droppedTables: string[] }>
}

const TABLE_PATTERN = /^p16_cart_merge_[a-z0-9_]+$/

function quoteTable(tableName: string): string {
  if (!TABLE_PATTERN.test(tableName)) {
    throw new Error("P16_CART_MERGE_TABLE_NAME_FORBIDDEN")
  }
  return `"${tableName}"`
}

/**
 * Wave 0 owns only this loopback probe table. The disposable runner owns the
 * database lifecycle; this helper registers and drops exactly the table it
 * created, so no remote database or Redis state can be touched accidentally.
 */
export async function createCartMergePostgresHarness(
  connection: CartMergePostgresRawConnection
): Promise<CartMergePostgresHarness> {
  const tableName = `p16_cart_merge_${randomBytes(6).toString("hex")}`
  const table = quoteTable(tableName)
  let cleaned = false

  await connection.raw(`
    create table ${table} (
      id text primary key,
      operation text not null,
      idempotency_key text not null,
      stage text not null check (stage in ('cart', 'version', 'capability', 'idempotency')),
      state text not null check (state in ('committed', 'processing')),
      transaction_id bigint not null,
      created_at timestamptz not null default now(),
      constraint ${tableName}_operation_key unique (operation, idempotency_key, stage)
    )
  `)

  return {
    tableName,
    async record(transaction, row): Promise<string> {
      const result = await transaction.raw(
        `
          insert into ${table} (
            id, operation, idempotency_key, stage, state, transaction_id
          ) values (?, ?, ?, ?, ?, txid_current())
          returning transaction_id::text as transaction_id
        `,
        [row.id, row.operation, row.idempotencyKey, row.stage, row.state]
      )
      return String(result.rows?.[0]?.transaction_id ?? "")
    },
    async read() {
      const result = await connection.raw(
        `select id, operation, idempotency_key, stage, state,
                transaction_id::text as transaction_id
         from ${table}
         order by case stage
           when 'cart' then 1
           when 'version' then 2
           when 'capability' then 3
           when 'idempotency' then 4
         end, id`
      )
      return result.rows ?? []
    },
    async clear() {
      await connection.raw(`delete from ${table}`)
    },
    async cleanup() {
      if (cleaned) return { droppedTables: [tableName] }
      await connection.raw(`drop table if exists ${table}`)
      cleaned = true
      return { droppedTables: [tableName] }
    },
  }
}

export function createCartMergeFailpoint(code = "P16_CART_MERGE_FAILPOINT") {
  let armed = false
  return {
    arm() {
      armed = true
    },
    trip() {
      if (armed) throw new Error(code)
    },
  }
}
