import { createProductsWorkflow } from "@medusajs/core-flows";
import type { MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { POST as mergeCart } from "../../src/api/store/customers/me/cart/merge/route";
import {
  GUEST_CART_CAPABILITY_MODULE,
  GUEST_CART_CAPABILITY_TTL_ROLLING_MS,
  type GuestCartCapabilityModuleService,
} from "../../src/modules/guest-cart-capability";
import { STORE_RESOURCE_VERSION_MODULE } from "../../src/modules/store-resource-version";

type RawResult = { rows?: Array<Record<string, unknown>> };

export type CartMergePostgresRawConnection = {
  raw(sql: string, bindings?: unknown[]): Promise<RawResult>;
};

export type CartMergeFixture = {
  identity: string;
  customerId: string;
  guestCartId: string;
  guestCartEmail: string;
  variantId: string;
  secondaryVariantId: string;
  capabilityId: string;
  capabilityToken: string;
  guestVersion: number;
  idempotencyKey: string;
  mutationCartId?: string;
  mutationVersion?: number;
  mutationVariantId?: string;
};

export type CartReviewRaceFixture = CartMergeFixture & {
  reviewCartId: string;
  reviewRef: string;
  reviewVersion: number;
};

export type CartMergePersistedState = {
  cart_id: string;
  customer_id: string | null;
  cart_xmin: string;
  line_items: unknown;
  version: number | null;
  version_xmin: string | null;
  authority_state: string | null;
  authority_customer_id: string | null;
  authority_cart_id: string | null;
  authority_xmin: string | null;
  capability_status: string | null;
  capability_consumed_at: string | null;
  capability_xmin: string | null;
  idempotency_state: string | null;
  idempotency_result_id: string | null;
  idempotency_xmin: string | null;
  result_id: string | null;
  result_outcome: string | null;
  customer_version_before: number | null;
  customer_version_after: number | null;
  result_review_id: string | null;
  result_xmin: string | null;
  result_etag: string | null;
  result_expires_at: string | null;
  review_status: string | null;
  review_ref: string | null;
  review_xmin: string | null;
};

export type CartMergeTransactionInstrumentation = {
  transactionIds: string[];
  restore(): void;
};

export type CartMergeRaceOperation =
  | "active"
  | "merge"
  | "guest-mutation"
  | "customer-mutation"
  | "ack"
  | "payment";

export type CheckoutCompletenessItemDiagnostic = {
  quantity: number | null;
  quantityValid: boolean;
  variantPresent: boolean;
  gelatoProductUidPresent: boolean;
  gelatoTemplateIdPresent: boolean;
  gelatoVariantOptionsPresent: boolean;
  gelatoSizePresent: boolean;
  gelatoColorPresent: boolean;
  templateModeFixed: boolean;
  brlPricePositive: boolean;
};

export type CheckoutCompletenessDiagnostic = {
  cartPresent: boolean;
  cartEmailPresent: boolean;
  cartEmailValidShape: boolean;
  customerPresent: boolean;
  customerEmailPresent: boolean;
  customerEmailValidShape: boolean;
  currencyCode: string | null;
  regionIdPresent: boolean;
  regionPresent: boolean;
  regionCountryCount: number;
  regionCountryCodes: string[];
  shippingAddressPresent: boolean;
  shippingFirstNamePresent: boolean;
  shippingLastNamePresent: boolean;
  shippingAddress1Present: boolean;
  shippingCityPresent: boolean;
  shippingPostalCodePresent: boolean;
  shippingCountryCode: string | null;
  shippingProvincePresent: boolean;
  shippingPhonePresent: boolean;
  federalTaxIdPresent: boolean;
  itemCount: number;
  items: CheckoutCompletenessItemDiagnostic[];
  cartCompletedAtPresent: boolean;
  orderIdPresent: boolean;
  totals: {
    totalPresent: boolean;
    itemTotalPresent: boolean;
    subtotalPresent: boolean;
  };
};

export type CheckoutPaymentEligibilityDiagnostic = {
  eligible: boolean;
  code: string | null;
  incompleteReasons?: string[];
};

export type CheckoutRemoteQueryContract = {
  entryPoint: "cart";
  requestedFields: string[];
};

export type PaymentCheckoutDiagnostic = {
  persisted: CheckoutCompletenessDiagnostic | null;
  requestedProjectionFields: CheckoutRemoteQueryContract | null;
  projectedSnapshot: CheckoutCompletenessDiagnostic | null;
  pureEligibilityResult: CheckoutPaymentEligibilityDiagnostic | null;
};

export type CartMergeRaceWorkerResult = {
  role: "A" | "B";
  operation: CartMergeRaceOperation;
  statusCode: number | null;
  code: string | null;
  cartId: string | null;
  outcome: string | null;
  txid: string;
  pid: number;
  connectionPid: string;
  message: string | null;
  etag: string | null;
  responseFingerprint: string;
  providerCalls: number;
  stages: Array<{
    name: string;
    statusCode?: number | null;
    message?: string | null;
    error?: {
      name?: string;
      statusCode?: number;
      code?: string;
      message?: string;
      stack?: string;
    };
  }>;
  error?: {
    name?: string;
    statusCode?: number;
    code?: string;
    message?: string;
    stack?: string;
  };
  checkoutDiagnostic?: PaymentCheckoutDiagnostic;
};

export type CartMergeRaceResult = {
  workers: [CartMergeRaceWorkerResult, CartMergeRaceWorkerResult];
  lockTxids: [string, string];
};

type CartMergeRaceWorker = {
  child: ChildProcess;
  role: "A" | "B";
  pid: number;
  connectionPid: string;
  queue: {
    messages: unknown[];
    waiters: Array<any>;
  };
  send(message: Record<string, unknown>): void;
  close(): Promise<void>;
};

export type CartMergeSchemaCatalog = {
  tables: string[];
  columns: Array<{
    table_name: string;
    column_name: string;
    udt_name: string;
    is_nullable: string;
  }>;
  checks: Array<{
    table_name: string;
    constraint_name: string;
    definition: string;
  }>;
  indexes: Array<{
    table_name: string;
    index_name: string;
    is_unique: boolean;
    predicate: string | null;
    definition: string;
  }>;
};

export type CustomerCartBackfillAudit = {
  status: "none" | "single" | "ambiguous";
  candidateCount: number;
  selectedCartId: string | null;
  report: {
    code:
      | "P16_CUSTOMER_CART_BACKFILL_NO_CANDIDATE"
      | "P16_CUSTOMER_CART_BACKFILL_SINGLE_CANDIDATE"
      | "P16_CUSTOMER_CART_BACKFILL_AMBIGUOUS";
    candidateCount: number;
  };
};

export type CartMergeResultProbeInput = {
  id: string;
  idempotencyRecordId?: string;
  customerId?: string;
  guestCartId?: string;
  canonicalCartId?: string;
  capabilityId?: string;
  requestFingerprint?: string;
};

export type CartReviewProbeInput = {
  id: string;
  cartId: string;
  reviewRef: string;
  mergeResultId: string;
  status?: "pending" | "acknowledged";
};

export type CustomerCartAuthorityProbeInput = {
  id: string;
  customerId: string;
  cartId: string;
  state?: "active" | "superseded";
};

type CartRepository = {
  transaction<T>(
    callback: (transactionManager: {
      getTransactionContext?: () => CartMergePostgresRawConnection | null;
    }) => Promise<T>,
    ...options: unknown[]
  ): Promise<T>;
};

type CartModule = {
  baseRepository_: CartRepository;
};

type Failpoint = { trip(point?: string): void };

function requireRows(result: RawResult): Array<Record<string, unknown>> {
  return result.rows ?? [];
}

function readString(row: Record<string, unknown>, key: string): string {
  return String(row[key] ?? "");
}

function readNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  return row[key] == null ? null : String(row[key]);
}

function readBoolean(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

/**
 * Reads the physical catalog produced by the approved cart-merge migration.
 * The assertions intentionally query PostgreSQL catalogs instead of models or
 * TypeScript metadata so a disposable migration failure cannot be masked.
 */
export async function readCartMergeSchemaCatalog(
  connection: CartMergePostgresRawConnection,
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
  `);
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
  `);
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
  `);
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
  `);

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
  };
}

/**
 * Creates two real, active Customer carts representing historical duplicate
 * candidates. The audit below must refuse to choose either one.
 */
export async function createHistoricalCustomerCartCandidates(
  container: MedusaContainer,
  customerId: string,
  identity: string,
): Promise<string[]> {
  const cartModule = container.resolve(Modules.CART) as unknown as {
    createCarts(input: Record<string, unknown>): Promise<unknown>;
  };

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
      });
      const cart = Array.isArray(created) ? created[0] : created;
      const cartId = String((cart as { id?: unknown })?.id ?? "");
      if (!cartId) {
        throw new Error("P16_HISTORICAL_CUSTOMER_CART_CREATION_FAILED");
      }
      return cartId;
    }),
  );

  return candidates;
}

/**
 * Performs only the read side of the future authority backfill. In particular,
 * it does not order by temporal columns and never returns a selected cart for
 * an ambiguous Customer.
 */
export async function auditCustomerCartBackfill(
  connection: CartMergePostgresRawConnection,
  customerId: string,
): Promise<CustomerCartBackfillAudit> {
  const result = await connection.raw(
    `
      select id
      from cart
      where customer_id = ?
        and completed_at is null
        and deleted_at is null
    `,
    [customerId],
  );
  const candidateCount = requireRows(result).length;

  if (candidateCount > 1) {
    return {
      status: "ambiguous",
      candidateCount,
      selectedCartId: null,
      report: {
        code: "P16_CUSTOMER_CART_BACKFILL_AMBIGUOUS",
        candidateCount,
      },
    };
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
    };
  }

  return {
    status: "none",
    candidateCount: 0,
    selectedCartId: null,
    report: {
      code: "P16_CUSTOMER_CART_BACKFILL_NO_CANDIDATE",
      candidateCount: 0,
    },
  };
}

export function assertCustomerCartBackfillFailClosed(
  audit: CustomerCartBackfillAudit,
): void {
  if (audit.status !== "ambiguous") return;

  const error = new Error(audit.report.code);
  Object.assign(error, {
    code: audit.report.code,
    candidateCount: audit.report.candidateCount,
    selectedCartId: null,
  });
  throw error;
}

export async function countCustomerCartAuthorityRows(
  connection: CartMergePostgresRawConnection,
  customerId: string,
): Promise<number> {
  const result = await connection.raw(
    `
      select count(*)::int as count
      from customer_cart_authority
      where customer_id = ?
    `,
    [customerId],
  );
  return Number(requireRows(result)[0]?.count ?? 0);
}

export async function insertCartMergeResultProbe(
  connection: CartMergePostgresRawConnection,
  input: CartMergeResultProbeInput,
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
    ],
  );
}

export async function insertCartReviewProbe(
  connection: CartMergePostgresRawConnection,
  input: CartReviewProbeInput,
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
    ],
  );
}

export async function insertCustomerCartAuthorityProbe(
  connection: CartMergePostgresRawConnection,
  input: CustomerCartAuthorityProbeInput,
): Promise<void> {
  await connection.raw(
    `
      insert into customer_cart_authority (id, customer_id, cart_id, state)
      values (?, ?, ?, ?)
    `,
    [input.id, input.customerId, input.cartId, input.state ?? "active"],
  );
}

export async function cleanupCartMergeSchemaProbes(
  connection: CartMergePostgresRawConnection,
  prefix: string,
): Promise<void> {
  await connection.raw(`delete from cart_review where id like ?`, [
    `${prefix}%`,
  ]);
  await connection.raw(`delete from cart_merge_result where id like ?`, [
    `${prefix}%`,
  ]);
  await connection.raw(`delete from customer_cart_authority where id like ?`, [
    `${prefix}%`,
  ]);
}

