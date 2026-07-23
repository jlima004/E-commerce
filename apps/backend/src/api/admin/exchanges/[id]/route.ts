import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { env } from "../../../../config/env"
import {
  ADMIN_ACTION_LOG_MODULE,
  type AdminAction,
  type AdminActionState,
} from "../../../../modules/admin-action-log"
import { EXCHANGE_REQUEST_MODULE } from "../../../../modules/exchange-request"
import {
  assertExchangeRequestUpdateBodyAllowed,
  sanitizeExchangeRequestError,
  updateAdminExchangeRequest,
} from "../../../../modules/exchange-request/service"
import {
  EXCHANGE_REQUEST_STATUS,
  EXCHANGE_REQUEST_STATUSES,
  REVERSE_LOGISTICS_PROVIDERS,
  type ExchangeRequestRecord,
  type UpdateExchangeRequestInput,
} from "../../../../modules/exchange-request/types"
import {
  auditAdminAction,
  type AdminActionLogAppendService,
  type SanitizedAuditLogger,
} from "../../_shared/audit-admin-action"
import { requireAdminActor } from "../../_shared/require-admin-actor"

type ExchangeRequestModuleLike = {
  retrieveExchangeRequest?: (id: string) => Promise<ExchangeRequestRecord | null>
  listExchangeRequests?: (filters?: {
    id?: string
  }) => Promise<ExchangeRequestRecord[]>
  updateExchangeRequests?: (
    data: ExchangeRequestRecord | ExchangeRequestRecord[]
  ) => Promise<ExchangeRequestRecord[] | ExchangeRequestRecord>
}

type RouteDeps = {
  resolveExchangeRequestModule: (
    req: MedusaRequest
  ) => ExchangeRequestModuleLike | null
  resolveAdminActionLogModule: (
    req: MedusaRequest
  ) => AdminActionLogAppendService | null
  resolveLogger?: (req: MedusaRequest) => SanitizedAuditLogger | undefined
  generateActionAttemptId?: () => string
  generateCorrelationId?: () => string
  isEnabled?: () => boolean
}

function defaultResolveExchangeRequestModule(
  req: MedusaRequest
): ExchangeRequestModuleLike | null {
  try {
    return req.scope.resolve(
      EXCHANGE_REQUEST_MODULE
    ) as unknown as ExchangeRequestModuleLike
  } catch {
    return null
  }
}

function defaultResolveAdminActionLogModule(
  req: MedusaRequest
): AdminActionLogAppendService | null {
  try {
    return req.scope.resolve(
      ADMIN_ACTION_LOG_MODULE
    ) as unknown as AdminActionLogAppendService
  } catch {
    return null
  }
}

function defaultResolveLogger(req: MedusaRequest): SanitizedAuditLogger | undefined {
  try {
    return req.scope.resolve("logger") as SanitizedAuditLogger
  } catch {
    return undefined
  }
}

