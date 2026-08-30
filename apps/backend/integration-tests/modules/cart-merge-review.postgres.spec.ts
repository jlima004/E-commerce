import { createRegionsWorkflow } from "@medusajs/core-flows";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { POST as addGuestLineItem } from "../../src/api/store/carts/[id]/line-items/route";
import { POST as mergeCart } from "../../src/api/store/customers/me/cart/merge/route";
import { CART_MERGE_MODULE } from "../../src/modules/cart-merge";
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness";
import { resetMikroOrmGlobalMetadataForTestRealm } from "../helpers/mikro-orm-test-metadata";
import {
  assertCustomerCartBackfillFailClosed,
  auditCustomerCartBackfill,
  countPersistedOrders,
  countCustomerCartAuthorityRows,
  countUsableCustomerCarts,
  createCartMergeFailpoint,
  createCartMergeRequest,
  createCartMergeResponse,
  createHistoricalCustomerCartCandidates,
  createRealCustomerCartFixture,
  createRealCartMergeFixture,
  createRealPendingCartReviewFixture,
  cleanupCartMergeSchemaProbes,
  insertCartMergeResultProbe,
  insertCartReviewProbe,
  insertCustomerCartAuthorityProbe,
  instrumentRealCartMergeTransaction,
  readCartMergeSchemaCatalog,
  readCustomerCartCanonicalState,
  readCartReviewRaceLedger,
  readPersistedCheckoutCompletenessDiagnostic,
  readRealCartMergeState,
  runCartMergeRace,
  runCartReviewRace,
  type CartMergePostgresRawConnection,
} from "../helpers/cart-merge-postgres";

const requestedDatabaseName = process.env.DB_TEMP_NAME;

jest.mock(
  "pg-god",
  () => {
    const { Client: PgClient } = jest.requireActual(
      "pg",
    ) as typeof import("pg");

    const safe = (name: unknown) => {
      if (
        typeof name !== "string" ||
        !/^p12_disposable_[a-z0-9_]+$/.test(name)
      ) {
        throw new Error("P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN");
      }
      return name;
    };

    const maintenance = () =>
      new PgClient({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: "postgres",
      });

    return {
      createDatabase: async ({ databaseName }: { databaseName: string }) => {
        const name = safe(databaseName);
        const client = maintenance();
        await client.connect();
        try {
          const found = await client.query(
            "select 1 from pg_database where datname = $1",
            [name],
          );
          if (found.rowCount === 0) {
            await client.query(`create database "${name}"`);
          }
        } finally {
          await client.end();
        }
      },
      dropDatabase: async ({ databaseName }: { databaseName: string }) => {
        const name = safe(databaseName);
        const client = maintenance();
        await client.connect();
        try {
          await client.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
            [name],
          );
          await client.query(`drop database if exists "${name}"`);
        } finally {
          await client.end();
        }
      },
    };
  },
  { virtual: true },
);