/**
 * Creates the actual Customer/Cart/Catalog/Capability/Version records used by
 * the merge tracer. No in-memory domain object is used as persistence.
 */
export async function createRealCartMergeFixture(
  container: MedusaContainer,
  identity = `p16_real_${randomBytes(5).toString("hex")}`,
  options: {
    withItems?: boolean;
    customerId?: string;
    guestItemQuantity?: number;
  } = {},
): Promise<CartMergeFixture> {
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT) as {
    createShippingProfiles(input: {
      name: string;
      type: string;
    }): Promise<{ id: string }>;
  };
  const customerModule = container.resolve(Modules.CUSTOMER) as {
    createCustomers(input: Record<string, unknown>): Promise<unknown>;
  };
  const cartModule = container.resolve(Modules.CART) as unknown as {
    createCarts(input: Record<string, unknown>): Promise<{ id: string }>;
  };

  const safeIdentity = identity.replace(/[^a-z0-9_-]/gi, "-");
  const handleIdentity = safeIdentity.replace(/_/g, "-");
  const email = `${safeIdentity}@cart-merge.test`;
  let customerId = options.customerId ?? "";
  if (!customerId) {
    const createdCustomer = await customerModule.createCustomers({
      email,
      first_name: "Cart",
      last_name: "Merge",
    });
    const customer = Array.isArray(createdCustomer)
      ? createdCustomer[0]
      : createdCustomer;
    customerId = String((customer as { id?: unknown })?.id ?? "");
  }
  if (!customerId) throw new Error("P16_REAL_CUSTOMER_CREATION_FAILED");

  const shippingProfile = await fulfillmentModule.createShippingProfiles({
    name: `Cart merge ${safeIdentity}`,
    type: "default",
  });
  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: `Cart merge ${safeIdentity}`,
          handle: `cart-merge-${handleIdentity}`,
          status: "published",
          shipping_profile_id: shippingProfile.id,
          options: [{ title: "Size", values: ["M", "L"] }],
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
            {
              title: "L",
              sku: `CART-MERGE-${safeIdentity}-L`,
              options: { Size: "L" },
              manage_inventory: false,
              allow_backorder: true,
              metadata: {
                gelato_product_uid: `gelato_${safeIdentity}_l`,
                gelato_template_id: `template_${safeIdentity}_l`,
                gelato_variant_options: { size: "L", color: "Preto" },
                template_mode: "fixed",
              },
              prices: [{ amount: 99, currency_code: "brl" }],
            },
          ],
        },
      ],
    },
  });
  const variant = products[0]?.variants[0];
  const secondaryVariant = products[0]?.variants[1];
  if (!variant?.id || !secondaryVariant?.id) {
    throw new Error("P16_REAL_VARIANT_CREATION_FAILED");
  }

  const cartInput: Record<string, unknown> = {
    currency_code: "brl",
    email,
    metadata: { active_for_checkout: true },
  };
  if (options.withItems !== false) {
    cartInput.items = [
      {
        title: `Cart merge item ${safeIdentity}`,
        quantity: options.guestItemQuantity ?? 1,
        unit_price: 99,
        variant_id: variant.id,
        variant_sku: variant.sku,
        requires_shipping: false,
        is_custom_price: true,
      },
    ];
  }
  const cart = await cartModule.createCarts(cartInput);

  const capabilityService = container.resolve(
    GUEST_CART_CAPABILITY_MODULE,
  ) as GuestCartCapabilityModuleService;
  const fixtureNow = new Date();
  const expiresAt = new Date(
    fixtureNow.getTime() + GUEST_CART_CAPABILITY_TTL_ROLLING_MS,
  );
  const minted = await capabilityService.mintGuestCartCapability({
    cart_id: cart.id,
    now: fixtureNow,
    expires_at: expiresAt,
  });

  const resourceVersionService = container.resolve(
    STORE_RESOURCE_VERSION_MODULE,
  ) as unknown as {
    initialize(
      resourceType: string,
      resourceId: string,
      sharedContext: unknown,
    ): Promise<{ version: number }>;
    baseRepository_: {
      transaction<T>(
        callback: (transactionManager: unknown) => Promise<T>,
      ): Promise<T>;
    };
  };
  const version = await resourceVersionService.baseRepository_.transaction(
    async (transactionManager) =>
      resourceVersionService.initialize("cart", cart.id, {
        __type: "MedusaContext",
        transactionManager,
        manager: transactionManager,
      }),
  );

  return {
    identity: safeIdentity,
    customerId,
    guestCartId: cart.id,
    guestCartEmail: email,
    variantId: variant.id,
    secondaryVariantId: secondaryVariant.id,
    capabilityId: minted.record.id,
    capabilityToken: minted.plaintext_token,
    guestVersion: version.version,
    idempotencyKey: `cart-merge-${safeIdentity}`,
  };
}

/**
 * Creates the pending-review state through the real merge handler.  The ACK
 * and race workers consume this persisted MERGED_PARTIAL/CartReview state;
 * this helper never substitutes an in-memory review flag or a probe row.
 */
export async function createRealPendingCartReviewFixture(
  container: MedusaContainer,
  identity = `p16_pending_review_${randomBytes(5).toString("hex")}`,
  options: { regionId?: string } = {},
): Promise<CartReviewRaceFixture> {
  const fixture = await createRealCartMergeFixture(container, identity, {
    guestItemQuantity: 30,
  });
  let regionId = options.regionId;
  if (!regionId) {
    const regionModule = container.resolve(Modules.REGION) as unknown as {
      listRegions(
        filters: Record<string, unknown>,
      ): Promise<Array<{ id?: string }>>;
    };
    const regions = await regionModule.listRegions({ currency_code: "brl" });
    regionId = regions.find((region) => typeof region.id === "string")?.id;
  }
  if (!regionId) throw new Error("P16_REAL_PENDING_REVIEW_REGION_MISSING");

  const checkoutShippingAddress = {
    first_name: "Maria",
    last_name: "Silva",
    address_1: "Rua A, 100",
    city: "Sao Paulo",
    postal_code: "01311000",
    country_code: "br",
    province: "SP",
    phone: "+5511999999999",
    metadata: { federal_tax_id: "52998224725" },
  };
  const customerCart = await createRealCustomerCartFixture(
    container,
    fixture,
    identity,
    {
      itemQuantity: 80,
      regionId,
      shippingAddress: checkoutShippingAddress,
    },
  );
  const response = createCartMergeResponse();

  await mergeCart(
    createCartMergeRequest(fixture, container) as never,
    response as never,
  );

  const body = response.body as {
    outcome?: unknown;
    cart?: { id?: unknown };
    review?: { requiresReview?: unknown; reviewRef?: unknown };
  };
  const reviewRef =
    typeof body?.review?.reviewRef === "string" ? body.review.reviewRef : "";
  const reviewCartId = typeof body?.cart?.id === "string" ? body.cart.id : "";

  if (
    response.statusCode !== 200 ||
    body?.outcome !== "MERGED_PARTIAL" ||
    body?.review?.requiresReview !== true ||
    !/^review_/.test(reviewRef) ||
    reviewCartId !== customerCart.cartId
  ) {
    throw new Error("P16_REAL_PENDING_REVIEW_FIXTURE_FAILED");
  }

  return {
    ...fixture,
    reviewCartId,
    reviewRef,
    reviewVersion: customerCart.version + 1,
    mutationCartId: customerCart.cartId,
    mutationVersion: customerCart.version + 1,
    mutationVariantId: fixture.secondaryVariantId,
  };
}

export type CartMergeCustomerCartFixture = {
  cartId: string;
  customerId: string;
  version: number;
  variantId: string;
};

/** Creates a real canonical-candidate Customer cart for structural-race tests. */
export async function createRealCustomerCartFixture(
  container: MedusaContainer,
  fixture: CartMergeFixture,
  identity: string,
  options: {
    itemQuantity?: number;
    regionId?: string;
    shippingAddress?: Record<string, unknown>;
  } = {},
): Promise<CartMergeCustomerCartFixture> {
  const cartModule = container.resolve(Modules.CART) as unknown as {
    createCarts(input: Record<string, unknown>): Promise<{ id: string }>;
  };
  const cartInput: Record<string, unknown> = {
    currency_code: "brl",
    customer_id: fixture.customerId,
    email: `${identity}@cart-merge.test`,
    metadata: { active_for_checkout: true },
    items: [
      {
        title: `Customer cart item ${identity}`,
        quantity: options.itemQuantity ?? 1,
        unit_price: 99,
        variant_id: fixture.variantId,
        requires_shipping: false,
        is_custom_price: true,
      },
    ],
  };
  if (options.regionId) cartInput.region_id = options.regionId;
  if (options.shippingAddress) {
    cartInput.shipping_address = options.shippingAddress;
  }
  const cart = await cartModule.createCarts(cartInput);

  const resourceVersionService = container.resolve(
    STORE_RESOURCE_VERSION_MODULE,
  ) as unknown as {
    initialize(
      resourceType: string,
      resourceId: string,
      sharedContext: unknown,
    ): Promise<{ version: number }>;
    baseRepository_: {
      transaction<T>(
        callback: (transactionManager: unknown) => Promise<T>,
      ): Promise<T>;
    };
  };
  const version = await resourceVersionService.baseRepository_.transaction(
    async (transactionManager) =>
      resourceVersionService.initialize("cart", cart.id, {
        __type: "MedusaContext",
        transactionManager,
        manager: transactionManager,
      }),
  );

  return {
    cartId: cart.id,
    customerId: fixture.customerId,
    version: version.version,
    variantId: fixture.variantId,
  };
}

export function createCartMergeRequest(
  fixture: CartMergeFixture,
  scope: MedusaContainer,
  overrides: Record<string, unknown> = {},
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
  };
}

export function createCartMergeResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

