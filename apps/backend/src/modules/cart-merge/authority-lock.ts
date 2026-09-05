export type CustomerCartAuthorityTransaction = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
}

/** Shared Customer-scope lock for every canonical-cart authority transition. */
export async function lockCustomerCartAuthority(
  transaction: CustomerCartAuthorityTransaction,
  customerId: string
): Promise<void> {
  await transaction.raw(
    "select pg_advisory_xact_lock(hashtextextended(?, 1616))",
    [customerId]
  )
}
