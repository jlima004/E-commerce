import { MedusaService, Module } from "@medusajs/framework/utils"
import {
  CUSTOMER_AUTH_TRANSACTION_CAPABILITIES,
  type CustomerAuthTransactionCapability,
} from "../../infrastructure/customer-auth-transaction-compatibility"
import AuthCredentialState from "./models/auth-credential-state"
import AuthNotificationOutbox from "./models/auth-notification-outbox"
import AuthRefreshCredential from "./models/auth-refresh-credential"
import AuthResetIntent from "./models/auth-reset-intent"
import AuthSessionLineage from "./models/auth-session-lineage"
import AuthVerificationIntent from "./models/auth-verification-intent"
import RegistrationIntent from "./models/registration-intent"

export const CUSTOMER_AUTH_MODULE = "customer_auth"
export const CUSTOMER_AUTH_TRANSACTION_REQUIRED =
  "CUSTOMER_AUTH_TRANSACTION_REQUIRED"
export const CUSTOMER_AUTH_WRITE_FORBIDDEN = "CUSTOMER_AUTH_WRITE_FORBIDDEN"

type RawResult = { rows?: Array<Record<string, unknown>> }
type TransactionalKnex = {
  raw(sql: string, bindings?: unknown[]): Promise<RawResult> | RawResult
}
type TransactionManager = {
  getTransactionContext?: () => TransactionalKnex | null | undefined
}

export type CustomerAuthMutationContext = {
  __type: "MedusaContext"
  transactionManager: TransactionManager
  manager?: TransactionManager
}

export type CustomerAuthCasResult =
  | {
      type: "updated"
      previousVersion: number
      version: number
      capability: CustomerAuthTransactionCapability
    }
  | {
      type: "stale"
      expectedVersion: number
      actualVersion: number
      capability: CustomerAuthTransactionCapability
    }

function requireTransaction(
  sharedContext?: CustomerAuthMutationContext
): TransactionalKnex {
  const manager = sharedContext?.transactionManager
  if (
    sharedContext?.__type !== "MedusaContext" ||
    !manager ||
    (sharedContext.manager !== undefined && sharedContext.manager !== manager)
  ) {
    throw new Error(CUSTOMER_AUTH_TRANSACTION_REQUIRED)
  }
  const knex = manager.getTransactionContext?.()
  if (!knex) {
    throw new Error(CUSTOMER_AUTH_TRANSACTION_REQUIRED)
  }
  return knex
}

function requireId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 255) {
    throw new Error("CUSTOMER_AUTH_ID_INVALID")
  }
  return value
}

function requireVersion(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error("CUSTOMER_AUTH_VERSION_INVALID")
  }
  return Number(value)
}

function requireGeneration(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("CUSTOMER_AUTH_GENERATION_INVALID")
  }
  return Number(value)
}

async function queryRows(
  knex: TransactionalKnex,
  sql: string,
  bindings: unknown[] = []
): Promise<Array<Record<string, unknown>>> {
  const result = await knex.raw(sql, bindings)
  return result.rows ?? []
}

async function casUpdate(input: {
  table: string
  id: string
  expectedVersion: number
  assignments: ReadonlyArray<{ column: string; value: unknown }>
  predicate?: string
  concurrencyColumn?: "version" | "generation"
  incrementConcurrency?: boolean
  context?: CustomerAuthMutationContext
}): Promise<CustomerAuthCasResult> {
  const knex = requireTransaction(input.context)
  const id = requireId(input.id)
  const concurrencyColumn = input.concurrencyColumn ?? "version"
  const expected =
    concurrencyColumn === "generation"
      ? requireGeneration(input.expectedVersion)
      : requireVersion(input.expectedVersion)
  const current = await queryRows(
    knex,
    `select ${concurrencyColumn} as concurrency_version from ${input.table} where id = ? and deleted_at is null for update`,
    [id]
  )
  if (current.length !== 1) {
    throw new Error("CUSTOMER_AUTH_ROW_NOT_FOUND")
  }
  const actual =
    concurrencyColumn === "generation"
      ? requireGeneration(Number(current[0].concurrency_version))
      : requireVersion(Number(current[0].concurrency_version))
  const capability = CUSTOMER_AUTH_TRANSACTION_CAPABILITIES.combined
  if (actual !== expected) {
    return {
      type: "stale",
      expectedVersion: expected,
      actualVersion: actual,
      capability,
    }
  }

  const concurrencyUpdate =
    input.incrementConcurrency === false
      ? []
      : [`${concurrencyColumn} = ${concurrencyColumn} + 1`]
  const assignments = input.assignments
    .map(({ column }) => `${column} = ?`)
    .concat(concurrencyUpdate, ["updated_at = now()"])
    .join(", ")
  const predicate = input.predicate ? ` and (${input.predicate})` : ""
  const updated = await queryRows(
    knex,
    `update ${input.table} set ${assignments} where id = ? and ${concurrencyColumn} = ? and deleted_at is null${predicate} returning ${concurrencyColumn} as concurrency_version`,
    [...input.assignments.map(({ value }) => value), id, expected]
  )
  if (updated.length !== 1) {
    return {
      type: "stale",
      expectedVersion: expected,
      actualVersion: actual,
      capability,
    }
  }
  return {
    type: "updated",
    previousVersion: expected,
    version:
      concurrencyColumn === "generation"
        ? requireGeneration(Number(updated[0].concurrency_version))
        : requireVersion(Number(updated[0].concurrency_version)),
    capability,
  }
}

