import { createProductsWorkflow } from "@medusajs/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { spawn, type ChildProcess } from "node:child_process"
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

export type CartMergeRaceOperation = "active" | "merge"

export type CartMergeRaceWorkerResult = {
  role: "A" | "B"
  operation: CartMergeRaceOperation
  statusCode: number | null
  code: string | null
  cartId: string | null
  outcome: string | null
  txid: string
}

export type CartMergeRaceResult = {
  workers: [CartMergeRaceWorkerResult, CartMergeRaceWorkerResult]
  lockTxids: [string, string]
}

type CartMergeRaceWorker = {
  child: ChildProcess
  role: "A" | "B"
  queue: {
    messages: unknown[]
    waiters: Array<any>
  }
  send(message: Record<string, unknown>): void
  close(): Promise<void>
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
  options: { withItems?: boolean; customerId?: string } = {}
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
  let customerId = options.customerId ?? ""
  if (!customerId) {
    const createdCustomer = await customerModule.createCustomers({
      email,
      first_name: "Cart",
      last_name: "Merge",
    })
    const customer = Array.isArray(createdCustomer)
      ? createdCustomer[0]
      : createdCustomer
    customerId = String((customer as { id?: unknown })?.id ?? "")
  }
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

const CART_MERGE_RACE_WORKER_SOURCE = String.raw`
const { MedusaAppLoader, container } = require("@medusajs/framework")
const { asValue } = require("@medusajs/framework/awilix")
const { configManager } = require("@medusajs/framework/config")
const { ContainerRegistrationKeys } = require("@medusajs/framework/utils")
const { MedusaModule } = require("@medusajs/modules-sdk")
const path = require("node:path")

const role = process.env.P16_CART_MERGE_WORKER_ROLE
const workerId = process.env.P16_CART_MERGE_WORKER_ID
let application

function send(message) {
  if (typeof process.send !== "function") {
    throw new Error("P16_CART_MERGE_WORKER_IPC_UNAVAILABLE")
  }
  process.send(message)
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this },
    json(body) { this.body = body; return this },
  }
}

function errorShape(error) {
  return {
    code: typeof error?.code === "string" ? error.code : null,
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
    message: typeof error?.message === "string" ? error.message : "WORKER_ERROR",
  }
}

function requestFor(operation, fixture, idempotencyKey) {
  const base = {
    method: "POST",
    originalUrl: operation === "active" ? "/store/carts/active" : "/store/customers/me/cart/merge",
    url: operation === "active" ? "/store/carts/active" : "/store/customers/me/cart/merge",
    scope: container,
    auth_context: { actor_type: "customer", actor_id: fixture.customerId },
    customerAuth: { authorized: true, customerId: fixture.customerId },
    customerAuthBff: { authorized: true },
    headers: {
      authorization: "Bearer test-customer-jwt",
      "x-indicio-bff-auth": "test-bff-authority",
      "idempotency-key": idempotencyKey,
    },
  }
  if (operation === "merge") {
    base.body = { guestCartId: fixture.guestCartId }
    base.headers["x-indicio-guest-cart-token"] = fixture.capabilityToken
    base.headers["if-match"] = '"' + String(fixture.guestVersion) + '"'
  }
  return base
}

async function boot() {
  const projectConfig = require(path.join(process.cwd(), "medusa-config"))
  configManager.loadConfig({ projectConfig, baseDir: process.cwd() })
  const { pgConnectionLoader } = require("@medusajs/framework")
  await pgConnectionLoader()
  const logger = {
    debug() {}, info() {}, log() {}, warn() {}, error() {},
  }
  container.register({
    [ContainerRegistrationKeys.LOGGER]: asValue(logger),
  })
  const loader = new MedusaAppLoader({
    container,
    cwd: process.cwd(),
    medusaConfigPath: process.cwd(),
  })
  application = await loader.load()
  send({ type: "ready", role, workerId, pid: process.pid })
}

async function run(message) {
  const operation = message.operation
  const fixture = message.fixture
  const runId = message.runId
  process.env.P16_CART_MERGE_BARRIER_RUN_ID = runId
  process.env.P16_CART_MERGE_BARRIER_ROLE = role
  process.env.P16_CART_MERGE_BARRIER_PARENT_PID = String(process.ppid)
  const res = response()
  send({ type: "command-started", runId, role })
  try {
    const handler = operation === "active"
      ? require(path.join(process.cwd(), "src/api/store/carts/active/route")).POST
      : require(path.join(process.cwd(), "src/api/store/customers/me/cart/merge/route")).POST
    await handler(requestFor(operation, fixture, message.idempotencyKey), res)
    send({
      type: "result",
      runId,
      role,
      operation,
      statusCode: res.statusCode,
      code: null,
      cartId: res.body?.cart?.id ?? null,
      outcome: res.body?.outcome ?? null,
      txid: message.lockTxid ?? "",
    })
  } catch (error) {
    send({
      type: "result",
      runId,
      role,
      operation,
      statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
      ...errorShape(error),
      cartId: null,
      outcome: null,
      txid: message.lockTxid ?? "",
    })
  }
}

process.on("message", async (message) => {
  if (!message || typeof message !== "object") return
  if (message.type === "run") {
    await run(message)
    return
  }
  if (message.type === "close") {
    await application?.onApplicationShutdown().catch(() => undefined)
    MedusaModule.clearInstances()
    process.exit(0)
  }
})

boot().catch((error) => {
  try { send({ type: "boot-error", role, code: error?.code ?? null, message: error?.message ?? "BOOT_ERROR" }) } catch {}
  process.exit(1)
})
`

function raceError(code: string): Error {
  return new Error(code)
}

function workerMessageQueue(worker: CartMergeRaceWorker): {
  messages: unknown[]
  waiters: Array<{
    predicate: (message: any) => boolean
    resolve: (message: any) => void
    reject: (error: Error) => void
    timer?: ReturnType<typeof setTimeout>
  }>
} {
  return (worker as unknown as { queue: { messages: unknown[]; waiters: Array<any> } }).queue
}

async function startCartMergeRaceWorker(
  role: "A" | "B",
  databaseUrl: string
): Promise<CartMergeRaceWorker> {
  const parsed = new URL(databaseUrl)
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.replace(/^\[|\]$/g, ""))) {
    throw raceError("P16_CART_MERGE_WORKER_DATABASE_HOST_FORBIDDEN")
  }
  const child = spawn(
    process.execPath,
    ["-r", "ts-node/register/transpile-only", "-e", CART_MERGE_RACE_WORKER_SOURCE],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: databaseUrl,
        P16_CART_MERGE_WORKER_ROLE: role,
        P16_CART_MERGE_WORKER_ID: `worker-${role}`,
        TS_NODE_PROJECT: "tsconfig.json",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    }
  )
  const queue = { messages: [] as unknown[], waiters: [] as Array<any> }
  ;(child as unknown as { queue: typeof queue }).queue = queue
  child.on("message", (message) => {
    const waiterIndex = queue.waiters.findIndex((waiter) => waiter.predicate(message))
    if (waiterIndex >= 0) {
      const waiter = queue.waiters.splice(waiterIndex, 1)[0]
      waiter.resolve(message)
    } else {
      queue.messages.push(message)
    }
  })
  const boot = await nextCartMergeRaceWorkerMessage(
    child as unknown as CartMergeRaceWorker,
    (message) => message?.type === "ready" || message?.type === "boot-error",
    60_000
  )
  if (boot.type !== "ready") {
    throw raceError(
      `P16_CART_MERGE_WORKER_BOOT_FAILED:${boot.code ?? boot.message ?? "unknown"}`
    )
  }
  return {
    child,
    role,
    queue,
    send(message) {
      if (!child.connected) throw raceError("P16_CART_MERGE_WORKER_IPC_CLOSED")
      child.send(message)
    },
    close: async () => {
      if (child.exitCode !== null) return
      child.send({ type: "close" })
      await new Promise<void>((resolveClose) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL")
          resolveClose()
        }, 10_000)
        child.once("exit", () => {
          clearTimeout(timer)
          resolveClose()
        })
      })
    },
  }
}