function defaultGenerateActionAttemptId(): string {
  return `admatt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function defaultGenerateCorrelationId(): string {
  return `admcorr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function parseUpdateExchangeRequestBody(body: unknown): UpdateExchangeRequestInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_BODY_INVALID"
    )
  }

  const record = body as Record<string, unknown>

  if (
    "created_by_operator_id" in record ||
    "admin_id" in record ||
    "actor_id" in record ||
    "admin_email" in record
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_BODY_INVALID"
    )
  }

  const update: UpdateExchangeRequestInput = {}

  if (record.status !== undefined) {
    if (typeof record.status !== "string") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "EXCHANGE_REQUEST_STATUS_INVALID"
      )
    }

    if (!(EXCHANGE_REQUEST_STATUSES as readonly string[]).includes(record.status)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "EXCHANGE_REQUEST_STATUS_INVALID"
      )
    }

    update.status = record.status as UpdateExchangeRequestInput["status"]
  }

  if (record.customer_visible_note !== undefined) {
    update.customer_visible_note =
      typeof record.customer_visible_note === "string"
        ? record.customer_visible_note
        : null
  }

  if (record.operator_note !== undefined) {
    update.operator_note =
      typeof record.operator_note === "string" ? record.operator_note : null
  }

  if (record.reverse_logistics_provider !== undefined) {
    if (record.reverse_logistics_provider === null) {
      update.reverse_logistics_provider = null
    } else if (typeof record.reverse_logistics_provider === "string") {
      if (
        !(REVERSE_LOGISTICS_PROVIDERS as readonly string[]).includes(
          record.reverse_logistics_provider
        )
      ) {
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          "EXCHANGE_REQUEST_REVERSE_LOGISTICS_PROVIDER_INVALID"
        )
      }

      update.reverse_logistics_provider =
        record.reverse_logistics_provider as UpdateExchangeRequestInput["reverse_logistics_provider"]
    }
  }

  if (record.reverse_tracking_code !== undefined) {
    update.reverse_tracking_code =
      typeof record.reverse_tracking_code === "string"
        ? record.reverse_tracking_code
        : null
  }

  if (record.reverse_authorization_code !== undefined) {
    update.reverse_authorization_code =
      typeof record.reverse_authorization_code === "string"
        ? record.reverse_authorization_code
        : null
  }

  if (record.reverse_label_reference !== undefined) {
    update.reverse_label_reference =
      typeof record.reverse_label_reference === "string"
        ? record.reverse_label_reference
        : null
  }

  if (Object.keys(update).length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_UPDATE_EMPTY"
    )
  }

  return update
}

function mapExchangeRequestError(error: unknown): never {
  const message =
    error instanceof Error ? error.message : "EXCHANGE_REQUEST_FAILED"
  const sanitized = sanitizeExchangeRequestError({
    code: message,
    message,
  })

  if (message === "EXCHANGE_REQUEST_NOT_FOUND") {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, sanitized.error_code)
  }

  if (
    message === "EXCHANGE_REQUEST_BODY_INVALID" ||
    message === "EXCHANGE_REQUEST_STATUS_INVALID" ||
    message === "EXCHANGE_REQUEST_STATUS_TRANSITION_INVALID" ||
    message === "EXCHANGE_REQUEST_TERMINAL_STATUS_IMMUTABLE" ||
    message === "EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD" ||
    message === "EXCHANGE_REQUEST_REVERSE_LOGISTICS_PROVIDER_INVALID" ||
    message === "EXCHANGE_REQUEST_UPDATE_EMPTY"
  ) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, sanitized.error_code)
  }

  if (error instanceof MedusaError) {
    throw error
  }

  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    sanitized.error_code
  )
}

function classifyExchangeDomainError(error: unknown): "failed" | "blocked" {
  if (error instanceof MedusaError) {
    if (
      error.type === MedusaError.Types.INVALID_DATA ||
      error.type === MedusaError.Types.NOT_FOUND ||
      error.type === MedusaError.Types.NOT_ALLOWED
    ) {
      return "blocked"
    }
  }
  return "failed"
}

function resolveExchangeAuditAction(
  update: UpdateExchangeRequestInput
): AdminAction {
  if (update.status === EXCHANGE_REQUEST_STATUS.REJECTED) {
    return "reject_exchange"
  }
  if (update.status === EXCHANGE_REQUEST_STATUS.CANCELED) {
    return "cancel_exchange"
  }
  return "update_exchange"
}

function allowlistedExchangeState(
  record: ExchangeRequestRecord
): AdminActionState {
  return {
    status: record.status,
    reverse_logistics_provider: record.reverse_logistics_provider,
    reverse_tracking_code: record.reverse_tracking_code,
    reverse_authorization_code: record.reverse_authorization_code,
    reverse_label_reference: record.reverse_label_reference,
  }
}