const CART_MERGE_RACE_WORKER_SOURCE = String.raw`
const { MedusaAppLoader, container } = require("@medusajs/framework")
const { asValue } = require("@medusajs/framework/awilix")
const { configManager } = require("@medusajs/framework/config")
const { ContainerRegistrationKeys, Modules } = require("@medusajs/framework/utils")
const { MedusaModule } = require("@medusajs/modules-sdk")
const path = require("node:path")

const role = process.env.P16_CART_MERGE_WORKER_ROLE
const workerId = process.env.P16_CART_MERGE_WORKER_ID
let application
let connectionPid = ""
let transactionTxid = ""
let transactionConnectionPid = ""
let providerCalls = 0
let currentRunId = ""
let stages = []
let pgConnectionRef = null
let currentOperation = ""
let currentPaymentCartId = ""
let currentPaymentActor = null
let currentCartLockBarrierEnabled = false
let checkoutDiagnostic = emptyCheckoutDiagnostic()

function emptyCheckoutDiagnostic() {
  return {
    persisted: null,
    requestedProjectionFields: null,
    projectedSnapshot: null,
    pureEligibilityResult: null,
  }
}

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

function sanitizeDiagnosticText(value, maxLength) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:postgres(?:ql)?|redis):\/\/[^\s]+/gi, "[REDACTED_DSN]")
    .replace(
      /\b(?:authorization|cookie|token|secret|password|api[-_]?key|idempotency[-_]?key)\s*[:=]\s*\S+/gi,
      "[REDACTED_SECRET]"
    )
    .replace(
      /\b(?:cart|cus|customer|guest|order|payment|pay|line|item|variant|prod|review|result|authority|capability|idempotency)[_-][a-z0-9]{12,}\b/gi,
      "[REDACTED_ID]"
    )
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "[REDACTED_ID]")
    .replace(/\b[0-9a-f]{24,}\b/gi, "[REDACTED_ID]")
    .slice(0, maxLength)
}

function errorShape(error) {
  const shape = {
    code: typeof error?.code === "string" ? sanitizeDiagnosticText(error.code, 120) : null,
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
    message: typeof error?.message === "string" ? sanitizeDiagnosticText(error.message, 500) : null,
  }
  const diagnostic = {}
  if (typeof error?.name === "string") {
    diagnostic.name = sanitizeDiagnosticText(error.name, 120)
  }
  if (Number.isInteger(error?.statusCode)) diagnostic.statusCode = error.statusCode
  if (typeof error?.code === "string") {
    diagnostic.code = sanitizeDiagnosticText(error.code, 120)
  }
  if (typeof error?.message === "string") {
    diagnostic.message = sanitizeDiagnosticText(error.message, 500)
  }
  if (typeof error?.stack === "string") {
    diagnostic.stack = sanitizeDiagnosticText(error.stack, 4_000)
  }
  return Object.keys(diagnostic).length > 0 ? { ...shape, error: diagnostic } : shape
}

function pipelineStage(name, details) {
  const stage = { name, ...(details || {}) }
  stages.push(stage)
  send({ type: "pipeline-stage", runId: currentRunId, role, stage })
}

function loadCartMergeDiagnosticHelpers() {
  try {
    return require(path.join(process.cwd(), "integration-tests/helpers/cart-merge-postgres"))
  } catch {
    return null
  }
}

function loadEvaluatePaymentStartEligibility() {
  try {
    const loaded = require(path.join(process.cwd(), "src/modules/payment-attempt/eligibility"))
    return typeof loaded.evaluatePaymentStartEligibility === "function"
      ? loaded.evaluatePaymentStartEligibility
      : null
  } catch {
    return null
  }
}

function toPureEligibilityResult(result) {
  if (!result || typeof result !== "object") return null
  const incompleteReasons = Array.isArray(result.incomplete_reasons)
    ? result.incomplete_reasons.filter((reason) => typeof reason === "string")
    : undefined
  if (result.eligible === true) {
    return { eligible: true, code: null, incompleteReasons: undefined }
  }
  return {
    eligible: false,
    code: typeof result.code === "string" ? result.code : null,
    incompleteReasons,
  }
}

function readCartFromRemoteQueryResult(result) {
  if (Array.isArray(result)) return result[0] ?? null
  if (!result || typeof result !== "object") return null
  if (Array.isArray(result.rows)) return result.rows[0] ?? null
  if (Array.isArray(result.data)) return result.data[0] ?? null
  return result
}

function observePaymentCartRemoteQuery(queryObject, result) {
  try {
    if (checkoutDiagnostic.projectedSnapshot != null) return
    const helpers = loadCartMergeDiagnosticHelpers()
    if (!helpers || typeof helpers.readRemoteQueryCartContract !== "function") return
    const contract = helpers.readRemoteQueryCartContract(queryObject)
    if (!contract) return
    checkoutDiagnostic.requestedProjectionFields = contract
    pipelineStage("payment-cart-query-observed", {
      entryPoint: contract.entryPoint,
      requestedFields: contract.requestedFields,
    })
    const cart = readCartFromRemoteQueryResult(result)
    checkoutDiagnostic.projectedSnapshot =
      typeof helpers.sanitizeCheckoutCompletenessFromCartLike === "function"
        ? helpers.sanitizeCheckoutCompletenessFromCartLike(cart)
        : null
    pipelineStage("payment-cart-snapshot-observed", {
      snapshot: checkoutDiagnostic.projectedSnapshot,
    })
    const evaluate = loadEvaluatePaymentStartEligibility()
    if (typeof evaluate !== "function" || !cart || typeof cart !== "object") {
      checkoutDiagnostic.pureEligibilityResult = null
      pipelineStage("payment-eligibility-diagnostic-computed", { available: false })
      return
    }
    try {
      const eligibility = evaluate({
        cart,
        actor: currentPaymentActor,
        paymentMethod: "card",
      })
      checkoutDiagnostic.pureEligibilityResult = toPureEligibilityResult(eligibility)
    } catch (error) {
      checkoutDiagnostic.pureEligibilityResult = null
      pipelineStage("payment-eligibility-diagnostic-computed", {
        available: false,
        errorName: typeof error?.name === "string"
          ? sanitizeDiagnosticText(error.name, 120)
          : "Error",
      })
      return
    }
    pipelineStage("payment-eligibility-diagnostic-computed", checkoutDiagnostic.pureEligibilityResult)
  } catch {}
}

function wrapRemoteQueryObservationally(originalRemoteQuery) {
  if (typeof originalRemoteQuery === "function") {
    return new Proxy(originalRemoteQuery, {
      apply(target, thisArg, args) {
        const result = target.apply(thisArg, args)
        if (result && typeof result.then === "function") {
          return result.then((resolved) => {
            observePaymentCartRemoteQuery(args[0], resolved)
            return resolved
          })
        }
        observePaymentCartRemoteQuery(args[0], result)
        return result
      },
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }
  if (!originalRemoteQuery || typeof originalRemoteQuery !== "object") {
    return originalRemoteQuery
  }
  return new Proxy(originalRemoteQuery, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== "function") return value
      if (property === "bind" || property === "call" || property === "apply") {
        return value.bind(target)
      }
      return (...args) => {
        const result = value.apply(target, args)
        if (result && typeof result.then === "function") {
          return result.then((resolved) => {
            observePaymentCartRemoteQuery(args[0], resolved)
            return resolved
          })
        }
        observePaymentCartRemoteQuery(args[0], result)
        return result
      }
    },
  })
}

function awaitRunRelease(runId, releaseTypes) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      process.removeListener("message", onMessage)
      reject(new Error("P16_CART_MERGE_STRUCTURAL_BARRIER_TIMEOUT"))
    }, 30_000)
    const onMessage = (message) => {
      if (!releaseTypes.includes(message?.type) || message.runId !== runId) return
      clearTimeout(timeout)
      process.removeListener("message", onMessage)
      resolve()
    }
    process.on("message", onMessage)
  })
}

function requireQuery(scope, label) {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  if (!query || typeof query.graph !== "function") {
    throw new Error("P16_CART_MERGE_WORKER_QUERY_UNAVAILABLE:" + label)
  }
  return query
}

function requestFor(operation, fixture, idempotencyKey, scope) {
  const cartId = operation === "guest-mutation"
    ? fixture.guestCartId
    : (fixture.mutationCartId || fixture.reviewCartId)
  const base = {
    method: "POST",
    originalUrl: operation === "active"
      ? "/store/carts/active"
      : operation === "merge"
        ? "/store/customers/me/cart/merge"
        : operation === "ack"
          ? "/store/carts/" + fixture.reviewCartId + "/review/acknowledge"
          : operation === "payment"
            ? "/store/carts/" + cartId + "/payment-attempts/card"
            : "/store/carts/" + cartId + "/line-items",
    url: operation === "active"
      ? "/store/carts/active"
      : operation === "merge"
        ? "/store/customers/me/cart/merge"
        : operation === "ack"
          ? "/store/carts/" + fixture.reviewCartId + "/review/acknowledge"
          : operation === "payment"
            ? "/store/carts/" + cartId + "/payment-attempts/card"
            : "/store/carts/" + cartId + "/line-items",
    params: operation === "active" || operation === "merge"
      ? {}
      : { id: operation === "ack" ? fixture.reviewCartId : cartId },
    scope,
    body: operation === "ack"
      ? { reviewRef: fixture.reviewRef }
      : operation === "payment"
        ? {}
        : operation === "guest-mutation" || operation === "customer-mutation"
      ? { variant_id: operation === "guest-mutation" ? fixture.secondaryVariantId : fixture.mutationVariantId, quantity: 1 }
      : undefined,
    headers: {},
  }
  if (operation !== "guest-mutation") {
    base.auth_context = { actor_type: "customer", actor_id: fixture.customerId }
    base.customerAuth = { authorized: true, customerId: fixture.customerId }
    base.customerAuthBff = { authorized: true }
    base.headers.authorization = "Bearer test-customer-jwt"
    base.headers["x-indicio-bff-auth"] = "test-bff-authority"
  }
  if (operation !== "ack" && operation !== "payment") {
    base.headers["idempotency-key"] = idempotencyKey
  }
  if (operation === "merge") {
    base.body = { guestCartId: fixture.guestCartId }
    base.headers["x-indicio-guest-cart-token"] = fixture.capabilityToken
    base.headers["if-match"] = '"' + String(fixture.guestVersion) + '"'
  } else if (operation === "guest-mutation") {
    base.headers["x-indicio-guest-cart-token"] = fixture.capabilityToken
    base.headers["if-match"] = '"' + String(fixture.guestVersion) + '"'
  } else if (operation === "customer-mutation") {
    base.headers["if-match"] = '"' + String(fixture.mutationVersion) + '"'
  } else if (operation === "ack") {
    base.headers["if-match"] = '"' + String(fixture.reviewVersion) + '"'
  }
  return base
}

async function boot() {
  const projectConfig = require(path.join(process.cwd(), "medusa-config"))
  configManager.loadConfig({ projectConfig, baseDir: process.cwd() })
  const { pgConnectionLoader } = require("@medusajs/framework")
  await pgConnectionLoader()
  const pgConnection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  pgConnectionRef = pgConnection
  const connectionResult = await pgConnection.raw(
    "select pg_backend_pid()::text as pid"
  )
  connectionPid = String(connectionResult.rows?.[0]?.pid ?? "")
  if (!/^\d+$/.test(connectionPid)) {
    throw new Error("P16_CART_MERGE_WORKER_CONNECTION_PID_INVALID")
  }
  const logger = {
    debug() {}, info() {}, log() {}, warn() {}, error() {},
  }
  const { LinkLoader } = require("@medusajs/framework")
  const { getResolvedPlugins } = require("@medusajs/framework/utils")
  const configModule = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  const plugins = await getResolvedPlugins(process.cwd(), configModule, true)
  await new LinkLoader(
    plugins.map((plugin) => path.join(plugin.resolve, "links")),
    logger
  ).load()
  container.register({
    [ContainerRegistrationKeys.LOGGER]: asValue(logger),
  })
  const loader = new MedusaAppLoader({
    container,
    cwd: process.cwd(),
    medusaConfigPath: process.cwd(),
  })
  application = await loader.load()
  requireQuery(container, "root")
  const cartModule = container.resolve(Modules.CART)
  const repository = cartModule.baseRepository_
  const originalTransaction = repository.transaction
  function instrumentTransaction(transaction, runId) {
    let cartLockSent = false
    const raw = async (...args) => {
      const result = await transaction.raw(...args)
      const sql = String(args[0] ?? "").replace(/\s+/g, " ").toLowerCase()
      if (
        currentCartLockBarrierEnabled &&
        !cartLockSent &&
        sql.includes("pg_advisory_xact_lock") &&
        sql.includes("1515")
      ) {
        cartLockSent = true
        send({
          type: "cart-lock-acquired",
          runId,
          role,
          txid: transactionTxid,
        })
        pipelineStage("cart-lock-acquired")
        await awaitRunRelease(runId, ["cart-lock-release"])
        if (currentOperation === "payment" && currentPaymentCartId && pgConnectionRef) {
          try {
            const helpers = loadCartMergeDiagnosticHelpers()
            if (helpers && typeof helpers.readPersistedCheckoutCompletenessDiagnostic === "function") {
              checkoutDiagnostic.persisted = await helpers.readPersistedCheckoutCompletenessDiagnostic(
                pgConnectionRef,
                currentPaymentCartId
              )
            }
          } catch {}
        }
      }
      return result
    }
    return new Proxy(transaction, {
      get(target, property) {
        if (property === "raw") return raw
        const value = Reflect.get(target, property, target)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }
  repository.transaction = async function instrumentedWorkerTransaction(callback, ...rest) {
    return originalTransaction.call(this, async (transactionManager) => {
      const transaction = transactionManager.getTransactionContext?.()
      if (transaction) {
        const identity = await transaction.raw(
          "select txid_current()::text as txid, pg_backend_pid()::text as pid"
        )
        transactionTxid = String(identity.rows?.[0]?.txid ?? "")
        transactionConnectionPid = String(identity.rows?.[0]?.pid ?? "")
        pipelineStage("transaction-started")
        send({
          type: "transaction-started",
          runId: process.env.P16_CART_MERGE_BARRIER_RUN_ID,
          role,
          txid: transactionTxid,
          connectionPid: transactionConnectionPid,
        })
      }
      if (!transaction) return callback(transactionManager)
      const instrumentedTransaction = instrumentTransaction(
        transaction,
        process.env.P16_CART_MERGE_BARRIER_RUN_ID
      )
      const instrumentedManager = new Proxy(transactionManager, {
        get(target, property) {
          if (property === "getTransactionContext") {
            return () => instrumentedTransaction
          }
          const value = Reflect.get(target, property, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
      return callback(instrumentedManager)
    }, ...rest)
  }
  send({ type: "ready", role, workerId, pid: process.pid, connectionPid })
}

async function run(message) {
  const operation = message.operation
  const fixture = message.fixture
  const runId = message.runId
  currentCartLockBarrierEnabled = message.cartLockBarrierEnabled === true
  providerCalls = 0
  currentRunId = runId
  stages = []
  currentOperation = operation
  currentPaymentCartId = operation === "payment"
    ? (fixture.mutationCartId || fixture.reviewCartId || "")
    : ""
  currentPaymentActor = operation === "payment"
    ? {
        actorType: "customer",
        actorId: fixture.customerId,
        customerId: fixture.customerId,
      }
    : null
  checkoutDiagnostic = emptyCheckoutDiagnostic()
  process.env.P16_CART_MERGE_BARRIER_RUN_ID = runId
  process.env.P16_CART_MERGE_BARRIER_ROLE = role
  process.env.P16_CART_MERGE_BARRIER_PARENT_PID = String(process.ppid)
  const res = response()
  send({ type: "command-started", runId, role })
  pipelineStage("command-started")
  try {
    if (message.waitForStructuralRelease) {
      await awaitRunRelease(runId, ["structural-release"])
    }
    const handler = operation === "active"
      ? require(path.join(process.cwd(), "src/api/store/carts/active/route")).POST
      : operation === "merge"
        ? require(path.join(process.cwd(), "src/api/store/customers/me/cart/merge/route")).POST
        : operation === "ack"
          ? require(path.join(process.cwd(), "src/api/store/carts/[id]/review/acknowledge/route")).POST
          : operation === "payment"
            ? require(path.join(process.cwd(), "src/api/store/carts/[id]/payment-attempts/card/route")).POST
            : require(path.join(process.cwd(), "src/api/store/carts/[id]/line-items/route")).POST
    pipelineStage("handler-loaded")
    const requestScope = container.createScope()
    requireQuery(requestScope, "request")
    pipelineStage("request-scope-ready")
    if (operation === "payment") {
      loadCartMergeDiagnosticHelpers()
      loadEvaluatePaymentStartEligibility()
      try {
        const originalRemoteQuery = requestScope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
        requestScope.register({
          [ContainerRegistrationKeys.REMOTE_QUERY]: asValue(
            wrapRemoteQueryObservationally(originalRemoteQuery)
          ),
        })
      } catch {}
      requestScope.register({
        stripeCardInitiationLayer: asValue({
          async createCardPaymentIntent(request) {
            providerCalls += 1
            pipelineStage("provider-call")
            const result = {
              id: "pi_hr04_" + role.toLowerCase(),
              status: "requires_payment_method",
              amount: request.amount_minor,
              currency: request.currency_code,
              client_secret: "cs_hr04_" + role.toLowerCase(),
              metadata: {
                cart_id: request.cart_id,
                session_id: request.payment_session_id,
                payment_attempt_id: request.payment_attempt_id,
              },
            }
            pipelineStage("provider-returned")
            return result
          },
        }),
      })
    }
    pipelineStage("handler-entered")
    await handler(requestFor(operation, fixture, message.idempotencyKey, requestScope), res)
    pipelineStage("handler-returned", {
      statusCode: res.statusCode,
      message: typeof res.body?.message === "string"
        ? sanitizeDiagnosticText(res.body.message, 500)
        : null,
    })
    send({
      type: "result",
      runId,
      role,
      operation,
      statusCode: res.statusCode,
      code: typeof res.body?.code === "string"
        ? sanitizeDiagnosticText(res.body.code, 120)
        : null,
      cartId: res.body?.cart?.id ?? null,
      outcome: res.body?.outcome ?? null,
      message: typeof res.body?.message === "string"
        ? sanitizeDiagnosticText(res.body.message, 500)
        : null,
      txid: transactionTxid || message.lockTxid || "",
      pid: process.pid,
      connectionPid: transactionConnectionPid || connectionPid,
      etag: typeof res.headers?.etag === "string" ? res.headers.etag : null,
      responseFingerprint: JSON.stringify({
        statusCode: res.statusCode,
        etag: typeof res.headers?.etag === "string" ? res.headers.etag : null,
        hasBody: res.body != null,
      }),
      providerCalls,
      stages,
      checkoutDiagnostic,
    })
  } catch (error) {
    const diagnostic = errorShape(error)
    pipelineStage("handler-threw", diagnostic)
    send({
      type: "result",
      runId,
      role,
      operation,
      statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
      ...diagnostic,
      cartId: null,
      outcome: null,
      txid: transactionTxid || message.lockTxid || "",
      pid: process.pid,
      connectionPid: transactionConnectionPid || connectionPid,
      etag: null,
      responseFingerprint: "",
      providerCalls,
      stages,
      checkoutDiagnostic,
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
`;

