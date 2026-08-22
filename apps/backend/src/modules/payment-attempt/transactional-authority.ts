import {
  applyStripePaymentIntentWebhookToAttempt,
  PaymentAttemptWebhookError,
  type StripePaymentIntentWebhookObject,
  type SupportedStripePaymentIntentEventType,
} from "./service"
import {
  ACTIVE_PAYMENT_ATTEMPT_STATUSES,
} from "./state-machine"
import type { PaymentAttemptRecord } from "./types"

export type PaymentAttemptSqlTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
}

export type PaymentAttemptSqlConnection = {
  transaction<T>(callback: (trx: PaymentAttemptSqlTransaction) => Promise<T>): Promise<T>
}

export const PAYMENT_ATTEMPT_ORDER_AUTHORITY_EXISTS =
  "PAYMENT_ATTEMPT_ORDER_AUTHORITY_EXISTS"
export const PAYMENT_ATTEMPT_ORDER_AUTHORITY_UNAVAILABLE =
  "PAYMENT_ATTEMPT_ORDER_AUTHORITY_UNAVAILABLE"
export const PAYMENT_ATTEMPT_CART_VERSION_UNBOUND =
  "PAYMENT_ATTEMPT_CART_VERSION_UNBOUND"
export const PAYMENT_ATTEMPT_CART_VERSION_STALE =
  "PAYMENT_ATTEMPT_CART_VERSION_STALE"

const ACTIVE_STATUS_BINDINGS = ACTIVE_PAYMENT_ATTEMPT_STATUSES.map(() => "?").join(
  ", "
)

const PAYMENT_ATTEMPT_COLUMNS = [
  "id",
  "cart_id",
  "payment_collection_id",
  "payment_session_id",
  "provider",
  "provider_payment_intent_id",
  "provider_payment_session_id",
  "payment_method_type",
  "status",
  "amount",
  "currency_code",
  "expires_at",
  "order_id",
  "metadata",
  "client_confirmed_at",
  "instructions_displayed_at",
  "awaiting_webhook_since",
  "superseded_at",
  "invalidated_at",
  "canceled_at",
  "failed_at",
  "expired_at",
  "created_at",
  "updated_at",
] as const

function queryRows(
  transaction: PaymentAttemptSqlTransaction,
  sql: string,
  bindings: unknown[] = []
): Promise<Array<Record<string, unknown>>> {
  return transaction.raw(sql, bindings).then((result) => result.rows ?? [])
}

function readNullableDate(value: unknown): Date | string | null {
  return value instanceof Date || typeof value === "string" ? value : null
}

function mapPaymentAttemptRow(row: Record<string, unknown>): PaymentAttemptRecord {
  const metadata = row.metadata

  return {
    id: String(row.id),
    cart_id: String(row.cart_id),
    payment_collection_id: String(row.payment_collection_id),
    payment_session_id:
      row.payment_session_id === null || row.payment_session_id === undefined
        ? null
        : String(row.payment_session_id),
    provider: String(row.provider),
    provider_payment_intent_id:
      row.provider_payment_intent_id === null ||
      row.provider_payment_intent_id === undefined
        ? null
        : String(row.provider_payment_intent_id),
    provider_payment_session_id:
      row.provider_payment_session_id === null ||
      row.provider_payment_session_id === undefined
        ? null
        : String(row.provider_payment_session_id),
    payment_method_type: row.payment_method_type as PaymentAttemptRecord["payment_method_type"],
    status: row.status as PaymentAttemptRecord["status"],
    amount: typeof row.amount === "number" ? row.amount : Number(row.amount),
    currency_code: String(row.currency_code),
    expires_at: readNullableDate(row.expires_at),
    order_id: row.order_id === null || row.order_id === undefined ? null : String(row.order_id),
    metadata:
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : null,
    client_confirmed_at: readNullableDate(row.client_confirmed_at),
    instructions_displayed_at: readNullableDate(row.instructions_displayed_at),
    awaiting_webhook_since: readNullableDate(row.awaiting_webhook_since),
    superseded_at: readNullableDate(row.superseded_at),
    invalidated_at: readNullableDate(row.invalidated_at),
    canceled_at: readNullableDate(row.canceled_at),
    failed_at: readNullableDate(row.failed_at),
    expired_at: readNullableDate(row.expired_at),
    created_at: readNullableDate(row.created_at) ?? undefined,
    updated_at: readNullableDate(row.updated_at) ?? undefined,
  }
}

