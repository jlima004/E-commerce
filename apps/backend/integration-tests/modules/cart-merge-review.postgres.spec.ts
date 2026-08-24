import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { POST as mergeCart } from "../../src/api/store/customers/me/cart/merge/route"
import {
  CART_MERGE_MODULE,
} from "../../src/modules/cart-merge"
import {
  STORE_IDEMPOTENCY_CART_MERGE,
  STORE_IDEMPOTENCY_MODULE,
} from "../../src/modules/store-idempotency"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"
import {
  countPersistedOrders,
  countUsableCustomerCarts,
  createCartMergeFailpoint,
  createCartMergeRequest,
  createCartMergeResponse,
  createRealCartMergeFixture,
  instrumentRealCartMergeTransaction,
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

      it("executa o CartMergeModuleService real e prova um commit PostgreSQL único", async () => {
        const container = getContainer()
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_wave0_real_commit"
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
        expect(afterState.idempotency_result_id).toBe(fixture.guestCartId)
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
          ])
        ).toEqual(new Set([transaction.transactionIds[0]]))
      })

      it("reverte os efeitos reais do merge quando o tracer falha antes do commit", async () => {
        const container = getContainer()
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_wave0_real_rollback"
        )
        const beforeOrders = await countPersistedOrders(connection)
        const beforeState = await readRealCartMergeState(connection, fixture)
        const failpoint = createCartMergeFailpoint()
        failpoint.arm()
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
            mergeCart(
              createCartMergeRequest(fixture, container) as never,
              createCartMergeResponse() as never
            )
          ).rejects.toThrow("P16_CART_MERGE_FAILPOINT")
        } finally {
          transaction.restore()
        }

        const afterState = await readRealCartMergeState(connection, fixture)
        expect(afterState.customer_id).toBe(beforeState.customer_id)
        expect(afterState.version).toBe(beforeState.version)
        expect(afterState.capability_status).toBe("active")
        expect(afterState.capability_consumed_at).toBeNull()
        expect(afterState.idempotency_state).toBeNull()
        expect(await countUsableCustomerCarts(connection, fixture.customerId)).toBe(0)
        expect(await countPersistedOrders(connection)).toBe(beforeOrders)
        expect(transaction.transactionIds).toHaveLength(2)
        expect(new Set(transaction.transactionIds).size).toBe(1)
      })

      it("usa StoreIdempotency real para distinguir claim e replay da mesma chave", async () => {
        const container = getContainer()
        const fixture = await createRealCartMergeFixture(
          container,
          "p16_wave0_real_replay"
        )
        const beforeState = await readRealCartMergeState(connection, fixture)
        const beforeOrders = await countPersistedOrders(connection)
        const idempotency = container.resolve(STORE_IDEMPOTENCY_MODULE) as any
        const input = {
          operation: STORE_IDEMPOTENCY_CART_MERGE,
          actorScope: {
            actor_type: "customer",
            customer_id: fixture.customerId,
          },
          resourceScope: {
            resource_type: "cart_merge",
            guest_cart_id: fixture.guestCartId,
            customer_cart_id: null,
            capability_id: fixture.capabilityId,
          },
          rawIdempotencyKey: fixture.idempotencyKey,
          canonicalSemanticObject: {
            operation: "CART_MERGE",
            customerId: fixture.customerId,
            guestCartId: fixture.guestCartId,
            customerCartId: null,
            guestVersion: fixture.guestVersion,
            customerVersion: null,
            normalizedGuestIntent: [
              { variantId: fixture.variantId, quantity: 1 },
            ],
          },
        }

        const first = await idempotency.claim(input)
        expect(first.type).toBe("claimed")
        const completed = await idempotency.markCompleted({
          id: first.record.id,
          expectedState: "processing",
          expectedStateVersion: first.record.state_version,
          result_type: "cart_merge",
          result_id: fixture.guestCartId,
          response_status: 200,
          result_safe_metadata: {
            operation: STORE_IDEMPOTENCY_CART_MERGE,
            result_type: "cart_merge",
            result_id: fixture.guestCartId,
            response_status: 200,
          },
        })
        expect(completed.type).toBe("claimed")

        const second = await idempotency.claim(input)
        expect(second.type).toBe("replay")
        expect(second.record.id).toBe(first.record.id)
        expect(second.record.state).toBe("completed")

        const afterState = await readRealCartMergeState(connection, fixture)
        expect(afterState.customer_id).toBe(beforeState.customer_id)
        expect(afterState.version).toBe(beforeState.version)
        expect(afterState.capability_status).toBe("active")
        expect(await countPersistedOrders(connection)).toBe(beforeOrders)
      })
    },
  })
}