function raceError(code: string): Error {
  return new Error(code);
}

function workerMessageQueue(worker: CartMergeRaceWorker): {
  messages: unknown[];
  waiters: Array<{
    predicate: (message: any) => boolean;
    resolve: (message: any) => void;
    reject: (error: Error) => void;
    timer?: ReturnType<typeof setTimeout>;
  }>;
} {
  return (
    worker as unknown as { queue: { messages: unknown[]; waiters: Array<any> } }
  ).queue;
}

async function startCartMergeRaceWorker(
  role: "A" | "B",
  databaseUrl: string,
): Promise<CartMergeRaceWorker> {
  const parsed = new URL(databaseUrl);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(
      parsed.hostname.replace(/^\[|\]$/g, ""),
    )
  ) {
    throw raceError("P16_CART_MERGE_WORKER_DATABASE_HOST_FORBIDDEN");
  }
  const child = spawn(
    process.execPath,
    [
      "-r",
      "ts-node/register/transpile-only",
      "-e",
      CART_MERGE_RACE_WORKER_SOURCE,
    ],
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
    },
  );
  const queue = { messages: [] as unknown[], waiters: [] as Array<any> };
  (child as unknown as { queue: typeof queue }).queue = queue;
  child.on("message", (message) => {
    const waiterIndex = queue.waiters.findIndex((waiter) =>
      waiter.predicate(message),
    );
    if (waiterIndex >= 0) {
      const waiter = queue.waiters.splice(waiterIndex, 1)[0];
      waiter.resolve(message);
    } else {
      queue.messages.push(message);
    }
  });
  child.stderr?.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) process.stderr.write(`[P16 worker ${role}] ${text}\n`);
  });
  const boot = await nextCartMergeRaceWorkerMessage(
    child as unknown as CartMergeRaceWorker,
    (message) => message?.type === "ready" || message?.type === "boot-error",
    60_000,
  );
  if (boot.type !== "ready") {
    throw raceError(
      `P16_CART_MERGE_WORKER_BOOT_FAILED:${boot.code ?? boot.message ?? "unknown"}`,
    );
  }
  if (
    !Number.isInteger(boot.pid) ||
    !/^\d+$/.test(String(boot.connectionPid ?? ""))
  ) {
    throw raceError("P16_CART_MERGE_WORKER_IDENTITY_INVALID");
  }
  return {
    child,
    role,
    pid: Number(boot.pid),
    connectionPid: String(boot.connectionPid),
    queue,
    send(message) {
      if (!child.connected) throw raceError("P16_CART_MERGE_WORKER_IPC_CLOSED");
      child.send(message);
    },
    close: async () => {
      if (child.exitCode !== null) return;
      child.send({ type: "close" });
      await new Promise<void>((resolveClose) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolveClose();
        }, 10_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolveClose();
        });
      });
    },
  };
}

function nextCartMergeRaceWorkerMessage(
  worker: CartMergeRaceWorker,
  predicate: (message: any) => boolean,
  timeoutMs: number,
): Promise<any> {
  const queue = workerMessageQueue(worker);
  const existingIndex = queue.messages.findIndex(predicate);
  if (existingIndex >= 0)
    return Promise.resolve(queue.messages.splice(existingIndex, 1)[0]);
  return new Promise((resolveMessage, reject) => {
    const waiter = {
      predicate,
      resolve: (message: any) => {
        clearTimeout(waiter.timer);
        resolveMessage(message);
      },
      reject,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
    };
    waiter.timer = setTimeout(() => {
      const index = queue.waiters.indexOf(waiter);
      if (index >= 0) queue.waiters.splice(index, 1);
      reject(
        raceError(
          `P16_CART_MERGE_LOCK_BARRIER_TIMEOUT:${worker.role}:${queue.messages
            .map((message: any) => String(message?.type ?? "unknown"))
            .join(",")}`,
        ),
      );
    }, timeoutMs);
    queue.waiters.push(waiter);
  });
}

function usesCustomerLockBarrier(operation: CartMergeRaceOperation): boolean {
  return operation === "active" || operation === "merge";
}

