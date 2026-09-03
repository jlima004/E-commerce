import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import { buildCompleteStripePaymentIntentCreateAuthorityV1 } from "../provider-request-authority"
import {
  PAYMENT_ATTEMPT_PROVIDER_BIND_CONFLICT,
  bindProviderPaymentIntentInTransaction,
  claimProviderDiscoveryInTransaction,
  isSameOperationReplayEligibleInTransaction,
  readDurablePreProviderAuthority,
} from "../transactional-authority"
import type { StripePaymentIntentLike } from "../stripe-safe"

jest.mock(
  "pg-god",
  () => {
    const { Client: PgClient } = jest.requireActual("pg") as typeof import("pg")

    function requireSafeName(databaseName: unknown): string {
      if (
        typeof databaseName !== "string" ||
        !/^p12_disposable_[a-z0-9_]+$/.test(databaseName)
      ) {
        throw new Error("P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN")
      }
      return databaseName
    }

    function maintenanceClient() {
      return new PgClient({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: "postgres",
      })
    }

    return {
      createDatabase: async ({ databaseName }: { databaseName: string }) => {
        const safeName = requireSafeName(databaseName)
        const client = maintenanceClient()
        await client.connect()
        try {
          const existing = await client.query(
            "select 1 from pg_database where datname = $1",
            [safeName]
          )
          if (existing.rowCount === 0) {
            await client.query(`create database "${safeName}"`)
          }
        } finally {
          await client.end()
        }
      },
      dropDatabase: async ({ databaseName }: { databaseName: string }) => {
        const safeName = requireSafeName(databaseName)
        const client = maintenanceClient()
        await client.connect()
        try {
          await client.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
            [safeName]
          )
          await client.query(`drop database if exists "${safeName}"`)
        } finally {
          await client.end()
        }
      },
    }
  },
  { virtual: true }
)

const requestedDatabaseName = process.env.DB_TEMP_NAME