function nextCartMergeRaceWorkerMessage(
  worker: CartMergeRaceWorker,
  predicate: (message: any) => boolean,
  timeoutMs: number
): Promise<any> {
  const queue = workerMessageQueue(worker)
  const existingIndex = queue.messages.findIndex(predicate)
  if (existingIndex >= 0) return Promise.resolve(queue.messages.splice(existingIndex, 1)[0])
  return new Promise((resolveMessage, reject) => {
    const waiter = {
      predicate,
      resolve: (message: any) => {
        clearTimeout(waiter.timer)
        resolveMessage(message)
      },
      reject,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    }
    waiter.timer = setTimeout(() => {
      const index = queue.waiters.indexOf(waiter)
      if (index >= 0) queue.waiters.splice(index, 1)
      reject(raceError("P16_CART_MERGE_LOCK_BARRIER_TIMEOUT"))
    }, timeoutMs)
    queue.waiters.push(waiter)
  })
}

function cancelCartMergeRaceWaiters(workers: CartMergeRaceWorker[]): void {
  for (const worker of workers) {
    const queue = workerMessageQueue(worker)
    const pending = queue.waiters.splice(0)
    for (const waiter of pending) {
      clearTimeout(waiter.timer)
      waiter.reject(raceError("P16_CART_MERGE_RACE_WAITER_CANCELLED"))
    }
  }
}