export async function runCartMergeRace(
  databaseUrl: string,
  operationA: CartMergeRaceOperation,
  operationB: CartMergeRaceOperation,
  fixtureA: CartMergeFixture,
  fixtureB: CartMergeFixture,
  idempotencyKeyA = `p16-race-a-${randomBytes(5).toString("hex")}`,
  idempotencyKeyB = `p16-race-b-${randomBytes(5).toString("hex")}`,
): Promise<CartMergeRaceResult> {
  const runId = randomBytes(8).toString("hex");
  const workers: CartMergeRaceWorker[] = [];
  try {
    workers.push(await startCartMergeRaceWorker("A", databaseUrl));
    workers.push(await startCartMergeRaceWorker("B", databaseUrl));
  } catch (error) {
    await Promise.all(workers.map((worker) => worker.close()));
    throw error;
  }
  const results: Array<CartMergeRaceWorkerResult> = [];
  try {
    workers[0].send({
      type: "run",
      runId,
      operation: operationA,
      fixture: fixtureA,
      idempotencyKey: idempotencyKeyA,
      waitForStructuralRelease: !usesCustomerLockBarrier(operationA),
    });
    workers[1].send({
      type: "run",
      runId,
      operation: operationB,
      fixture: fixtureB,
      idempotencyKey: idempotencyKeyB,
      waitForStructuralRelease: !usesCustomerLockBarrier(operationB),
    });

    await Promise.all(
      workers.map((worker) =>
        nextCartMergeRaceWorkerMessage(
          worker,
          (message) =>
            message?.type === "command-started" && message.runId === runId,
          30_000,
        ),
      ),
    );

    const lockTxidByRole = new Map<string, string>();
    const readResult = async (worker: CartMergeRaceWorker) => {
      const result = await nextCartMergeRaceWorkerMessage(
        worker,
        (message) => message?.type === "result" && message.runId === runId,
        30_000,
      );
      results.push({
        role: result.role,
        operation: result.operation,
        statusCode: result.statusCode,
        code: result.code,
        cartId: result.cartId == null ? null : String(result.cartId),
        outcome: result.outcome == null ? null : String(result.outcome),
        txid: String(result.txid ?? ""),
        pid: Number(result.pid ?? worker.pid),
        connectionPid: String(result.connectionPid ?? worker.connectionPid),
        message: result.message == null ? null : String(result.message),
        etag: result.etag == null ? null : String(result.etag),
        responseFingerprint: String(result.responseFingerprint ?? ""),
        providerCalls: Number(result.providerCalls ?? 0),
        stages: Array.isArray(result.stages) ? result.stages : [],
        error: result.error == null ? undefined : result.error,
        checkoutDiagnostic:
          result.checkoutDiagnostic == null
            ? undefined
            : result.checkoutDiagnostic,
      });
    };

    const operationByRole = new Map<"A" | "B", CartMergeRaceOperation>([
      ["A", operationA],
      ["B", operationB],
    ]);
    const barrierWorkers = workers.filter((worker) =>
      usesCustomerLockBarrier(
        operationByRole.get(worker.role) as CartMergeRaceOperation,
      ),
    );
    const mutationWorkers = workers.filter(
      (worker) =>
        !usesCustomerLockBarrier(
          operationByRole.get(worker.role) as CartMergeRaceOperation,
        ),
    );

    if (barrierWorkers.length === 1 && mutationWorkers.length === 1) {
      const barrierWorker = barrierWorkers[0];
      const mutationWorker = mutationWorkers[0];
      const lockMessage = await nextCartMergeRaceWorkerMessage(
        barrierWorker,
        (message) =>
          message?.type === "lock-acquired" && message.runId === runId,
        30_000,
      );
      lockTxidByRole.set(String(lockMessage.role), String(lockMessage.txid));
      if (operationByRole.get(mutationWorker.role) === "customer-mutation") {
        barrierWorker.send({
          type: "cart-merge-release",
          runId,
          role: lockMessage.role,
          lockTxid: lockMessage.txid,
        });
        mutationWorker.send({ type: "structural-release", runId });
        await Promise.all([
          readResult(mutationWorker),
          readResult(barrierWorker),
        ]);
      } else {
        mutationWorker.send({ type: "structural-release", runId });
        await readResult(mutationWorker);
        barrierWorker.send({
          type: "cart-merge-release",
          runId,
          role: lockMessage.role,
          lockTxid: lockMessage.txid,
        });
        await readResult(barrierWorker);
      }
    } else if (barrierWorkers.length === 2) {
      const lockWaiters = barrierWorkers.map((worker) => ({
        worker,
        promise: nextCartMergeRaceWorkerMessage(
          worker,
          (message) =>
            message?.type === "lock-acquired" && message.runId === runId,
          30_000,
        ).then((message) => ({ worker, message })),
      }));
      const first = await Promise.race(
        lockWaiters.map(({ promise }) => promise),
      );
      lockTxidByRole.set(
        String(first.message.role),
        String(first.message.txid),
      );
      first.worker.send({
        type: "cart-merge-release",
        runId,
        role: first.message.role,
        lockTxid: first.message.txid,
      });

      const secondWorker = barrierWorkers.find(
        (worker) => worker.role !== first.message.role,
      );
      if (!secondWorker)
        throw raceError("P16_CART_MERGE_SECOND_WORKER_MISSING");
      const secondWaiter = lockWaiters.find(
        ({ worker }) => worker.role === secondWorker.role,
      );
      if (!secondWaiter)
        throw raceError("P16_CART_MERGE_SECOND_WORKER_WAITER_MISSING");
      const second = (await secondWaiter.promise).message;
      lockTxidByRole.set(String(second.role), String(second.txid));
      secondWorker.send({
        type: "cart-merge-release",
        runId,
        role: second.role,
        lockTxid: second.txid,
      });
      await Promise.all(barrierWorkers.map((worker) => readResult(worker)));
    } else {
      for (const mutationWorker of mutationWorkers) {
        mutationWorker.send({ type: "structural-release", runId });
      }
      await Promise.all(workers.map((worker) => readResult(worker)));
    }

    const sortedResults = results.sort((a, b) => a.role.localeCompare(b.role));
    const txids = sortedResults
      .map((result) => lockTxidByRole.get(result.role) ?? result.txid)
      .map(String) as [string, string];
    if (!txids.every((txid) => /^\d+$/.test(txid))) {
      throw raceError("P16_CART_MERGE_WORKER_TXID_UNSANITIZED");
    }
    return {
      workers: sortedResults as [
        CartMergeRaceWorkerResult,
        CartMergeRaceWorkerResult,
      ],
      lockTxids: txids,
    };
  } finally {
    await Promise.all(workers.map((worker) => worker.close()));
  }
}

export type CartReviewRaceCompetitor =
  | "customer-mutation"
  | "merge"
  | "payment";

export type CartReviewRaceOrdering = "competitor-first" | "ack-first";

export type CartReviewRaceResult = {
  workers: [CartMergeRaceWorkerResult, CartMergeRaceWorkerResult];
  lockTxids: [string, string];
  barriers: string[];
};

function reviewRaceResultFromMessage(
  worker: CartMergeRaceWorker,
  result: any,
): CartMergeRaceWorkerResult {
  return {
    role: result.role,
    operation: result.operation,
    statusCode: result.statusCode,
    code: result.code,
    cartId: result.cartId == null ? null : String(result.cartId),
    outcome: result.outcome == null ? null : String(result.outcome),
    txid: String(result.txid ?? ""),
    pid: Number(result.pid ?? worker.pid),
    connectionPid: String(result.connectionPid ?? worker.connectionPid),
    message: result.message == null ? null : String(result.message),
    etag: result.etag == null ? null : String(result.etag),
    responseFingerprint: String(result.responseFingerprint ?? ""),
    providerCalls: Number(result.providerCalls ?? 0),
    stages: Array.isArray(result.stages) ? result.stages : [],
    error: result.error == null ? undefined : result.error,
    checkoutDiagnostic:
      result.checkoutDiagnostic == null ? undefined : result.checkoutDiagnostic,
  };
}

/**
 * Runs the ACK handler and one real competing handler in separate OS
 * processes.  The transaction wrapper in each worker reports the actual
 * PostgreSQL transaction and cart advisory-lock boundaries; this function
 * releases only those IPC barriers, never a synthetic lock.
 */
export async function runCartReviewRace(
  databaseUrl: string,
  competitorOperation: CartReviewRaceCompetitor,
  ackFixture: CartReviewRaceFixture,
  competitorFixture: CartMergeFixture,
  ordering: CartReviewRaceOrdering,
  competitorIdempotencyKey = `p16-review-race-${randomBytes(5).toString("hex")}`,
  options: { onMidpoint?: () => Promise<void> } = {},
): Promise<CartReviewRaceResult> {
  const runId = randomBytes(8).toString("hex");
  const workers: CartMergeRaceWorker[] = [];
  const barriers: string[] = [];
  const results = new Map<"A" | "B", CartMergeRaceWorkerResult>();
  const workerForRole = (role: "A" | "B") =>
    workers.find((worker) => worker.role === role) as CartMergeRaceWorker;

  const waitFor = async (
    worker: CartMergeRaceWorker,
    type: string,
    timeoutMs = 30_000,
  ) => {
    const message = await nextCartMergeRaceWorkerMessage(
      worker,
      (candidate) => candidate?.type === type && candidate.runId === runId,
      timeoutMs,
    );
    barriers.push(`${worker.role}:${type}`);
    return message;
  };

  const sendRun = (
    worker: CartMergeRaceWorker,
    operation: CartMergeRaceOperation,
    fixture: CartMergeFixture,
    idempotencyKey: string,
  ) => {
    worker.send({
      type: "run",
      runId,
      operation,
      fixture,
      idempotencyKey,
      waitForStructuralRelease: false,
      cartLockBarrierEnabled: true,
    });
  };

  const releaseCartLock = (worker: CartMergeRaceWorker, message: any) => {
    worker.send({
      type: "cart-lock-release",
      runId,
      role: message.role,
      lockTxid: message.txid,
    });
    barriers.push(`${worker.role}:cart-lock-release`);
  };

  const releaseCustomerLock = (worker: CartMergeRaceWorker, message: any) => {
    worker.send({
      type: "cart-merge-release",
      runId,
      role: message.role,
      lockTxid: message.txid,
    });
    barriers.push(`${worker.role}:cart-merge-release`);
  };

  const readResult = async (worker: CartMergeRaceWorker) => {
    const result = await waitFor(worker, "result");
    const normalized = reviewRaceResultFromMessage(worker, result);
    if (normalized.operation === "ack" && normalized.statusCode === null) {
      throw raceError("P16_CART_REVIEW_ACK_HANDLER_RESULT_INVALID");
    }
    results.set(worker.role, normalized);
    return normalized;
  };

  const readResultReleasingCartLocks = async (
    worker: CartMergeRaceWorker,
  ) => {
    while (true) {
      const message = await nextCartMergeRaceWorkerMessage(
        worker,
        (candidate) =>
          (candidate?.type === "result" ||
            candidate?.type === "cart-lock-acquired") &&
          candidate.runId === runId,
        30_000,
      );

      if (message.type === "cart-lock-acquired") {
        if (!/^\d+$/.test(String(message.txid ?? ""))) {
          throw raceError("P16_CART_REVIEW_RACE_LOCK_TXID_INVALID");
        }
        releaseCartLock(worker, message);
        continue;
      }

      const normalized = reviewRaceResultFromMessage(worker, message);
      if (normalized.operation === "ack" && normalized.statusCode === null) {
        throw raceError("P16_CART_REVIEW_ACK_HANDLER_RESULT_INVALID");
      }
      results.set(worker.role, normalized);
      return normalized;
    }
  };

  const startTransaction = async (worker: CartMergeRaceWorker) => {
    await waitFor(worker, "command-started");
    const transaction = await waitFor(worker, "transaction-started");
    if (!/^\d+$/.test(String(transaction.txid ?? ""))) {
      throw raceError("P16_CART_REVIEW_RACE_TXID_INVALID");
    }
    if (!/^\d+$/.test(String(transaction.connectionPid ?? ""))) {
      throw raceError("P16_CART_REVIEW_RACE_CONNECTION_PID_INVALID");
    }
    return transaction;
  };

  const acquireCartLock = async (worker: CartMergeRaceWorker) => {
    const message = await waitFor(worker, "cart-lock-acquired");
    if (!/^\d+$/.test(String(message.txid ?? ""))) {
      throw raceError("P16_CART_REVIEW_RACE_LOCK_TXID_INVALID");
    }
    return message;
  };

  const startCompetitor = async () => {
    const competitor = workerForRole("B");
    sendRun(
      competitor,
      competitorOperation,
      competitorFixture,
      competitorIdempotencyKey,
    );
    await startTransaction(competitor);
    if (competitorOperation === "merge") {
      const customerLock = await waitFor(competitor, "lock-acquired");
      releaseCustomerLock(competitor, customerLock);
    }
    return acquireCartLock(competitor);
  };

  const startAck = async () => {
    const ack = workerForRole("A");
    sendRun(ack, "ack", ackFixture, "");
    await startTransaction(ack);
    return acquireCartLock(ack);
  };

  const startAckTransaction = async () => {
    const ack = workerForRole("A");
    sendRun(ack, "ack", ackFixture, "");
    return startTransaction(ack);
  };

  try {
    workers.push(await startCartMergeRaceWorker("A", databaseUrl));
    workers.push(await startCartMergeRaceWorker("B", databaseUrl));

    let ackLock: any;
    let competitorLock: any;
    if (ordering === "competitor-first") {
      competitorLock = await startCompetitor();
      await startAckTransaction();
      await options.onMidpoint?.();
      const competitorResultPromise = readResultReleasingCartLocks(
        workerForRole("B"),
      );
      releaseCartLock(workerForRole("B"), competitorLock);
      await competitorResultPromise;
      ackLock = await acquireCartLock(workerForRole("A"));
      const ackResultPromise = readResult(workerForRole("A"));
      releaseCartLock(workerForRole("A"), ackLock);
      await ackResultPromise;
    } else {
      ackLock = await startAck();
      sendRun(
        workerForRole("B"),
        competitorOperation,
        competitorFixture,
        competitorIdempotencyKey,
      );
      await startTransaction(workerForRole("B"));
      await options.onMidpoint?.();
      releaseCartLock(workerForRole("A"), ackLock);
      const ackResultPromise = readResult(workerForRole("A"));
      if (competitorOperation === "merge") {
        const customerLock = await waitFor(workerForRole("B"), "lock-acquired");
        releaseCustomerLock(workerForRole("B"), customerLock);
      }
      competitorLock = await acquireCartLock(workerForRole("B"));
      await ackResultPromise;
      const competitorResultPromise = readResultReleasingCartLocks(
        workerForRole("B"),
      );
      releaseCartLock(workerForRole("B"), competitorLock);
      await competitorResultPromise;
    }

    const sortedResults = [results.get("A"), results.get("B")];
    if (!sortedResults[0] || !sortedResults[1]) {
      throw raceError("P16_CART_REVIEW_RACE_RESULT_MISSING");
    }
    const txids = sortedResults.map((result) => String(result.txid)) as [
      string,
      string,
    ];
    const pids = sortedResults.map((result) => result.pid);
    const connectionPids = sortedResults.map((result) => result.connectionPid);
    if (!txids.every((txid) => /^\d+$/.test(txid))) {
      throw raceError("P16_CART_REVIEW_RACE_TXID_UNSANITIZED");
    }
    if (new Set(txids).size !== 2) {
      throw raceError("P16_CART_REVIEW_RACE_TRANSACTION_NOT_DISTINCT");
    }
    if (new Set(pids).size !== 2) {
      throw raceError("P16_CART_REVIEW_RACE_PROCESS_NOT_DISTINCT");
    }
    if (new Set(connectionPids).size !== 2) {
      throw raceError("P16_CART_REVIEW_RACE_CONNECTION_NOT_DISTINCT");
    }
    if (!barriers.some((barrier) => barrier.endsWith(":transaction-started"))) {
      throw raceError("P16_CART_REVIEW_RACE_TRANSACTION_BARRIER_MISSING");
    }
    if (!barriers.some((barrier) => barrier.endsWith(":cart-lock-acquired"))) {
      throw raceError("P16_CART_REVIEW_RACE_CART_LOCK_BARRIER_MISSING");
    }
    return {
      workers: sortedResults as [
        CartMergeRaceWorkerResult,
        CartMergeRaceWorkerResult,
      ],
      lockTxids: [
        String(ackLock?.txid ?? ""),
        String(competitorLock?.txid ?? ""),
      ] as [string, string],
      barriers,
    };
  } finally {
    await Promise.all(workers.map((worker) => worker.close()));
  }
}

