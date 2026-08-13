import { createCustomerAccountWorkflow } from "@medusajs/core-flows"
import { Modules } from "@medusajs/framework/utils"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"
import {
  CUSTOMER_AUTH_TRANSACTION_CAPABILITIES,
  classifyCustomerAuthTransactionEvidence,
  identifyCustomerAuthQueryRunner,
  identifyCustomerAuthTransactionManager,
  isCustomerAuthRecoveryFailClosed,
  resolveCustomerAuthTransactionalKnex,
  type CustomerAuthSeam,
  type CustomerAuthSeamEvidence,
  type CustomerAuthTransactionManagerLike,
  type CustomerAuthTransactionalRepositoryLike,
} from "../../src/infrastructure/customer-auth-transaction-compatibility"

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

type AuthResponse = {
  success: boolean
  authIdentity?: { id: string }
  error?: string
}

type AuthServiceLike = {
  baseRepository_: CustomerAuthTransactionalRepositoryLike
  providerIdentityService_: {
    __providerIdentityRepository__: ObservableRepositoryLike
  }
  register(provider: string, data: Record<string, unknown>): Promise<AuthResponse>
  updateProvider(
    provider: string,
    data: Record<string, unknown>
  ): Promise<AuthResponse>
  authenticate(
    provider: string,
    data: Record<string, unknown>
  ): Promise<AuthResponse>
}

type CustomerServiceLike = {
  customerService_: {
    __customerRepository__: ObservableRepositoryLike
  }
}

type ObservableRepositoryLike = {
  getActiveManager(
    context?: Record<string, unknown>
  ): CustomerAuthTransactionManagerLike
}

type ManagerObservation = {
  managerIdentity: string
  queryRunnerIdentity: string
}

type ScenarioResult = {
  customManagerIdentity: string
  customQueryRunnerIdentity: string
  customTransactionId: string
  effectManagers: ManagerObservation[]
  effectTransactionIds: string[]
  customPersisted: boolean
  authPersisted: boolean
  customerPersisted: boolean
}

const PROBE_TABLE = "p14_auth_tx_probe"
const AUDIT_TABLE = "p14_auth_tx_audit"
const INJECTED_FAULT = "P14_AUTH_TX_INJECTED_FAULT"

function observeRepository(repository: ObservableRepositoryLike) {
  if (!repository || typeof repository.getActiveManager !== "function") {
    throw new Error("P14_AUTH_TX_MANAGER_UNOBSERVABLE")
  }

  const ownDescriptor = Object.getOwnPropertyDescriptor(
    repository,
    "getActiveManager"
  )
  let prototype: object | null = Object.getPrototypeOf(repository)
  let prototypeMethod:
    | ObservableRepositoryLike["getActiveManager"]
    | undefined

  while (prototype && !prototypeMethod) {
    const descriptor = Object.getOwnPropertyDescriptor(
      prototype,
      "getActiveManager"
    )
    if (typeof descriptor?.value === "function") {
      prototypeMethod = descriptor.value as ObservableRepositoryLike["getActiveManager"]
      break
    }
    prototype = Object.getPrototypeOf(prototype)
  }

  if (!prototypeMethod) {
    throw new Error("P14_AUTH_TX_MANAGER_UNOBSERVABLE")
  }

  const original = (context: Record<string, unknown> = {}) =>
    prototypeMethod!.call(repository, context)
  const observations: ManagerObservation[] = []

  repository.getActiveManager = (context = {}) => {
    const manager = original(context)
    observations.push({
      managerIdentity: identifyCustomerAuthTransactionManager(manager),
      queryRunnerIdentity: identifyCustomerAuthQueryRunner(
        resolveCustomerAuthTransactionalKnex(manager)
      ),
    })
    return manager
  }

  return {
    observations,
    restore: () => {
      if (ownDescriptor) {
        Object.defineProperty(repository, "getActiveManager", ownDescriptor)
      } else {
        delete (repository as Partial<ObservableRepositoryLike>).getActiveManager
      }
    },
  }
}

function uniqueObservations(
  observations: ManagerObservation[]
): ManagerObservation[] {
  return Array.from(
    new Map(
      observations.map((observation) => [
        `${observation.managerIdentity}:${observation.queryRunnerIdentity}`,
        observation,
      ])
    ).values()
  )
}