if (!requestedDatabaseName) {
  describe("Cart merge Wave 0 PostgreSQL", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(() =>
        requireDisposableDatabaseName(requestedDatabaseName),
      ).toThrow("P12_DISPOSABLE_DATABASE_NAME_REQUIRED");
    });
  });
} else {
  const disposableEnvironment = buildDisposableMedusaEnvironment(process.env);
  assertDisposableMedusaEnvironment(disposableEnvironment);

  for (const [name, value] of Object.entries(disposableEnvironment)) {
    if (typeof value === "string") process.env[name] = value;
  }

  const databaseName = requireDisposableDatabaseName(requestedDatabaseName);

  resetMikroOrmGlobalMetadataForTestRealm();

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      jest.setTimeout(180_000);

      const connection =
        dbConnection as unknown as CartMergePostgresRawConnection;

      const ensureBrazilRegion = async (): Promise<string> => {
        const existing = await connection.raw(
          "select id from region where currency_code = ? and deleted_at is null limit 1",
          ["brl"],
        );
        const existingId = existing.rows?.[0]?.id;
        if (existingId) return String(existingId);
        await createRegionsWorkflow(getContainer()).run({
          input: {
            regions: [
              {
                name: "P16 Cart Merge Brazil",
                currency_code: "brl",
                countries: ["br"],
                payment_providers: ["pp_system_default"],
              },
            ],
          },
        });
        const created = await connection.raw(
          "select id from region where currency_code = ? and deleted_at is null limit 1",
          ["brl"],
        );
        const createdId = created.rows?.[0]?.id;
        if (!createdId)
          throw new Error("P16_REAL_PENDING_REVIEW_REGION_MISSING");
        return String(createdId);
      };

      const runMerge = async (
        container: any,
        fixture: Awaited<ReturnType<typeof createRealCartMergeFixture>>,
        overrides: Record<string, unknown> = {},
      ) => {
        const response = createCartMergeResponse();
        await mergeCart(
          createCartMergeRequest(fixture, container, overrides) as never,
          response as never,
        );
        return response;
      };

      const scopedContainerWithObservedLinkCreates = (
        container: any,
        createdLinkInputs: unknown[],
      ) => {
        const realLink = container.resolve(
          ContainerRegistrationKeys.LINK,
        ) as {
          create(input: unknown): Promise<unknown>;
        };
        const scope = Object.create(container);
        const resolve = container.resolve.bind(container);
        scope.resolve = (key: string) => {
          if (key === ContainerRegistrationKeys.LINK) {
            return {
              create: async (input: unknown) => {
                createdLinkInputs.push(input);
                return realLink.create(input);
              },
            };
          }
          return resolve(key);
        };
        return scope;
      };

      const readCartRow = async (cartId: string) => {
        const result = await connection.raw(
          `
            select
              c.id,
              c.customer_id,
              c.metadata,
              v.version,
              coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'variant_id', li.variant_id,
                    'quantity', li.quantity
                  ) order by li.variant_id
                )
                from cart_line_item li
                where li.cart_id = c.id and li.deleted_at is null
              ), '[]'::jsonb) as line_items
            from cart c
            left join store_resource_version v
              on v.resource_type = 'cart'
             and v.resource_id = c.id
             and v.deleted_at is null
            where c.id = ? and c.deleted_at is null
          `,
          [cartId],
        );
        const row = result.rows?.[0];
        if (!row) throw new Error(`P16_REAL_CART_ROW_MISSING:${cartId}`);
        return row;
      };

      const readLedgerCounts = async (fixture: {
        guestCartId: string;
        customerCartId?: string;
      }) => {
        const result = await connection.raw(
          `
            select
              (
                select count(*)::int
                from cart_merge_result
                where guest_cart_id = ? and deleted_at is null
              ) as result_count,
              (
                select count(*)::int
                from cart_review
                where cart_id = ? and deleted_at is null
              ) as review_count
          `,
          [fixture.guestCartId, fixture.customerCartId ?? fixture.guestCartId],
        );
        const row = result.rows?.[0];
        return {
          resultCount: Number(row?.result_count ?? 0),
          reviewCount: Number(row?.review_count ?? 0),
        };
      };

      it("aplica o schema frozen real com tabelas, CHECKs e índices aprovados", async () => {
        expect(process.env.DB_HOST).toMatch(/^(localhost|127\.0\.0\.1|::1)$/);
        expect(process.env.DB_TEMP_NAME).toMatch(/^p12_disposable_[a-z0-9_]+$/);
        expect(process.env.DATABASE_URL).toMatch(
          /@(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//,
        );
        expect(process.env.REDIS_URL).toBe("");
        expect(process.env.CACHE_REDIS_URL).toBe("");
        expect(process.env.EVENTS_REDIS_URL).toBe("");
        expect(process.env.WE_REDIS_URL).toBe("");

        const catalog = await readCartMergeSchemaCatalog(connection);

        expect(catalog.tables).toEqual([
          "cart_merge_result",
          "cart_review",
          "customer_cart_authority",
        ]);

        const columnSignatures = catalog.columns.map(
          ({ table_name, column_name, udt_name, is_nullable }) =>
            `${table_name}.${column_name}:${udt_name}:${is_nullable}`,
        );
        expect(columnSignatures.sort()).toEqual(
          [
            "cart_merge_result.id:text:NO",
            "cart_merge_result.idempotency_record_id:text:NO",
            "cart_merge_result.customer_id:text:NO",
            "cart_merge_result.guest_cart_id:text:NO",
            "cart_merge_result.customer_cart_id:text:YES",
            "cart_merge_result.canonical_cart_id:text:NO",
            "cart_merge_result.capability_id:text:NO",
            "cart_merge_result.capability_hash:text:YES",
            "cart_merge_result.request_fingerprint:text:NO",
            "cart_merge_result.guest_version_before:int4:NO",
            "cart_merge_result.customer_version_before:int4:YES",
            "cart_merge_result.guest_version_after:int4:NO",
            "cart_merge_result.customer_version_after:int4:YES",
            "cart_merge_result.outcome:text:NO",
            "cart_merge_result.rejected_items:jsonb:NO",
            "cart_merge_result.review_id:text:YES",
            "cart_merge_result.review_ref:text:YES",
            "cart_merge_result.original_public_cart_snapshot:jsonb:NO",
            "cart_merge_result.original_review_snapshot:jsonb:NO",
            "cart_merge_result.original_etag:text:NO",
            "cart_merge_result.expires_at:timestamptz:NO",
            "cart_merge_result.created_at:timestamptz:NO",
            "cart_merge_result.updated_at:timestamptz:NO",
            "cart_merge_result.deleted_at:timestamptz:YES",
            "cart_review.id:text:NO",
            "cart_review.cart_id:text:NO",
            "cart_review.review_ref:text:NO",
            "cart_review.merge_result_id:text:NO",
            "cart_review.produced_cart_version:int4:NO",
            "cart_review.status:text:NO",
            "cart_review.rejected_items:jsonb:NO",
            "cart_review.acknowledged_at:timestamptz:YES",
            "cart_review.created_at:timestamptz:NO",
            "cart_review.updated_at:timestamptz:NO",
            "cart_review.deleted_at:timestamptz:YES",
            "customer_cart_authority.id:text:NO",
            "customer_cart_authority.customer_id:text:NO",
            "customer_cart_authority.cart_id:text:NO",
            "customer_cart_authority.state:text:NO",
            "customer_cart_authority.created_at:timestamptz:NO",
            "customer_cart_authority.updated_at:timestamptz:NO",
            "customer_cart_authority.deleted_at:timestamptz:YES",
          ].sort(),
        );

        const checksByTable = new Map<string, string[]>();
        for (const check of catalog.checks) {
          const checks = checksByTable.get(check.table_name) ?? [];
          checks.push(check.definition);
          checksByTable.set(check.table_name, checks);
        }
        expect(checksByTable.get("cart_merge_result")).toHaveLength(1);
        expect(checksByTable.get("cart_merge_result")?.[0]).toMatch(
          /outcome.*MERGED.*MERGED_PARTIAL.*GUEST_CART_ATTACHED.*CUSTOMER_CART_PRESERVED.*NO_ITEMS/i,
        );
        expect(checksByTable.get("cart_review")).toHaveLength(1);
        expect(checksByTable.get("cart_review")?.[0]).toMatch(
          /status.*pending.*acknowledged/i,
        );
        expect(checksByTable.get("customer_cart_authority")).toHaveLength(1);
        expect(checksByTable.get("customer_cart_authority")?.[0]).toMatch(
          /state.*active.*superseded/i,
        );

        const indexNames = catalog.indexes
          .map((index) => index.index_name)
          .sort();
        expect(indexNames).toEqual(
          [
            "IDX_cart_merge_result_canonical_cart_id",
            "IDX_cart_merge_result_customer_id",
            "IDX_cart_merge_result_deleted_at",
            "IDX_cart_merge_result_expires_at",
            "IDX_cart_merge_result_guest_cart_id",
            "IDX_cart_review_cart_status",
            "IDX_cart_review_deleted_at",
            "IDX_customer_cart_authority_deleted_at",
            "IDX_customer_cart_authority_state",
            "UQ_cart_merge_result_idempotency_record",
            "UQ_cart_review_merge_result",
            "UQ_cart_review_pending_cart",
            "UQ_cart_review_review_ref",
            "UQ_customer_cart_authority_active_cart",
            "UQ_customer_cart_authority_active_customer",
            "cart_merge_result_pkey",
            "cart_review_pkey",
            "customer_cart_authority_pkey",
          ].sort(),
        );

        const indexesByName = new Map(
          catalog.indexes.map((index) => [index.index_name, index]),
        );
        for (const name of [
          "UQ_cart_merge_result_idempotency_record",
          "UQ_cart_review_review_ref",
          "UQ_cart_review_merge_result",
        ]) {
          expect(indexesByName.get(name)).toEqual(
            expect.objectContaining({ is_unique: true, predicate: null }),
          );
        }
        expect(
          indexesByName.get("UQ_customer_cart_authority_active_customer"),
        ).toEqual(
          expect.objectContaining({
            is_unique: true,
            predicate: expect.stringMatching(
              /state\s*=\s*'active'.*deleted_at\s+IS\s+NULL/i,
            ),
          }),
        );
        expect(
          indexesByName.get("UQ_customer_cart_authority_active_cart"),
        ).toEqual(
          expect.objectContaining({
            is_unique: true,
            predicate: expect.stringMatching(
              /state\s*=\s*'active'.*deleted_at\s+IS\s+NULL/i,
            ),
          }),
        );
        expect(indexesByName.get("UQ_cart_review_pending_cart")).toEqual(
          expect.objectContaining({
            is_unique: true,
            predicate: expect.stringMatching(
              /status\s*=\s*'pending'.*deleted_at\s+IS\s+NULL/i,
            ),
          }),
        );
        for (const index of catalog.indexes) {
          expect(index.definition).not.toMatch(/FOREIGN KEY|REFERENCES/i);
        }
      });

      it("falha fechado no audit histórico e não materializa authority ambígua", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0501_collision",
        );
        const beforeOrders = await countPersistedOrders(connection);
        const candidateIds = await createHistoricalCustomerCartCandidates(
          container,
          fixture.customerId,
          fixture.identity,
        );
        expect(candidateIds).toHaveLength(2);

        const audit = await auditCustomerCartBackfill(
          connection,
          fixture.customerId,
        );
        expect(audit).toEqual({
          status: "ambiguous",
          candidateCount: 2,
          selectedCartId: null,
          report: {
            code: "P16_CUSTOMER_CART_BACKFILL_AMBIGUOUS",
            candidateCount: 2,
          },
        });
        expect(() => assertCustomerCartBackfillFailClosed(audit)).toThrow(
          "P16_CUSTOMER_CART_BACKFILL_AMBIGUOUS",
        );
        expect(
          await countCustomerCartAuthorityRows(connection, fixture.customerId),
        ).toBe(0);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("faz o PostgreSQL rejeitar uniques globais e uniques parciais de invariantes", async () => {
        const prefix = "p16_task0501_constraints";
        try {
          await insertCartMergeResultProbe(connection, {
            id: `${prefix}_result_a`,
            idempotencyRecordId: `${prefix}_idempotency_shared`,
          });
          await expect(
            insertCartMergeResultProbe(connection, {
              id: `${prefix}_result_b`,
              idempotencyRecordId: `${prefix}_idempotency_shared`,
            }),
          ).rejects.toMatchObject({ code: "23505" });

          await insertCartReviewProbe(connection, {
            id: `${prefix}_review_a`,
            cartId: `${prefix}_cart_a`,
            reviewRef: `${prefix}_review_ref_shared`,
            mergeResultId: `${prefix}_merge_a`,
          });
          await expect(
            insertCartReviewProbe(connection, {
              id: `${prefix}_review_b`,
              cartId: `${prefix}_cart_b`,
              reviewRef: `${prefix}_review_ref_shared`,
              mergeResultId: `${prefix}_merge_b`,
            }),
          ).rejects.toMatchObject({ code: "23505" });

          await insertCartReviewProbe(connection, {
            id: `${prefix}_review_c`,
            cartId: `${prefix}_cart_c`,
            reviewRef: `${prefix}_review_ref_c`,
            mergeResultId: `${prefix}_merge_shared`,
          });
          await expect(
            insertCartReviewProbe(connection, {
              id: `${prefix}_review_d`,
              cartId: `${prefix}_cart_d`,
              reviewRef: `${prefix}_review_ref_d`,
              mergeResultId: `${prefix}_merge_shared`,
            }),
          ).rejects.toMatchObject({ code: "23505" });

          await insertCartReviewProbe(connection, {
            id: `${prefix}_review_e`,
            cartId: `${prefix}_pending_cart`,
            reviewRef: `${prefix}_review_ref_e`,
            mergeResultId: `${prefix}_merge_e`,
          });
          await expect(
            insertCartReviewProbe(connection, {
              id: `${prefix}_review_f`,
              cartId: `${prefix}_pending_cart`,
              reviewRef: `${prefix}_review_ref_f`,
              mergeResultId: `${prefix}_merge_f`,
            }),
          ).rejects.toMatchObject({ code: "23505" });

          await insertCustomerCartAuthorityProbe(connection, {
            id: `${prefix}_authority_a`,
            customerId: `${prefix}_customer_shared`,
            cartId: `${prefix}_authority_cart_a`,
          });
          await expect(
            insertCustomerCartAuthorityProbe(connection, {
              id: `${prefix}_authority_b`,
              customerId: `${prefix}_customer_shared`,
              cartId: `${prefix}_authority_cart_b`,
            }),
          ).rejects.toMatchObject({ code: "23505" });

          await insertCustomerCartAuthorityProbe(connection, {
            id: `${prefix}_authority_c`,
            customerId: `${prefix}_customer_c`,
            cartId: `${prefix}_authority_cart_shared`,
          });
          await expect(
            insertCustomerCartAuthorityProbe(connection, {
              id: `${prefix}_authority_d`,
              customerId: `${prefix}_customer_d`,
              cartId: `${prefix}_authority_cart_shared`,
            }),
          ).rejects.toMatchObject({ code: "23505" });
        } finally {
          await cleanupCartMergeSchemaProbes(connection, prefix);
        }
      });

      it("persiste receipt, authority e terminal state no mesmo transaction manager", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0503_commit",
        );
        const beforeOrders = await countPersistedOrders(connection);
        const beforeState = await readRealCartMergeState(connection, fixture);

        expect(beforeState.customer_id).toBeNull();
        expect(beforeState.version).toBe(fixture.guestVersion);
        expect(beforeState.capability_status).toBe("active");
        expect(beforeState.idempotency_state).toBeNull();
        expect(
          await countUsableCustomerCarts(connection, fixture.customerId),
        ).toBe(0);

        const cartModule = container.resolve(Modules.CART) as unknown as {
          baseRepository_: {
            transaction: (...args: any[]) => Promise<unknown>;
          };
        };
        const transaction = instrumentRealCartMergeTransaction(
          cartModule as any,
        );
        const response = createCartMergeResponse();

        try {
          await mergeCart(
            createCartMergeRequest(fixture, container) as never,
            response as never,
          );
        } finally {
          transaction.restore();
        }

        expect(container.resolve(CART_MERGE_MODULE)).toEqual(
          expect.objectContaining({ executeCartMerge: expect.any(Function) }),
        );
        expect(response.statusCode).toBe(200);
        expect(response.headers.etag).toBe('"2"');
        expect((response.body as any).outcome).toBe("GUEST_CART_ATTACHED");
        expect((response.body as any).cart.id).toBe(fixture.guestCartId);
        expect((response.body as any).cart.customer.id).toBe(
          fixture.customerId,
        );

        const afterState = await readRealCartMergeState(connection, fixture);
        expect(afterState.customer_id).toBe(fixture.customerId);
        expect(afterState.version).toBe(fixture.guestVersion + 1);
        expect(afterState.capability_status).toBe("consumed");
        expect(afterState.capability_consumed_at).not.toBeNull();
        expect(afterState.idempotency_state).toBe("completed");
        expect(afterState.result_id).toMatch(/^cmres_/);
        expect(afterState.idempotency_result_id).toBe(afterState.result_id);
        expect(afterState.result_outcome).toBe("GUEST_CART_ATTACHED");
        expect(afterState.result_etag).toBe('"2"');
        expect(afterState.authority_state).toBe("active");
        expect(afterState.authority_customer_id).toBe(fixture.customerId);
        expect(afterState.authority_cart_id).toBe(fixture.guestCartId);
        expect(afterState.review_status).toBeNull();

        const receiptQuery = await connection.raw(
          `
            select
              r.id,
              r.idempotency_record_id,
              r.customer_id,
              r.guest_cart_id,
              r.customer_cart_id,
              r.canonical_cart_id,
              r.capability_id,
              r.capability_hash,
              r.request_fingerprint,
              r.guest_version_before,
              r.guest_version_after,
              r.outcome,
              r.rejected_items,
              r.review_id,
              r.review_ref,
              r.original_public_cart_snapshot,
              r.original_review_snapshot,
              r.original_etag,
              r.expires_at::text as result_expires_at,
              i.expires_at::text as idempotency_expires_at
            from cart_merge_result r
            join store_idempotency_record i on i.id = r.idempotency_record_id
            where r.id = ?
          `,
          [afterState.result_id],
        );
        const receipt = receiptQuery.rows?.[0];
        expect(receipt).toEqual(
          expect.objectContaining({
            id: afterState.result_id,
            idempotency_record_id: expect.any(String),
            customer_id: fixture.customerId,
            guest_cart_id: fixture.guestCartId,
            customer_cart_id: null,
            canonical_cart_id: fixture.guestCartId,
            capability_id: fixture.capabilityId,
            guest_version_before: fixture.guestVersion,
            guest_version_after: fixture.guestVersion + 1,
            outcome: "GUEST_CART_ATTACHED",
            rejected_items: [],
            review_id: null,
            review_ref: null,
            original_etag: '"2"',
          }),
        );
        expect(receipt?.capability_hash).not.toBe(fixture.capabilityToken);
        expect(receipt?.request_fingerprint).not.toContain(
          fixture.capabilityToken,
        );
        expect(receipt?.request_fingerprint).not.toContain(
          fixture.idempotencyKey,
        );
        expect(receipt?.original_public_cart_snapshot).toBeTruthy();
        expect(receipt?.original_review_snapshot).toBeTruthy();
        expect(receipt?.result_expires_at).toBe(
          receipt?.idempotency_expires_at,
        );
        expect(
          await countUsableCustomerCarts(connection, fixture.customerId),
        ).toBe(1);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);

        const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
          graph(input: {
            entity: string;
            fields: string[];
            filters: Record<string, unknown>;
          }): Promise<{ data: Array<Record<string, any>> }>;
        };
        const resultGraph = await query.graph({
          entity: "cart_merge_result",
          fields: [
            "id",
            "store_idempotency.id",
            "merge_customer.id",
            "guest_cart.id",
            "canonical_cart.id",
            "guest_capability.id",
          ],
          filters: { id: afterState.result_id },
        });
        expect(resultGraph.data).toHaveLength(1);
        expect(resultGraph.data[0]).toEqual(
          expect.objectContaining({
            id: afterState.result_id,
            store_idempotency: expect.objectContaining({
              id: receipt?.idempotency_record_id,
            }),
            merge_customer: expect.objectContaining({
              id: fixture.customerId,
            }),
            guest_cart: expect.objectContaining({ id: fixture.guestCartId }),
            canonical_cart: expect.objectContaining({
              id: fixture.guestCartId,
            }),
            guest_capability: expect.objectContaining({
              id: fixture.capabilityId,
            }),
          }),
        );

        expect(transaction.transactionIds).toHaveLength(2);
        expect(new Set(transaction.transactionIds).size).toBe(1);
        expect(
          new Set([
            afterState.cart_xmin,
            afterState.version_xmin,
            afterState.capability_xmin,
            afterState.idempotency_xmin,
            afterState.authority_xmin,
            afterState.result_xmin,
          ]),
        ).toEqual(new Set([transaction.transactionIds[0]]));
      });

      it("persiste MERGED_PARTIAL real com ledger e CartReview canônicos", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0707_merged_partial_ledger",
          { guestItemQuantity: 30 },
        );
        const customerCart = await createRealCustomerCartFixture(
          container,
          fixture,
          "p16_task0707_merged_partial_ledger",
          { itemQuantity: 80 },
        );
        const beforeGuest = await readRealCartMergeState(connection, fixture);
        const beforeCustomer = await readCartRow(customerCart.cartId);
        const beforeLedger = await readLedgerCounts({
          guestCartId: fixture.guestCartId,
          customerCartId: customerCart.cartId,
        });
        const beforeOrders = await countPersistedOrders(connection);

        expect(beforeGuest.line_items).toEqual([
          expect.objectContaining({
            variant_id: fixture.variantId,
            quantity: 30,
          }),
        ]);
        expect(beforeCustomer.line_items).toEqual([
          expect.objectContaining({
            variant_id: fixture.variantId,
            quantity: 80,
          }),
        ]);
        expect(beforeLedger).toEqual({ resultCount: 0, reviewCount: 0 });

        const response = await runMerge(container, fixture);
        const body = response.body as any;
        const rejectedItems = [
          {
            variantId: fixture.variantId,
            requestedQuantity: 30,
            acceptedQuantity: 19,
            rejectedQuantity: 11,
            reason: "QUANTITY_LIMIT_EXCEEDED",
          },
        ];

        expect(response.statusCode).toBe(200);
        expect(response.headers.etag).toBe(`"${customerCart.version + 1}"`);
        expect(body.outcome).toBe("MERGED_PARTIAL");
        expect(body.cart.id).toBe(customerCart.cartId);
        expect(body.cart.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variant_id: fixture.variantId,
              quantity: 99,
            }),
          ]),
        );
        expect(body.review).toEqual({
          requiresReview: true,
          reviewRef: expect.stringMatching(/^review_/),
          rejectedItems,
        });

        const afterGuest = await readRealCartMergeState(connection, fixture);
        const afterGuestRow = await readCartRow(fixture.guestCartId);
        const afterCustomer = await readCartRow(customerCart.cartId);
        const authority = await readCustomerCartCanonicalState(
          connection,
          fixture.customerId,
        );
        const receiptQuery = await connection.raw(
          `
            select
              id,
              customer_cart_id,
              canonical_cart_id,
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
              original_etag
            from cart_merge_result
            where guest_cart_id = ? and deleted_at is null
          `,
          [fixture.guestCartId],
        );
        const reviewQuery = await connection.raw(
          `
            select
              id,
              cart_id,
              review_ref,
              merge_result_id,
              produced_cart_version,
              status,
              rejected_items
            from cart_review
            where cart_id = ? and deleted_at is null
          `,
          [customerCart.cartId],
        );
        const receipt = receiptQuery.rows?.[0];
        const review = reviewQuery.rows?.[0];

        expect(afterGuest.line_items).toEqual(beforeGuest.line_items);
        expect(afterGuest.customer_id).toBeNull();
        expect(afterGuest.version).toBe(fixture.guestVersion + 1);
        expect(afterGuest.capability_status).toBe("consumed");
        expect(afterGuest.idempotency_state).toBe("completed");
        expect(afterGuest.idempotency_result_id).toBe(afterGuest.result_id);
        expect(afterGuest.result_outcome).toBe("MERGED_PARTIAL");
        expect(afterGuest.authority_state).toBeNull();
        expect(afterGuest.review_status).toBe("pending");
        expect(afterGuest.review_ref).toBe(body.review.reviewRef);
        expect(afterGuestRow.metadata).toEqual(
          expect.objectContaining({
            active_for_checkout: false,
            superseded_by_cart_id: customerCart.cartId,
          }),
        );

        expect(afterCustomer.customer_id).toBe(fixture.customerId);
        expect(afterCustomer.version).toBe(customerCart.version + 1);
        expect(afterCustomer.line_items).toEqual([
          expect.objectContaining({
            variant_id: fixture.variantId,
            quantity: 99,
          }),
        ]);
        expect(afterCustomer.version).not.toBe(beforeCustomer.version);
        expect(authority).toEqual({
          activeAuthorityRows: 1,
          activeAuthorityCartId: customerCart.cartId,
          usableCustomerCartIds: [customerCart.cartId],
        });

        expect(receiptQuery.rows).toHaveLength(1);
        expect(receipt).toEqual(
          expect.objectContaining({
            id: afterGuest.result_id,
            customer_cart_id: customerCart.cartId,
            canonical_cart_id: customerCart.cartId,
            guest_version_before: fixture.guestVersion,
            customer_version_before: customerCart.version,
            guest_version_after: fixture.guestVersion + 1,
            customer_version_after: customerCart.version + 1,
            outcome: "MERGED_PARTIAL",
            rejected_items: rejectedItems,
            review_id: expect.any(String),
            review_ref: body.review.reviewRef,
            original_public_cart_snapshot: body.cart,
            original_review_snapshot: body.review,
            original_etag: response.headers.etag,
          }),
        );
        expect(receipt?.review_id).toBe(review?.id);
        expect(receipt?.review_ref).toBe(review?.review_ref);

        expect(reviewQuery.rows).toHaveLength(1);
        expect(review).toEqual({
          id: receipt?.review_id,
          cart_id: customerCart.cartId,
          review_ref: body.review.reviewRef,
          merge_result_id: afterGuest.result_id,
          produced_cart_version: customerCart.version + 1,
          status: "pending",
          rejected_items: rejectedItems,
        });
        const pendingReviewCount = await connection.raw(
          `select count(*)::int as count from cart_review where cart_id = ? and status = 'pending' and deleted_at is null`,
          [customerCart.cartId],
        );
        expect(pendingReviewCount.rows).toEqual([{ count: 1 }]);
        expect(
          await readLedgerCounts({
            guestCartId: fixture.guestCartId,
            customerCartId: customerCart.cartId,
          }),
        ).toEqual({ resultCount: 1, reviewCount: 1 });
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("faz rollback integral no failpoint review após o write da CartReview", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0707_failpoint_review",
          { guestItemQuantity: 30 },
        );
        const customerCart = await createRealCustomerCartFixture(
          container,
          fixture,
          "p16_task0707_failpoint_review",
          { itemQuantity: 80 },
        );
        const beforeGuest = await readRealCartMergeState(connection, fixture);
        const beforeGuestRow = await readCartRow(fixture.guestCartId);
        const beforeCustomer = await readCartRow(customerCart.cartId);
        const beforeAuthority = await readCustomerCartCanonicalState(
          connection,
          fixture.customerId,
        );
        const beforeLedger = await readLedgerCounts({
          guestCartId: fixture.guestCartId,
          customerCartId: customerCart.cartId,
        });
        const beforeOrders = await countPersistedOrders(connection);
        const failpoint = createCartMergeFailpoint();
        failpoint.arm("review");
        const createdLinkInputs: unknown[] = [];
        const requestScope = scopedContainerWithObservedLinkCreates(
          container,
          createdLinkInputs,
        );
        const cartModule = container.resolve(Modules.CART) as unknown as {
          baseRepository_: {
            transaction: (...args: any[]) => Promise<unknown>;
          };
        };
        const transaction = instrumentRealCartMergeTransaction(
          cartModule as any,
          {
            failpoint,
          },
        );

        try {
          await expect(
            runMerge(requestScope, fixture, {
              cartMergeFailpoint: failpoint,
            }),
          ).rejects.toThrow("P16_CART_MERGE_FAILPOINT:review");
        } finally {
          transaction.restore();
        }

        const afterGuest = await readRealCartMergeState(connection, fixture);
        const afterGuestRow = await readCartRow(fixture.guestCartId);
        const afterCustomer = await readCartRow(customerCart.cartId);
        expect(afterGuest).toEqual(beforeGuest);
        expect(afterGuestRow).toEqual(beforeGuestRow);
        expect(afterCustomer).toEqual(beforeCustomer);
        expect(
          await readCustomerCartCanonicalState(connection, fixture.customerId),
        ).toEqual(beforeAuthority);
        expect(
          await readLedgerCounts({
            guestCartId: fixture.guestCartId,
            customerCartId: customerCart.cartId,
          }),
        ).toEqual(beforeLedger);
        expect(afterGuest.capability_status).toBe("active");
        expect(afterGuest.idempotency_state).toBeNull();
        expect(afterGuest.result_id).toBeNull();
        expect(afterGuest.review_status).toBeNull();
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
        expect(failpoint.ledger).toContain("review");
        expect(createdLinkInputs).toHaveLength(0);
        expect(transaction.transactionIds).toHaveLength(1);
      });

      it("faz rollback integral no failpoint supersede com destino Customer real", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0707_failpoint_supersede",
        );
        const customerCart = await createRealCustomerCartFixture(
          container,
          fixture,
          "p16_task0707_failpoint_supersede",
        );
        const beforeGuest = await readRealCartMergeState(connection, fixture);
        const beforeGuestRow = await readCartRow(fixture.guestCartId);
        const beforeCustomer = await readCartRow(customerCart.cartId);
        const beforeAuthority = await readCustomerCartCanonicalState(
          connection,
          fixture.customerId,
        );
        const beforeLedger = await readLedgerCounts({
          guestCartId: fixture.guestCartId,
          customerCartId: customerCart.cartId,
        });
        const beforeOrders = await countPersistedOrders(connection);
        const failpoint = createCartMergeFailpoint();
        failpoint.arm("supersede");
        const cartModule = container.resolve(Modules.CART) as unknown as {
          baseRepository_: {
            transaction: (...args: any[]) => Promise<unknown>;
          };
        };
        const transaction = instrumentRealCartMergeTransaction(
          cartModule as any,
          {
            failpoint,
          },
        );

        try {
          await expect(
            runMerge(container, fixture, { cartMergeFailpoint: failpoint }),
          ).rejects.toThrow("P16_CART_MERGE_FAILPOINT:supersede");
        } finally {
          transaction.restore();
        }

        const afterGuest = await readRealCartMergeState(connection, fixture);
        const afterGuestRow = await readCartRow(fixture.guestCartId);
        const afterCustomer = await readCartRow(customerCart.cartId);
        expect(afterGuest).toEqual(beforeGuest);
        expect(afterGuestRow).toEqual(beforeGuestRow);
        expect(afterCustomer).toEqual(beforeCustomer);
        expect(
          await readCustomerCartCanonicalState(connection, fixture.customerId),
        ).toEqual(beforeAuthority);
        expect(
          await readLedgerCounts({
            guestCartId: fixture.guestCartId,
            customerCartId: customerCart.cartId,
          }),
        ).toEqual(beforeLedger);
        expect(afterGuestRow.metadata).toEqual(beforeGuestRow.metadata);
        expect(afterGuest.capability_status).toBe("active");
        expect(afterGuest.idempotency_state).toBeNull();
        expect(afterGuest.result_id).toBeNull();
        expect(afterGuest.review_status).toBeNull();
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
        expect(failpoint.ledger).toContain("supersede");
        expect(transaction.transactionIds).toHaveLength(1);
      });

      it("prova mutation guest serial real com addToCartWorkflow nativo e QUERY resolvido", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0703_guest_mutation_smoke",
        );
        const beforeState = await readRealCartMergeState(connection, fixture);
        const beforeOrders = await countPersistedOrders(connection);
        const requestScope = container.createScope();
        const query = requestScope.resolve(ContainerRegistrationKeys.QUERY) as {
          graph?: unknown;
        };
        expect(typeof query.graph).toBe("function");

        const cartModule = container.resolve(Modules.CART) as unknown as {
          baseRepository_: {
            transaction: (...args: any[]) => Promise<unknown>;
          };
        };
        const transaction = instrumentRealCartMergeTransaction(
          cartModule as any,
        );
        const response = createCartMergeResponse();

        try {
          await addGuestLineItem(
            {
              method: "POST",
              url: `/store/carts/${fixture.guestCartId}/line-items`,
              originalUrl: `/store/carts/${fixture.guestCartId}/line-items`,
              params: { id: fixture.guestCartId },
              body: { variant_id: fixture.secondaryVariantId, quantity: 1 },
              headers: {
                "idempotency-key": "cart-merge-p16-task0703-guest-smoke",
                "if-match": `"${fixture.guestVersion}"`,
                "x-indicio-guest-cart-token": fixture.capabilityToken,
              },
              scope: requestScope,
            } as never,
            response as never,
          );
        } finally {
          transaction.restore();
        }

        expect(response.statusCode).toBe(200);
        expect(response.headers.etag).toBe(`\"${fixture.guestVersion + 1}\"`);
        expect((response.body as any).cart.id).toBe(fixture.guestCartId);
        const afterState = await readRealCartMergeState(connection, fixture);
        expect(afterState.customer_id).toBeNull();
        expect(afterState.version).toBe(fixture.guestVersion + 1);
        expect(afterState.line_items).toHaveLength(
          beforeState.line_items.length + 1,
        );
        expect(afterState.line_items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variant_id: fixture.secondaryVariantId,
              quantity: 1,
            }),
          ]),
        );
        expect(afterState.capability_status).toBe("active");
        expect(afterState.capability_consumed_at).toBeNull();
        const capability = await connection.raw(
          "select token_hash from guest_cart_capability where id = ? and deleted_at is null",
          [fixture.capabilityId],
        );
        expect(capability.rows?.[0]?.token_hash).not.toBe(
          fixture.capabilityToken,
        );
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);

        expect(transaction.transactionIds).toHaveLength(2);
        expect(transaction.transactionIds[0]).toMatch(/^\d+$/);
        expect(new Set(transaction.transactionIds).size).toBe(1);
      });

      it("reproduz somente o receipt original depois de mudança no cart atual", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0503_replay_original",
        );
        const first = await runMerge(container, fixture);
        const committedState = await readRealCartMergeState(
          connection,
          fixture,
        );
        const beforeOrders = await countPersistedOrders(connection);
        const originalBody = structuredClone(first.body);
        const originalEtag = first.headers.etag;

        await connection.raw("update cart set email = ? where id = ?", [
          `changed-after-commit@cart-merge.test`,
          fixture.guestCartId,
        ]);
        const mutatedState = await readRealCartMergeState(connection, fixture);

        const replay = await runMerge(container, fixture);
        const replayState = await readRealCartMergeState(connection, fixture);

        expect(replay.statusCode).toBe(200);
        expect(replay.headers.etag).toBe(originalEtag);
        expect(replay.body).toEqual(originalBody);
        expect(mutatedState.cart_xmin).not.toBe(committedState.cart_xmin);
        expect(replayState).toEqual(mutatedState);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("rejeita replay com If-Match divergente sem write nem Order", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0503_replay_version_conflict",
        );
        await runMerge(container, fixture);

        const beforeConflict = await readRealCartMergeState(
          connection,
          fixture,
        );
        const beforeOrders = await countPersistedOrders(connection);
        const originalRequest = createCartMergeRequest(fixture, container);

        await expect(
          runMerge(container, fixture, {
            headers: {
              ...originalRequest.headers,
              "if-match": `"${fixture.guestVersion + 100}"`,
            },
          }),
        ).rejects.toMatchObject({
          code: "IDEMPOTENCY_KEY_REUSE_CONFLICT",
          statusCode: 409,
          status: 409,
        });

        expect(await readRealCartMergeState(connection, fixture)).toEqual(
          beforeConflict,
        );
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("confirma NO_ITEMS sem tocar cart, lines, version, review ou capability", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0503_no_items",
          { withItems: false },
        );
        const beforeState = await readRealCartMergeState(connection, fixture);
        const beforeOrders = await countPersistedOrders(connection);
        expect(beforeState.line_items).toEqual([]);
        const first = await runMerge(container, fixture);
        const afterFirst = await readRealCartMergeState(connection, fixture);

        expect(first.statusCode).toBe(200);
        expect(first.headers.etag).toBe(`"${fixture.guestVersion}"`);
        expect((first.body as any).outcome).toBe("NO_ITEMS");
        expect((first.body as any).cart.items).toEqual([]);
        expect(afterFirst.customer_id).toBe(beforeState.customer_id);
        expect(afterFirst.line_items).toEqual(beforeState.line_items);
        expect(afterFirst.cart_xmin).toBe(beforeState.cart_xmin);
        expect(afterFirst.version).toBe(beforeState.version);
        expect(afterFirst.version_xmin).toBe(beforeState.version_xmin);
        expect(afterFirst.capability_status).toBe("active");
        expect(afterFirst.capability_consumed_at).toBeNull();
        expect(afterFirst.authority_state).toBeNull();
        expect(afterFirst.review_status).toBeNull();
        expect(afterFirst.result_id).toMatch(/^cmres_/);
        expect(afterFirst.idempotency_state).toBe("completed");
        expect(afterFirst.idempotency_result_id).toBe(afterFirst.result_id);
        expect(afterFirst.result_outcome).toBe("NO_ITEMS");
        expect(afterFirst.result_etag).toBe(`"${fixture.guestVersion}"`);

        const second = await runMerge(container, fixture);
        const afterReplay = await readRealCartMergeState(connection, fixture);
        expect(second.body).toEqual(first.body);
        expect(second.headers.etag).toBe(first.headers.etag);
        expect(afterReplay).toEqual(afterFirst);
        expect(
          await countUsableCustomerCarts(connection, fixture.customerId),
        ).toBe(0);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it.each([
        "cart",
        "invalidation",
        "version",
        "association",
        "result",
        "capability_consume",
        "idempotency_completion",
      ])("faz rollback integral no failpoint pós-write %s", async (point) => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          `p16_task0503_failpoint_${point}`,
        );
        const beforeState = await readRealCartMergeState(connection, fixture);
        const beforeOrders = await countPersistedOrders(connection);
        const failpoint = createCartMergeFailpoint();
        failpoint.arm(point);
        const cartModule = container.resolve(Modules.CART) as unknown as {
          baseRepository_: {
            transaction: (...args: any[]) => Promise<unknown>;
          };
        };
        const transaction = instrumentRealCartMergeTransaction(
          cartModule as any,
          {
            failpoint,
          },
        );

        try {
          await expect(
            runMerge(container, fixture, { cartMergeFailpoint: failpoint }),
          ).rejects.toThrow(`P16_CART_MERGE_FAILPOINT:${point}`);
        } finally {
          transaction.restore();
        }

        const afterState = await readRealCartMergeState(connection, fixture);
        expect(afterState).toEqual(beforeState);
        expect(
          await countUsableCustomerCarts(connection, fixture.customerId),
        ).toBe(0);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
        expect(failpoint.ledger).toContain(point);
        expect(transaction.transactionIds).toHaveLength(1);
      });

      it("serializa active-vs-active em workers reais e materializa uma authority", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0602_active_active",
          { withItems: false },
        );
        await ensureBrazilRegion();
        const beforeOrders = await countPersistedOrders(connection);

        const race = await runCartMergeRace(
          process.env.DATABASE_URL!,
          "active",
          "active",
          fixture,
          fixture,
          "p16-task0602-active-a",
          "p16-task0602-active-b",
        );
        expect(race.lockTxids).toEqual([
          expect.stringMatching(/^\d+$/),
          expect.stringMatching(/^\d+$/),
        ]);
        expect(new Set(race.lockTxids).size).toBe(2);
        expect(race.workers.map((worker) => worker.statusCode).sort()).toEqual([
          200, 201,
        ]);
        expect(race.workers[0]?.cartId).toBe(race.workers[1]?.cartId);

        const finalState = await readCustomerCartCanonicalState(
          connection,
          fixture.customerId,
        );
        expect(finalState.activeAuthorityRows).toBe(1);
        expect(finalState.usableCustomerCartIds).toHaveLength(1);
        expect(finalState.activeAuthorityCartId).toBe(
          finalState.usableCustomerCartIds[0],
        );
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("serializa active-vs-merge e deixa o perdedor reler a authority", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0602_active_merge",
        );
        const beforeOrders = await countPersistedOrders(connection);

        const race = await runCartMergeRace(
          process.env.DATABASE_URL!,
          "active",
          "merge",
          fixture,
          fixture,
          "p16-task0602-active-merge-active",
          "p16-task0602-active-merge-merge",
        );
        const activeResult = race.workers.find(
          (worker) => worker.operation === "active",
        )!;
        const mergeResult = race.workers.find(
          (worker) => worker.operation === "merge",
        )!;

        expect(
          [activeResult.statusCode, mergeResult.statusCode].sort(),
        ).toEqual(activeResult.statusCode === 201 ? [201, 409] : [200, 200]);
        if (activeResult.statusCode === 201) {
          expect(mergeResult.code).toBe(
            "CART_MERGE_CUSTOMER_DESTINATION_UNSUPPORTED",
          );
        } else {
          expect(mergeResult.outcome).toBe("GUEST_CART_ATTACHED");
          expect(mergeResult.statusCode).toBe(200);
          expect(activeResult.statusCode).toBe(200);
        }

        const finalState = await readCustomerCartCanonicalState(
          connection,
          fixture.customerId,
        );
        expect(finalState.activeAuthorityRows).toBe(1);
        expect(finalState.usableCustomerCartIds).toHaveLength(1);
        expect(finalState.activeAuthorityCartId).toBe(
          finalState.usableCustomerCartIds[0],
        );
        const mergeState = await readRealCartMergeState(connection, fixture);
        if (mergeResult.statusCode === 200) {
          expect(mergeState.customer_id).toBe(fixture.customerId);
          expect(mergeState.capability_status).toBe("consumed");
          expect(mergeState.idempotency_state).toBe("completed");
          expect(mergeState.result_outcome).toBe("GUEST_CART_ATTACHED");
          expect(mergeState.review_status).toBeNull();
        } else {
          expect(mergeState.customer_id).toBeNull();
          expect(mergeState.capability_status).toBe("active");
          expect(mergeState.idempotency_state).toBeNull();
          expect(mergeState.result_id).toBeNull();
          expect(mergeState.review_status).toBeNull();
        }
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("serializa merge-vs-merge com destino Customer real e não herda replay por key diferente", async () => {
        const container = getContainer();
        const firstFixture = await createRealCartMergeFixture(
          container,
          "p16_task0602_merge_merge_a",
        );
        const secondFixture = await createRealCartMergeFixture(
          container,
          "p16_task0602_merge_merge_b",
          { customerId: firstFixture.customerId },
        );
        const beforeOrders = await countPersistedOrders(connection);

        const race = await runCartMergeRace(
          process.env.DATABASE_URL!,
          "merge",
          "merge",
          firstFixture,
          secondFixture,
          "p16-task0602-merge-a",
          "p16-task0602-merge-b",
        );
        expect(race.workers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              statusCode: 200,
              outcome: "GUEST_CART_ATTACHED",
            }),
            expect.objectContaining({ statusCode: 200, outcome: "MERGED" }),
          ]),
        );

        const attached = race.workers.find(
          (worker) => worker.outcome === "GUEST_CART_ATTACHED",
        )!;
        const merged = race.workers.find(
          (worker) => worker.outcome === "MERGED",
        )!;
        const attachedFixture =
          attached.role === "A" ? firstFixture : secondFixture;
        const mergedFixture =
          merged.role === "A" ? firstFixture : secondFixture;
        expect(attached.cartId).toBe(attachedFixture.guestCartId);
        expect(merged.cartId).toBe(attachedFixture.guestCartId);

        const attachedState = await readRealCartMergeState(
          connection,
          attachedFixture,
        );
        const mergedState = await readRealCartMergeState(
          connection,
          mergedFixture,
        );
        expect(attachedState.customer_id).toBe(firstFixture.customerId);
        expect(attachedState.capability_status).toBe("consumed");
        expect(attachedState.idempotency_state).toBe("completed");
        expect(attachedState.result_outcome).toBe("GUEST_CART_ATTACHED");
        expect(attachedState.customer_version_before).toBeNull();
        expect(attachedState.customer_version_after).toBeNull();
        expect(attachedState.version).toBe(attachedFixture.guestVersion + 2);
        expect(attachedState.authority_state).toBe("active");
        expect(attachedState.authority_customer_id).toBe(
          firstFixture.customerId,
        );
        expect(attachedState.authority_cart_id).toBe(
          attachedFixture.guestCartId,
        );
        expect(attachedState.review_status).toBeNull();
        expect(attachedState.line_items).toHaveLength(2);
        expect(attachedState.line_items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variant_id: attachedFixture.variantId,
              quantity: 1,
            }),
            expect.objectContaining({
              variant_id: mergedFixture.variantId,
              quantity: 1,
            }),
          ]),
        );

        expect(mergedState.customer_id).toBeNull();
        expect(mergedState.capability_status).toBe("consumed");
        expect(mergedState.idempotency_state).toBe("completed");
        expect(mergedState.result_outcome).toBe("MERGED");
        expect(mergedState.customer_version_before).toBe(
          attachedFixture.guestVersion + 1,
        );
        expect(mergedState.customer_version_after).toBe(
          attachedFixture.guestVersion + 2,
        );
        expect(mergedState.version).toBe(mergedFixture.guestVersion + 1);
        expect(mergedState.authority_state).toBeNull();
        expect(mergedState.authority_customer_id).toBeNull();
        expect(mergedState.authority_cart_id).toBeNull();
        expect(mergedState.review_status).toBeNull();
        expect(mergedState.line_items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variant_id: mergedFixture.variantId,
              quantity: 1,
            }),
          ]),
        );
        expect(
          new Set([attachedState.result_id, mergedState.result_id]).size,
        ).toBe(2);

        const finalState = await readCustomerCartCanonicalState(
          connection,
          firstFixture.customerId,
        );
        expect(finalState.activeAuthorityRows).toBe(1);
        expect(finalState.usableCustomerCartIds).toEqual([
          attachedFixture.guestCartId,
        ]);
        expect(finalState.activeAuthorityCartId).toBe(
          attachedFixture.guestCartId,
        );
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);

        const beforeDifferentKey = await readRealCartMergeState(
          connection,
          mergedFixture,
        );
        await expect(
          runMerge(container, mergedFixture, {
            headers: {
              ...createCartMergeRequest(mergedFixture, container).headers,
              "idempotency-key": "p16-task0602-merge-different-key",
            },
          }),
        ).rejects.toMatchObject({
          code: "CART_MERGE_GUEST_CART_UNSUPPORTED",
          statusCode: 409,
          status: 409,
        });
        expect(await readRealCartMergeState(connection, mergedFixture)).toEqual(
          beforeDifferentKey,
        );

        const sameKey =
          attached.role === "A"
            ? "p16-task0602-merge-a"
            : "p16-task0602-merge-b";
        const beforeReplay = await readRealCartMergeState(
          connection,
          attachedFixture,
        );
        const replay = await runMerge(container, attachedFixture, {
          headers: {
            ...createCartMergeRequest(attachedFixture, container).headers,
            "idempotency-key": sameKey,
          },
        });
        expect(replay.statusCode).toBe(200);
        expect((replay.body as any).outcome).toBe("GUEST_CART_ATTACHED");
        expect(replay.headers.etag).toBe(
          `"${attachedFixture.guestVersion + 1}"`,
        );
        expect(
          await readRealCartMergeState(connection, attachedFixture),
        ).toEqual(beforeReplay);
      });

      it("faz different-key concurrent merge no mesmo guest com um vencedor e um loser sem segundo efeito", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0703_different_key_merge",
        );
        const beforeOrders = await countPersistedOrders(connection);

        const race = await runCartMergeRace(
          process.env.DATABASE_URL!,
          "merge",
          "merge",
          fixture,
          fixture,
          "p16-task0703-different-key-a",
          "p16-task0703-different-key-b",
        );
        console.info(
          `[P16_RACE_EVIDENCE] case=different-key workers=${JSON.stringify(
            race.workers.map(
              ({ role, pid, connectionPid, txid, statusCode, code }) => ({
                role,
                pid,
                connectionPid,
                txid,
                statusCode,
                code,
              }),
            ),
          )} lockTxids=${JSON.stringify(race.lockTxids)}`,
        );

        expect(new Set(race.workers.map((worker) => worker.pid)).size).toBe(2);
        expect(
          new Set(race.workers.map((worker) => worker.connectionPid)).size,
        ).toBe(2);
        expect(new Set(race.lockTxids).size).toBe(2);
        expect(race.workers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              statusCode: 200,
              outcome: "GUEST_CART_ATTACHED",
              cartId: fixture.guestCartId,
            }),
            expect.objectContaining({
              statusCode: 409,
              code: "CART_MERGE_GUEST_CART_UNSUPPORTED",
              outcome: null,
            }),
          ]),
        );

        const state = await readRealCartMergeState(connection, fixture);
        expect(state.customer_id).toBe(fixture.customerId);
        expect(state.capability_status).toBe("consumed");
        expect(state.capability_consumed_at).not.toBeNull();
        expect(state.idempotency_state).toBe("completed");
        expect(state.result_outcome).toBe("GUEST_CART_ATTACHED");
        expect(state.version).toBe(fixture.guestVersion + 1);
        const resultCount = await connection.raw(
          `select count(*)::int as count from cart_merge_result where guest_cart_id = ? and deleted_at is null`,
          [fixture.guestCartId],
        );
        expect(Number(resultCount.rows?.[0]?.count ?? 0)).toBe(1);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("faz same-key concurrent merge no mesmo guest uma única vez e permite replay compatível", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0703_same_key_merge",
        );
        const beforeOrders = await countPersistedOrders(connection);

        const race = await runCartMergeRace(
          process.env.DATABASE_URL!,
          "merge",
          "merge",
          fixture,
          fixture,
          "p16-task0703-same-key",
          "p16-task0703-same-key",
        );
        console.info(
          `[P16_RACE_EVIDENCE] case=same-key workers=${JSON.stringify(
            race.workers.map(
              ({ role, pid, connectionPid, txid, statusCode, code }) => ({
                role,
                pid,
                connectionPid,
                txid,
                statusCode,
                code,
              }),
            ),
          )} lockTxids=${JSON.stringify(race.lockTxids)}`,
        );

        expect(new Set(race.workers.map((worker) => worker.pid)).size).toBe(2);
        expect(
          new Set(race.workers.map((worker) => worker.connectionPid)).size,
        ).toBe(2);
        expect(new Set(race.lockTxids).size).toBe(2);
        expect(race.workers).toEqual([
          expect.objectContaining({
            statusCode: 200,
            outcome: "GUEST_CART_ATTACHED",
            cartId: fixture.guestCartId,
          }),
          expect.objectContaining({
            statusCode: 200,
            outcome: "GUEST_CART_ATTACHED",
            cartId: fixture.guestCartId,
          }),
        ]);

        const state = await readRealCartMergeState(connection, fixture);
        const resultCount = await connection.raw(
          `select count(*)::int as count from cart_merge_result where guest_cart_id = ? and deleted_at is null`,
          [fixture.guestCartId],
        );
        expect(Number(resultCount.rows?.[0]?.count ?? 0)).toBe(1);
        expect(state.customer_id).toBe(fixture.customerId);
        expect(state.capability_status).toBe("consumed");
        expect(state.idempotency_state).toBe("completed");
        expect(state.result_outcome).toBe("GUEST_CART_ATTACHED");
        expect(state.version).toBe(fixture.guestVersion + 1);
        expect(state.line_items).toEqual([
          expect.objectContaining({
            variant_id: fixture.variantId,
            quantity: 1,
          }),
        ]);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("serializa merge-vs-guest structural mutation real semherdar efeito", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0703_merge_guest_mutation",
        );
        const beforeOrders = await countPersistedOrders(connection);

        const race = await runCartMergeRace(
          process.env.DATABASE_URL!,
          "merge",
          "guest-mutation",
          fixture,
          fixture,
          "p16-task0703-merge-guest",
          "p16-task0703-guest-mutation",
        );
        console.info(
          `[P16_RACE_EVIDENCE] case=merge-vs-guest workers=${JSON.stringify(
            race.workers.map(
              ({ role, pid, connectionPid, txid, statusCode, code }) => ({
                role,
                pid,
                connectionPid,
                txid,
                statusCode,
                code,
              }),
            ),
          )} lockTxids=${JSON.stringify(race.lockTxids)}`,
        );

        expect(new Set(race.workers.map((worker) => worker.pid)).size).toBe(2);
        expect(
          new Set(race.workers.map((worker) => worker.connectionPid)).size,
        ).toBe(2);
        expect(new Set(race.lockTxids).size).toBe(2);
        expect(race.workers).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              operation: "guest-mutation",
              statusCode: 200,
            }),
            expect.objectContaining({ operation: "merge", statusCode: 412 }),
          ]),
        );

        const state = await readRealCartMergeState(connection, fixture);
        expect(state.customer_id).toBeNull();
        expect(state.capability_status).toBe("active");
        expect(state.idempotency_state).toBeNull();
        expect(state.result_id).toBeNull();
        expect(state.version).toBe(fixture.guestVersion + 1);
        expect(state.line_items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variant_id: fixture.variantId,
              quantity: 1,
            }),
            expect.objectContaining({
              variant_id: fixture.secondaryVariantId,
              quantity: 1,
            }),
          ]),
        );
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("serializa merge-vs-Customer no mesmo cart real sem lost update nem quantity overwrite", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0703_merge_customer_mutation",
        );
        const customerCart = await createRealCustomerCartFixture(
          container,
          fixture,
          "p16_task0703_merge_customer_mutation",
        );
        fixture.mutationCartId = customerCart.cartId;
        fixture.mutationVersion = customerCart.version;
        fixture.mutationVariantId = fixture.secondaryVariantId;
        const beforeOrders = await countPersistedOrders(connection);

        const race = await runCartMergeRace(
          process.env.DATABASE_URL!,
          "merge",
          "customer-mutation",
          fixture,
          fixture,
          "p16-task0703-merge-customer",
          "p16-task0703-customer-mutation",
        );
        console.info(
          `[P16_RACE_EVIDENCE] case=merge-vs-Customer workers=${JSON.stringify(
            race.workers.map(
              ({
                role,
                pid,
                connectionPid,
                txid,
                statusCode,
                code,
                message,
                error,
              }) => ({
                role,
                pid,
                connectionPid,
                txid,
                statusCode,
                code,
                ...(role === "B" && message != null ? { message } : {}),
                ...(error ? { error } : {}),
              }),
            ),
          )} lockTxids=${JSON.stringify(race.lockTxids)}`,
        );

        expect(new Set(race.workers.map((worker) => worker.pid)).size).toBe(2);
        expect(
          new Set(race.workers.map((worker) => worker.connectionPid)).size,
        ).toBe(2);
        expect(new Set(race.lockTxids).size).toBe(2);
        const mergeResult = race.workers.find(
          (worker) => worker.operation === "merge",
        )!;
        const mutationResult = race.workers.find(
          (worker) => worker.operation === "customer-mutation",
        )!;
        expect(mergeResult).toEqual(
          expect.objectContaining({
            statusCode: 200,
            outcome: "MERGED",
            cartId: customerCart.cartId,
          }),
        );
        expect([200, 412]).toContain(mutationResult.statusCode);
        if (mutationResult.statusCode === 200) {
          expect(mutationResult.cartId).toBe(customerCart.cartId);
        } else {
          expect(mutationResult.code).toBe("CART_VERSION_MISMATCH");
        }

        const guestState = await readRealCartMergeState(connection, fixture);
        expect(guestState.customer_id).toBeNull();
        expect(guestState.capability_status).toBe("consumed");
        expect(guestState.idempotency_state).toBe("completed");
        expect(guestState.result_outcome).toBe("MERGED");
        expect(guestState.review_status).toBeNull();

        const customerState = await connection.raw(
          `
            select
              c.customer_id,
              v.version,
              coalesce((
                select jsonb_agg(
                  jsonb_build_object('variant_id', li.variant_id, 'quantity', li.quantity)
                  order by li.variant_id
                )
                from cart_line_item li
                where li.cart_id = c.id and li.deleted_at is null
              ), '[]'::jsonb) as line_items
            from cart c
            left join store_resource_version v
              on v.resource_type = 'cart'
             and v.resource_id = c.id
             and v.deleted_at is null
            where c.id = ? and c.deleted_at is null
          `,
          [customerCart.cartId],
        );
        const expectedCustomerState =
          mutationResult.statusCode === 200
            ? {
                version: 3,
                line_items: [
                  { quantity: 1, variant_id: fixture.secondaryVariantId },
                  { quantity: 2, variant_id: fixture.variantId },
                ],
              }
            : {
                version: 2,
                line_items: [{ quantity: 2, variant_id: fixture.variantId }],
              };
        expect(customerState.rows).toEqual([
          expect.objectContaining({
            customer_id: fixture.customerId,
            ...expectedCustomerState,
          }),
        ]);

        const authority = await readCustomerCartCanonicalState(
          connection,
          fixture.customerId,
        );
        expect(authority.activeAuthorityRows).toBe(1);
        expect(authority.activeAuthorityCartId).toBe(customerCart.cartId);
        expect(authority.usableCustomerCartIds).toEqual([customerCart.cartId]);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("B16-09-HR-03 discrimina ownership Customer na releitura PostgreSQL real", async () => {
        const container = getContainer();
        const actorFixture = await createRealCartMergeFixture(
          container,
          "p16_task0903_ownership_actor",
          { withItems: false },
        );
        const actorCart = await createRealCustomerCartFixture(
          container,
          actorFixture,
          "p16_task0903_ownership_actor",
        );
        const foreignIdFixture = await createRealCartMergeFixture(
          container,
          "p16_task0903_ownership_foreign_id",
          { withItems: false },
        );
        const foreignIdCart = await createRealCustomerCartFixture(
          container,
          foreignIdFixture,
          "p16_task0903_ownership_foreign_id",
        );
        const bothPresentFixture = await createRealCartMergeFixture(
          container,
          "p16_task0903_ownership_both_present",
          { withItems: false },
        );
        const bothPresentCart = await createRealCustomerCartFixture(
          container,
          bothPresentFixture,
          "p16_task0903_ownership_both_present",
        );

        const readOwnershipShape = async (cartId: string) => {
          const result = await connection.raw(
            `
              select
                c.customer_id,
                customer.id as customer_record_id
              from cart c
              left join customer
                on customer.id = c.customer_id
               and customer.deleted_at is null
              where c.id = ? and c.deleted_at is null
            `,
            [cartId],
          );
          const row = result.rows?.[0];
          if (!row) throw new Error("P16_OWNERSHIP_CART_ROW_MISSING");
          return {
            customerId:
              row.customer_id == null ? null : String(row.customer_id),
            customerRecordId:
              row.customer_record_id == null
                ? null
                : String(row.customer_record_id),
          };
        };

        const readIdempotencyCount = async () => {
          const result = await connection.raw(
            "select count(*)::int as count from store_idempotency_record where deleted_at is null",
          );
          return Number(result.rows?.[0]?.count ?? 0);
        };

        const targetFixture = (target: {
          cartId: string;
          version: number;
          variantId: string;
        }) => ({
          ...actorFixture,
          mutationCartId: target.cartId,
          mutationVersion: target.version,
          mutationVariantId: actorFixture.secondaryVariantId,
        });

        const runOwnershipRace = async (
          fixture: ReturnType<typeof targetFixture>,
          keyPrefix: string,
        ) => {
          const race = await runCartMergeRace(
            process.env.DATABASE_URL!,
            "customer-mutation",
            "customer-mutation",
            fixture,
            fixture,
            `${keyPrefix}-a`,
            `${keyPrefix}-b`,
          );
          expect(new Set(race.workers.map((worker) => worker.pid)).size).toBe(
            2,
          );
          expect(
            new Set(race.workers.map((worker) => worker.connectionPid)).size,
          ).toBe(2);
          expect(new Set(race.lockTxids).size).toBe(2);
          return race;
        };

        const assertClosedOwnership = async (
          target: {
            cartId: string;
            version: number;
            variantId: string;
          },
          keyPrefix: string,
          expectedShape: Partial<{
            customerId: string | null;
            customerRecordId: string | null;
          }>,
        ) => {
          const before = await readCartRow(target.cartId);
          const beforeIdempotency = await readIdempotencyCount();
          const beforeOrders = await countPersistedOrders(connection);
          expect(await readOwnershipShape(target.cartId)).toMatchObject(
            expectedShape,
          );

          const race = await runOwnershipRace(targetFixture(target), keyPrefix);
          expect(race.workers).toEqual([
            expect.objectContaining({
              statusCode: null,
              code: null,
              message: "Not Found",
              cartId: null,
              outcome: null,
            }),
            expect.objectContaining({
              statusCode: null,
              code: null,
              message: "Not Found",
              cartId: null,
              outcome: null,
            }),
          ]);
          expect(await readCartRow(target.cartId)).toEqual(before);
          expect(await readIdempotencyCount()).toBe(beforeIdempotency);
          expect(await countPersistedOrders(connection)).toBe(beforeOrders);
        };

        // A foreign persisted customer_id is denied even when the caller has
        // a different, valid canonical Customer cart.
        await assertClosedOwnership(
          foreignIdCart,
          "p16-task0903-foreign-customer-id",
          {
            customerId: foreignIdFixture.customerId,
          },
        );

        // Both ownership sources absent (a real Guest cart) remain denied to
        // a Customer actor and cannot create a claim or mutate the cart.
        await assertClosedOwnership(
          {
            cartId: actorFixture.guestCartId,
            version: actorFixture.guestVersion,
            variantId: actorFixture.secondaryVariantId,
          },
          "p16-task0903-customer-on-guest",
          { customerId: null, customerRecordId: null },
        );

        // A real foreign Customer row plus its persisted cart.customer_id is
        // present, but both diverge from the authenticated actor.
        await assertClosedOwnership(
          bothPresentCart,
          "p16-task0903-both-present-divergent",
          {
            customerId: bothPresentFixture.customerId,
            customerRecordId: bothPresentFixture.customerId,
          },
        );

        const actorBefore = await readCartRow(actorCart.cartId);
        expect(await readOwnershipShape(actorCart.cartId)).toEqual({
          customerId: actorFixture.customerId,
          customerRecordId: actorFixture.customerId,
        });
        const actorBeforeOrders = await countPersistedOrders(connection);
        const actorRace = await runOwnershipRace(
          targetFixture(actorCart),
          "p16-task0903-same-customer",
        );

        // RED discriminator: current transactional reread has the persisted
        // customer_id but no normalized cart.customer projection, so both
        // real workers fail ownership here. After the production fix, one
        // worker must apply and the other must lose only the version CAS.
        expect(
          actorRace.workers.every(
            (worker) =>
              worker.statusCode === 200 ||
              (worker.statusCode === 412 &&
                worker.code === "CART_VERSION_MISMATCH"),
          ),
        ).toBe(true);
        expect(
          actorRace.workers.some((worker) => worker.statusCode === 200),
        ).toBe(true);
        const actorAfter = await readCartRow(actorCart.cartId);
        expect(actorAfter.customer_id).toBe(actorFixture.customerId);
        expect(actorAfter.version).toBe(Number(actorBefore.version) + 1);
        expect(actorAfter.line_items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variant_id: actorFixture.secondaryVariantId,
              quantity: 1,
            }),
          ]),
        );
        expect(await countPersistedOrders(connection)).toBe(actorBeforeOrders);
      });

      it("falha fechado em ambiguity pré-existente nos dois processos", async () => {
        const container = getContainer();
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0602_preexisting_ambiguity",
          { withItems: false },
        );
        const candidateIds = await createHistoricalCustomerCartCandidates(
          container,
          fixture.customerId,
          fixture.identity,
        );
        expect(candidateIds).toHaveLength(2);
        const beforeOrders = await countPersistedOrders(connection);

        const race = await runCartMergeRace(
          process.env.DATABASE_URL!,
          "active",
          "active",
          fixture,
          fixture,
          "p16-task0602-ambiguity-a",
          "p16-task0602-ambiguity-b",
        );

        expect(race.workers.map((worker) => worker.statusCode)).toEqual([
          409, 409,
        ]);
        expect(race.workers.map((worker) => worker.code)).toEqual([
          "CUSTOMER_CART_AUTHORITY_CONFLICT",
          "CUSTOMER_CART_AUTHORITY_CONFLICT",
        ]);
        const finalState = await readCustomerCartCanonicalState(
          connection,
          fixture.customerId,
        );
        expect(finalState.activeAuthorityRows).toBe(0);
        expect(finalState.usableCustomerCartIds).toHaveLength(2);
        expect(
          await countCustomerCartAuthorityRows(connection, fixture.customerId),
        ).toBe(0);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
        const fixtureState = await readRealCartMergeState(connection, fixture);
        expect(fixtureState.capability_status).toBe("active");
        expect(fixtureState.idempotency_state).toBeNull();
      });

      const assertReviewRaceProcessEvidence = (
        race: Awaited<ReturnType<typeof runCartReviewRace>>,
      ) => {
        expect(race.workers).toHaveLength(2);
        expect(new Set(race.workers.map((worker) => worker.pid)).size).toBe(2);
        expect(
          new Set(race.workers.map((worker) => worker.connectionPid)).size,
        ).toBe(2);
        expect(new Set(race.workers.map((worker) => worker.txid)).size).toBe(2);
        expect(race.workers.every((worker) => /^\d+$/.test(worker.txid))).toBe(
          true,
        );
        expect(
          race.workers.every((worker) => /^\d+$/.test(worker.connectionPid)),
        ).toBe(true);
        expect(new Set(race.lockTxids).size).toBe(2);
        expect(
          race.barriers.some((barrier) =>
            barrier.endsWith(":transaction-started"),
          ),
        ).toBe(true);
        expect(
          race.barriers.some((barrier) =>
            barrier.endsWith(":cart-lock-acquired"),
          ),
        ).toBe(true);
        expect(
          race.barriers.some((barrier) =>
            barrier.endsWith(":cart-lock-release"),
          ),
        ).toBe(true);
      };

      const captureReviewRaceMidpoint = async (
        fixture: Awaited<ReturnType<typeof createRealPendingCartReviewFixture>>,
        midpoint: {
          value?: Awaited<ReturnType<typeof readCartReviewRaceLedger>>;
        },
      ) => {
        midpoint.value = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
      };

      const emitHr04AckPaymentDiagnostic = (
        race: Awaited<ReturnType<typeof runCartReviewRace>>,
        before: Awaited<ReturnType<typeof readCartReviewRaceLedger>>,
        midpoint: { value?: Awaited<ReturnType<typeof readCartReviewRaceLedger>> },
        after: Awaited<ReturnType<typeof readCartReviewRaceLedger>>,
        persisted: Awaited<
          ReturnType<typeof readPersistedCheckoutCompletenessDiagnostic>
        >,
      ) => {
        const redactKeys = new Set([
          "cart_id",
          "customer_id",
          "review_ref",
          "cartId",
          "customerId",
          "reviewRef",
          "email",
          "first_name",
          "last_name",
          "address_1",
          "address_2",
          "city",
          "postal_code",
          "phone",
          "federal_tax_id",
          "variant_id",
          "capability",
        ]);
        const scrub = (value: unknown): unknown => {
          if (Array.isArray(value)) return value.map(scrub);
          if (!value || typeof value !== "object") {
            if (typeof value !== "string") return value;
            return value
              .replace(
                /\b(?:cart|cus|customer|guest|order|payment|pay|line|item|variant|prod|review|result|authority|capability|idempotency)[_-][a-z0-9]{12,}\b/gi,
                "[REDACTED_ID]",
              )
              .replace(/\b[0-9a-f]{24,}\b/gi, "[REDACTED_ID]");
          }
          const record = value as Record<string, unknown>;
          return Object.fromEntries(
            Object.entries(record).map(([key, entry]) => {
              if (redactKeys.has(key)) {
                if (key === "customer_id" && entry == null) {
                  return [key, null];
                }
                return [key, "[REDACTED_ID]"];
              }
              return [key, scrub(entry)];
            }),
          );
        };

        const workerB = race.workers.find((worker) => worker.role === "B");
        const workerDiagnostic = workerB?.checkoutDiagnostic;
        process.stderr.write(
          `[P16_HR04_ACK_PAYMENT_ACK_FIRST] ${JSON.stringify(
            scrub({
              workerB: {
                statusCode: workerB?.statusCode ?? null,
                code: workerB?.code ?? null,
                message: workerB?.message ?? null,
                error: workerB?.error,
                providerCalls: workerB?.providerCalls ?? 0,
                pid: workerB?.pid,
                connectionPid: workerB?.connectionPid,
                txid: workerB?.txid,
                stages: workerB?.stages ?? [],
              },
              checkoutDiagnostic: {
                persisted: workerDiagnostic?.persisted ?? persisted,
                requestedProjectionFields:
                  workerDiagnostic?.requestedProjectionFields ?? null,
                projectedSnapshot: workerDiagnostic?.projectedSnapshot ?? null,
                pureEligibilityResult:
                  workerDiagnostic?.pureEligibilityResult ?? null,
              },
              ledger: { before, midpoint: midpoint.value ?? null, after },
            }),
          )}\n`,
        );
      };

      const createPendingReviewFixture = async (identity: string) =>
        createRealPendingCartReviewFixture(getContainer(), identity, {
          regionId: await ensureBrazilRegion(),
        });

      it("serializa ACK-vs-line-item pending-first com zero efeitos antes do ACK", async () => {
        const fixture = await createPendingReviewFixture(
          "p16_task0904_ack_line_pending_first",
        );
        const before = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const beforeOrders = await countPersistedOrders(connection);
        const midpoint: {
          value?: Awaited<ReturnType<typeof readCartReviewRaceLedger>>;
        } = {};
        const race = await runCartReviewRace(
          process.env.DATABASE_URL!,
          "customer-mutation",
          fixture,
          fixture,
          "competitor-first",
          "p16-task0904-line-item-pending-first",
          { onMidpoint: () => captureReviewRaceMidpoint(fixture, midpoint) },
        );
        const after = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const ack = race.workers.find((worker) => worker.role === "A")!;
        const competitor = race.workers.find((worker) => worker.role === "B")!;

        assertReviewRaceProcessEvidence(race);
        expect(midpoint.value).toEqual(before);
        expect(ack.statusCode).toBe(200);
        expect(competitor.statusCode).toBe(409);
        expect(competitor.code).toBe("REVIEW_REQUIRED");
        expect(competitor.message ?? "").not.toContain(fixture.reviewRef);
        expect(ack.providerCalls).toBe(0);
        expect(competitor.providerCalls).toBe(0);
        expect(after.line_items).toEqual(before.line_items);
        expect(after.version).toBe(before.version);
        expect(after.review_count).toBe(1);
        expect(after.review_status).toBe("acknowledged");
        expect(after.review_ref).toBe(fixture.reviewRef);
        expect(after.acknowledged_at).toEqual(expect.any(String));
        expect(after.capability_status).toBe(before.capability_status);
        expect(after.merge_result_count).toBe(before.merge_result_count);
        expect(after.idempotency_count).toBe(before.idempotency_count);
        expect(after.payment_attempt_count).toBe(0);
        expect(after.payment_collection_count).toBe(0);
        expect(after.payment_session_count).toBe(0);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("serializa ACK-vs-line-item ACK-first sem bump estrutural no ACK", async () => {
        const fixture = await createPendingReviewFixture(
          "p16_task0904_ack_line_ack_first",
        );
        const before = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const beforeOrders = await countPersistedOrders(connection);
        const midpoint: {
          value?: Awaited<ReturnType<typeof readCartReviewRaceLedger>>;
        } = {};
        const race = await runCartReviewRace(
          process.env.DATABASE_URL!,
          "customer-mutation",
          fixture,
          fixture,
          "ack-first",
          "p16-task0904-line-item-ack-first",
          { onMidpoint: () => captureReviewRaceMidpoint(fixture, midpoint) },
        );
        const after = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const ack = race.workers.find((worker) => worker.role === "A")!;
        const competitor = race.workers.find((worker) => worker.role === "B")!;

        assertReviewRaceProcessEvidence(race);
        expect(midpoint.value).toEqual(before);
        expect(ack.statusCode).toBe(200);
        expect(competitor.statusCode).toBe(200);
        expect(competitor.code).toBeNull();
        expect(after.version).toBe((before.version as number) + 1);
        expect(after.line_items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              variant_id: fixture.secondaryVariantId,
              quantity: 1,
            }),
          ]),
        );
        expect(after.review_status).toBe("acknowledged");
        expect(after.acknowledged_at).toEqual(expect.any(String));
        expect(after.idempotency_count).toBe(before.idempotency_count + 1);
        expect(after.merge_result_count).toBe(before.merge_result_count);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("serializa ACK-vs-merge pending-first sem resurrection e sem efeitos do merge", async () => {
        const container = getContainer();
        const fixture = await createPendingReviewFixture(
          "p16_task0904_ack_merge_pending_first",
        );
        const competitorFixture = await createRealCartMergeFixture(
          container,
          "p16_task0904_ack_merge_pending_first_guest",
          { customerId: fixture.customerId },
        );
        const beforeTarget = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const beforeGuest = await readCartReviewRaceLedger(
          connection,
          competitorFixture,
          competitorFixture.guestCartId,
        );
        const beforeOrders = await countPersistedOrders(connection);
        const midpoint: {
          value?: Awaited<ReturnType<typeof readCartReviewRaceLedger>>;
        } = {};
        const race = await runCartReviewRace(
          process.env.DATABASE_URL!,
          "merge",
          fixture,
          competitorFixture,
          "competitor-first",
          "p16-task0904-merge-pending-first",
          { onMidpoint: () => captureReviewRaceMidpoint(fixture, midpoint) },
        );
        const afterTarget = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const afterGuest = await readCartReviewRaceLedger(
          connection,
          competitorFixture,
          competitorFixture.guestCartId,
        );
        const ack = race.workers.find((worker) => worker.role === "A")!;
        const competitor = race.workers.find((worker) => worker.role === "B")!;

        assertReviewRaceProcessEvidence(race);
        expect(midpoint.value).toEqual(beforeTarget);
        expect(ack.statusCode).toBe(200);
        expect(competitor.statusCode).toBe(409);
        expect(competitor.code).toBe("REVIEW_REQUIRED");
        expect(afterTarget.review_status).toBe("acknowledged");
        expect(afterTarget.review_ref).toBe(fixture.reviewRef);
        expect(afterTarget.version).toBe(beforeTarget.version);
        expect(afterGuest.customer_id).toBe(beforeGuest.customer_id);
        expect(afterGuest.line_items).toEqual(beforeGuest.line_items);
        expect(afterGuest.version).toBe(beforeGuest.version);
        expect(afterGuest.capability_status).toBe("active");
        expect(afterGuest.merge_result_count).toBe(0);
        expect(afterGuest.idempotency_count).toBe(
          beforeGuest.idempotency_count,
        );
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("serializa ACK-vs-merge ACK-first sem reabrir a CartReview anterior", async () => {
        const container = getContainer();
        const fixture = await createPendingReviewFixture(
          "p16_task0904_ack_merge_ack_first",
        );
        const competitorFixture = await createRealCartMergeFixture(
          container,
          "p16_task0904_ack_merge_ack_first_guest",
          { customerId: fixture.customerId },
        );
        const beforeTarget = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const beforeGuest = await readCartReviewRaceLedger(
          connection,
          competitorFixture,
          competitorFixture.guestCartId,
        );
        const beforeOrders = await countPersistedOrders(connection);
        const midpoint: {
          value?: Awaited<ReturnType<typeof readCartReviewRaceLedger>>;
        } = {};
        const race = await runCartReviewRace(
          process.env.DATABASE_URL!,
          "merge",
          fixture,
          competitorFixture,
          "ack-first",
          "p16-task0904-merge-ack-first",
          { onMidpoint: () => captureReviewRaceMidpoint(fixture, midpoint) },
        );
        const afterTarget = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const afterGuest = await readCartReviewRaceLedger(
          connection,
          competitorFixture,
          competitorFixture.guestCartId,
        );
        const ack = race.workers.find((worker) => worker.role === "A")!;
        const competitor = race.workers.find((worker) => worker.role === "B")!;

        assertReviewRaceProcessEvidence(race);
        expect(midpoint.value).toEqual(beforeTarget);
        expect(ack.statusCode).toBe(200);
        expect(competitor.statusCode).toBe(200);
        expect(competitor.outcome).toBe("MERGED");
        expect(afterTarget.review_status).toBe("acknowledged");
        expect(afterTarget.review_ref).toBe(fixture.reviewRef);
        expect(afterTarget.version).toBe((beforeTarget.version as number) + 1);
        expect(afterGuest.customer_id).toBeNull();
        expect(afterGuest.version).toBe((beforeGuest.version as number) + 1);
        expect(afterGuest.capability_status).toBe("consumed");
        expect(afterGuest.merge_result_count).toBe(1);
        expect(afterGuest.idempotency_count).toBe(
          beforeGuest.idempotency_count + 1,
        );
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("serializa ACK-vs-payment pending-first antes de qualquer PaymentAttempt", async () => {
        const fixture = await createPendingReviewFixture(
          "p16_task0904_ack_payment_pending_first",
        );
        const before = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const beforeOrders = await countPersistedOrders(connection);
        const midpoint: {
          value?: Awaited<ReturnType<typeof readCartReviewRaceLedger>>;
        } = {};
        const race = await runCartReviewRace(
          process.env.DATABASE_URL!,
          "payment",
          fixture,
          fixture,
          "competitor-first",
          "p16-task0904-payment-pending-first",
          { onMidpoint: () => captureReviewRaceMidpoint(fixture, midpoint) },
        );
        const after = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const ack = race.workers.find((worker) => worker.role === "A")!;
        const competitor = race.workers.find((worker) => worker.role === "B")!;

        assertReviewRaceProcessEvidence(race);
        expect(midpoint.value).toEqual(before);
        expect(ack.statusCode).toBe(200);
        expect(competitor.statusCode).toBe(409);
        expect(competitor.code).toBe("REVIEW_REQUIRED");
        expect(competitor.providerCalls).toBe(0);
        expect(after.review_status).toBe("acknowledged");
        expect(after.version).toBe(before.version);
        expect(after.line_items).toEqual(before.line_items);
        expect(after.idempotency_count).toBe(before.idempotency_count);
        expect(after.payment_attempt_count).toBe(0);
        expect(after.payment_collection_count).toBe(0);
        expect(after.payment_session_count).toBe(0);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });

      it("serializa ACK-vs-payment ACK-first com provider double e registros reais", async () => {
        const fixture = await createPendingReviewFixture(
          "p16_task0904_ack_payment_ack_first",
        );
        const before = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const beforeOrders = await countPersistedOrders(connection);
        const midpoint: {
          value?: Awaited<ReturnType<typeof readCartReviewRaceLedger>>;
        } = {};
        const race = await runCartReviewRace(
          process.env.DATABASE_URL!,
          "payment",
          fixture,
          fixture,
          "ack-first",
          "p16-task0904-payment-ack-first",
          { onMidpoint: () => captureReviewRaceMidpoint(fixture, midpoint) },
        );
        const after = await readCartReviewRaceLedger(
          connection,
          fixture,
          fixture.reviewCartId,
        );
        const persisted = await readPersistedCheckoutCompletenessDiagnostic(
          connection,
          fixture.reviewCartId,
        );
        const ack = race.workers.find((worker) => worker.role === "A")!;
        const competitor = race.workers.find((worker) => worker.role === "B")!;

        emitHr04AckPaymentDiagnostic(race, before, midpoint, after, persisted);
        assertReviewRaceProcessEvidence(race);
        expect(midpoint.value).toEqual(before);
        expect(ack.statusCode).toBe(200);
        expect(competitor.statusCode).toBe(201);
        expect(competitor.code).toBeNull();
        expect(competitor.providerCalls).toBe(1);
        expect(after.review_status).toBe("acknowledged");
        expect(after.review_ref).toBe(fixture.reviewRef);
        expect(after.version).toBe(before.version);
        expect(after.payment_attempt_count).toBe(1);
        expect(after.payment_attempt_statuses).toEqual([
          "card_client_secret_created",
        ]);
        expect(after.payment_collection_count).toBe(1);
        expect(after.payment_session_count).toBe(1);
        expect(after.payment_session_statuses).toEqual(["pending"]);
        expect(after.idempotency_count).toBe(before.idempotency_count);
        expect(await countPersistedOrders(connection)).toBe(beforeOrders);
      });
    },
  });
}
