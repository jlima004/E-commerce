import { createProductsWorkflow } from "@medusajs/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { randomBytes } from "node:crypto"
import {
  GUEST_CART_CAPABILITY_MODULE,
  type GuestCartCapabilityModuleService,
} from "../../src/modules/guest-cart-capability"
import { STORE_RESOURCE_VERSION_MODULE } from "../../src/modules/store-resource-version"

type RawResult = { rows?: Array<Record<string, unknown>> }

export type CartMergePostgresRawConnection = {
  raw(sql: string, bindings?: unknown[]): Promise<RawResult>
}

export type CartMergeFixture = {
  identity: string
  customerId: string
  guestCartId: string
  guestCartEmail: string
  variantId: string
  capabilityId: string
  capabilityToken: string
  guestVersion: number
  idempotencyKey: string
}

export type CartMergePersistedState = {
  cart_id: string
  customer_id: string | null
  cart_xmin: string
  line_items: unknown
  version: number | null
  version_xmin: string | null
  authority_state: string | null
  authority_customer_id: string | null
  authority_cart_id: string | null
  authority_xmin: string | null
  capability_status: string | null
  capability_consumed_at: string | null
  capability_xmin: string | null
  idempotency_state: string | null
  idempotency_result_id: string | null
  idempotency_xmin: string | null
  result_id: string | null
  result_outcome: string | null
  result_review_id: string | null
  result_xmin: string | null
  result_etag: string | null
  result_expires_at: string | null
  review_status: string | null
  review_ref: string | null
  review_xmin: string | null
}

export type CartMergeTransactionInstrumentation = {
  transactionIds: string[]
  restore(): void
}

export type CartMergeSchemaCatalog = {
  tables: string[]
  columns: Array<{
    table_name: string
    column_name: string
    udt_name: string
    is_nullable: string
  }>
  checks: Array<{
    table_name: string
    constraint_name: string
    definition: string
  }>
  indexes: Array<{
    table_name: string
    index_name: string
    is_unique: boolean
    predicate: string | null
    definition: string
  }>
}

export type CustomerCartBackfillAudit = {
  status: "none" | "single" | "ambiguous"
  candidateCount: number
  selectedCartId: string | null
  report: {
    code:
      | "P16_CUSTOMER_CART_BACKFILL_NO_CANDIDATE"
      | "P16_CUSTOMER_CART_BACKFILL_SINGLE_CANDIDATE"
      | "P16_CUSTOMER_CART_BACKFILL_AMBIGUOUS"
    candidateCount: number
  }
}

export type CartMergeResultProbeInput = {
  id: string
  idempotencyRecordId?: string
  customerId?: string
  guestCartId?: string
  canonicalCartId?: string
  capabilityId?: string
  requestFingerprint?: string
}

export type CartReviewProbeInput = {
  id: string
  cartId: string
  reviewRef: string
  mergeResultId: string
  status?: "pending" | "acknowledged"
}

export type CustomerCartAuthorityProbeInput = {
  id: string
  customerId: string
  cartId: string
  state?: "active" | "superseded"
}

type CartRepository = {
  transaction<T>(
    callback: (transactionManager: {
      getTransactionContext?: () => CartMergePostgresRawConnection | null
    }) => Promise<T>,
    ...options: unknown[]
  ): Promise<T>
}

type CartModule = {
  baseRepository_: CartRepository
}

type Failpoint = { trip(point?: string): void }

function requireRows(result: RawResult): Array<Record<string, unknown>> {
  return result.rows ?? []
}

function readString(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "")
}

function readNullableString(
  row: Record<string, unknown>,
  key: string
): string | null {
  return row[key] == null ? null : String(row[key])
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "t" || value === "true"
}

/**
 * Reads the physical catalog produced by the approved cart-merge migration.
 * The assertions intentionally query PostgreSQL catalogs instead of models or
 * TypeScript metadata so a disposable migration failure cannot be masked.
 */
