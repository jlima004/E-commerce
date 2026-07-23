import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import {
  ADMIN_ACTION_LOG_MODULE,
  type AdminActionLogModuleService,
  type AppendIntentInput,
} from ".."

const CANONICAL_ADMIN_ACTION_LOG_RESOLVE = "./src/modules/admin-action-log"

function isCanonicalAdminActionLogRegistration(
  registration: unknown
): boolean {
  if (
    !registration ||
    typeof registration !== "object" ||
    Array.isArray(registration)
  ) {
    return false
  }

  const entry = registration as { resolve?: unknown; disable?: unknown }
  if (entry.disable === true) {
    return false
  }

  return entry.resolve === CANONICAL_ADMIN_ACTION_LOG_RESOLVE
}

function ensureAdminActionLogModuleRegistration(
  modules: Record<string, unknown>
): {
  registered: boolean
  alreadyPresent: boolean
  resolvePath: string
} {
  const existingRegistration = modules.admin_action_log

  if (!existingRegistration) {
    modules.admin_action_log = {
      resolve: CANONICAL_ADMIN_ACTION_LOG_RESOLVE,
    }
    return {
      registered: true,
      alreadyPresent: false,
      resolvePath: CANONICAL_ADMIN_ACTION_LOG_RESOLVE,
    }
  }

  if (!isCanonicalAdminActionLogRegistration(existingRegistration)) {
    throw new Error("ADMIN_ACTION_LOG_CONFLICTING_REGISTRATION")
  }

  return {
    registered: false,
    alreadyPresent: true,
    resolvePath: CANONICAL_ADMIN_ACTION_LOG_RESOLVE,
  }
}

describe("AdminActionLog test-only registration idempotency", () => {
  it("registers when the module is absent", () => {
    const modules: Record<string, unknown> = {}
    expect(ensureAdminActionLogModuleRegistration(modules)).toEqual({
      registered: true,
      alreadyPresent: false,
      resolvePath: CANONICAL_ADMIN_ACTION_LOG_RESOLVE,
    })
    expect(modules.admin_action_log).toEqual({
      resolve: CANONICAL_ADMIN_ACTION_LOG_RESOLVE,
    })
  })

  it("preserves an existing canonical registration", () => {
    const existing = { resolve: CANONICAL_ADMIN_ACTION_LOG_RESOLVE }
    const modules: Record<string, unknown> = {
      admin_action_log: existing,
    }
    expect(ensureAdminActionLogModuleRegistration(modules)).toEqual({
      registered: false,
      alreadyPresent: true,
      resolvePath: CANONICAL_ADMIN_ACTION_LOG_RESOLVE,
    })
    expect(modules.admin_action_log).toBe(existing)
  })

  it("rejects a divergent existing registration", () => {
    const modules: Record<string, unknown> = {
      admin_action_log: { resolve: "./src/modules/other-module" },
    }
    expect(() => ensureAdminActionLogModuleRegistration(modules)).toThrow(
      "ADMIN_ACTION_LOG_CONFLICTING_REGISTRATION"
    )
    expect(modules.admin_action_log).toEqual({
      resolve: "./src/modules/other-module",
    })
  })
})

