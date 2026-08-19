/**
 * Phase 14 execution-time compatibility boundary.
 *
 * This file does not claim cross-module atomicity. A seam is strong only when
 * executable disposable-PostgreSQL evidence proves the same manager, query
 * runner and transaction id and proves rollback of every custom/Medusa write.
 */

export type CustomerAuthTransactionCapability =
  | "SUPPORTED_STRONG"
  | "RECONCILIATION_REQUIRED"

export type CustomerAuthSeam =
  | "auth_provider"
  | "customer_workflow"
  | "combined"

export type CustomerAuthTransactionCapabilityMatrix = Record<
  CustomerAuthSeam,
  CustomerAuthTransactionCapability
>

/**
 * Selected only after the 14-03 disposable-PostgreSQL probe observed distinct
 * managers/query runners/transaction ids and surviving Medusa writes on fault.
 */
export const CUSTOMER_AUTH_TRANSACTION_CAPABILITIES = {
  auth_provider: "RECONCILIATION_REQUIRED",
  customer_workflow: "RECONCILIATION_REQUIRED",
  combined: "RECONCILIATION_REQUIRED",
} as const satisfies CustomerAuthTransactionCapabilityMatrix

export type CustomerAuthRecoveryStatus =
  | "stable"
  | "claimed"
  | "provider_outcome_ambiguous"
  | "credential_proved"
  | "credential_updated"
  | "revocation_pending"
  | "revocation_committed"
  | "completed"

export type CustomerAuthKnexResult = {
  rows?: Array<Record<string, unknown>>
}

export type CustomerAuthKnexLike = object & {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<CustomerAuthKnexResult> | CustomerAuthKnexResult
}

export type CustomerAuthTransactionManagerLike = object & {
  getKnex?: () => CustomerAuthKnexLike
  getTransactionContext?: () =>
    | CustomerAuthKnexLike
    | undefined
    | null
}

export type CustomerAuthTransactionalRepositoryLike = {
  transaction<T>(
    task: (manager: CustomerAuthTransactionManagerLike) => Promise<T>,
    options?: {
      transaction?: CustomerAuthTransactionManagerLike
      enableNestedTransactions?: boolean
      isolationLevel?: string
    }
  ): Promise<T>
  getActiveManager(context?: {
    transactionManager?: CustomerAuthTransactionManagerLike
    manager?: CustomerAuthTransactionManagerLike
  }): CustomerAuthTransactionManagerLike
}

export type CustomerAuthEffectEvidence = {
  custom: boolean
  authProvider: boolean | null
  customer: boolean | null
}

export type CustomerAuthSeamEvidence = {
  seam: CustomerAuthSeam
  managerIdentity: {
    custom: string
    medusa: string[]
  }
  queryRunnerIdentity: {
    custom: string
    medusa: string[]
  }
  transactionIds: {
    custom: string
    medusa: string[]
  }
  commit: CustomerAuthEffectEvidence
  faultRollback: CustomerAuthEffectEvidence
  failClosed: {
    claimed: boolean
    credentialUpdated: boolean
    stable: boolean
  } | null
  capability?: CustomerAuthTransactionCapability
}

const managerIdentities = new WeakMap<object, string>()
const queryRunnerIdentities = new WeakMap<object, string>()
let managerSequence = 0
let queryRunnerSequence = 0

export function identifyCustomerAuthTransactionManager(
  manager: CustomerAuthTransactionManagerLike
): string {
  const existing = managerIdentities.get(manager)
  if (existing) {
    return existing
  }

  managerSequence += 1
  const identity = `auth_tm_${managerSequence}`
  managerIdentities.set(manager, identity)
  return identity
}

export function identifyCustomerAuthQueryRunner(
  queryRunner: CustomerAuthKnexLike
): string {
  const existing = queryRunnerIdentities.get(queryRunner)
  if (existing) {
    return existing
  }

  queryRunnerSequence += 1
  const identity = `auth_qr_${queryRunnerSequence}`
  queryRunnerIdentities.set(queryRunner, identity)
  return identity
}

export function resolveCustomerAuthTransactionalKnex(
  manager: CustomerAuthTransactionManagerLike
): CustomerAuthKnexLike {
  const transactionContext = manager.getTransactionContext?.()
  if (transactionContext) {
    return transactionContext
  }

  const knex = manager.getKnex?.()
  if (!knex) {
    throw new Error("P14_AUTH_TRANSACTION_QUERY_RUNNER_UNAVAILABLE")
  }

  return knex
}

export function isCustomerAuthRecoveryFailClosed(
  status: CustomerAuthRecoveryStatus
): boolean {
  return status !== "stable" && status !== "completed"
}

function requiredEffectValues(
  seam: CustomerAuthSeam,
  evidence: CustomerAuthEffectEvidence
): boolean[] {
  const values = [evidence.custom]

  if (seam === "auth_provider" || seam === "combined") {
    values.push(evidence.authProvider === true)
  }
  if (seam === "customer_workflow" || seam === "combined") {
    values.push(evidence.customer === true)
  }

  return values
}

function sameNonEmptyIdentity(custom: string, medusa: string[]): boolean {
  return (
    custom.length > 0 &&
    medusa.length > 0 &&
    medusa.every((identity) => identity === custom)
  )
}

/**
 * Classifies evidence conservatively. Anything short of one observed manager,
 * query runner, transaction id, joint commit and full rollback selects the
 * fail-closed reconciliation baseline.
 */
export function classifyCustomerAuthTransactionEvidence(
  evidence: CustomerAuthSeamEvidence
): CustomerAuthTransactionCapability {
  const commitProved = requiredEffectValues(evidence.seam, evidence.commit).every(
    Boolean
  )
  const rollbackProved = requiredEffectValues(
    evidence.seam,
    evidence.faultRollback
  ).every(Boolean)
  const sameManager = sameNonEmptyIdentity(
    evidence.managerIdentity.custom,
    evidence.managerIdentity.medusa
  )
  const sameQueryRunner = sameNonEmptyIdentity(
    evidence.queryRunnerIdentity.custom,
    evidence.queryRunnerIdentity.medusa
  )
  const sameTransaction = sameNonEmptyIdentity(
    evidence.transactionIds.custom,
    evidence.transactionIds.medusa
  )

  if (
    commitProved &&
    rollbackProved &&
    sameManager &&
    sameQueryRunner &&
    sameTransaction
  ) {
    return "SUPPORTED_STRONG"
  }

  return "RECONCILIATION_REQUIRED"
}
