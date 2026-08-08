/**
 * Wave 0 feasibility probe for Store foundation transactional atomicity.
 *
 * Proves a Medusa-controlled mutation and a version CAS can share one
 * PostgreSQL transaction manager / single commit (FND-06 / D13-24).
 *
 * Intentionally NOT a StoreResourceVersion module or product migration —
 * probe tables exist only inside disposable PostgreSQL.
 */

export const STORE_FOUNDATION_PROBE_MUTATION_TABLE =
  "store_foundation_tx_probe_mutation"
export const STORE_FOUNDATION_PROBE_VERSION_TABLE =
  "store_foundation_tx_probe_version"

export const STORE_FOUNDATION_CAS_CONFLICT = "STORE_FOUNDATION_CAS_CONFLICT"
export const STORE_FOUNDATION_INJECTED_FAILURE =
  "STORE_FOUNDATION_INJECTED_FAILURE"
export const STORE_FOUNDATION_LOCKING_UNAVAILABLE =
  "STORE_FOUNDATION_LOCKING_UNAVAILABLE"

export type KnexQueryResult = { rows?: Array<Record<string, unknown>> }

export type KnexLike = {
  raw: (
    sql: string,
    bindings?: unknown[]
  ) => Promise<KnexQueryResult> | KnexQueryResult
  schema: {
    hasTable: (name: string) => Promise<boolean>
    createTable: (
      name: string,
      builder: (table: {
        text: (column: string) => { primary: () => unknown }
        bigInteger: (column: string) => {
          notNullable: () => { defaultTo: (value: number) => unknown }
        }
        timestamp: (
          column: string,
          options?: { useTz?: boolean }
        ) => { defaultTo: (value: unknown) => unknown }
      }) => void
    ) => Promise<unknown>
    dropTableIfExists: (name: string) => Promise<unknown>
  }
  fn?: { now: () => unknown }
}

export type TransactionalManagerLike = object & {
  getKnex?: () => KnexLike
  getTransactionContext?: () => KnexLike | undefined | null
}

export type SharedTransactionContext = {
  __type: "MedusaContext"
  transactionManager: TransactionalManagerLike
  manager?: TransactionalManagerLike
}

export type TransactionalRepositoryLike = {
  transaction: <T>(
    task: (transactionManager: TransactionalManagerLike) => Promise<T>,
    options?: {
      transaction?: TransactionalManagerLike
      enableNestedTransactions?: boolean
      isolationLevel?: string
    }
  ) => Promise<T>
  getActiveManager: (context?: {
    transactionManager?: TransactionalManagerLike
    manager?: TransactionalManagerLike
  }) => TransactionalManagerLike
}

export type OptionalLockingCoordinator = {
  /**
   * Optional short-lived coordination lock (Redis Locking stand-in).
   * Failure/absence must not decide CAS correctness.
   */
  acquire?: (resourceKey: string) => Promise<void>
  release?: (resourceKey: string) => Promise<void>
}

const managerIdentityRegistry = new WeakMap<object, string>()
let managerIdentitySeq = 0

export function identifyTransactionManager(
  manager: TransactionalManagerLike
): string {
  const existing = managerIdentityRegistry.get(manager)
  if (existing) {
    return existing
  }
  managerIdentitySeq += 1
  const token = `tm_${managerIdentitySeq}`
  managerIdentityRegistry.set(manager, token)
  return token
}

export function resolveTransactionalKnex(
  manager: TransactionalManagerLike
): KnexLike {
  const fromTransaction = manager.getTransactionContext?.()
  if (fromTransaction) {
    return fromTransaction
  }
  const knex = manager.getKnex?.()
  if (!knex) {
    throw new Error("STORE_FOUNDATION_TRANSACTION_KNEX_UNAVAILABLE")
  }
  return knex
}

async function queryRows(
  knex: KnexLike,
  sql: string,
  bindings: unknown[] = []
): Promise<Array<Record<string, unknown>>> {
  const result = await knex.raw(sql, bindings)
  return result.rows ?? []
}

export async function ensureStoreFoundationProbeTables(
  knex: KnexLike
): Promise<void> {
  const hasMutation = await knex.schema.hasTable(
    STORE_FOUNDATION_PROBE_MUTATION_TABLE
  )
  if (!hasMutation) {
    await knex.schema.createTable(
      STORE_FOUNDATION_PROBE_MUTATION_TABLE,
      (table) => {
        table.text("id").primary()
        table.text("resource_key")
        table.text("marker")
        table.timestamp("created_at", { useTz: true }).defaultTo(knex.fn?.now())
      }
    )
  }

  const hasVersion = await knex.schema.hasTable(
    STORE_FOUNDATION_PROBE_VERSION_TABLE
  )
  if (!hasVersion) {
    await knex.schema.createTable(
      STORE_FOUNDATION_PROBE_VERSION_TABLE,
      (table) => {
        table.text("resource_key").primary()
        table.bigInteger("version").notNullable().defaultTo(0)
        table.timestamp("updated_at", { useTz: true }).defaultTo(knex.fn?.now())
      }
    )
  }
}