export async function runCartMergeRace(
  databaseUrl: string,
  operationA: CartMergeRaceOperation,
  operationB: CartMergeRaceOperation,
  fixtureA: CartMergeFixture,
  fixtureB: CartMergeFixture,
  idempotencyKeyA = `p16-race-a-${randomBytes(5).toString("hex")}`,
  idempotencyKeyB = `p16-race-b-${randomBytes(5).toString("hex")}`
): Promise<CartMergeRaceResult> {
  const runId = randomBytes(8).toString("hex")
  const workers: CartMergeRaceWorker[] = []
  try {
    workers.push(await startCartMergeRaceWorker("A", databaseUrl))
    workers.push(await startCartMergeRaceWorker("B", databaseUrl))
  } catch (error) {
    await Promise.all(workers.map((worker) => worker.close()))
    throw error
  }
  const results: Array<CartMergeRaceWorkerResult> = []
  try {
    workers[0].send({
      type: "run", runId, operation: operationA, fixture: fixtureA,
      idempotencyKey: idempotencyKeyA,
    })
    workers[1].send({
      type: "run", runId, operation: operationB, fixture: fixtureB,
      idempotencyKey: idempotencyKeyB,
    })

    await Promise.all(workers.map((worker) =>
      nextCartMergeRaceWorkerMessage(worker, (message) =>
        message?.type === "command-started" && message.runId === runId,
        30_000
      )
    ))

    const first = await Promise.race(workers.map((worker) =>
      nextCartMergeRaceWorkerMessage(worker, (message) =>
        (message?.type === "lock-acquired" || message?.type === "result") &&
          message.runId === runId,
        30_000
      ).then((message) => ({ worker, message }))
    ))
    if (first.message.type === "result") {
      throw raceError(
        `P16_CART_MERGE_WORKER_RESULT_BEFORE_LOCK:${first.message.code ?? first.message.message ?? "unknown"}`
      )
    }
    cancelCartMergeRaceWaiters(workers)
    first.worker.send({ type: "cart-merge-release", runId, role: first.message.role })

    const secondWorker = workers.find((worker) => worker.role !== first.message.role)
    if (!secondWorker) throw raceError("P16_CART_MERGE_SECOND_WORKER_MISSING")
    const second = {
      worker: secondWorker,
      message: await nextCartMergeRaceWorkerMessage(
        secondWorker,
        (message) => message?.type === "lock-acquired" && message.runId === runId,
        30_000
      ),
    }
    second.worker.send({ type: "cart-merge-release", runId, role: second.message.role })

    for (const worker of workers) {
      const result = await nextCartMergeRaceWorkerMessage(
        worker,
        (message) => message?.type === "result" && message.runId === runId,
        30_000
      )
      results.push({
        role: result.role,
        operation: result.operation,
        statusCode: result.statusCode,
        code: result.code,
        cartId: result.cartId == null ? null : String(result.cartId),
        outcome: result.outcome == null ? null : String(result.outcome),
        txid: String(result.txid ?? ""),
      })
    }

    const txids = [first.message.txid, second.message.txid].map(String) as [string, string]
    if (!txids.every((txid) => /^\d+$/.test(txid))) {
      throw raceError("P16_CART_MERGE_WORKER_TXID_UNSANITIZED")
    }
    return {
      workers: results.sort((a, b) => a.role.localeCompare(b.role)) as [CartMergeRaceWorkerResult, CartMergeRaceWorkerResult],
      lockTxids: txids,
    }
  } finally {
    await Promise.all(workers.map((worker) => worker.close()))
  }
}

export async function readCustomerCartCanonicalState(
  connection: CartMergePostgresRawConnection,
  customerId: string
): Promise<{
  activeAuthorityRows: number
  activeAuthorityCartId: string | null
  usableCustomerCartIds: string[]
}> {
  const authority = await connection.raw(
    `select cart_id from customer_cart_authority where customer_id = ? and state = 'active' and deleted_at is null order by cart_id`,
    [customerId]
  )
  const carts = await connection.raw(
    `select id from cart where customer_id = ? and completed_at is null and deleted_at is null order by id`,
    [customerId]
  )
  const authorityRows = requireRows(authority)
  return {
    activeAuthorityRows: authorityRows.length,
    activeAuthorityCartId: authorityRows[0] ? readNullableString(authorityRows[0], "cart_id") : null,
    usableCustomerCartIds: requireRows(carts).map((row) => readString(row, "id")),
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
