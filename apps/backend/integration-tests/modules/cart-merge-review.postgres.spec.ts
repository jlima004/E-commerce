import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { POST as mergeCart } from "../../src/api/store/customers/me/cart/merge/route"
import {
  CART_MERGE_MODULE,
} from "../../src/modules/cart-merge"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"
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
  createRealCartMergeFixture,
  cleanupCartMergeSchemaProbes,
  insertCartMergeResultProbe,
  insertCartReviewProbe,
  insertCustomerCartAuthorityProbe,
  instrumentRealCartMergeTransaction,
  readCartMergeSchemaCatalog,
  readRealCartMergeState,
  type CartMergePostgresRawConnection,
} from "../helpers/cart-merge-postgres"

const requestedDatabaseName = process.env.DB_TEMP_NAME

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
          if (found.rowCount === 0) {
            await client.query(`create database "${name}"`)
          }
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

if (!requestedDatabaseName) {
  describe("Cart merge Wave 0 PostgreSQL", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(() => requireDisposableDatabaseName(requestedDatabaseName)).toThrow(
        "P12_DISPOSABLE_DATABASE_NAME_REQUIRED"
      )
    })
  })
} else {
  const disposableEnvironment = buildDisposableMedusaEnvironment(process.env)
  assertDisposableMedusaEnvironment(disposableEnvironment)

  for (const [name, value] of Object.entries(disposableEnvironment)) {
    if (typeof value === "string") process.env[name] = value
  }

  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      jest.setTimeout(180_000)

      const connection = dbConnection as unknown as CartMergePostgresRawConnection

      const runMerge = async (
        container: any,
        fixture: Awaited<ReturnType<typeof createRealCartMergeFixture>>,
        overrides: Record<string, unknown> = {}
      ) => {
        const response = createCartMergeResponse()
        await mergeCart(
          createCartMergeRequest(fixture, container, overrides) as never,
          response as never
        )
        return response
      }

      it("aplica o schema frozen real com tabelas, CHECKs e índices aprovados", async () => {
        expect(process.env.DB_HOST).toMatch(/^(localhost|127\.0\.0\.1|::1)$/)
        expect(process.env.DB_TEMP_NAME).toMatch(/^p12_disposable_[a-z0-9_]+$/)
        expect(process.env.DATABASE_URL).toMatch(
          /@(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//
        )
        expect(process.env.REDIS_URL).toBe("")
        expect(process.env.CACHE_REDIS_URL).toBe("")
        expect(process.env.EVENTS_REDIS_URL).toBe("")
        expect(process.env.WE_REDIS_URL).toBe("")

        const catalog = await readCartMergeSchemaCatalog(connection)

        expect(catalog.tables).toEqual([
          "cart_merge_result",
          "cart_review",
          "customer_cart_authority",
        ])

        const columnSignatures = catalog.columns.map(
          ({ table_name, column_name, udt_name, is_nullable }) =>
            `${table_name}.${column_name}:${udt_name}:${is_nullable}`
        )
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
          ].sort()
        )

        const checksByTable = new Map<string, string[]>()
        for (const check of catalog.checks) {
          const checks = checksByTable.get(check.table_name) ?? []
          checks.push(check.definition)
          checksByTable.set(check.table_name, checks)
        }
        expect(checksByTable.get("cart_merge_result")).toHaveLength(1)
        expect(checksByTable.get("cart_merge_result")?.[0]).toMatch(
          /outcome.*MERGED.*MERGED_PARTIAL.*GUEST_CART_ATTACHED.*CUSTOMER_CART_PRESERVED.*NO_ITEMS/i
        )
        expect(checksByTable.get("cart_review")).toHaveLength(1)
        expect(checksByTable.get("cart_review")?.[0]).toMatch(
          /status.*pending.*acknowledged/i
        )
        expect(checksByTable.get("customer_cart_authority")).toHaveLength(1)
        expect(checksByTable.get("customer_cart_authority")?.[0]).toMatch(
          /state.*active.*superseded/i
        )

        const indexNames = catalog.indexes.map((index) => index.index_name).sort()
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
          ].sort()
        )

        const indexesByName = new Map(
          catalog.indexes.map((index) => [index.index_name, index])
        )
        for (const name of [
          "UQ_cart_merge_result_idempotency_record",
          "UQ_cart_review_review_ref",
          "UQ_cart_review_merge_result",
        ]) {
          expect(indexesByName.get(name)).toEqual(
            expect.objectContaining({ is_unique: true, predicate: null })
          )
        }
        expect(indexesByName.get("UQ_customer_cart_authority_active_customer")).toEqual(
          expect.objectContaining({
            is_unique: true,
            predicate: expect.stringMatching(/state\s*=\s*'active'.*deleted_at\s+IS\s+NULL/i),
          })
        )
        expect(indexesByName.get("UQ_customer_cart_authority_active_cart")).toEqual(
          expect.objectContaining({
            is_unique: true,
            predicate: expect.stringMatching(/state\s*=\s*'active'.*deleted_at\s+IS\s+NULL/i),
          })
        )
        expect(indexesByName.get("UQ_cart_review_pending_cart")).toEqual(
          expect.objectContaining({
            is_unique: true,
            predicate: expect.stringMatching(/status\s*=\s*'pending'.*deleted_at\s+IS\s+NULL/i),
          })
        )
        for (const index of catalog.indexes) {
          expect(index.definition).not.toMatch(/FOREIGN KEY|REFERENCES/i)
        }
      })

      it("falha fechado no audit histórico e não materializa authority ambígua", async () => {
        const container = getContainer()
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0501_collision"
        )
        const beforeOrders = await countPersistedOrders(connection)
        const candidateIds = await createHistoricalCustomerCartCandidates(
          container,
          fixture.customerId,
          fixture.identity
        )
        expect(candidateIds).toHaveLength(2)

        const audit = await auditCustomerCartBackfill(
          connection,
          fixture.customerId
        )
        expect(audit).toEqual({
          status: "ambiguous",
          candidateCount: 2,
          selectedCartId: null,
          report: {
            code: "P16_CUSTOMER_CART_BACKFILL_AMBIGUOUS",
            candidateCount: 2,
          },
        })
        expect(() => assertCustomerCartBackfillFailClosed(audit)).toThrow(
          "P16_CUSTOMER_CART_BACKFILL_AMBIGUOUS"
        )
        expect(await countCustomerCartAuthorityRows(connection, fixture.customerId)).toBe(0)
        expect(await countPersistedOrders(connection)).toBe(beforeOrders)
      })

      it("faz o PostgreSQL rejeitar uniques globais e uniques parciais de invariantes", async () => {
        const prefix = "p16_task0501_constraints"
        try {
          await insertCartMergeResultProbe(connection, {
            id: `${prefix}_result_a`,
            idempotencyRecordId: `${prefix}_idempotency_shared`,
          })
          await expect(
            insertCartMergeResultProbe(connection, {
              id: `${prefix}_result_b`,
              idempotencyRecordId: `${prefix}_idempotency_shared`,
            })
          ).rejects.toMatchObject({ code: "23505" })

          await insertCartReviewProbe(connection, {
            id: `${prefix}_review_a`,
            cartId: `${prefix}_cart_a`,
            reviewRef: `${prefix}_review_ref_shared`,
            mergeResultId: `${prefix}_merge_a`,
          })
          await expect(
            insertCartReviewProbe(connection, {
              id: `${prefix}_review_b`,
              cartId: `${prefix}_cart_b`,
              reviewRef: `${prefix}_review_ref_shared`,
              mergeResultId: `${prefix}_merge_b`,
            })
          ).rejects.toMatchObject({ code: "23505" })

          await insertCartReviewProbe(connection, {
            id: `${prefix}_review_c`,
            cartId: `${prefix}_cart_c`,
            reviewRef: `${prefix}_review_ref_c`,
            mergeResultId: `${prefix}_merge_shared`,
          })
          await expect(
            insertCartReviewProbe(connection, {
              id: `${prefix}_review_d`,
              cartId: `${prefix}_cart_d`,
              reviewRef: `${prefix}_review_ref_d`,
              mergeResultId: `${prefix}_merge_shared`,
            })
          ).rejects.toMatchObject({ code: "23505" })

          await insertCartReviewProbe(connection, {
            id: `${prefix}_review_e`,
            cartId: `${prefix}_pending_cart`,
            reviewRef: `${prefix}_review_ref_e`,
            mergeResultId: `${prefix}_merge_e`,
          })
          await expect(
            insertCartReviewProbe(connection, {
              id: `${prefix}_review_f`,
              cartId: `${prefix}_pending_cart`,
              reviewRef: `${prefix}_review_ref_f`,
              mergeResultId: `${prefix}_merge_f`,
            })
          ).rejects.toMatchObject({ code: "23505" })

          await insertCustomerCartAuthorityProbe(connection, {
            id: `${prefix}_authority_a`,
            customerId: `${prefix}_customer_shared`,
            cartId: `${prefix}_authority_cart_a`,
          })
          await expect(
            insertCustomerCartAuthorityProbe(connection, {
              id: `${prefix}_authority_b`,
              customerId: `${prefix}_customer_shared`,
              cartId: `${prefix}_authority_cart_b`,
            })
          ).rejects.toMatchObject({ code: "23505" })

          await insertCustomerCartAuthorityProbe(connection, {
            id: `${prefix}_authority_c`,
            customerId: `${prefix}_customer_c`,
            cartId: `${prefix}_authority_cart_shared`,
          })
          await expect(
            insertCustomerCartAuthorityProbe(connection, {
              id: `${prefix}_authority_d`,
              customerId: `${prefix}_customer_d`,
              cartId: `${prefix}_authority_cart_shared`,
            })
          ).rejects.toMatchObject({ code: "23505" })
        } finally {
          await cleanupCartMergeSchemaProbes(connection, prefix)
        }
      })

      it("persiste receipt, authority e terminal state no mesmo transaction manager", async () => {
        const container = getContainer()
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0503_commit"
        )
        const beforeOrders = await countPersistedOrders(connection)
        const beforeState = await readRealCartMergeState(connection, fixture)

        expect(beforeState.customer_id).toBeNull()
        expect(beforeState.version).toBe(fixture.guestVersion)
        expect(beforeState.capability_status).toBe("active")
        expect(beforeState.idempotency_state).toBeNull()
        expect(await countUsableCustomerCarts(connection, fixture.customerId)).toBe(0)

        const cartModule = container.resolve(Modules.CART) as unknown as {
          baseRepository_: {
            transaction: (...args: any[]) => Promise<unknown>
          }
        }
        const transaction = instrumentRealCartMergeTransaction(cartModule as any)
        const response = createCartMergeResponse()

        try {
          await mergeCart(
            createCartMergeRequest(fixture, container) as never,
            response as never
          )
        } finally {
          transaction.restore()
        }

        expect(container.resolve(CART_MERGE_MODULE)).toEqual(
          expect.objectContaining({ executeCartMerge: expect.any(Function) })
        )
        expect(response.statusCode).toBe(200)
        expect(response.headers.etag).toBe('"2"')
        expect((response.body as any).outcome).toBe("GUEST_CART_ATTACHED")
        expect((response.body as any).cart.id).toBe(fixture.guestCartId)
        expect((response.body as any).cart.customer.id).toBe(fixture.customerId)

        const afterState = await readRealCartMergeState(connection, fixture)
        expect(afterState.customer_id).toBe(fixture.customerId)
        expect(afterState.version).toBe(fixture.guestVersion + 1)
        expect(afterState.capability_status).toBe("consumed")
        expect(afterState.capability_consumed_at).not.toBeNull()
        expect(afterState.idempotency_state).toBe("completed")
        expect(afterState.result_id).toMatch(/^cmres_/)
        expect(afterState.idempotency_result_id).toBe(afterState.result_id)
        expect(afterState.result_outcome).toBe("GUEST_CART_ATTACHED")
        expect(afterState.result_etag).toBe('"2"')
        expect(afterState.authority_state).toBe("active")
        expect(afterState.authority_customer_id).toBe(fixture.customerId)
        expect(afterState.authority_cart_id).toBe(fixture.guestCartId)
        expect(afterState.review_status).toBeNull()

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
          [afterState.result_id]
        )
        const receipt = receiptQuery.rows?.[0]
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
          })
        )
        expect(receipt?.capability_hash).not.toBe(fixture.capabilityToken)
        expect(receipt?.request_fingerprint).not.toContain(fixture.capabilityToken)
        expect(receipt?.request_fingerprint).not.toContain(fixture.idempotencyKey)
        expect(receipt?.original_public_cart_snapshot).toBeTruthy()
        expect(receipt?.original_review_snapshot).toBeTruthy()
        expect(receipt?.result_expires_at).toBe(receipt?.idempotency_expires_at)
        expect(await countUsableCustomerCarts(connection, fixture.customerId)).toBe(1)
        expect(await countPersistedOrders(connection)).toBe(beforeOrders)

        expect(transaction.transactionIds).toHaveLength(2)
        expect(new Set(transaction.transactionIds).size).toBe(1)
        expect(
          new Set([
            afterState.cart_xmin,
            afterState.version_xmin,
            afterState.capability_xmin,
            afterState.idempotency_xmin,
            afterState.authority_xmin,
            afterState.result_xmin,
          ])
        ).toEqual(new Set([transaction.transactionIds[0]]))
      })

      it("reproduz somente o receipt original depois de mudança no cart atual", async () => {
        const container = getContainer()
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0503_replay_original"
        )
        const first = await runMerge(container, fixture)
        const committedState = await readRealCartMergeState(connection, fixture)
        const beforeOrders = await countPersistedOrders(connection)
        const originalBody = structuredClone(first.body)
        const originalEtag = first.headers.etag

        await connection.raw(
          "update cart set email = ? where id = ?",
          [`changed-after-commit@cart-merge.test`, fixture.guestCartId]
        )
        const mutatedState = await readRealCartMergeState(connection, fixture)

        const replay = await runMerge(container, fixture)
        const replayState = await readRealCartMergeState(connection, fixture)

        expect(replay.statusCode).toBe(200)
        expect(replay.headers.etag).toBe(originalEtag)
        expect(replay.body).toEqual(originalBody)
        expect(mutatedState.cart_xmin).not.toBe(committedState.cart_xmin)
        expect(replayState).toEqual(mutatedState)
        expect(await countPersistedOrders(connection)).toBe(beforeOrders)
      })

      it("rejeita replay com If-Match divergente sem write nem Order", async () => {
        const container = getContainer()
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0503_replay_version_conflict"
        )
        await runMerge(container, fixture)

        const beforeConflict = await readRealCartMergeState(connection, fixture)
        const beforeOrders = await countPersistedOrders(connection)
        const originalRequest = createCartMergeRequest(fixture, container)

        await expect(
          runMerge(container, fixture, {
            headers: {
              ...originalRequest.headers,
              "if-match": `"${fixture.guestVersion + 100}"`,
            },
          })
        ).rejects.toMatchObject({
          code: "IDEMPOTENCY_KEY_REUSE_CONFLICT",
          statusCode: 409,
          status: 409,
        })

        expect(await readRealCartMergeState(connection, fixture)).toEqual(
          beforeConflict
        )
        expect(await countPersistedOrders(connection)).toBe(beforeOrders)
      })

      it("confirma NO_ITEMS sem tocar cart, lines, version, review ou capability", async () => {
        const container = getContainer()
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_task0503_no_items",
          { withItems: false }
        )
        const beforeState = await readRealCartMergeState(connection, fixture)
        const beforeOrders = await countPersistedOrders(connection)
        expect(beforeState.line_items).toEqual([])
        const first = await runMerge(container, fixture)
        const afterFirst = await readRealCartMergeState(connection, fixture)

        expect(first.statusCode).toBe(200)
        expect(first.headers.etag).toBe(`"${fixture.guestVersion}"`)
        expect((first.body as any).outcome).toBe("NO_ITEMS")
        expect((first.body as any).cart.items).toEqual([])
        expect(afterFirst.customer_id).toBe(beforeState.customer_id)
        expect(afterFirst.line_items).toEqual(beforeState.line_items)
        expect(afterFirst.cart_xmin).toBe(beforeState.cart_xmin)
        expect(afterFirst.version).toBe(beforeState.version)
        expect(afterFirst.version_xmin).toBe(beforeState.version_xmin)
        expect(afterFirst.capability_status).toBe("active")
        expect(afterFirst.capability_consumed_at).toBeNull()
        expect(afterFirst.authority_state).toBeNull()
        expect(afterFirst.review_status).toBeNull()
        expect(afterFirst.result_id).toMatch(/^cmres_/)
        expect(afterFirst.idempotency_state).toBe("completed")
        expect(afterFirst.idempotency_result_id).toBe(afterFirst.result_id)
        expect(afterFirst.result_outcome).toBe("NO_ITEMS")
        expect(afterFirst.result_etag).toBe(`"${fixture.guestVersion}"`)

        const second = await runMerge(container, fixture)
        const afterReplay = await readRealCartMergeState(connection, fixture)
        expect(second.body).toEqual(first.body)
        expect(second.headers.etag).toBe(first.headers.etag)
        expect(afterReplay).toEqual(afterFirst)
        expect(await countUsableCustomerCarts(connection, fixture.customerId)).toBe(0)
        expect(await countPersistedOrders(connection)).toBe(beforeOrders)
      })

      it.each([
        "cart",
        "invalidation",
        "version",
        "association",
        "result",
        "capability_consume",
        "idempotency_completion",
      ])(
        "faz rollback integral no failpoint pós-write %s",
        async (point) => {
          const container = getContainer()
          const fixture = await createRealCartMergeFixture(
            container,
            `p16_task0503_failpoint_${point}`
          )
          const beforeState = await readRealCartMergeState(connection, fixture)
          const beforeOrders = await countPersistedOrders(connection)
          const failpoint = createCartMergeFailpoint()
          failpoint.arm(point)
          const cartModule = container.resolve(Modules.CART) as unknown as {
            baseRepository_: {
              transaction: (...args: any[]) => Promise<unknown>
            }
          }
          const transaction = instrumentRealCartMergeTransaction(cartModule as any, {
            failpoint,
          })

          try {
            await expect(
              runMerge(container, fixture, { cartMergeFailpoint: failpoint })
            ).rejects.toThrow(`P16_CART_MERGE_FAILPOINT:${point}`)
          } finally {
            transaction.restore()
          }

          const afterState = await readRealCartMergeState(connection, fixture)
          expect(afterState).toEqual(beforeState)
          expect(await countUsableCustomerCarts(connection, fixture.customerId)).toBe(0)
          expect(await countPersistedOrders(connection)).toBe(beforeOrders)
          expect(failpoint.ledger).toContain(point)
          expect(transaction.transactionIds).toHaveLength(1)
        }
      )
    },
  })
}