function selectColumns(): string {
  return PAYMENT_ATTEMPT_COLUMNS.join(", ")
}

/**
 * All cart mutation, webhook transition and Order authority paths acquire this
 * transaction-scoped PostgreSQL lock before touching PaymentAttempt state.
 * hashtextextended keeps the lock key opaque and avoids putting IDs in logs.
 */
export async function lockCartOrderAuthority(
  transaction: PaymentAttemptSqlTransaction,
  cartId: string
): Promise<void> {
  await transaction.raw(
    "select pg_advisory_xact_lock(hashtextextended(?, 1515))",
    [cartId]
  )
}

export async function readPaymentAttemptForUpdate(
  transaction: PaymentAttemptSqlTransaction,
  input:
    | { id: string }
    | { provider_payment_intent_id: string },
  forUpdate = true
): Promise<PaymentAttemptRecord | null> {
  const key = "id" in input ? "id" : "provider_payment_intent_id"
  const rows = await queryRows(
    transaction,
    `select ${selectColumns()} from payment_attempt where ${key} = ? and deleted_at is null${forUpdate ? " for update" : ""}`,
    [input[key]]
  )
  return rows[0] ? mapPaymentAttemptRow(rows[0]) : null
}

export async function readCartResourceVersionForUpdate(
  transaction: PaymentAttemptSqlTransaction,
  cartId: string,
  forUpdate = true
): Promise<number | null> {
  const rows = await queryRows(
    transaction,
    `
      select version
      from store_resource_version
      where resource_type = 'cart' and resource_id = ? and deleted_at is null
      ${forUpdate ? "for update" : ""}
    `,
    [cartId]
  )
  return rows[0] ? Number(rows[0].version) : null
}

export function readPaymentAttemptCartResourceVersion(
  attempt: Pick<PaymentAttemptRecord, "metadata">
): number | null {
  const value = attempt.metadata?.cart_resource_version
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

export function assertPaymentAttemptCartResourceVersion(
  attempt: Pick<PaymentAttemptRecord, "metadata">,
  currentVersion: number | null
): void {
  const boundVersion = readPaymentAttemptCartResourceVersion(attempt)

  if (boundVersion === null) {
    throw new Error(PAYMENT_ATTEMPT_CART_VERSION_UNBOUND)
  }

  if (currentVersion === null || boundVersion !== currentVersion) {
    throw new Error(PAYMENT_ATTEMPT_CART_VERSION_STALE)
  }
}

export async function invalidatePaymentAttemptsForCartChangeInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  cartId: string,
  at: Date
): Promise<PaymentAttemptRecord[]> {
  await lockCartOrderAuthority(transaction, cartId)

  const locked = await queryRows(
    transaction,
    `
      select ${selectColumns()}
      from payment_attempt
      where cart_id = ? and deleted_at is null
      order by id
      for update
    `,
    [cartId]
  )
  const attempts = locked.map(mapPaymentAttemptRow)
  const active = attempts.filter((attempt) =>
    ACTIVE_PAYMENT_ATTEMPT_STATUSES.includes(attempt.status)
  )

  if (active.some((attempt) => attempt.order_id !== null)) {
    throw new Error(PAYMENT_ATTEMPT_ORDER_AUTHORITY_EXISTS)
  }

  if (active.length > 1) {
    throw new Error("PAYMENT_ATTEMPT_MULTIPLE_ACTIVE")
  }

  if (active.length === 0) {
    return []
  }

  const updated = await queryRows(
    transaction,
    `
      update payment_attempt
      set status = 'invalidated_by_cart_change',
          invalidated_at = ?,
          order_id = null,
          updated_at = ?
      where id = ?
        and cart_id = ?
        and deleted_at is null
        and order_id is null
        and status in (${ACTIVE_STATUS_BINDINGS})
      returning ${selectColumns()}
    `,
    [
      at.toISOString(),
      at.toISOString(),
      active[0].id,
      cartId,
      ...ACTIVE_PAYMENT_ATTEMPT_STATUSES,
    ]
  )

  if (updated.length !== 1) {
    throw new Error("PAYMENT_ATTEMPT_INVALIDATION_CAS_FAILED")
  }

  return [mapPaymentAttemptRow(updated[0])]
}