export async function seedStoreFoundationProbeVersion(
  knex: KnexLike,
  resourceKey: string,
  version = 1
): Promise<void> {
  await knex.raw(
    `
      insert into ${STORE_FOUNDATION_PROBE_VERSION_TABLE} (resource_key, version, updated_at)
      values (?, ?, now())
      on conflict (resource_key)
      do update set version = excluded.version, updated_at = now()
    `,
    [resourceKey, version]
  )
}

export async function readStoreFoundationProbeVersion(
  knex: KnexLike,
  resourceKey: string
): Promise<number | null> {
  const rows = await queryRows(
    knex,
    `select version::bigint as version from ${STORE_FOUNDATION_PROBE_VERSION_TABLE} where resource_key = ?`,
    [resourceKey]
  )
  if (rows.length === 0) {
    return null
  }
  return Number(rows[0].version)
}

export async function countStoreFoundationProbeMutations(
  knex: KnexLike,
  resourceKey: string
): Promise<number> {
  const rows = await queryRows(
    knex,
    `select count(*)::int as count from ${STORE_FOUNDATION_PROBE_MUTATION_TABLE} where resource_key = ?`,
    [resourceKey]
  )
  return Number(rows[0]?.count ?? 0)
}

export type AtomicMutationCasInput = {
  repository: TransactionalRepositoryLike
  /**
   * Controlled Medusa module mutation that MUST honor sharedContext.transactionManager.
   */
  medusaMutation: (sharedContext: SharedTransactionContext) => Promise<void>
  resourceKey: string
  expectedVersion: number
  mutationId: string
  mutationMarker: string
  /**
   * Inject failure AFTER a successful CAS UPDATE and BEFORE COMMIT.
   * Distinct from any pre-CAS failure path — required for rollback proof.
   */
  injectErrorAfterCas?: boolean
  /**
   * Test/probe hook invoked only after CAS UPDATE returned a winner row.
   * Used to prove CAS executed inside the transaction even when rollback follows.
   */
  onCasSucceeded?: (info: {
    previousVersion: number
    newVersion: number
    casTransactionId: string
  }) => void
  locking?: OptionalLockingCoordinator
}

export type AtomicMutationCasResult = {
  transactionManagerIdentity: string
  activeManagerIdentity: string
  mutationManagerIdentity: string
  casManagerIdentity: string
  sameManager: boolean
  transactionId: string
  mutationTransactionId: string
  casTransactionId: string
  sameTransactionId: boolean
  casWon: boolean
  newVersion: number | null
}

async function readTxId(knex: KnexLike): Promise<string> {
  const rows = await queryRows(knex, "select txid_current()::text as txid")
  return String(rows[0]?.txid ?? "")
}