function serializeExchangeRequestResponse(
  exchangeRequest: ExchangeRequestRecord
) {
  return {
    exchange_request: {
      id: exchangeRequest.id,
      order_id: exchangeRequest.order_id,
      reason: exchangeRequest.reason,
      status: exchangeRequest.status,
      affected_items: exchangeRequest.affected_items,
      customer_visible_note: exchangeRequest.customer_visible_note,
      operator_note: exchangeRequest.operator_note,
      reverse_logistics_provider: exchangeRequest.reverse_logistics_provider,
      reverse_tracking_code: exchangeRequest.reverse_tracking_code,
      reverse_authorization_code: exchangeRequest.reverse_authorization_code,
      reverse_label_reference: exchangeRequest.reverse_label_reference,
      return_received_at: exchangeRequest.return_received_at,
      resolved_at: exchangeRequest.resolved_at,
      created_by_operator_id: exchangeRequest.created_by_operator_id,
      created_at: exchangeRequest.created_at,
      updated_at: exchangeRequest.updated_at,
    },
  }
}

export async function handleAdminUpdateExchangeRequest(
  req: MedusaRequest,
  res: MedusaResponse,
  deps: RouteDeps = {
    resolveExchangeRequestModule: defaultResolveExchangeRequestModule,
    resolveAdminActionLogModule: defaultResolveAdminActionLogModule,
    resolveLogger: defaultResolveLogger,
  }
): Promise<void> {
  const logger = deps.resolveLogger?.(req) ?? defaultResolveLogger(req)
  const actor = requireAdminActor(
    req as MedusaRequest & {
      auth_context?: { actor_id?: unknown; actor_type?: unknown }
    },
    logger
  )

  if (!(deps.isEnabled?.() ?? env.ADMIN_EXCHANGE_REQUEST_ENABLED)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "ADMIN_EXCHANGE_REQUEST_DISABLED"
    )
  }

  const exchangeRequestId =
    typeof req.params?.id === "string" ? req.params.id.trim() : ""

  if (!exchangeRequestId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_ID_REQUIRED"
    )
  }

  const exchangeRequestModule = deps.resolveExchangeRequestModule(req)
  const audit = deps.resolveAdminActionLogModule(req)

  if (
    !exchangeRequestModule?.listExchangeRequests ||
    !exchangeRequestModule.updateExchangeRequests
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "EXCHANGE_REQUEST_MODULE_UNAVAILABLE"
    )
  }

  if (!audit?.appendIntent || !audit.appendOutcome) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "ADMIN_ACTION_LOG_MODULE_UNAVAILABLE"
    )
  }

  let updateInput: UpdateExchangeRequestInput

  try {
    assertExchangeRequestUpdateBodyAllowed(req.body)
    updateInput = parseUpdateExchangeRequestBody(req.body)
  } catch (error) {
    mapExchangeRequestError(error)
  }

  const existingRecords = await exchangeRequestModule.listExchangeRequests({
    id: exchangeRequestId,
  })
  const existing = existingRecords[0] ?? null

  if (!existing) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "EXCHANGE_REQUEST_NOT_FOUND"
    )
  }

  const previousState = allowlistedExchangeState(existing)
  const action = resolveExchangeAuditAction(updateInput)
  const actionAttemptId =
    deps.generateActionAttemptId?.() ?? defaultGenerateActionAttemptId()
  const correlationId =
    deps.generateCorrelationId?.() ?? defaultGenerateCorrelationId()

  const persisted = await auditAdminAction({
    audit,
    logger,
    descriptor: {
      action_attempt_id: actionAttemptId,
      correlation_id: correlationId,
      actor,
      action,
      entity_type: "exchange_request",
      entity_id: exchangeRequestId,
      intent_previous_state: previousState,
      classifySuccess: (result) => ({
        result: "succeeded",
        previous_state: previousState,
        new_state: allowlistedExchangeState(result),
        metadata: {
          order_id: result.order_id,
          request_id: result.id,
          actor_type: actor.actor_type,
        },
      }),
      classifyDomainError: classifyExchangeDomainError,
    },
    executeDomain: async () => {
      try {
        const result = updateAdminExchangeRequest({
          existing,
          update: updateInput,
        })

        const updated = await exchangeRequestModule.updateExchangeRequests!(
          result.exchange_request
        )
        const next = Array.isArray(updated) ? updated[0] : updated
        return next ?? result.exchange_request
      } catch (error) {
        mapExchangeRequestError(error)
      }
    },
  })

  res.status(200).json(serializeExchangeRequestResponse(persisted))
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await handleAdminUpdateExchangeRequest(req, res)
}