export async function applyStripePaymentIntentWebhookInTransaction(
  transaction: PaymentAttemptSqlTransaction,
  paymentIntent: StripePaymentIntentWebhookObject,
  eventType: SupportedStripePaymentIntentEventType,
  at: Date
): Promise<PaymentAttemptRecord> {
  const unlocked = await queryRows(
    transaction,
    `select cart_id from payment_attempt where provider_payment_intent_id = ? and deleted_at is null`,
    [paymentIntent.id]
  )

  if (unlocked.length === 0) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_NOT_FOUND",
      "Tentativa nao encontrada para o PaymentIntent."
    )
  }

  const cartId = String(unlocked[0].cart_id)
  await lockCartOrderAuthority(transaction, cartId)
  const attempt = await readPaymentAttemptForUpdate(transaction, {
    provider_payment_intent_id: paymentIntent.id as string,
  })

  if (!attempt) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_NOT_FOUND",
      "Tentativa nao encontrada para o PaymentIntent."
    )
  }

  const updatedAttempt = applyStripePaymentIntentWebhookToAttempt(
    attempt,
    paymentIntent,
    eventType,
    at
  )

  if (updatedAttempt.status === attempt.status) {
    return attempt
  }

  const timestampColumn =
    eventType === "payment_intent.payment_failed"
      ? "failed_at"
      : eventType === "payment_intent.canceled"
        ? "canceled_at"
        : null
  const rows = await queryRows(
    transaction,
    `
      update payment_attempt
      set status = ?,
          ${timestampColumn ? `${timestampColumn} = ?,` : ""}
          order_id = null,
          updated_at = ?
      where id = ?
        and cart_id = ?
        and provider_payment_intent_id = ?
        and deleted_at is null
        and order_id is null
        and status = ?
      returning ${selectColumns()}
    `,
    [
      updatedAttempt.status,
      ...(timestampColumn ? [at.toISOString()] : []),
      at.toISOString(),
      attempt.id,
      attempt.cart_id,
      paymentIntent.id,
      attempt.status,
    ]
  )

  if (rows.length !== 1) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_WEBHOOK_STALE",
      "Tentativa nao pode ser atualizada pelo webhook atual.",
      "ignored"
    )
  }

  return mapPaymentAttemptRow(rows[0])
}

export async function withCartOrderAuthorityLock<T>(
  connection: PaymentAttemptSqlConnection,
  paymentAttemptId: string,
  callback: (input: {
    transaction: PaymentAttemptSqlTransaction
    attempt: PaymentAttemptRecord
    currentCartResourceVersion: number | null
  }) => Promise<T>
): Promise<T> {
  return connection.transaction(async (transaction) => {
    const unlocked = await queryRows(
      transaction,
      `select cart_id from payment_attempt where id = ? and deleted_at is null`,
      [paymentAttemptId]
    )
    if (unlocked.length !== 1) {
      throw new Error("PAYMENT_ATTEMPT_NOT_FOUND")
    }

    const cartId = String(unlocked[0].cart_id)
    await lockCartOrderAuthority(transaction, cartId)
    // The advisory lock serializes this authority check with cart mutation and
    // webhook transitions. Do not retain row locks while the callback invokes
    // Medusa modules, because those modules may use another DB connection.
    const attempt = await readPaymentAttemptForUpdate(
      transaction,
      { id: paymentAttemptId },
      false
    )
    if (!attempt) {
      throw new Error("PAYMENT_ATTEMPT_NOT_FOUND")
    }

    return callback({
      transaction,
      attempt,
      currentCartResourceVersion: await readCartResourceVersionForUpdate(
        transaction,
        cartId,
        false
      ),
    })
  })
}