export async function runAtomicMedusaMutationWithVersionCas(
  input: AtomicMutationCasInput
): Promise<AtomicMutationCasResult> {
  let lockingHeld = false

  if (input.locking?.acquire) {
    try {
      await input.locking.acquire(input.resourceKey)
      lockingHeld = true
    } catch {
      // Redis/locking absence or failure must not decide PostgreSQL CAS truth.
    }
  }

  try {
    return await input.repository.transaction(async (transactionManager) => {
      const transactionManagerIdentity =
        identifyTransactionManager(transactionManager)
      const activeManager = input.repository.getActiveManager({
        transactionManager,
      })
      const activeManagerIdentity = identifyTransactionManager(activeManager)

      if (activeManager !== transactionManager) {
        throw new Error("STORE_FOUNDATION_ACTIVE_MANAGER_MISMATCH")
      }

      const sharedContext: SharedTransactionContext = {
        __type: "MedusaContext",
        transactionManager,
        manager: transactionManager,
      }

      const knex = resolveTransactionalKnex(transactionManager)
      const transactionId = await readTxId(knex)

      await input.medusaMutation(sharedContext)

      const mutationManager = input.repository.getActiveManager(sharedContext)
      const mutationManagerIdentity = identifyTransactionManager(mutationManager)
      const mutationKnex = resolveTransactionalKnex(mutationManager)
      const mutationTransactionId = await readTxId(mutationKnex)

      await mutationKnex.raw(
        `
          insert into ${STORE_FOUNDATION_PROBE_MUTATION_TABLE}
            (id, resource_key, marker, created_at)
          values (?, ?, ?, now())
        `,
        [input.mutationId, input.resourceKey, input.mutationMarker]
      )

      const casManager = input.repository.getActiveManager({
        transactionManager,
      })
      const casManagerIdentity = identifyTransactionManager(casManager)
      const casKnex = resolveTransactionalKnex(casManager)
      const casTransactionId = await readTxId(casKnex)

      const updated = await queryRows(
        casKnex,
        `
          update ${STORE_FOUNDATION_PROBE_VERSION_TABLE}
          set version = version + 1, updated_at = now()
          where resource_key = ? and version = ?
          returning version::bigint as version
        `,
        [input.resourceKey, input.expectedVersion]
      )

      if (updated.length === 0) {
        throw new Error(STORE_FOUNDATION_CAS_CONFLICT)
      }

      const newVersion = Number(updated[0].version)

      // Prove CAS applied inside this transaction before any injected failure.
      const versionInsideTx = await readStoreFoundationProbeVersion(
        casKnex,
        input.resourceKey
      )
      if (versionInsideTx !== newVersion) {
        throw new Error("STORE_FOUNDATION_CAS_VISIBLE_VERSION_MISMATCH")
      }

      input.onCasSucceeded?.({
        previousVersion: input.expectedVersion,
        newVersion,
        casTransactionId,
      })

      if (input.injectErrorAfterCas) {
        throw new Error(STORE_FOUNDATION_INJECTED_FAILURE)
      }

      const sameManager =
        transactionManager === activeManager &&
        transactionManager === mutationManager &&
        transactionManager === casManager

      return {
        transactionManagerIdentity,
        activeManagerIdentity,
        mutationManagerIdentity,
        casManagerIdentity,
        sameManager,
        transactionId,
        mutationTransactionId,
        casTransactionId,
        sameTransactionId:
          transactionId === mutationTransactionId &&
          transactionId === casTransactionId &&
          transactionId.length > 0,
        casWon: true,
        newVersion,
      }
    })
  } finally {
    if (lockingHeld && input.locking?.release) {
      try {
        await input.locking.release(input.resourceKey)
      } catch {
        // ignore release failures in probe
      }
    }
  }
}

export type CompetingCasWriterResult = {
  index: number
  ok: boolean
  errorCode: string | null
  result: AtomicMutationCasResult | null
}

/**
 * Two writers with the same expected version — exactly one PostgreSQL CAS winner.
 */
export async function competeStoreFoundationCasWriters(input: {
  repositoryFactory: () => TransactionalRepositoryLike
  medusaMutationFactory: (
    index: number
  ) => (sharedContext: SharedTransactionContext) => Promise<void>
  resourceKey: string
  expectedVersion: number
  lockingFactory?: (index: number) => OptionalLockingCoordinator
  writerCount?: number
}): Promise<CompetingCasWriterResult[]> {
  const writerCount = input.writerCount ?? 2
  let released = false
  const gate = new Promise<void>((resolve) => {
    const poll = () => {
      if (released) {
        resolve()
        return
      }
      setImmediate(poll)
    }
    poll()
  })

  const workers = Array.from({ length: writerCount }, (_, index) =>
    (async (): Promise<CompetingCasWriterResult> => {
      await gate
      try {
        const result = await runAtomicMedusaMutationWithVersionCas({
          repository: input.repositoryFactory(),
          medusaMutation: input.medusaMutationFactory(index),
          resourceKey: input.resourceKey,
          expectedVersion: input.expectedVersion,
          mutationId: `probe_mut_${index}_${Date.now()}`,
          mutationMarker: `writer_${index}`,
          locking: input.lockingFactory?.(index),
        })
        return { index, ok: true, errorCode: null, result }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown")
        return {
          index,
          ok: false,
          errorCode: message.includes(STORE_FOUNDATION_CAS_CONFLICT)
            ? STORE_FOUNDATION_CAS_CONFLICT
            : message,
          result: null,
        }
      }
    })()
  )

  released = true
  return Promise.all(workers)
}

export function createFailingRedisLockingCoordinator(): OptionalLockingCoordinator {
  return {
    acquire: async () => {
      throw new Error(STORE_FOUNDATION_LOCKING_UNAVAILABLE)
    },
    release: async () => {
      throw new Error(STORE_FOUNDATION_LOCKING_UNAVAILABLE)
    },
  }
}
