import { MedusaError } from "@medusajs/framework/utils"
import type {
  AdminAction,
  AdminActionEntityType,
  AdminActionFact,
  AdminActionMetadata,
  AdminActionResult,
  AdminActionState,
} from "../../../modules/admin-action-log"
import type { AdminActor } from "./require-admin-actor"

export type SanitizedAuditLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
  info?: (message: string, meta?: Record<string, unknown>) => void
}

export type AdminActionLogAppendService = {
  appendIntent: (input: {
    action_attempt_id: string
    correlation_id: string
    admin_id: string
    action: AdminAction
    entity_type: AdminActionEntityType
    entity_id: string
    result?: "requested"
    audit_stage?: "intent"
    reason?: string | null
    metadata?: AdminActionMetadata | Record<string, unknown> | null
    idempotency_key?: string | null
    previous_state?: AdminActionState | Record<string, unknown> | null
    new_state?: AdminActionState | Record<string, unknown> | null
  }) => Promise<AdminActionFact>
  appendOutcome: (input: {
    action_attempt_id: string
    correlation_id: string
    admin_id: string
    action: AdminAction
    entity_type: AdminActionEntityType
    entity_id: string
    result: AdminActionResult
    audit_stage?: "outcome"
    severity?: "info" | "warning" | "critical"
    reason?: string | null
    metadata?: AdminActionMetadata | Record<string, unknown> | null
    idempotency_key?: string | null
    previous_state?: AdminActionState | Record<string, unknown> | null
    new_state?: AdminActionState | Record<string, unknown> | null
  }) => Promise<AdminActionFact>
}

export type AuditActionDescriptor<TDomain> = {
  action_attempt_id: string
  correlation_id: string
  idempotency_key?: string | null
  actor: AdminActor
  action: AdminAction
  entity_type: AdminActionEntityType
  entity_id: string
  intent_reason?: string | null
  intent_metadata?: AdminActionMetadata | Record<string, unknown> | null
  intent_previous_state?: AdminActionState | Record<string, unknown> | null
  intent_new_state?: AdminActionState | Record<string, unknown> | null
  classifySuccess: (result: TDomain) => {
    result: "requested" | "succeeded"
    previous_state?: AdminActionState | Record<string, unknown> | null
    new_state?: AdminActionState | Record<string, unknown> | null
    metadata?: AdminActionMetadata | Record<string, unknown> | null
    reason?: string | null
  }
  classifyDomainError: (error: unknown) => "failed" | "blocked"
}

function logAuditFailure(
  logger: SanitizedAuditLogger | undefined,
  code: string,
  meta: Record<string, unknown>
) {
  logger?.error?.(code, {
    error_code: code,
    ...meta,
  })
}

function sanitizeDomainError(error: unknown): never {
  if (error instanceof MedusaError) {
    throw error
  }
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{0,127}$/.test(error.message)) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, error.message)
  }
  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    "ADMIN_DOMAIN_ACTION_FAILED"
  )
}

/**
 * Strategy B sequencer: intent → domain (once) → outcome.
 * Outcome audit failures never re-execute the domain callback.
 */
export async function auditAdminAction<TDomain>(input: {
  audit: AdminActionLogAppendService
  logger?: SanitizedAuditLogger
  descriptor: AuditActionDescriptor<TDomain>
  executeDomain: () => Promise<TDomain>
}): Promise<TDomain> {
  const { audit, logger, descriptor, executeDomain } = input

  if (descriptor.actor.actor_type !== "user") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "ADMIN_ACTOR_TYPE_FORBIDDEN"
    )
  }
  if (
    typeof descriptor.actor.actor_id !== "string" ||
    descriptor.actor.actor_id.trim() === ""
  ) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "ADMIN_ACTOR_REQUIRED"
    )
  }

  try {
    await audit.appendIntent({
      action_attempt_id: descriptor.action_attempt_id,
      correlation_id: descriptor.correlation_id,
      admin_id: descriptor.actor.actor_id,
      action: descriptor.action,
      entity_type: descriptor.entity_type,
      entity_id: descriptor.entity_id,
      result: "requested",
      audit_stage: "intent",
      reason: descriptor.intent_reason ?? null,
      metadata: descriptor.intent_metadata ?? null,
      previous_state: descriptor.intent_previous_state ?? null,
      new_state: descriptor.intent_new_state ?? null,
      idempotency_key: descriptor.idempotency_key ?? null,
    })
  } catch (error) {
    if (error instanceof MedusaError) {
      throw error
    }
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "ADMIN_ACTION_LOG_INTENT_FAILED"
    )
  }

  let domainResult: TDomain
  try {
    domainResult = await executeDomain()
  } catch (domainError) {
    const classified = descriptor.classifyDomainError(domainError)
    try {
      await audit.appendOutcome({
        action_attempt_id: descriptor.action_attempt_id,
        correlation_id: descriptor.correlation_id,
        admin_id: descriptor.actor.actor_id,
        action: descriptor.action,
        entity_type: descriptor.entity_type,
        entity_id: descriptor.entity_id,
        result: classified,
        audit_stage: "outcome",
        severity: "warning",
        idempotency_key: descriptor.idempotency_key ?? null,
        metadata: {
          error_code:
            domainError instanceof MedusaError
              ? domainError.message.slice(0, 128)
              : "ADMIN_DOMAIN_ACTION_FAILED",
        },
      })
    } catch {
      logAuditFailure(logger, "ADMIN_ACTION_LOG_OUTCOME_FAILED", {
        action_attempt_id: descriptor.action_attempt_id,
        correlation_id: descriptor.correlation_id,
        entity_type: descriptor.entity_type,
        entity_id: descriptor.entity_id,
        orphan: true,
      })
    }
    sanitizeDomainError(domainError)
  }

  const success = descriptor.classifySuccess(domainResult)
  try {
    await audit.appendOutcome({
      action_attempt_id: descriptor.action_attempt_id,
      correlation_id: descriptor.correlation_id,
      admin_id: descriptor.actor.actor_id,
      action: descriptor.action,
      entity_type: descriptor.entity_type,
      entity_id: descriptor.entity_id,
      result: success.result,
      audit_stage: "outcome",
      severity: "info",
      reason: success.reason ?? null,
      previous_state: success.previous_state ?? null,
      new_state: success.new_state ?? null,
      metadata: success.metadata ?? null,
      idempotency_key: descriptor.idempotency_key ?? null,
    })
  } catch {
    logAuditFailure(logger, "ADMIN_ACTION_LOG_OUTCOME_FAILED", {
      action_attempt_id: descriptor.action_attempt_id,
      correlation_id: descriptor.correlation_id,
      entity_type: descriptor.entity_type,
      entity_id: descriptor.entity_id,
      orphan: true,
      domain_succeeded: true,
    })
  }

  return domainResult
}