const BaseCustomerAuthModuleService = MedusaService({
  RegistrationIntent,
  AuthCredentialState,
  AuthSessionLineage,
  AuthRefreshCredential,
  AuthVerificationIntent,
  AuthResetIntent,
  AuthNotificationOutbox,
})

export class CustomerAuthModuleService extends BaseCustomerAuthModuleService {
  override createRegistrationIntents = forbiddenWrite
  override updateRegistrationIntents = forbiddenWrite
  override deleteRegistrationIntents = forbiddenWrite
  override softDeleteRegistrationIntents = forbiddenWrite
  override restoreRegistrationIntents = forbiddenWrite
  override createAuthCredentialStates = forbiddenWrite
  override updateAuthCredentialStates = forbiddenWrite
  override deleteAuthCredentialStates = forbiddenWrite
  override softDeleteAuthCredentialStates = forbiddenWrite
  override restoreAuthCredentialStates = forbiddenWrite
  override createAuthSessionLineages = forbiddenWrite
  override updateAuthSessionLineages = forbiddenWrite
  override deleteAuthSessionLineages = forbiddenWrite
  override softDeleteAuthSessionLineages = forbiddenWrite
  override restoreAuthSessionLineages = forbiddenWrite
  override createAuthRefreshCredentials = forbiddenWrite
  override updateAuthRefreshCredentials = forbiddenWrite
  override deleteAuthRefreshCredentials = forbiddenWrite
  override softDeleteAuthRefreshCredentials = forbiddenWrite
  override restoreAuthRefreshCredentials = forbiddenWrite
  override createAuthVerificationIntents = forbiddenWrite
  override updateAuthVerificationIntents = forbiddenWrite
  override deleteAuthVerificationIntents = forbiddenWrite
  override softDeleteAuthVerificationIntents = forbiddenWrite
  override restoreAuthVerificationIntents = forbiddenWrite
  override createAuthResetIntents = forbiddenWrite
  override updateAuthResetIntents = forbiddenWrite
  override deleteAuthResetIntents = forbiddenWrite
  override softDeleteAuthResetIntents = forbiddenWrite
  override restoreAuthResetIntents = forbiddenWrite
  override createAuthNotificationOutboxes = forbiddenWrite
  override updateAuthNotificationOutboxes = forbiddenWrite
  override deleteAuthNotificationOutboxes = forbiddenWrite
  override softDeleteAuthNotificationOutboxes = forbiddenWrite
  override restoreAuthNotificationOutboxes = forbiddenWrite

  transitionRegistrationIntent(
    id: string,
    expectedVersion: number,
    status: "pending_customer" | "completed" | "expired" | "failed_reconcilable",
    authIdentityId: string | null,
    sharedContext?: CustomerAuthMutationContext
  ) {
    return casUpdate({
      table: "registration_intent",
      id,
      expectedVersion,
      assignments: [
        { column: "status", value: status },
        { column: "auth_identity_id", value: authIdentityId },
      ],
      context: sharedContext,
    })
  }

