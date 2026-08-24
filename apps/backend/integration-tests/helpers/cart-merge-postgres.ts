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
  version: number | null
  version_xmin: string | null
  capability_status: string | null
  capability_consumed_at: string | null
  capability_xmin: string | null
  idempotency_state: string | null
  idempotency_result_id: string | null
  idempotency_xmin: string | null
}

export type CartMergeTransactionInstrumentation = {
  transactionIds: string[]
  restore(): void
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

type Failpoint = { trip(): void }

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

/**
 * Creates the actual Customer/Cart/Catalog/Capability/Version records used by
 * the merge tracer. No in-memory domain object is used as persistence.
 */
export async function createRealCartMergeFixture(
  container: MedusaContainer,
  identity = `p16_real_${randomBytes(5).toString("hex")}`
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

  const cart = await cartModule.createCarts({
    currency_code: "brl",
    email,
    metadata: { active_for_checkout: true },
    items: [
      {
        title: `Cart merge item ${safeIdentity}`,
        quantity: 1,
        unit_price: 99,
        variant_id: variant.id,
        variant_sku: variant.sku,
        requires_shipping: false,
        is_custom_price: true,
      },
    ],
  })

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
        v.version,
        v.xmin::text as version_xmin,
        cap.status as capability_status,
        cap.consumed_at::text as capability_consumed_at,
        cap.xmin::text as capability_xmin,
        idem.state as idempotency_state,
        idem.result_id as idempotency_result_id,
        idem.xmin::text as idempotency_xmin
      from cart c
      left join store_resource_version v
        on v.resource_type = 'cart'
       and v.resource_id = c.id
       and v.deleted_at is null
      left join guest_cart_capability cap
        on cap.cart_id = c.id
       and cap.deleted_at is null
      left join store_idempotency_record idem
        on idem.operation = 'cart_merge'
       and idem.result_id = c.id
       and idem.deleted_at is null
      where c.id = ? and c.deleted_at is null
      order by idem.created_at desc nulls last
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
    version: row.version == null ? null : Number(row.version),
    version_xmin: readNullableString(row, "version_xmin"),
    capability_status: readNullableString(row, "capability_status"),
    capability_consumed_at: readNullableString(row, "capability_consumed_at"),
    capability_xmin: readNullableString(row, "capability_xmin"),
    idempotency_state: readNullableString(row, "idempotency_state"),
    idempotency_result_id: readNullableString(row, "idempotency_result_id"),
    idempotency_xmin: readNullableString(row, "idempotency_xmin"),
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
      options.failpoint?.trip()
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