export async function readCustomerCartCanonicalState(
  connection: CartMergePostgresRawConnection,
  customerId: string,
): Promise<{
  activeAuthorityRows: number;
  activeAuthorityCartId: string | null;
  usableCustomerCartIds: string[];
}> {
  const authority = await connection.raw(
    `select cart_id from customer_cart_authority where customer_id = ? and state = 'active' and deleted_at is null order by cart_id`,
    [customerId],
  );
  const carts = await connection.raw(
    `select id from cart where customer_id = ? and completed_at is null and deleted_at is null order by id`,
    [customerId],
  );
  const authorityRows = requireRows(authority);
  return {
    activeAuthorityRows: authorityRows.length,
    activeAuthorityCartId: authorityRows[0]
      ? readNullableString(authorityRows[0], "cart_id")
      : null,
    usableCustomerCartIds: requireRows(carts).map((row) =>
      readString(row, "id"),
    ),
  };
}

export async function countPersistedOrders(
  connection: CartMergePostgresRawConnection,
): Promise<number> {
  const result = await connection.raw(
    'select count(*)::int as count from "order"',
  );
  return Number(requireRows(result)[0]?.count ?? 0);
}

export async function countUsableCustomerCarts(
  connection: CartMergePostgresRawConnection,
  customerId: string,
): Promise<number> {
  const result = await connection.raw(
    `
      select count(*)::int as count
      from cart
      where customer_id = ? and completed_at is null and deleted_at is null
    `,
    [customerId],
  );
  return Number(requireRows(result)[0]?.count ?? 0);
}

export async function readRealCartMergeState(
  connection: CartMergePostgresRawConnection,
  fixture: CartMergeFixture,
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
        result.customer_version_before,
        result.customer_version_after,
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
        on result.guest_cart_id = c.id
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
    [fixture.guestCartId],
  );
  const row = requireRows(result)[0];
  if (!row) throw new Error("P16_REAL_CART_STATE_MISSING");

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
    customer_version_before:
      row.customer_version_before == null
        ? null
        : Number(row.customer_version_before),
    customer_version_after:
      row.customer_version_after == null
        ? null
        : Number(row.customer_version_after),
    result_review_id: readNullableString(row, "result_review_id"),
    result_xmin: readNullableString(row, "result_xmin"),
    result_etag: readNullableString(row, "result_etag"),
    result_expires_at: readNullableString(row, "result_expires_at"),
    review_status: readNullableString(row, "review_status"),
    review_ref: readNullableString(row, "review_ref"),
    review_xmin: readNullableString(row, "review_xmin"),
  };
}

export type CartReviewRaceLedger = {
  cart_id: string;
  customer_id: string | null;
  region_id_present: boolean;
  shipping_address_id_present: boolean;
  line_items: unknown;
  version: number | null;
  review_count: number;
  review_status: string | null;
  review_ref: string | null;
  acknowledged_at: string | null;
  capability_status: string | null;
  capability_consumed_at: string | null;
  merge_result_count: number;
  merge_outcomes: string[];
  idempotency_count: number;
  payment_attempt_count: number;
  payment_attempt_statuses: string[];
  payment_collection_count: number;
  payment_session_count: number;
  payment_session_statuses: string[];
};

/**
 * Captures the committed effect ledger for a race target.  Payment
 * collection/session rows are read through Medusa's persisted cart link, and
 * payment attempts through the real PaymentAttempt table; no probe row is
 * created by this reader.
 */