  transitionCredentialState(
    id: string,
    expectedVersion: number,
    operationStatus: "claimed" | "provider_outcome_ambiguous" | "credential_proved" | "credential_updated" | "revocation_pending" | "revocation_committed" | "completed",
    operationType: "reset" | "password_change",
    operationId: string,
    sharedContext?: CustomerAuthMutationContext
  ) {
    return casUpdate({
      table: "auth_credential_state",
      id,
      expectedVersion,
      assignments: [
        { column: "operation_status", value: operationStatus },
        { column: "operation_type", value: operationType },
        { column: "operation_id", value: requireId(operationId) },
        { column: "operation_version", value: expectedVersion },
      ],
      context: sharedContext,
    })
  }

  transitionSessionLineage(
    id: string,
    expectedVersion: number,
    status: "revoked" | "expired",
    marker: Date,
    reason: string | null,
    sharedContext?: CustomerAuthMutationContext
  ) {
    return casUpdate({
      table: "auth_session_lineage",
      id,
      expectedVersion,
      assignments:
        status === "revoked"
          ? [
              { column: "status", value: status },
              { column: "revoked_at", value: marker },
              { column: "revocation_reason", value: requireId(reason) },
            ]
          : [
              { column: "status", value: status },
              { column: "expired_at", value: marker },
            ],
      context: sharedContext,
    })
  }

  transitionRefreshCredential(
    id: string,
    expectedVersion: number,
    status: "consumed" | "replayed" | "revoked",
    assignments: ReadonlyArray<{ column: "consumed_at" | "replacement_id" | "request_key_hash" | "recovery_until" | "replayed_at" | "revoked_at"; value: unknown }>,
    sharedContext?: CustomerAuthMutationContext
  ) {
    return casUpdate({
      table: "auth_refresh_credential",
      id,
      expectedVersion,
      assignments: [{ column: "status", value: status }, ...assignments],
      concurrencyColumn: "generation",
      incrementConcurrency: false,
      predicate: "status = 'active'",
      context: sharedContext,
    })
  }

  transitionVerificationIntent(
    id: string,
    expectedVersion: number,
    status: "claimed" | "confirmed" | "superseded" | "expired" | "dead_letter",
    markerColumn: "claimed_at" | "confirmed_at" | "superseded_at" | "expired_at" | "dead_lettered_at",
    marker: Date,
    sharedContext?: CustomerAuthMutationContext
  ) {
    return casUpdate({
      table: "auth_verification_intent",
      id,
      expectedVersion,
      assignments: [
        { column: "status", value: status },
        { column: markerColumn, value: marker },
      ],
      context: sharedContext,
    })
  }

  transitionResetIntent(
    id: string,
    expectedVersion: number,
    status: "claimed" | "credential_updated" | "revocation_committed" | "completed" | "superseded" | "expired" | "failed_reconcilable",
    markerColumn: "claimed_at" | "credential_updated_at" | "revocation_committed_at" | "completed_at",
    marker: Date,
    operationId: string | null,
    sharedContext?: CustomerAuthMutationContext
  ) {
    return casUpdate({
      table: "auth_reset_intent",
      id,
      expectedVersion,
      assignments: [
        { column: "status", value: status },
        { column: markerColumn, value: marker },
        { column: "operation_id", value: operationId },
      ],
      predicate:
        status === "completed"
          ? "claimed_at is not null and provider_proved_at is not null and credential_updated_at is not null and revocation_committed_at is not null"
          : undefined,
      context: sharedContext,
    })
  }

  claimNotificationOutbox(
    id: string,
    expectedVersion: number,
    owner: string,
    claimedAt: Date,
    sharedContext?: CustomerAuthMutationContext
  ) {
    const leaseUntil = new Date(claimedAt.getTime() + 2 * 60 * 1000)
    return casUpdate({
      table: "auth_notification_outbox",
      id,
      expectedVersion,
      assignments: [
        { column: "status", value: "claimed" },
        { column: "claimed_at", value: claimedAt },
        { column: "lease_owner", value: requireId(owner) },
        { column: "lease_until", value: leaseUntil },
      ],
      predicate: "status in ('recorded','failed')",
      context: sharedContext,
    })
  }
}

export async function rejectCustomerAuthGeneratedWrite(
  ..._args: unknown[]
): Promise<never> {
  throw new Error(CUSTOMER_AUTH_WRITE_FORBIDDEN)
}

const forbiddenWrite = rejectCustomerAuthGeneratedWrite

export default Module(CUSTOMER_AUTH_MODULE, {
  service: CustomerAuthModuleService,
})
