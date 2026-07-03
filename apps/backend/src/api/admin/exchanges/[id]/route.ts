import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { env } from "../../../../config/env"
import { EXCHANGE_REQUEST_MODULE } from "../../../../modules/exchange-request"
import {
  assertExchangeRequestUpdateBodyAllowed,
  sanitizeExchangeRequestError,
  updateAdminExchangeRequest,
} from "../../../../modules/exchange-request/service"
import {
  EXCHANGE_REQUEST_STATUSES,
  REVERSE_LOGISTICS_PROVIDERS,
  type ExchangeRequestRecord,
  type UpdateExchangeRequestInput,
} from "../../../../modules/exchange-request/types"

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

function parseUpdateExchangeRequestBody(body: unknown): UpdateExchangeRequestInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_BODY_INVALID"
    )
  }

  const record = body as Record<string, unknown>
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

  throw new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    sanitized.error_code
  )
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
  }
): Promise<void> {
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

  if (
    !exchangeRequestModule?.listExchangeRequests ||
    !exchangeRequestModule.updateExchangeRequests
  ) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "EXCHANGE_REQUEST_MODULE_UNAVAILABLE"
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

  try {
    const result = updateAdminExchangeRequest({
      existing,
      update: updateInput,
    })

    const updated = await exchangeRequestModule.updateExchangeRequests(
      result.exchange_request
    )
    const persisted = Array.isArray(updated) ? updated[0] : updated

    res.status(200).json(
      serializeExchangeRequestResponse(persisted ?? result.exchange_request)
    )
  } catch (error) {
    mapExchangeRequestError(error)
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await handleAdminUpdateExchangeRequest(req, res)
}