export async function readCartReviewRaceLedger(
  connection: CartMergePostgresRawConnection,
  fixture: CartMergeFixture,
  cartId = fixture.mutationCartId ?? fixture.guestCartId,
): Promise<CartReviewRaceLedger> {
  const result = await connection.raw(
    `
      select
        c.id as cart_id,
        c.customer_id,
        c.region_id,
        c.shipping_address_id,
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'variant_id', li.variant_id,
              'quantity', li.quantity
            ) order by li.variant_id
          )
          from cart_line_item li
          where li.cart_id = c.id and li.deleted_at is null
        ), '[]'::jsonb) as line_items,
        v.version,
        (
          select count(*)::int
          from cart_review review
          where review.cart_id = c.id and review.deleted_at is null
        ) as review_count,
        (
          select review.status
          from cart_review review
          where review.cart_id = c.id and review.deleted_at is null
          order by review.created_at desc
          limit 1
        ) as review_status,
        (
          select review.review_ref
          from cart_review review
          where review.cart_id = c.id and review.deleted_at is null
          order by review.created_at desc
          limit 1
        ) as review_ref,
        (
          select review.acknowledged_at::text
          from cart_review review
          where review.cart_id = c.id and review.deleted_at is null
          order by review.created_at desc
          limit 1
        ) as acknowledged_at,
        cap.status as capability_status,
        cap.consumed_at::text as capability_consumed_at,
        (
          select count(*)::int
          from cart_merge_result result
          where result.guest_cart_id = ? and result.deleted_at is null
        ) as merge_result_count,
        coalesce((
          select array_agg(result.outcome order by result.created_at)
          from cart_merge_result result
          where result.guest_cart_id = ? and result.deleted_at is null
        ), '{}'::text[]) as merge_outcomes,
        (
          select count(*)::int
          from store_idempotency_record
          where deleted_at is null
        ) as idempotency_count,
        (
          select count(*)::int
          from payment_attempt attempt
          where attempt.cart_id = c.id and attempt.deleted_at is null
        ) as payment_attempt_count,
        coalesce((
          select array_agg(attempt.status order by attempt.created_at)
          from payment_attempt attempt
          where attempt.cart_id = c.id and attempt.deleted_at is null
        ), '{}'::text[]) as payment_attempt_statuses,
        (
          select count(*)::int
          from cart_payment_collection link
          where link.cart_id = c.id
        ) as payment_collection_count,
        (
          select count(*)::int
          from payment_session session
          where session.payment_collection_id in (
            select link.payment_collection_id
            from cart_payment_collection link
            where link.cart_id = c.id
          )
        ) as payment_session_count,
        coalesce((
          select array_agg(session.status order by session.created_at)
          from payment_session session
          where session.payment_collection_id in (
            select link.payment_collection_id
            from cart_payment_collection link
            where link.cart_id = c.id
          )
        ), '{}'::text[]) as payment_session_statuses
      from cart c
      left join store_resource_version v
        on v.resource_type = 'cart'
       and v.resource_id = c.id
       and v.deleted_at is null
      left join guest_cart_capability cap
        on cap.cart_id = ?
       and cap.deleted_at is null
      where c.id = ? and c.deleted_at is null
    `,
    [fixture.guestCartId, fixture.guestCartId, fixture.guestCartId, cartId],
  );
  const row = requireRows(result)[0];
  if (!row) throw new Error("P16_REAL_CART_REVIEW_RACE_LEDGER_MISSING");

  return {
    cart_id: readString(row, "cart_id"),
    customer_id: readNullableString(row, "customer_id"),
    region_id_present: Boolean(row.region_id),
    shipping_address_id_present: Boolean(row.shipping_address_id),
    line_items: row.line_items ?? [],
    version: row.version == null ? null : Number(row.version),
    review_count: Number(row.review_count ?? 0),
    review_status: readNullableString(row, "review_status"),
    review_ref: readNullableString(row, "review_ref"),
    acknowledged_at: readNullableString(row, "acknowledged_at"),
    capability_status: readNullableString(row, "capability_status"),
    capability_consumed_at: readNullableString(row, "capability_consumed_at"),
    merge_result_count: Number(row.merge_result_count ?? 0),
    merge_outcomes: Array.isArray(row.merge_outcomes)
      ? row.merge_outcomes.map(String)
      : [],
    idempotency_count: Number(row.idempotency_count ?? 0),
    payment_attempt_count: Number(row.payment_attempt_count ?? 0),
    payment_attempt_statuses: Array.isArray(row.payment_attempt_statuses)
      ? row.payment_attempt_statuses.map(String)
      : [],
    payment_collection_count: Number(row.payment_collection_count ?? 0),
    payment_session_count: Number(row.payment_session_count ?? 0),
    payment_session_statuses: Array.isArray(row.payment_session_statuses)
      ? row.payment_session_statuses.map(String)
      : [],
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPresentText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function emailHasValidShape(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  );
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asCountryCode(value: unknown): string | null {
  return isPresentText(value) ? value.trim().toLowerCase() : null;
}

function asCurrencyCode(value: unknown): string | null {
  return isPresentText(value) ? value.trim().toLowerCase() : null;
}

function emptyCheckoutCompletenessDiagnostic(
  overrides: Partial<CheckoutCompletenessDiagnostic> = {},
): CheckoutCompletenessDiagnostic {
  return {
    cartPresent: false,
    cartEmailPresent: false,
    cartEmailValidShape: false,
    customerPresent: false,
    customerEmailPresent: false,
    customerEmailValidShape: false,
    currencyCode: null,
    regionIdPresent: false,
    regionPresent: false,
    regionCountryCount: 0,
    regionCountryCodes: [],
    shippingAddressPresent: false,
    shippingFirstNamePresent: false,
    shippingLastNamePresent: false,
    shippingAddress1Present: false,
    shippingCityPresent: false,
    shippingPostalCodePresent: false,
    shippingCountryCode: null,
    shippingProvincePresent: false,
    shippingPhonePresent: false,
    federalTaxIdPresent: false,
    itemCount: 0,
    items: [],
    cartCompletedAtPresent: false,
    orderIdPresent: false,
    totals: {
      totalPresent: false,
      itemTotalPresent: false,
      subtotalPresent: false,
    },
    ...overrides,
  };
}

function metadataRecord(value: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return null;
  return value;
}

function federalTaxIdPresentFromMetadata(value: unknown): boolean {
  const metadata = metadataRecord(value);
  if (!metadata) return false;
  return isPresentText(metadata.federal_tax_id);
}

function gelatoOptionsRecord(value: unknown): Record<string, unknown> | null {
  return isPlainRecord(value) ? value : null;
}

function sanitizeCheckoutItemDiagnostic(
  item: unknown,
): CheckoutCompletenessItemDiagnostic {
  const record = isPlainRecord(item) ? item : {};
  const quantity = asFiniteNumber(record.quantity);
  const variant = isPlainRecord(record.variant) ? record.variant : null;
  const metadata = variant ? metadataRecord(variant.metadata) : null;
  const options = gelatoOptionsRecord(metadata?.gelato_variant_options);
  const prices = Array.isArray(variant?.prices) ? variant.prices : [];
  const brlPricePositive = prices.some((price) => {
    if (!isPlainRecord(price)) return false;
    const amount = asFiniteNumber(price.amount);
    return asCurrencyCode(price.currency_code) === "brl" && amount !== null && amount > 0;
  });

  return {
    quantity,
    quantityValid: quantity !== null && quantity > 0,
    variantPresent: variant !== null,
    gelatoProductUidPresent: isPresentText(metadata?.gelato_product_uid),
    gelatoTemplateIdPresent: isPresentText(metadata?.gelato_template_id),
    gelatoVariantOptionsPresent: options !== null,
    gelatoSizePresent: isPresentText(options?.size),
    gelatoColorPresent: isPresentText(options?.color),
    templateModeFixed: metadata?.template_mode === "fixed",
    brlPricePositive,
  };
}

/**
 * Maps a cart-shaped object (REMOTE_QUERY row or assembled persisted shape)
 * onto the sanitized completeness diagnostic. Output is PII-free by
 * construction: no ids, emails, names, addresses, phones, or tax ids.
 */
export function sanitizeCheckoutCompletenessFromCartLike(
  cart: unknown,
): CheckoutCompletenessDiagnostic {
  if (!isPlainRecord(cart)) {
    return emptyCheckoutCompletenessDiagnostic();
  }

  const customer = isPlainRecord(cart.customer) ? cart.customer : null;
  const shipping = isPlainRecord(cart.shipping_address)
    ? cart.shipping_address
    : null;
  const region = isPlainRecord(cart.region) ? cart.region : null;
  const countries = Array.isArray(region?.countries)
    ? region.countries
        .map((country) =>
          isPlainRecord(country) ? asCountryCode(country.iso_2) : null,
        )
        .filter((code): code is string => Boolean(code))
    : [];
  const items = Array.isArray(cart.items) ? cart.items : [];

  return emptyCheckoutCompletenessDiagnostic({
    cartPresent: true,
    cartEmailPresent: isPresentText(cart.email),
    cartEmailValidShape: emailHasValidShape(cart.email),
    customerPresent: customer !== null,
    customerEmailPresent: isPresentText(customer?.email),
    customerEmailValidShape: emailHasValidShape(customer?.email),
    currencyCode: asCurrencyCode(cart.currency_code),
    regionIdPresent: isPresentText(cart.region_id) || region !== null,
    regionPresent: region !== null,
    regionCountryCount: countries.length,
    regionCountryCodes: countries,
    shippingAddressPresent: shipping !== null,
    shippingFirstNamePresent: isPresentText(shipping?.first_name),
    shippingLastNamePresent: isPresentText(shipping?.last_name),
    shippingAddress1Present: isPresentText(shipping?.address_1),
    shippingCityPresent: isPresentText(shipping?.city),
    shippingPostalCodePresent: isPresentText(shipping?.postal_code),
    shippingCountryCode: asCountryCode(shipping?.country_code),
    shippingProvincePresent: isPresentText(shipping?.province),
    shippingPhonePresent: isPresentText(shipping?.phone),
    federalTaxIdPresent: federalTaxIdPresentFromMetadata(shipping?.metadata),
    itemCount: items.length,
    items: items.map((item) => sanitizeCheckoutItemDiagnostic(item)),
    cartCompletedAtPresent: cart.completed_at != null && cart.completed_at !== "",
    orderIdPresent: isPresentText(cart.order_id),
    totals: {
      totalPresent: cart.total !== undefined && cart.total !== null,
      itemTotalPresent: cart.item_total !== undefined && cart.item_total !== null,
      subtotalPresent: cart.subtotal !== undefined && cart.subtotal !== null,
    },
  });
}

function isUnsafeRequestedFieldToken(value: string): boolean {
  return (
    /@/.test(value) ||
    /\b(?:cart|cus|customer|guest|order|payment|pay|line|item|variant|prod|review|result|authority|capability|idempotency)[_-][a-z0-9]{12,}\b/i.test(
      value,
    ) ||
    /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i.test(value) ||
    /\b[0-9a-f]{24,}\b/i.test(value)
  );
}

function flattenRemoteQueryFields(
  node: unknown,
  prefix = "",
  out: string[] = [],
): string[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      if (typeof item === "string" && !isUnsafeRequestedFieldToken(item)) {
        out.push(prefix ? `${prefix}.${item}` : item);
      }
    }
    return out;
  }
  if (!isPlainRecord(node)) return out;

  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("__")) continue;
    if (isUnsafeRequestedFieldToken(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (key === "*") {
      out.push(prefix ? `${prefix}.*` : "*");
      continue;
    }
    if (value === "*" || value === true) {
      out.push(path);
      continue;
    }
    if (value && typeof value === "object") {
      flattenRemoteQueryFields(value, path, out);
    }
  }
  return out;
}

/**
 * Extracts the Card cart REMOTE_QUERY contract as field names only.
 * Filters, ids, and relation values are never returned.
 */
export function readRemoteQueryCartContract(
  queryObject: unknown,
): CheckoutRemoteQueryContract | null {
  if (!isPlainRecord(queryObject)) return null;
  if (
    queryObject.entryPoint === "cart_payment_collection" ||
    queryObject.entity === "cart_payment_collection" ||
    "cart_payment_collection" in queryObject
  ) {
    return null;
  }

  const fieldList = Array.isArray(queryObject.fields)
    ? queryObject.fields.filter(
        (field): field is string =>
          typeof field === "string" && !isUnsafeRequestedFieldToken(field),
      )
    : null;

  if (queryObject.entryPoint === "cart" || queryObject.entity === "cart") {
    const requestedFields = [
      ...new Set(fieldList ?? flattenRemoteQueryFields(queryObject)),
    ];
    return { entryPoint: "cart", requestedFields };
  }

  if (isPlainRecord(queryObject.cart)) {
    const requestedFields = [
      ...new Set(fieldList ?? flattenRemoteQueryFields(queryObject.cart)),
    ];
    return { entryPoint: "cart", requestedFields };
  }

  return null;
}

async function listPublicTableNames(
  connection: CartMergePostgresRawConnection,
  candidates: string[],
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const result = await connection.raw(
    `
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (${candidates.map(() => "?").join(", ")})
    `,
    candidates,
  );
  return new Set(requireRows(result).map((row) => readString(row, "table_name")));
}

async function listPublicTableColumns(
  connection: CartMergePostgresRawConnection,
  tableName: string,
): Promise<Set<string>> {
  const result = await connection.raw(
    `
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = ?
    `,
    [tableName],
  );
  return new Set(
    requireRows(result).map((row) => readString(row, "column_name")),
  );
}

async function discoverPublicTableWithColumns(
  connection: CartMergePostgresRawConnection,
  requiredColumns: string[],
  preferredTable?: string,
): Promise<string | null> {
  if (requiredColumns.length === 0) return null;
  const result = await connection.raw(
    `
      select table_name
      from information_schema.columns
      where table_schema = 'public'
        and column_name in (${requiredColumns.map(() => "?").join(", ")})
      group by table_name
      having count(distinct column_name) = ?
    `,
    [...requiredColumns, requiredColumns.length],
  );
  const tables = requireRows(result).map((row) => readString(row, "table_name"));
  if (preferredTable && tables.includes(preferredTable)) return preferredTable;
  return tables[0] ?? null;
}

function assertSafeSqlIdentifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error("P16_CHECKOUT_DIAGNOSTIC_IDENTIFIER_UNSAFE");
  }
  return value;
}

function deletedAtPredicate(columns: Set<string>, alias: string): string {
  return columns.has("deleted_at")
    ? `and ${assertSafeSqlIdentifier(alias)}.deleted_at is null`
    : "";
}

function selectColumnOrNull(
  columns: Set<string>,
  alias: string,
  column: string,
): string {
  return columns.has(column)
    ? `${assertSafeSqlIdentifier(alias)}.${assertSafeSqlIdentifier(column)}`
    : "null";
}

/**
 * Reads eligibility-relevant checkout fields from real PostgreSQL and returns
 * only the sanitized completeness diagnostic. Cart ids stay in the query bind
 * and never appear in the returned object.
 */
export async function readPersistedCheckoutCompletenessDiagnostic(
  connection: CartMergePostgresRawConnection,
  cartId: string,
): Promise<CheckoutCompletenessDiagnostic> {
  try {
    return await readPersistedCheckoutCompletenessDiagnosticUnsafe(
      connection,
      cartId,
    );
  } catch {
    return emptyCheckoutCompletenessDiagnostic();
  }
}