if (!requestedDatabaseName) {
  describe("customer auth transaction compatibility", () => {
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

  jest.setTimeout(300_000)

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      const authService = () =>
        getContainer().resolve(Modules.AUTH) as AuthServiceLike
      const customerService = () =>
        getContainer().resolve(Modules.CUSTOMER) as CustomerServiceLike

      const readCount = async (sql: string, bindings: unknown[] = []) => {
        const result = await dbConnection.raw(sql, bindings)
        return Number(result.rows[0]?.count ?? 0)
      }

      const setupProbeSchema = async () => {
        await dbConnection.raw(`
          create table if not exists ${PROBE_TABLE} (
            id text primary key,
            seam text not null,
            phase text not null,
            transaction_id bigint not null
          )
        `)
        await dbConnection.raw(`
          create table if not exists ${AUDIT_TABLE} (
            id bigserial primary key,
            effect text not null,
            entity_key text not null,
            transaction_id bigint not null
          )
        `)
        await dbConnection.raw(`
          create or replace function p14_auth_tx_provider_audit()
          returns trigger language plpgsql as $$
          begin
            insert into ${AUDIT_TABLE} (effect, entity_key, transaction_id)
            values ('auth_provider', new.entity_id, txid_current());
            return new;
          end
          $$
        `)
        await dbConnection.raw(`
          drop trigger if exists p14_auth_tx_provider_update on provider_identity;
          create trigger p14_auth_tx_provider_update
          after update on provider_identity
          for each row execute function p14_auth_tx_provider_audit()
        `)
        await dbConnection.raw(`
          create or replace function p14_auth_tx_customer_audit()
          returns trigger language plpgsql as $$
          begin
            insert into ${AUDIT_TABLE} (effect, entity_key, transaction_id)
            values ('customer', new.email, txid_current());
            return new;
          end
          $$
        `)
        await dbConnection.raw(`
          drop trigger if exists p14_auth_tx_customer_insert on customer;
          create trigger p14_auth_tx_customer_insert
          after insert on customer
          for each row execute function p14_auth_tx_customer_audit()
        `)
      }

      const cleanupProbeSchema = async () => {
        await dbConnection.raw(
          "drop trigger if exists p14_auth_tx_provider_update on provider_identity"
        )
        await dbConnection.raw(
          "drop trigger if exists p14_auth_tx_customer_insert on customer"
        )
        await dbConnection.raw(
          "drop function if exists p14_auth_tx_provider_audit()"
        )
        await dbConnection.raw(
          "drop function if exists p14_auth_tx_customer_audit()"
        )
        await dbConnection.raw(`drop table if exists ${AUDIT_TABLE}`)
        await dbConnection.raw(`drop table if exists ${PROBE_TABLE}`)
      }

      const seedIdentity = async (email: string, password: string) => {
        const result = await authService().register("emailpass", {
          actor_type: "customer",
          body: { email, password },
        })
        expect(result.success).toBe(true)
        expect(result.authIdentity?.id).toBeTruthy()
        return result.authIdentity!.id
      }

      const runScenario = async (
        seam: CustomerAuthSeam,
        phase: "commit" | "fault"
      ): Promise<ScenarioResult> => {
        const suffix = `${seam}_${phase}`.replace(/[^a-z_]/g, "_")
        const email = `p14-${suffix}@example.test`
        const oldPassword = `Old-${suffix}-Password-1!`
        const newPassword = `New-${suffix}-Password-2!`
        const authIdentityId = await seedIdentity(email, oldPassword)
        const probeId = `probe_${suffix}`

        const effectObservers: Array<ReturnType<typeof observeRepository>> = []
        if (seam === "auth_provider" || seam === "combined") {
          effectObservers.push(
            observeRepository(
              authService().providerIdentityService_
                .__providerIdentityRepository__
            )
          )
        }
        if (seam === "customer_workflow" || seam === "combined") {
          effectObservers.push(
            observeRepository(
              customerService().customerService_.__customerRepository__
            )
          )
        }

        let customManagerIdentity = ""
        let customQueryRunnerIdentity = ""
        let customTransactionId = ""

        try {
          const execution = authService().baseRepository_.transaction(
            async (transactionManager) => {
              customManagerIdentity =
                identifyCustomerAuthTransactionManager(transactionManager)
              const knex = resolveCustomerAuthTransactionalKnex(transactionManager)
              customQueryRunnerIdentity = identifyCustomerAuthQueryRunner(knex)
              const tx = await knex.raw(
                "select txid_current()::text as transaction_id"
              )
              customTransactionId = String(tx.rows?.[0]?.transaction_id ?? "")

              await knex.raw(
                `insert into ${PROBE_TABLE} (id, seam, phase, transaction_id) values (?, ?, ?, txid_current())`,
                [probeId, seam, phase]
              )

              if (seam === "auth_provider" || seam === "combined") {
                const updated = await authService().updateProvider("emailpass", {
                  entity_id: email,
                  password: newPassword,
                })
                if (!updated.success) {
                  throw new Error(
                    `P14_AUTH_PROVIDER_UPDATE_FAILED:${updated.error ?? "unknown"}`
                  )
                }
              }

              if (seam === "customer_workflow" || seam === "combined") {
                await createCustomerAccountWorkflow(getContainer()).run({
                  input: {
                    authIdentityId,
                    customerData: {
                      email,
                      first_name: "P14",
                      last_name: "Probe",
                    },
                  },
                })
              }

              if (phase === "fault") {
                throw new Error(INJECTED_FAULT)
              }
            }
          )

          if (phase === "fault") {
            await expect(execution).rejects.toThrow(INJECTED_FAULT)
          } else {
            await execution
          }
        } finally {
          for (const observer of effectObservers) {
            observer.restore()
          }
        }

        const customPersisted =
          (await readCount(
            `select count(*)::int as count from ${PROBE_TABLE} where id = ?`,
            [probeId]
          )) === 1

        const newAuth = await authService().authenticate("emailpass", {
          actor_type: "customer",
          body: { email, password: newPassword },
        })
        const customerPersisted =
          (await readCount(
            "select count(*)::int as count from customer where email = ? and deleted_at is null",
            [email]
          )) === 1

        const audit = await dbConnection.raw(
          `select distinct transaction_id::text as transaction_id
           from ${AUDIT_TABLE}
           where entity_key = ?
           order by transaction_id::text`,
          [email]
        )

        return {
          customManagerIdentity,
          customQueryRunnerIdentity,
          customTransactionId,
          effectManagers: uniqueObservations(
            effectObservers.flatMap((observer) => observer.observations)
          ),
          effectTransactionIds: audit.rows.map((row: { transaction_id: string }) =>
            String(row.transaction_id)
          ),
          customPersisted,
          authPersisted:
            seam === "auth_provider" || seam === "combined"
              ? newAuth.success
              : false,
          customerPersisted,
        }
      }

      beforeAll(setupProbeSchema)
      it("observes real managers/query runners and classifies all three seams from commit plus rollback evidence", async () => {
        const seams: CustomerAuthSeam[] = [
          "auth_provider",
          "customer_workflow",
          "combined",
        ]
        const matrix: CustomerAuthSeamEvidence[] = []

        for (const seam of seams) {
          const commit = await runScenario(seam, "commit")
          const fault = await runScenario(seam, "fault")
          const requiresAuth = seam === "auth_provider" || seam === "combined"
          const requiresCustomer =
            seam === "customer_workflow" || seam === "combined"

          expect(commit.customPersisted).toBe(true)
          expect(requiresAuth ? commit.authPersisted : true).toBe(true)
          expect(requiresCustomer ? commit.customerPersisted : true).toBe(true)
          expect(fault.customPersisted).toBe(false)
          expect(commit.customManagerIdentity).toBeTruthy()
          expect(commit.customQueryRunnerIdentity).toBeTruthy()
          expect(commit.customTransactionId).toBeTruthy()
          expect(commit.effectManagers.length).toBeGreaterThan(0)
          expect(commit.effectTransactionIds.length).toBeGreaterThan(0)

          const medusaEffectSurvived =
            (requiresAuth && fault.authPersisted) ||
            (requiresCustomer && fault.customerPersisted)

          const evidence: CustomerAuthSeamEvidence = {
            seam,
            managerIdentity: {
              custom: commit.customManagerIdentity,
              medusa: commit.effectManagers.map(
                (observation) => observation.managerIdentity
              ),
            },
            queryRunnerIdentity: {
              custom: commit.customQueryRunnerIdentity,
              medusa: commit.effectManagers.map(
                (observation) => observation.queryRunnerIdentity
              ),
            },
            transactionIds: {
              custom: commit.customTransactionId,
              medusa: commit.effectTransactionIds,
            },
            commit: {
              custom: commit.customPersisted,
              authProvider: requiresAuth ? commit.authPersisted : null,
              customer: requiresCustomer ? commit.customerPersisted : null,
            },
            faultRollback: {
              custom: !fault.customPersisted,
              authProvider: requiresAuth ? !fault.authPersisted : null,
              customer: requiresCustomer ? !fault.customerPersisted : null,
            },
            failClosed: medusaEffectSurvived
              ? {
                  claimed: isCustomerAuthRecoveryFailClosed("claimed"),
                  credentialUpdated:
                    isCustomerAuthRecoveryFailClosed("credential_updated"),
                  stable: isCustomerAuthRecoveryFailClosed("stable"),
                }
              : null,
          }

          evidence.capability =
            classifyCustomerAuthTransactionEvidence(evidence)
          matrix.push(evidence)
          expect(evidence.capability).toBe(
            CUSTOMER_AUTH_TRANSACTION_CAPABILITIES[seam]
          )

          if (medusaEffectSurvived) {
            expect(evidence.capability).toBe("RECONCILIATION_REQUIRED")
            expect(evidence.failClosed).toEqual({
              claimed: true,
              credentialUpdated: true,
              stable: false,
            })
          } else {
            expect(evidence.capability).toBe("SUPPORTED_STRONG")
          }
        }

        process.stdout.write(
          `P14_TX_EVIDENCE ${JSON.stringify({ databaseName, matrix })}\n`
        )
        await cleanupProbeSchema()
      })
    },
  })
}