export async function readCartMergeSchemaCatalog(
  connection: CartMergePostgresRawConnection
): Promise<CartMergeSchemaCatalog> {
  const tables = await connection.raw(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (
        'cart_merge_result',
        'cart_review',
        'customer_cart_authority'
      )
    order by table_name
  `)
  const columns = await connection.raw(`
    select table_name, column_name, udt_name, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'cart_merge_result',
        'cart_review',
        'customer_cart_authority'
      )
    order by table_name, ordinal_position
  `)
  const checks = await connection.raw(`
    select
      tbl.relname as table_name,
      con.conname as constraint_name,
      pg_get_constraintdef(con.oid) as definition
    from pg_constraint con
    join pg_class tbl on tbl.oid = con.conrelid
    join pg_namespace schema_name on schema_name.oid = tbl.relnamespace
    where schema_name.nspname = 'public'
      and con.contype = 'c'
      and tbl.relname in (
        'cart_merge_result',
        'cart_review',
        'customer_cart_authority'
      )
    order by tbl.relname, con.conname
  `)
  const indexes = await connection.raw(`
    select
      tbl.relname as table_name,
      idx.relname as index_name,
      catalog_index.indisunique as is_unique,
      pg_get_expr(catalog_index.indpred, catalog_index.indrelid) as predicate,
      pg_get_indexdef(catalog_index.indexrelid) as definition
    from pg_index catalog_index
    join pg_class idx on idx.oid = catalog_index.indexrelid
    join pg_class tbl on tbl.oid = catalog_index.indrelid
    join pg_namespace schema_name on schema_name.oid = tbl.relnamespace
    where schema_name.nspname = 'public'
      and tbl.relname in (
        'cart_merge_result',
        'cart_review',
        'customer_cart_authority'
      )
    order by tbl.relname, idx.relname
  `)

  return {
    tables: requireRows(tables).map((row) => readString(row, "table_name")),
    columns: requireRows(columns).map((row) => ({
      table_name: readString(row, "table_name"),
      column_name: readString(row, "column_name"),
      udt_name: readString(row, "udt_name"),
      is_nullable: readString(row, "is_nullable"),
    })),
    checks: requireRows(checks).map((row) => ({
      table_name: readString(row, "table_name"),
      constraint_name: readString(row, "constraint_name"),
      definition: readString(row, "definition"),
    })),
    indexes: requireRows(indexes).map((row) => ({
      table_name: readString(row, "table_name"),
      index_name: readString(row, "index_name"),
      is_unique: readBoolean(row.is_unique),
      predicate: readNullableString(row, "predicate"),
      definition: readString(row, "definition"),
    })),
  }
}

/**
 * Creates two real, active Customer carts representing historical duplicate
 * candidates. The audit below must refuse to choose either one.
 */
export async function createHistoricalCustomerCartCandidates(
  container: MedusaContainer,
  customerId: string,
  identity: string
): Promise<string[]> {
  const cartModule = container.resolve(Modules.CART) as unknown as {
    createCarts(input: Record<string, unknown>): Promise<unknown>
  }

  const candidates = await Promise.all(
    [0, 1].map(async (index) => {
      const created = await cartModule.createCarts({
        currency_code: "brl",
        customer_id: customerId,
        email: `${identity}@cart-merge.test`,
        metadata: {
          historical_fixture: true,
          candidate_index: index,
        },
      })
      const cart = Array.isArray(created) ? created[0] : created
      const cartId = String((cart as { id?: unknown })?.id ?? "")
      if (!cartId) {
        throw new Error("P16_HISTORICAL_CUSTOMER_CART_CREATION_FAILED")
      }
      return cartId
    })
  )

  return candidates
}

/**
 * Performs only the read side of the future authority backfill. In particular,
 * it does not order by temporal columns and never returns a selected cart for
 * an ambiguous Customer.
 */
export async function auditCustomerCartBackfill(
  connection: CartMergePostgresRawConnection,
  customerId: string
): Promise<CustomerCartBackfillAudit> {
  const result = await connection.raw(
    `
      select id
      from cart
      where customer_id = ?
        and completed_at is null
        and deleted_at is null
    `,
    [customerId]
  )
  const candidateCount = requireRows(result).length

  if (candidateCount > 1) {
    return {
      status: "ambiguous",
      candidateCount,
      selectedCartId: null,
      report: {
        code: "P16_CUSTOMER_CART_BACKFILL_AMBIGUOUS",
        candidateCount,
      },
    }
  }

  if (candidateCount === 1) {
    return {
      status: "single",
      candidateCount,
      selectedCartId: readString(requireRows(result)[0], "id"),
      report: {
        code: "P16_CUSTOMER_CART_BACKFILL_SINGLE_CANDIDATE",
        candidateCount,
      },
    }
  }

  return {
    status: "none",
    candidateCount: 0,
    selectedCartId: null,
    report: {
      code: "P16_CUSTOMER_CART_BACKFILL_NO_CANDIDATE",
      candidateCount: 0,
    },
  }
}

export function assertCustomerCartBackfillFailClosed(
  audit: CustomerCartBackfillAudit
): void {
  if (audit.status !== "ambiguous") return

  const error = new Error(audit.report.code)
  Object.assign(error, {
    code: audit.report.code,
    candidateCount: audit.report.candidateCount,
    selectedCartId: null,
  })
  throw error
}

export async function countCustomerCartAuthorityRows(
  connection: CartMergePostgresRawConnection,
  customerId: string
): Promise<number> {
  const result = await connection.raw(
    `
      select count(*)::int as count
      from customer_cart_authority
      where customer_id = ?
    `,
    [customerId]
  )
  return Number(requireRows(result)[0]?.count ?? 0)
}

export async function insertCartMergeResultProbe(
  connection: CartMergePostgresRawConnection,
  input: CartMergeResultProbeInput
): Promise<void> {
  await connection.raw(
    `
      insert into cart_merge_result (
        id,
        idempotency_record_id,
        customer_id,
        guest_cart_id,
        customer_cart_id,
        canonical_cart_id,
        capability_id,
        capability_hash,
        request_fingerprint,
        guest_version_before,
        customer_version_before,
        guest_version_after,
        customer_version_after,
        outcome,
        rejected_items,
        review_id,
        review_ref,
        original_public_cart_snapshot,
        original_review_snapshot,
        original_etag,
        expires_at
      ) values (?, ?, ?, ?, null, ?, ?, null, ?, 1, null, 1, null, 'NO_ITEMS', '[]'::jsonb, null, null, '{}'::jsonb, '{}'::jsonb, '"1"', '2099-01-01T00:00:00.000Z')
    `,
    [
      input.id,
      input.idempotencyRecordId ?? `${input.id}_idempotency`,
      input.customerId ?? `${input.id}_customer`,
      input.guestCartId ?? `${input.id}_guest_cart`,
      input.canonicalCartId ?? `${input.id}_canonical_cart`,
      input.capabilityId ?? `${input.id}_capability`,
      input.requestFingerprint ?? `${input.id}_fingerprint`,
    ]
  )
}

export async function insertCartReviewProbe(
  connection: CartMergePostgresRawConnection,
  input: CartReviewProbeInput
): Promise<void> {
  await connection.raw(
    `
      insert into cart_review (
        id, cart_id, review_ref, merge_result_id, produced_cart_version,
        status, rejected_items
      ) values (?, ?, ?, ?, 1, ?, '[]'::jsonb)
    `,
    [
      input.id,
      input.cartId,
      input.reviewRef,
      input.mergeResultId,
      input.status ?? "pending",
    ]
  )
}

export async function insertCustomerCartAuthorityProbe(
  connection: CartMergePostgresRawConnection,
  input: CustomerCartAuthorityProbeInput
): Promise<void> {
  await connection.raw(
    `
      insert into customer_cart_authority (id, customer_id, cart_id, state)
      values (?, ?, ?, ?)
    `,
    [input.id, input.customerId, input.cartId, input.state ?? "active"]
  )
}

export async function cleanupCartMergeSchemaProbes(
  connection: CartMergePostgresRawConnection,
  prefix: string
): Promise<void> {
  await connection.raw(`delete from cart_review where id like ?`, [`${prefix}%`])
  await connection.raw(`delete from cart_merge_result where id like ?`, [
    `${prefix}%`,
  ])
  await connection.raw(
    `delete from customer_cart_authority where id like ?`,
    [`${prefix}%`]
  )
}

/**
 * Creates the actual Customer/Cart/Catalog/Capability/Version records used by
 * the merge tracer. No in-memory domain object is used as persistence.
 */
export async function createRealCartMergeFixture(
  container: MedusaContainer,
  identity = `p16_real_${randomBytes(5).toString("hex")}`,
  options: { withItems?: boolean } = {}
): Promise<CartMergeFixture> {
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as {
    createShippingProfiles(input: {
      name: string
      type: string
    }): Promise<{ id: string }>
  }
  const customerModule = container.resolve(Modules.CUSTOMER) as {
    createCustomers(input: Record<string, unknown>): Promise<unknown>
  }
  const cartModule = container.resolve(Modules.CART) as unknown as {
    createCarts(input: Record<string, unknown>): Promise<{ id: string }>
  }

  const safeIdentity = identity.replace(/[^a-z0-9_-]/gi, "-")
  const handleIdentity = safeIdentity.replace(/_/g, "-")
  const email = `${safeIdentity}@cart-merge.test`
  const createdCustomer = await customerModule.createCustomers({
    email,
    first_name: "Cart",
    last_name: "Merge",
  })
  const customer = Array.isArray(createdCustomer)
    ? createdCustomer[0]
    : createdCustomer
  const customerId = String((customer as { id?: unknown })?.id ?? "")
  if (!customerId) throw new Error("P16_REAL_CUSTOMER_CREATION_FAILED")

  const shippingProfile = await fulfillmentModule.createShippingProfiles({
    name: `Cart merge ${safeIdentity}`,
    type: "default",
  })
  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: `Cart merge ${safeIdentity}`,
          handle: `cart-merge-${handleIdentity}`,
          shipping_profile_id: shippingProfile.id,
          options: [{ title: "Size", values: ["M"] }],
          variants: [
            {
              title: "M",
              sku: `CART-MERGE-${safeIdentity}`,
              options: { Size: "M" },
              manage_inventory: false,
              allow_backorder: true,
              metadata: {
                gelato_product_uid: `gelato_${safeIdentity}`,
                gelato_template_id: `template_${safeIdentity}`,
                gelato_variant_options: { size: "M", color: "Preto" },
                template_mode: "fixed",
              },
              prices: [{ amount: 99, currency_code: "brl" }],
            },
          ],
        },
      ],
    },
  })
  const variant = products[0]?.variants[0]
  if (!variant?.id) throw new Error("P16_REAL_VARIANT_CREATION_FAILED")

  const cartInput: Record<string, unknown> = {
    currency_code: "brl",
    email,
    metadata: { active_for_checkout: true },
  }
  if (options.withItems !== false) {
    cartInput.items = [
      {
        title: `Cart merge item ${safeIdentity}`,
        quantity: 1,
        unit_price: 99,
        variant_id: variant.id,
        variant_sku: variant.sku,
        requires_shipping: false,
        is_custom_price: true,
      },
    ]
  }
  const cart = await cartModule.createCarts(cartInput)

  const capabilityService = container.resolve(
    GUEST_CART_CAPABILITY_MODULE
  ) as GuestCartCapabilityModuleService
  const minted = await capabilityService.mintGuestCartCapability({
    cart_id: cart.id,
    now: new Date("2026-08-23T12:00:00.000Z"),
  })

  const resourceVersionService = container.resolve(
    STORE_RESOURCE_VERSION_MODULE
  ) as unknown as {
    initialize(
      resourceType: string,
      resourceId: string,
      sharedContext: unknown
    ): Promise<{ version: number }>
    baseRepository_: {
      transaction<T>(
        callback: (transactionManager: unknown) => Promise<T>
      ): Promise<T>
    }
  }
  const version = await resourceVersionService.baseRepository_.transaction(
    async (transactionManager) =>
      resourceVersionService.initialize("cart", cart.id, {
        __type: "MedusaContext",
        transactionManager,
        manager: transactionManager,
      })
  )

  return {
    identity: safeIdentity,
    customerId,
    guestCartId: cart.id,
    guestCartEmail: email,
    variantId: variant.id,
    capabilityId: minted.record.id,
    capabilityToken: minted.plaintext_token,
    guestVersion: version.version,
    idempotencyKey: `cart-merge-${safeIdentity}`,
  }
}

export function createCartMergeRequest(
  fixture: CartMergeFixture,
  scope: MedusaContainer,
  overrides: Record<string, unknown> = {}
) {
  return {
    method: "POST",
    url: "/store/customers/me/cart/merge",
    originalUrl: "/store/customers/me/cart/merge",
    auth_context: {
      actor_type: "customer",
      actor_id: fixture.customerId,
    },
    customerAuthBff: { authorized: true },
    body: { guestCartId: fixture.guestCartId },
    headers: {
      authorization: "Bearer test-customer-jwt",
      "x-indicio-bff-auth": "test-bff-authority",
      "x-indicio-guest-cart-token": fixture.capabilityToken,
      "idempotency-key": fixture.idempotencyKey,
      "if-match": `"${fixture.guestVersion}"`,
    },
    scope,
    ...overrides,
  }
}

export function createCartMergeResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }
}

export async function countPersistedOrders(
  connection: CartMergePostgresRawConnection
): Promise<number> {
  const result = await connection.raw(
    'select count(*)::int as count from "order"'
  )
  return Number(requireRows(result)[0]?.count ?? 0)
}

export async function countUsableCustomerCarts(
  connection: CartMergePostgresRawConnection,
  customerId: string
): Promise<number> {
  const result = await connection.raw(
    `
      select count(*)::int as count
      from cart
      where customer_id = ? and completed_at is null and deleted_at is null
    `,
    [customerId]
  )
  return Number(requireRows(result)[0]?.count ?? 0)
}

export async function readRealCartMergeState(
  connection: CartMergePostgresRawConnection,
  fixture: CartMergeFixture
): Promise<CartMergePersistedState> {
  const result = await connection.raw(
    `
      select
        c.id as cart_id,
        c.customer_id,
        c.xmin::text as cart_xmin,
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', li.id,
              'quantity', li.quantity,
              'variant_id', li.variant_id
            ) order by li.id
          )
          from cart_line_item li
          where li.cart_id = c.id and li.deleted_at is null
        ), '[]'::jsonb) as line_items,
        v.version,
        v.xmin::text as version_xmin,
        authority.state as authority_state,
        authority.customer_id as authority_customer_id,
        authority.cart_id as authority_cart_id,
        authority.xmin::text as authority_xmin,
        cap.status as capability_status,
        cap.consumed_at::text as capability_consumed_at,
        cap.xmin::text as capability_xmin,
        idem.state as idempotency_state,
        idem.result_id as idempotency_result_id,
        idem.xmin::text as idempotency_xmin,
        result.id as result_id,
        result.outcome as result_outcome,
        result.review_id as result_review_id,
        result.xmin::text as result_xmin,
        result.original_etag as result_etag,
        result.expires_at::text as result_expires_at,
        review.status as review_status,
        review.review_ref as review_ref,
        review.xmin::text as review_xmin
      from cart c
      left join store_resource_version v
        on v.resource_type = 'cart'
       and v.resource_id = c.id
       and v.deleted_at is null
      left join guest_cart_capability cap
        on cap.cart_id = c.id
       and cap.deleted_at is null
      left join customer_cart_authority authority
        on authority.cart_id = c.id
       and authority.state = 'active'
       and authority.deleted_at is null
      left join cart_merge_result result
        on result.canonical_cart_id = c.id
       and result.deleted_at is null
      left join store_idempotency_record idem
        on idem.id = result.idempotency_record_id
       and idem.deleted_at is null
      left join cart_review review
        on review.merge_result_id = result.id
       and review.deleted_at is null
      where c.id = ? and c.deleted_at is null
      order by result.created_at desc nulls last
      limit 1
    `,
    [fixture.guestCartId]
  )
  const row = requireRows(result)[0]
  if (!row) throw new Error("P16_REAL_CART_STATE_MISSING")

  return {
    cart_id: readString(row, "cart_id"),
    customer_id: readNullableString(row, "customer_id"),
    cart_xmin: readString(row, "cart_xmin"),
    line_items: row.line_items ?? [],
    version: row.version == null ? null : Number(row.version),
    version_xmin: readNullableString(row, "version_xmin"),
    authority_state: readNullableString(row, "authority_state"),
    authority_customer_id: readNullableString(row, "authority_customer_id"),
    authority_cart_id: readNullableString(row, "authority_cart_id"),
    authority_xmin: readNullableString(row, "authority_xmin"),
    capability_status: readNullableString(row, "capability_status"),
    capability_consumed_at: readNullableString(row, "capability_consumed_at"),
    capability_xmin: readNullableString(row, "capability_xmin"),
    idempotency_state: readNullableString(row, "idempotency_state"),
    idempotency_result_id: readNullableString(row, "idempotency_result_id"),
    idempotency_xmin: readNullableString(row, "idempotency_xmin"),
    result_id: readNullableString(row, "result_id"),
    result_outcome: readNullableString(row, "result_outcome"),
    result_review_id: readNullableString(row, "result_review_id"),
    result_xmin: readNullableString(row, "result_xmin"),
    result_etag: readNullableString(row, "result_etag"),
    result_expires_at: readNullableString(row, "result_expires_at"),
    review_status: readNullableString(row, "review_status"),
    review_ref: readNullableString(row, "review_ref"),
    review_xmin: readNullableString(row, "review_xmin"),
  }
}

/**
 * Instruments the real Cart module repository only for the current test.
 * The callback still runs in Medusa's transaction; the failpoint is invoked
 * after the real merge returns and before the repository can commit.
 */
export function instrumentRealCartMergeTransaction(
  cartModule: CartModule,
  options: { failpoint?: Failpoint } = {}
): CartMergeTransactionInstrumentation {
  const repository = cartModule.baseRepository_
  const original = repository.transaction
  const transactionIds: string[] = []

  repository.transaction = async function instrumentedTransaction<T>(
    callback,
    ...rest
  ): Promise<T> {
    return original.call(this, async (transactionManager) => {
      const transaction = transactionManager.getTransactionContext?.()
      if (!transaction) throw new Error("P16_REAL_TRANSACTION_CONTEXT_MISSING")
      const before = await transaction.raw(
        "select txid_current()::text as txid"
      )
      transactionIds.push(String(before.rows?.[0]?.txid ?? ""))
      const value = await callback(transactionManager)
      const after = await transaction.raw("select txid_current()::text as txid")
      transactionIds.push(String(after.rows?.[0]?.txid ?? ""))
      options.failpoint?.trip("transaction_before_commit")
      return value
    }, ...rest)
  }

  return {
    transactionIds,
    restore() {
      repository.transaction = original
    },
  }
}

export function createCartMergeFailpoint(
  code = "P16_CART_MERGE_FAILPOINT"
) {
  let armedPoint: string | null = null
  const ledger: string[] = []
  return {
    arm(point?: string) {
      armedPoint = point ?? "*"
    },
    trip(point = "transaction_before_commit") {
      ledger.push(point)
      if (armedPoint === "*" || armedPoint === point) {
        throw new Error(`${code}:${point}`)
      }
    },
    ledger,
    reset() {
      armedPoint = null
    },
  }
}