async function readPersistedCheckoutCompletenessDiagnosticUnsafe(
  connection: CartMergePostgresRawConnection,
  cartId: string,
): Promise<CheckoutCompletenessDiagnostic> {
  const tables = await listPublicTableNames(connection, [
    "cart",
    "cart_line_item",
    "cart_address",
    "customer",
    "region",
    "region_country",
    "product_variant",
    "price",
    "product_variant_price_set",
  ]);
  if (!tables.has("cart")) {
    return emptyCheckoutCompletenessDiagnostic();
  }

  const cartColumns = await listPublicTableColumns(connection, "cart");
  const cartResult = await connection.raw(
    `
      select
        ${selectColumnOrNull(cartColumns, "c", "email")} as email,
        ${selectColumnOrNull(cartColumns, "c", "currency_code")} as currency_code,
        ${selectColumnOrNull(cartColumns, "c", "customer_id")} as customer_id,
        ${selectColumnOrNull(cartColumns, "c", "region_id")} as region_id,
        ${selectColumnOrNull(cartColumns, "c", "shipping_address_id")} as shipping_address_id,
        ${selectColumnOrNull(cartColumns, "c", "completed_at")} as completed_at,
        ${selectColumnOrNull(cartColumns, "c", "order_id")} as order_id,
        ${selectColumnOrNull(cartColumns, "c", "total")} as total,
        ${selectColumnOrNull(cartColumns, "c", "item_total")} as item_total,
        ${selectColumnOrNull(cartColumns, "c", "subtotal")} as subtotal
      from cart c
      where c.id = ? ${deletedAtPredicate(cartColumns, "c")}
      limit 1
    `,
    [cartId],
  );
  const cartRow = requireRows(cartResult)[0];
  if (!cartRow) return emptyCheckoutCompletenessDiagnostic();

  const customerId = readNullableString(cartRow, "customer_id");
  const regionId = readNullableString(cartRow, "region_id");
  const shippingAddressId = readNullableString(cartRow, "shipping_address_id");

  let customer: { email?: unknown } | null = null;
  if (customerId) {
    customer = {};
    if (tables.has("customer")) {
      const customerColumns = await listPublicTableColumns(connection, "customer");
      const customerResult = await connection.raw(
        `
          select ${selectColumnOrNull(customerColumns, "customer", "email")} as email
          from customer
          where id = ? ${deletedAtPredicate(customerColumns, "customer")}
          limit 1
        `,
        [customerId],
      );
      const customerRow = requireRows(customerResult)[0];
      if (customerRow) {
        customer = { email: customerRow.email };
      }
    }
  }

  const addressTable =
    tables.has("cart_address")
      ? "cart_address"
      : await discoverPublicTableWithColumns(
          connection,
          ["first_name", "address_1", "country_code"],
          "cart_address",
        );
  let shippingAddress: Record<string, unknown> | null = null;
  if (shippingAddressId && addressTable) {
    const addressColumns = await listPublicTableColumns(connection, addressTable);
    const addressResult = await connection.raw(
      `
        select
          ${selectColumnOrNull(addressColumns, "a", "first_name")} as first_name,
          ${selectColumnOrNull(addressColumns, "a", "last_name")} as last_name,
          ${selectColumnOrNull(addressColumns, "a", "address_1")} as address_1,
          ${selectColumnOrNull(addressColumns, "a", "address_2")} as address_2,
          ${selectColumnOrNull(addressColumns, "a", "city")} as city,
          ${selectColumnOrNull(addressColumns, "a", "postal_code")} as postal_code,
          ${selectColumnOrNull(addressColumns, "a", "country_code")} as country_code,
          ${selectColumnOrNull(addressColumns, "a", "province")} as province,
          ${selectColumnOrNull(addressColumns, "a", "phone")} as phone,
          ${selectColumnOrNull(addressColumns, "a", "metadata")} as metadata
        from ${assertSafeSqlIdentifier(addressTable)} a
        where a.id = ? ${deletedAtPredicate(addressColumns, "a")}
        limit 1
      `,
      [shippingAddressId],
    );
    const addressRow = requireRows(addressResult)[0];
    if (addressRow) shippingAddress = addressRow;
  }

  const countryTable =
    tables.has("region_country")
      ? "region_country"
      : await discoverPublicTableWithColumns(
          connection,
          ["iso_2", "region_id"],
          "region_country",
        );
  let region: { countries: Array<{ iso_2?: unknown }> } | null = null;
  if (regionId) {
    const regionExists = tables.has("region")
      ? requireRows(
          await connection.raw(
            `
              select 1
              from region
              where id = ? ${deletedAtPredicate(
                await listPublicTableColumns(connection, "region"),
                "region",
              )}
              limit 1
            `,
            [regionId],
          ),
        ).length > 0
      : false;
    const countries: Array<{ iso_2?: unknown }> = [];
    if (countryTable) {
      const countryColumns = await listPublicTableColumns(connection, countryTable);
      const countryResult = await connection.raw(
        `
          select ${selectColumnOrNull(countryColumns, "rc", "iso_2")} as iso_2
          from ${assertSafeSqlIdentifier(countryTable)} rc
          where rc.region_id = ? ${deletedAtPredicate(countryColumns, "rc")}
          order by rc.iso_2
        `,
        [regionId],
      );
      for (const row of requireRows(countryResult)) {
        countries.push({ iso_2: row.iso_2 });
      }
    }
    if (regionExists || countries.length > 0) {
      region = { countries };
    }
  }

  const items: Array<Record<string, unknown>> = [];
  if (tables.has("cart_line_item")) {
    const lineColumns = await listPublicTableColumns(connection, "cart_line_item");
    const variantTable = tables.has("product_variant")
      ? "product_variant"
      : null;
    const variantColumns = variantTable
      ? await listPublicTableColumns(connection, variantTable)
      : new Set<string>();
    const lineResult = await connection.raw(
      variantTable
        ? `
          select
            ${selectColumnOrNull(lineColumns, "li", "quantity")} as quantity,
            ${selectColumnOrNull(lineColumns, "li", "unit_price")} as unit_price,
            ${selectColumnOrNull(lineColumns, "li", "variant_id")} as variant_id,
            ${selectColumnOrNull(variantColumns, "pv", "metadata")} as variant_metadata
          from cart_line_item li
          left join ${assertSafeSqlIdentifier(variantTable)} pv
            on pv.id = li.variant_id
           ${deletedAtPredicate(variantColumns, "pv")}
          where li.cart_id = ? ${deletedAtPredicate(lineColumns, "li")}
          order by li.id
        `
        : `
          select
            ${selectColumnOrNull(lineColumns, "li", "quantity")} as quantity,
            ${selectColumnOrNull(lineColumns, "li", "unit_price")} as unit_price,
            ${selectColumnOrNull(lineColumns, "li", "variant_id")} as variant_id,
            null as variant_metadata
          from cart_line_item li
          where li.cart_id = ? ${deletedAtPredicate(lineColumns, "li")}
          order by li.id
        `,
      [cartId],
    );

    const priceTable = tables.has("price")
      ? "price"
      : await discoverPublicTableWithColumns(
          connection,
          ["amount", "currency_code"],
          "price",
        );
    const linkTable = tables.has("product_variant_price_set")
      ? "product_variant_price_set"
      : (await discoverPublicTableWithColumns(connection, [
          "price_set_id",
          "variant_id",
        ])) ??
        (await discoverPublicTableWithColumns(connection, [
          "price_set_id",
          "product_variant_id",
        ]));
    const linkColumns = linkTable
      ? await listPublicTableColumns(connection, linkTable)
      : new Set<string>();
    const variantIdColumn = linkColumns.has("variant_id")
      ? "variant_id"
      : linkColumns.has("product_variant_id")
        ? "product_variant_id"
        : null;
    const pricesByVariantId = new Map<string, Array<Record<string, unknown>>>();
    const variantIds = requireRows(lineResult)
      .map((row) => readNullableString(row, "variant_id"))
      .filter((id): id is string => Boolean(id));

    if (priceTable && linkTable && variantIdColumn && variantIds.length > 0) {
      const priceColumns = await listPublicTableColumns(connection, priceTable);
      const placeholders = variantIds.map(() => "?").join(", ");
      const priceResult = await connection.raw(
        `
          select
            link.${assertSafeSqlIdentifier(variantIdColumn)} as variant_id,
            ${selectColumnOrNull(priceColumns, "p", "currency_code")} as currency_code,
            ${selectColumnOrNull(priceColumns, "p", "amount")} as amount
          from ${assertSafeSqlIdentifier(linkTable)} link
          join ${assertSafeSqlIdentifier(priceTable)} p
            on p.price_set_id = link.price_set_id
           ${deletedAtPredicate(priceColumns, "p")}
          where link.${assertSafeSqlIdentifier(variantIdColumn)} in (${placeholders})
            ${deletedAtPredicate(linkColumns, "link")}
        `,
        variantIds,
      );
      for (const row of requireRows(priceResult)) {
        const variantId = readNullableString(row, "variant_id");
        if (!variantId) continue;
        const prices = pricesByVariantId.get(variantId) ?? [];
        prices.push({
          currency_code: row.currency_code,
          amount: row.amount,
        });
        pricesByVariantId.set(variantId, prices);
      }
    }

    for (const row of requireRows(lineResult)) {
      const variantId = readNullableString(row, "variant_id");
      const variantPresent = Boolean(variantId) || row.variant_metadata != null;
      items.push({
        quantity: row.quantity,
        unit_price: row.unit_price,
        variant: variantPresent
          ? {
              metadata: row.variant_metadata ?? null,
              prices: variantId ? (pricesByVariantId.get(variantId) ?? []) : [],
            }
          : null,
      });
    }
  }

  const cartLike = {
    email: cartRow.email,
    currency_code: cartRow.currency_code,
    region_id: regionId,
    completed_at: cartRow.completed_at,
    order_id: cartRow.order_id,
    total: cartRow.total,
    item_total: cartRow.item_total,
    subtotal: cartRow.subtotal,
    customer,
    region,
    shipping_address: shippingAddress,
    items,
  };

  return sanitizeCheckoutCompletenessFromCartLike(cartLike);
}

/**
 * Instruments the real Cart module repository only for the current test.
 * The callback still runs in Medusa's transaction; the failpoint is invoked
 * after the real merge returns and before the repository can commit.
 */
export function instrumentRealCartMergeTransaction(
  cartModule: CartModule,
  options: { failpoint?: Failpoint } = {},
): CartMergeTransactionInstrumentation {
  const repository = cartModule.baseRepository_;
  const original = repository.transaction;
  const transactionIds: string[] = [];

  repository.transaction = async function instrumentedTransaction<T>(
    callback,
    ...rest
  ): Promise<T> {
    return original.call(
      this,
      async (transactionManager) => {
        const transaction = transactionManager.getTransactionContext?.();
        if (!transaction)
          throw new Error("P16_REAL_TRANSACTION_CONTEXT_MISSING");
        const before = await transaction.raw(
          "select txid_current()::text as txid",
        );
        transactionIds.push(String(before.rows?.[0]?.txid ?? ""));
        const value = await callback(transactionManager);
        const after = await transaction.raw(
          "select txid_current()::text as txid",
        );
        transactionIds.push(String(after.rows?.[0]?.txid ?? ""));
        options.failpoint?.trip("transaction_before_commit");
        return value;
      },
      ...rest,
    );
  };

  return {
    transactionIds,
    restore() {
      repository.transaction = original;
    },
  };
}

export function createCartMergeFailpoint(code = "P16_CART_MERGE_FAILPOINT") {
  let armedPoint: string | null = null;
  const ledger: string[] = [];
  return {
    arm(point?: string) {
      armedPoint = point ?? "*";
    },
    trip(point = "transaction_before_commit") {
      ledger.push(point);
      if (armedPoint === "*" || armedPoint === point) {
        throw new Error(`${code}:${point}`);
      }
    },
    ledger,
    reset() {
      armedPoint = null;
    },
  };
}