jest.mock(
  "pg-god",
  () => {
    const { Client } = jest.requireActual("pg") as typeof import("pg")

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
      return new Client({
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
  describe("AdminActionLog PostgreSQL routing", () => {
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

  jest.setTimeout(120_000)

  const beforeServerStartEvidence: {
    registered: boolean
    resolvePath: string | null
    alreadyPresent: boolean
  } = {
    registered: false,
    resolvePath: null,
    alreadyPresent: false,
  }

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    hooks: {
      beforeServerStart: async (container) => {
        const configModule = container.resolve(
          ContainerRegistrationKeys.CONFIG_MODULE
        ) as {
          modules?: Record<string, unknown>
        }

        if (
          !configModule.modules ||
          typeof configModule.modules !== "object" ||
          Array.isArray(configModule.modules)
        ) {
          throw new Error("ADMIN_ACTION_LOG_CONFIG_MODULE_INVALID")
        }

        const evidence = ensureAdminActionLogModuleRegistration(
          configModule.modules
        )
        beforeServerStartEvidence.registered = evidence.registered
        beforeServerStartEvidence.alreadyPresent = evidence.alreadyPresent
        beforeServerStartEvidence.resolvePath = evidence.resolvePath
      },
    },
    testSuite: ({ dbConnection, getContainer }) => {
      const resolveService = () =>
        getContainer().resolve(
          ADMIN_ACTION_LOG_MODULE
        ) as AdminActionLogModuleService

      const baseIntent = (
        overrides: Partial<AppendIntentInput> = {}
      ): AppendIntentInput => ({
        action_attempt_id: "attempt_base_01",
        correlation_id: "corr_base_01",
        admin_id: "user_admin_01",
        action: "refund_order",
        entity_type: "refund_request",
        entity_id: "refreq_base_01",
        result: "requested",
        previous_state: {},
        new_state: null,
        metadata: { order_id: "order_base_01" },
        idempotency_key: "idem_base_01",
        ...overrides,
      })

      it("registers admin_action_log before migrations and discovers DDL", async () => {
        expect(beforeServerStartEvidence.resolvePath).toBe(
          CANONICAL_ADMIN_ACTION_LOG_RESOLVE
        )
        expect(
          beforeServerStartEvidence.registered !==
            beforeServerStartEvidence.alreadyPresent
        ).toBe(true)

        const service = resolveService()
        expect(service).toBeTruthy()
        expect(typeof service.appendIntent).toBe("function")
        expect(typeof service.appendOutcome).toBe("function")
        expect(typeof service.appendReconciliation).toBe("function")
        expect(typeof service.listOrphanIntents).toBe("function")
        expect(typeof service.retrieveTerminalFact).toBe("function")

        const table = await dbConnection.raw(`
          select table_name
          from information_schema.tables
          where table_schema = 'public' and table_name = 'admin_action_log'
        `)
        const constraints = await dbConnection.raw(`
          select conname
          from pg_constraint
          where conrelid = 'admin_action_log'::regclass
          order by conname
        `)
        const indexes = await dbConnection.raw(`
          select indexname, indexdef
          from pg_indexes
          where schemaname = 'public' and tablename = 'admin_action_log'
          order by indexname
        `)
        const trigger = await dbConnection.raw(`
          select tgname
          from pg_trigger
          where tgrelid = 'admin_action_log'::regclass
            and not tgisinternal
        `)
        const fn = await dbConnection.raw(`
          select proname
          from pg_proc
          where proname = 'reject_admin_action_log_mutation'
        `)

        expect(table.rows).toEqual([{ table_name: "admin_action_log" }])
        expect(
          constraints.rows.map((row: { conname: string }) => row.conname)
        ).toEqual(
          expect.arrayContaining([
            "CK_admin_action_log_audit_stage",
            "CK_admin_action_log_result",
            "CK_admin_action_log_severity",
            "CK_admin_action_log_action",
            "CK_admin_action_log_entity_type",
            "CK_admin_action_log_intent_result",
            "admin_action_log_pkey",
          ])
        )

        const indexNames = indexes.rows.map(
          (row: { indexname: string }) => row.indexname
        )
        expect(indexNames).toEqual(
          expect.arrayContaining([
            "UQ_admin_action_log_attempt_intent",
            "UQ_admin_action_log_attempt_terminal",
            "IDX_admin_action_log_actor_created",
            "IDX_admin_action_log_entity_created",
            "IDX_admin_action_log_attempt_created",
            "IDX_admin_action_log_correlation_created",
            "IDX_admin_action_log_idempotency_key",
            "IDX_admin_action_log_orphan_scan",
          ])
        )

        const byName = Object.fromEntries(
          indexes.rows.map(
            (row: { indexname: string; indexdef: string }) => [
              row.indexname,
              row.indexdef,
            ]
          )
        )
        expect(byName.UQ_admin_action_log_attempt_intent).toMatch(
          /UNIQUE.*action_attempt_id.*audit_stage.*=.*'intent'/i
        )
        expect(byName.UQ_admin_action_log_attempt_terminal).toMatch(
          /UNIQUE.*action_attempt_id.*audit_stage.*outcome.*reconciliation/i
        )
        expect(byName.IDX_admin_action_log_idempotency_key).toMatch(
          /idempotency_key/i
        )
        expect(byName.IDX_admin_action_log_idempotency_key).not.toMatch(
          /UNIQUE/i
        )

        expect(trigger.rows).toEqual([
          { tgname: "TRG_admin_action_log_append_only" },
        ])
        expect(fn.rows).toEqual([
          { proname: "reject_admin_action_log_mutation" },
        ])
      })

      it("allows one intent and one outcome for the same attempt", async () => {
        const service = resolveService()
        const intent = await service.appendIntent(
          baseIntent({ action_attempt_id: "attempt_pair_01" })
        )
        const outcome = await service.appendOutcome({
          ...baseIntent({ action_attempt_id: "attempt_pair_01" }),
          result: "requested",
          new_state: {
            status: "requested",
            amount: 1500,
            currency_code: "brl",
          },
        })

        const rows = await dbConnection.raw(
          `
            select audit_stage, result
            from admin_action_log
            where action_attempt_id = ?
            order by created_at asc, id asc
          `,
          ["attempt_pair_01"]
        )

        expect(intent.audit_stage).toBe("intent")
        expect(outcome.audit_stage).toBe("outcome")
        expect(rows.rows).toEqual([
          { audit_stage: "intent", result: "requested" },
          { audit_stage: "outcome", result: "requested" },
        ])
      })

      it("rejects UPDATE, DELETE and soft-delete mutations", async () => {
        const service = resolveService()
        const intent = await service.appendIntent(
          baseIntent({ action_attempt_id: "attempt_immutable_01" })
        )

        await expect(
          dbConnection.raw(
            `update admin_action_log set reason = 'mutated' where id = ?`,
            [intent.id]
          )
        ).rejects.toThrow(/ADMIN_ACTION_LOG_APPEND_ONLY/)

        await expect(
          dbConnection.raw(`delete from admin_action_log where id = ?`, [
            intent.id,
          ])
        ).rejects.toThrow(/ADMIN_ACTION_LOG_APPEND_ONLY/)

        await expect(
          dbConnection.raw(
            `update admin_action_log set deleted_at = now() where id = ?`,
            [intent.id]
          )
        ).rejects.toThrow(/ADMIN_ACTION_LOG_APPEND_ONLY/)

        const persisted = await dbConnection.raw(
          `select reason, deleted_at from admin_action_log where id = ?`,
          [intent.id]
        )
        expect(persisted.rows).toEqual([{ reason: null, deleted_at: null }])
      })

      it("dedupes concurrent intents to one canonical row", async () => {
        const service = resolveService()
        const rows = await Promise.all(
          Array.from({ length: 8 }, () =>
            service.appendIntent(
              baseIntent({
                action_attempt_id: "attempt_intent_race",
                correlation_id: "corr_intent_race",
              })
            )
          )
        )

        const cardinality = await dbConnection.raw(
          `
            select count(*)::int as count
            from admin_action_log
            where action_attempt_id = 'attempt_intent_race'
              and audit_stage = 'intent'
          `
        )

        expect(new Set(rows.map((row) => row.id)).size).toBe(1)
        expect(cardinality.rows).toEqual([{ count: 1 }])
      })

      it("dedupes concurrent outcomes to one terminal fact", async () => {
        const service = resolveService()
        await service.appendIntent(
          baseIntent({ action_attempt_id: "attempt_outcome_race" })
        )

        const rows = await Promise.all(
          Array.from({ length: 8 }, (_, index) =>
            service.appendOutcome({
              ...baseIntent({
                action_attempt_id: "attempt_outcome_race",
              }),
              result: index % 2 === 0 ? "succeeded" : "failed",
            })
          )
        )

        const cardinality = await dbConnection.raw(
          `
            select count(*)::int as count, array_agg(distinct audit_stage) as stages
            from admin_action_log
            where action_attempt_id = 'attempt_outcome_race'
              and audit_stage in ('outcome', 'reconciliation')
          `
        )

        expect(new Set(rows.map((row) => row.id)).size).toBe(1)
        expect(cardinality.rows[0].count).toBe(1)
        expect(rows.every((row) => row.id === rows[0].id)).toBe(true)
      })

      it("outcome versus reconciliation yields one canonical terminal", async () => {
        const service = resolveService()
        await service.appendIntent(
          baseIntent({
            action_attempt_id: "attempt_terminal_race",
            entity_id: "refreq_terminal_race",
          })
        )

        const [outcome, reconciliation] = await Promise.all([
          service.appendOutcome({
            ...baseIntent({
              action_attempt_id: "attempt_terminal_race",
              entity_id: "refreq_terminal_race",
            }),
            result: "requested",
          }),
          service.appendReconciliation({
            ...baseIntent({
              action_attempt_id: "attempt_terminal_race",
              entity_id: "refreq_terminal_race",
            }),
            result: "requested",
          }),
        ])

        const terminals = await dbConnection.raw(
          `
            select id, audit_stage
            from admin_action_log
            where action_attempt_id = 'attempt_terminal_race'
              and audit_stage in ('outcome', 'reconciliation')
          `
        )

        expect(terminals.rows).toHaveLength(1)
        expect(new Set([outcome.id, reconciliation.id]).size).toBe(1)
        expect(outcome.id).toBe(reconciliation.id)
      })

      it("two workers reconciling the same orphan produce one terminal", async () => {
        const service = resolveService()
        await service.appendIntent(
          baseIntent({
            action_attempt_id: "attempt_worker_race",
            entity_id: "refreq_worker_race",
          })
        )

        const [first, second] = await Promise.all([
          service.appendReconciliation({
            ...baseIntent({
              action_attempt_id: "attempt_worker_race",
              entity_id: "refreq_worker_race",
            }),
            result: "requested",
          }),
          service.appendReconciliation({
            ...baseIntent({
              action_attempt_id: "attempt_worker_race",
              entity_id: "refreq_worker_race",
            }),
            result: "requested",
          }),
        ])

        const terminals = await dbConnection.raw(
          `
            select count(*)::int as count
            from admin_action_log
            where action_attempt_id = 'attempt_worker_race'
              and audit_stage = 'reconciliation'
          `
        )

        expect(first.id).toBe(second.id)
        expect(terminals.rows).toEqual([{ count: 1 }])
      })

      it("retries with a new action_attempt_id create a new attempt pair", async () => {
        const service = resolveService()
        const first = await service.appendIntent(
          baseIntent({
            action_attempt_id: "attempt_retry_a",
            idempotency_key: "idem_shared_retry",
          })
        )
        await service.appendOutcome({
          ...baseIntent({
            action_attempt_id: "attempt_retry_a",
            idempotency_key: "idem_shared_retry",
          }),
          result: "failed",
        })

        const second = await service.appendIntent(
          baseIntent({
            action_attempt_id: "attempt_retry_b",
            correlation_id: "corr_retry_shared",
            idempotency_key: "idem_shared_retry",
            metadata: { reused_idempotency: true },
          })
        )

        const rows = await dbConnection.raw(`
          select action_attempt_id, audit_stage, idempotency_key
          from admin_action_log
          where action_attempt_id in ('attempt_retry_a', 'attempt_retry_b')
          order by action_attempt_id, audit_stage
        `)

        expect(first.id).not.toBe(second.id)
        expect(rows.rows).toHaveLength(3)
        expect(
          rows.rows.every(
            (row: { idempotency_key: string }) =>
              row.idempotency_key === "idem_shared_retry"
          )
        ).toBe(true)
      })

      it("allows repeated correlation_id without global uniqueness", async () => {
        const service = resolveService()
        await service.appendIntent(
          baseIntent({
            action_attempt_id: "attempt_corr_a",
            correlation_id: "corr_repeated",
          })
        )
        await service.appendIntent(
          baseIntent({
            action_attempt_id: "attempt_corr_b",
            correlation_id: "corr_repeated",
            entity_id: "refreq_corr_b",
          })
        )

        const rows = await dbConnection.raw(`
          select count(*)::int as count
          from admin_action_log
          where correlation_id = 'corr_repeated'
            and audit_stage = 'intent'
        `)
        expect(rows.rows).toEqual([{ count: 2 }])
      })

      it("returns the canonical fact on expected conflicts without overwrite", async () => {
        const service = resolveService()
        const firstIntent = await service.appendIntent(
          baseIntent({
            action_attempt_id: "attempt_canonical",
            reason: "first",
          })
        )
        const secondIntent = await service.appendIntent(
          baseIntent({
            action_attempt_id: "attempt_canonical",
            reason: "second-should-not-win",
          })
        )
        const firstOutcome = await service.appendOutcome({
          ...baseIntent({ action_attempt_id: "attempt_canonical" }),
          result: "succeeded",
          reason: "terminal-first",
        })
        const secondOutcome = await service.appendOutcome({
          ...baseIntent({ action_attempt_id: "attempt_canonical" }),
          result: "failed",
          reason: "terminal-second",
        })

        expect(secondIntent.id).toBe(firstIntent.id)
        expect(secondIntent.reason).toBe("first")
        expect(secondOutcome.id).toBe(firstOutcome.id)
        expect(secondOutcome.reason).toBe("terminal-first")

        const overwritten = await dbConnection.raw(
          `
            select count(*)::int as count
            from admin_action_log
            where action_attempt_id = 'attempt_canonical'
              and reason in ('second-should-not-win', 'terminal-second')
          `
        )
        expect(overwritten.rows).toEqual([{ count: 0 }])
      })
    },
  })
}