if (!requestedDatabaseName) {
  describe("pre-provider CAS PostgreSQL routing", () => {
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
    if (typeof value === "string") {
      process.env[name] = value
    }
  }

  const { medusaIntegrationTestRunner } = jest.requireActual(
    "@medusajs/test-utils"
  ) as typeof import("@medusajs/test-utils")
  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  jest.setTimeout(180_000)

  function assertNoStripeNetwork() {
    expect(process.env.STRIPE_SECRET_KEY).toBe("")
    expect(process.env.STRIPE_WEBHOOK_SECRET).toBe("")
    expect(process.env.STRIPE_REAL_INITIATION_ENABLED).toBe("false")
    expect(disposableEnvironment.STRIPE_SECRET_KEY).toBe("")
  }

  function matchingIntent(
    id: string,
    attemptId: string,
    cartId: string,
    extras: Record<string, unknown> = {}
  ): StripePaymentIntentLike {
    return {
      id,
      amount: 9900,
      currency: "brl",
      payment_method_types: ["card"],
      metadata: {
        payment_attempt_id: attemptId,
        cart_id: cartId,
        session_id: `payses_${attemptId}`,
      },
      ...extras,
    }
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection }) => {
      async function seedCartResourceVersion(cartId: string, version = 3) {
        await dbConnection.raw(
          `
            insert into store_resource_version
              (id, resource_type, resource_id, version)
            values (?, 'cart', ?, ?)
          `,
          [`strver_${cartId}`, cartId, version]
        )
      }

      async function seedFrozenAttempt(input: {
        id: string
        cartId: string
        discovery?: Date | string | null
        replayDeadline?: string
        authorityCreatedAt?: string
      }) {
        const v1 = buildCompleteStripePaymentIntentCreateAuthorityV1({
          payment_method_type: "card",
          amount_minor: 9900,
          cart_id: input.cartId,
          cart_resource_version: 3,
          payment_attempt_id: input.id,
          payment_collection_id: `paycol_${input.id}`,
          payment_session_id: `payses_${input.id}`,
          authority_created_at:
            input.authorityCreatedAt ?? "2026-09-02T10:00:00.000Z",
          replay_deadline:
            input.replayDeadline ?? "2026-09-03T09:00:00.000Z",
        })
        await dbConnection.raw(
          `
            insert into payment_attempt (
              id, cart_id, payment_collection_id, payment_session_id,
              provider, provider_payment_intent_id, provider_payment_session_id,
              payment_method_type, status, amount, currency_code, metadata,
              order_id, financial_freeze_started_at, provider_canceled_confirmed_at,
              provider_discovery_started_at, reconciliation_reason_code,
              reconciliation_locked_at, last_reconciliation_at,
              created_at, updated_at, deleted_at
            ) values (
              ?, ?, ?, ?, 'stripe', null, null, 'card', 'created', 9900, 'brl', ?,
              null, ?, null, ?, null, null, null, now(), now(), null
            )
          `,
          [
            input.id,
            input.cartId,
            `paycol_${input.id}`,
            `payses_${input.id}`,
            JSON.stringify({
              cart_resource_version: 3,
              provider_idempotency_key: `payment-attempt:card:${input.id}`,
              payment_attempt_id: input.id,
              stripe_payment_intent_create: v1,
            }),
            new Date("2026-09-02T10:00:00.000Z"),
            input.discovery ?? null,
          ]
        )
      }

      afterEach(async () => {
        await dbConnection.raw(
          "delete from payment_attempt where id like 'payatt_r1_%'"
        )
        await dbConnection.raw(
          "delete from store_resource_version where resource_id like 'cart_r1_%' or id like 'strver_cart_r1_%'"
        )
        await dbConnection.raw("delete from cart where id like 'cart_r1_%'")
      })

      it("CAS BIND: unbound → pi_A PASS; same pi_A REUSE; pi_B FAIL CLOSED without mutating v1", async () => {
        assertNoStripeNetwork()
        const cartId = "cart_r1_cas_bind"
        const attemptId = "payatt_r1_cas_bind"
        await seedCartResourceVersion(cartId)
        await seedFrozenAttempt({ id: attemptId, cartId })

        const original = await dbConnection.raw(
          `
            select metadata -> 'stripe_payment_intent_create' as v1,
                   provider_payment_intent_id
            from payment_attempt
            where id = ?
          `,
          [attemptId]
        )
        const originalV1 = original.rows[0].v1

        const first = await dbConnection.transaction(async (transaction: any) =>
          bindProviderPaymentIntentInTransaction(transaction, {
            payment_attempt_id: attemptId,
            cart_id: cartId,
            amount_minor: 9900,
            currency_code: "brl",
            payment_method_type: "card",
            provider_payment_intent_id: "pi_A",
            payment_intent: matchingIntent("pi_A", attemptId, cartId),
          })
        )
        expect(first.outcome).toBe("BOUND")
        expect(first.attempt.provider_payment_intent_id).toBe("pi_A")
        expect(first.attempt.metadata?.stripe_payment_intent_create).toEqual(
          originalV1
        )

        const reused = await dbConnection.transaction(async (transaction: any) =>
          bindProviderPaymentIntentInTransaction(transaction, {
            payment_attempt_id: attemptId,
            cart_id: cartId,
            amount_minor: 9900,
            currency_code: "brl",
            payment_method_type: "card",
            provider_payment_intent_id: "pi_A",
            payment_intent: matchingIntent("pi_A", attemptId, cartId),
          })
        )
        expect(reused.outcome).toBe("REUSED")
        expect(reused.attempt.provider_payment_intent_id).toBe("pi_A")
        expect(reused.attempt.metadata?.stripe_payment_intent_create).toEqual(
          originalV1
        )

        await expect(
          dbConnection.transaction(async (transaction: any) =>
            bindProviderPaymentIntentInTransaction(transaction, {
              payment_attempt_id: attemptId,
              cart_id: cartId,
              amount_minor: 9900,
              currency_code: "brl",
              payment_method_type: "card",
              provider_payment_intent_id: "pi_B",
              payment_intent: matchingIntent("pi_B", attemptId, cartId),
            })
          )
        ).rejects.toThrow(PAYMENT_ATTEMPT_PROVIDER_BIND_CONFLICT)

        const afterConflict = await dbConnection.raw(
          `
            select provider_payment_intent_id,
                   metadata -> 'stripe_payment_intent_create' as v1
            from payment_attempt
            where id = ?
          `,
          [attemptId]
        )
        expect(afterConflict.rows[0].provider_payment_intent_id).toBe("pi_A")
        expect(afterConflict.rows[0].v1).toEqual(originalV1)
        assertNoStripeNetwork()
      })

      it("DISCOVERY CAS: first claimant gets timestamptz; second does not overwrite", async () => {
        const cartId = "cart_r1_cas_claim"
        const attemptId = "payatt_r1_cas_claim"
        await seedCartResourceVersion(cartId)
        await seedFrozenAttempt({ id: attemptId, cartId })

        const first = await dbConnection.transaction(async (transaction: any) =>
          claimProviderDiscoveryInTransaction(transaction, attemptId)
        )
        expect(first.claimed).toBe(true)
        expect(first.attempt.provider_discovery_started_at).not.toBeNull()
        const firstStamp = first.attempt.provider_discovery_started_at

        await dbConnection.raw("select pg_sleep(0.05)")

        const second = await dbConnection.transaction(async (transaction: any) =>
          claimProviderDiscoveryInTransaction(transaction, attemptId)
        )
        expect(second.claimed).toBe(false)
        expect(second.attempt.provider_discovery_started_at).toEqual(firstStamp)

        const stored = await dbConnection.raw(
          `
            select provider_discovery_started_at
            from payment_attempt
            where id = ?
          `,
          [attemptId]
        )
        expect(stored.rows[0].provider_discovery_started_at).toEqual(firstStamp)
        expect(stored.rows[0].provider_discovery_started_at).toBeInstanceOf(Date)
        assertNoStripeNetwork()
      })

      it("REPLAY DEADLINE uses CURRENT_TIMESTAMP vs persisted deadline, not Date.now()", async () => {
        const cartId = "cart_r1_cas_replay"
        const attemptId = "payatt_r1_cas_replay"
        await seedCartResourceVersion(cartId)
        await seedFrozenAttempt({ id: attemptId, cartId })

        await dbConnection.raw(
          `
            update payment_attempt
            set metadata = jsonb_set(
              metadata,
              '{stripe_payment_intent_create,replay_deadline}',
              to_jsonb(cast(? as text))
            )
            where id = ?
          `,
          ["2099-01-01T00:00:00.000Z", attemptId]
        )

        const dateNowSpy = jest
          .spyOn(Date, "now")
          .mockReturnValue(Date.parse("1999-01-01T00:00:00.000Z"))

        try {
          const futureProof = await dbConnection.transaction(
            async (transaction: any) => {
              const authority = await readDurablePreProviderAuthority(
                transaction,
                attemptId
              )
              const db = await transaction.raw(
                `
                  select
                    CURRENT_TIMESTAMP as db_now,
                    (metadata #>> '{stripe_payment_intent_create,replay_deadline}')::timestamptz as deadline,
                    (CURRENT_TIMESTAMP < (metadata #>> '{stripe_payment_intent_create,replay_deadline}')::timestamptz) as eligible
                  from payment_attempt
                  where id = ?
                `,
                [attemptId]
              )
              const result = await isSameOperationReplayEligibleInTransaction(
                transaction,
                attemptId
              )
              return { authority, db: db.rows[0], result }
            }
          )

          expect(futureProof.authority.replay_deadline).toBe(
            "2099-01-01T00:00:00.000Z"
          )
          expect(
            futureProof.db.eligible === true ||
              futureProof.db.eligible === "t" ||
              futureProof.db.eligible === "true"
          ).toBe(true)
          expect(futureProof.result).toEqual({ eligible: true })
          expect(new Date(futureProof.db.db_now).getTime()).toBeLessThan(
            new Date(futureProof.db.deadline).getTime()
          )

          await dbConnection.raw(
            `
              update payment_attempt
              set metadata = jsonb_set(
                metadata,
                '{stripe_payment_intent_create,replay_deadline}',
                to_jsonb(cast(? as text))
              )
              where id = ?
            `,
            ["2000-01-01T00:00:00.000Z", attemptId]
          )

          const pastProof = await dbConnection.transaction(
            async (transaction: any) => {
              const db = await transaction.raw(
                `
                  select
                    CURRENT_TIMESTAMP as db_now,
                    (metadata #>> '{stripe_payment_intent_create,replay_deadline}')::timestamptz as deadline,
                    (CURRENT_TIMESTAMP < (metadata #>> '{stripe_payment_intent_create,replay_deadline}')::timestamptz) as eligible
                  from payment_attempt
                  where id = ?
                `,
                [attemptId]
              )
              const result = await isSameOperationReplayEligibleInTransaction(
                transaction,
                attemptId
              )
              return { db: db.rows[0], result }
            }
          )

          expect(
            pastProof.db.eligible === true ||
              pastProof.db.eligible === "t" ||
              pastProof.db.eligible === "true"
          ).toBe(false)
          expect(pastProof.result).toEqual({
            eligible: false,
            reason: "REPLAY_DEADLINE_ELAPSED",
          })
          expect(new Date(pastProof.db.db_now).getTime()).toBeGreaterThan(
            new Date(pastProof.db.deadline).getTime()
          )
          assertNoStripeNetwork()
        } finally {
          dateNowSpy.mockRestore()
        }
      })

      it("never invokes an external Stripe provider in this suite", () => {
        assertNoStripeNetwork()
        expect(
          process.env.DB_HOST &&
            ["localhost", "127.0.0.1", "::1"].includes(String(process.env.DB_HOST))
        ).toBe(true)
      })
    },
  })
}
