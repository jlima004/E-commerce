import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { env } from "../../../config/env"
import { EXCHANGE_REQUEST_MODULE } from "../../../modules/exchange-request"
import {
  assertExchangeRequestCreateBodyAllowed,
  createAdminExchangeRequest,
  sanitizeExchangeRequestError,
} from "../../../modules/exchange-request/service"
import {
  EXCHANGE_REQUEST_REASONS,
  REVERSE_LOGISTICS_PROVIDERS,
  type CreateExchangeRequestInput,
  type ExchangeRequestRecord,
} from "../../../modules/exchange-request/types"

type OrderModuleLike = {
  retrieveOrder?: (id: string) => Promise<{
    id: string
    metadata?: Record<string, unknown> | null
  } | null>
}

type ExchangeRequestModuleLike = {
  createExchangeRequests?: (
    records: ExchangeRequestRecord[]
  ) => Promise<ExchangeRequestRecord[]>
}

type RouteDeps = {
  resolveOrderModule: (req: MedusaRequest) => OrderModuleLike | null
  resolveExchangeRequestModule: (
    req: MedusaRequest
  ) => ExchangeRequestModuleLike | null
  generateId: () => string
  isEnabled?: () => boolean
}

function defaultResolveOrderModule(req: MedusaRequest): OrderModuleLike | null {
  try {
    return req.scope.resolve("order") as OrderModuleLike
  } catch {
    return null
  }
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

function defaultGenerateId(): string {
  return `excreq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function parseCreateExchangeRequestBody(body: unknown): CreateExchangeRequestInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_BODY_INVALID"
    )
  }

  const record = body as Record<string, unknown>

  if (typeof record.order_id !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_ORDER_ID_REQUIRED"
    )
  }

  if (typeof record.reason !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_REASON_INVALID"
    )
  }

  if (!(EXCHANGE_REQUEST_REASONS as readonly string[]).includes(record.reason)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_REASON_INVALID"
    )
  }

  if (!Array.isArray(record.affected_items)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_AFFECTED_ITEMS_REQUIRED"
    )
  }

  const reverseProvider =
    record.reverse_logistics_provider === null ||
    record.reverse_logistics_provider === undefined
      ? null
      : typeof record.reverse_logistics_provider === "string"
        ? record.reverse_logistics_provider
        : null

  if (
    reverseProvider !== null &&
    !(REVERSE_LOGISTICS_PROVIDERS as readonly string[]).includes(reverseProvider)
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "EXCHANGE_REQUEST_REVERSE_LOGISTICS_PROVIDER_INVALID"
    )
  }

  return {
    order_id: record.order_id,
    reason: record.reason as CreateExchangeRequestInput["reason"],
    affected_items: record.affected_items as CreateExchangeRequestInput["affected_items"],
    customer_visible_note:
      typeof record.customer_visible_note === "string"
        ? record.customer_visible_note
        : null,
    operator_note:
      typeof record.operator_note === "string" ? record.operator_note : null,
    reverse_logistics_provider:
      reverseProvider as CreateExchangeRequestInput["reverse_logistics_provider"],
    reverse_tracking_code:
      typeof record.reverse_tracking_code === "string"
        ? record.reverse_tracking_code
        : null,
    reverse_authorization_code:
      typeof record.reverse_authorization_code === "string"
        ? record.reverse_authorization_code
        : null,
    reverse_label_reference:
      typeof record.reverse_label_reference === "string"
        ? record.reverse_label_reference
        : null,
    created_by_operator_id:
      typeof record.created_by_operator_id === "string"
        ? record.created_by_operator_id
        : null,
  }
}

function mapExchangeRequestError(error: unknown): never {
  const message =
    error instanceof Error ? error.message : "EXCHANGE_REQUEST_FAILED"
  const sanitized = sanitizeExchangeRequestError({
    code: message,
    message,
  })

  if (
    message === "EXCHANGE_REQUEST_ORDER_STATUS_NOT_ELIGIBLE" ||
    message === "EXCHANGE_REQUEST_ORDER_NOT_FOUND"
  ) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, sanitized.error_code)
  }

  if (
    message === "EXCHANGE_REQUEST_BODY_INVALID" ||
    message === "EXCHANGE_REQUEST_ORDER_ID_REQUIRED" ||
    message === "EXCHANGE_REQUEST_REASON_INVALID" ||
    message === "EXCHANGE_REQUEST_AFFECTED_ITEMS_REQUIRED" ||
    message === "EXCHANGE_REQUEST_AFFECTED_ITEMS_EMPTY" ||
    message === "EXCHANGE_REQUEST_AFFECTED_ITEMS_INVALID" ||
    message === "EXCHANGE_REQUEST_AFFECTED_ITEMS_TOO_MANY" ||
    message === "EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD" ||
    message === "EXCHANGE_REQUEST_REVERSE_LOGISTICS_PROVIDER_INVALID" ||
    message === "EXCHANGE_REQUEST_STATUS_INVALID"
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

export async function handleAdminCreateExchangeRequest(
  req: MedusaRequest,
  res: MedusaResponse,
  deps: RouteDeps = {
    resolveOrderModule: defaultResolveOrderModule,
    resolveExchangeRequestModule: defaultResolveExchangeRequestModule,
    generateId: defaultGenerateId,
  }
): Promise<void> {
  if (!(deps.isEnabled?.() ?? env.ADMIN_EXCHANGE_REQUEST_ENABLED)) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "ADMIN_EXCHANGE_REQUEST_DISABLED"
    )
  }

  const orderModule = deps.resolveOrderModule(req)
  const exchangeRequestModule = deps.resolveExchangeRequestModule(req)

  if (!orderModule?.retrieveOrder) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "EXCHANGE_REQUEST_ORDER_MODULE_UNAVAILABLE"
    )
  }

  if (!exchangeRequestModule?.createExchangeRequests) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "EXCHANGE_REQUEST_MODULE_UNAVAILABLE"
    )
  }

  let requestInput: CreateExchangeRequestInput

  try {
    assertExchangeRequestCreateBodyAllowed(req.body)
    requestInput = parseCreateExchangeRequestBody(req.body)
  } catch (error) {
    mapExchangeRequestError(error)
  }

  const order = await orderModule.retrieveOrder(requestInput.order_id)

  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "EXCHANGE_REQUEST_ORDER_NOT_FOUND"
    )
  }

  try {
    const result = createAdminExchangeRequest({
      request: requestInput,
      order_metadata: order.metadata,
      id: deps.generateId(),
    })

    const created = await exchangeRequestModule.createExchangeRequests([
      result.exchange_request,
    ])
    const persisted = created[0] ?? result.exchange_request

    res.status(201).json(serializeExchangeRequestResponse(persisted))
  } catch (error) {
    mapExchangeRequestError(error)
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await handleAdminCreateExchangeRequest(req, res)
}
