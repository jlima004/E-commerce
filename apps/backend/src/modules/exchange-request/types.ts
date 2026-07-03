export const EXCHANGE_REQUEST_STATUS = {
  OPENED: "opened",
  AWAITING_CUSTOMER_RETURN: "awaiting_customer_return",
  RETURN_IN_TRANSIT: "return_in_transit",
  RETURN_RECEIVED: "return_received",
  REPLACEMENT_REVIEW: "replacement_review",
  RESOLVED: "resolved",
  REJECTED: "rejected",
  CANCELED: "canceled",
} as const

const EXCHANGE_REQUEST_STATUSES_VALUES = [
  EXCHANGE_REQUEST_STATUS.OPENED,
  EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
  EXCHANGE_REQUEST_STATUS.RETURN_IN_TRANSIT,
  EXCHANGE_REQUEST_STATUS.RETURN_RECEIVED,
  EXCHANGE_REQUEST_STATUS.REPLACEMENT_REVIEW,
  EXCHANGE_REQUEST_STATUS.RESOLVED,
  EXCHANGE_REQUEST_STATUS.REJECTED,
  EXCHANGE_REQUEST_STATUS.CANCELED,
] as const

export const EXCHANGE_REQUEST_STATUSES = [...EXCHANGE_REQUEST_STATUSES_VALUES]

export const EXCHANGE_REQUEST_TERMINAL_STATUSES = [
  EXCHANGE_REQUEST_STATUS.RESOLVED,
  EXCHANGE_REQUEST_STATUS.REJECTED,
  EXCHANGE_REQUEST_STATUS.CANCELED,
] as const

export const EXCHANGE_REQUEST_REASON = {
  DEFECT: "defect",
  WRONG_PRODUCT: "wrong_product",
} as const

const EXCHANGE_REQUEST_REASONS_VALUES = [
  EXCHANGE_REQUEST_REASON.DEFECT,
  EXCHANGE_REQUEST_REASON.WRONG_PRODUCT,
] as const

export const EXCHANGE_REQUEST_REASONS = [...EXCHANGE_REQUEST_REASONS_VALUES]

export const REVERSE_LOGISTICS_PROVIDER = {
  CORREIOS_MANUAL: "correios_manual",
  OTHER_MANUAL: "other_manual",
} as const

const REVERSE_LOGISTICS_PROVIDERS_VALUES = [
  REVERSE_LOGISTICS_PROVIDER.CORREIOS_MANUAL,
  REVERSE_LOGISTICS_PROVIDER.OTHER_MANUAL,
] as const

export const REVERSE_LOGISTICS_PROVIDERS = [...REVERSE_LOGISTICS_PROVIDERS_VALUES]

export type ExchangeRequestStatus =
  (typeof EXCHANGE_REQUEST_STATUSES_VALUES)[number]

export type ExchangeRequestReason =
  (typeof EXCHANGE_REQUEST_REASONS_VALUES)[number]

export type ReverseLogisticsProvider =
  (typeof REVERSE_LOGISTICS_PROVIDERS_VALUES)[number]

export type AffectedItemSummary = {
  line_item_id?: string | null
  product_title?: string | null
  variant_title?: string | null
  quantity?: number | null
}

export type ExchangeRequestRecord = {
  id: string
  order_id: string
  reason: ExchangeRequestReason
  status: ExchangeRequestStatus
  affected_items: AffectedItemSummary[]
  customer_visible_note: string | null
  operator_note: string | null
  reverse_logistics_provider: ReverseLogisticsProvider | null
  reverse_tracking_code: string | null
  reverse_authorization_code: string | null
  reverse_label_reference: string | null
  return_received_at: string | null
  resolved_at: string | null
  created_by_operator_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type CreateExchangeRequestInput = {
  order_id: string
  reason: ExchangeRequestReason
  affected_items: AffectedItemSummary[]
  customer_visible_note?: string | null
  operator_note?: string | null
  reverse_logistics_provider?: ReverseLogisticsProvider | null
  reverse_tracking_code?: string | null
  reverse_authorization_code?: string | null
  reverse_label_reference?: string | null
  created_by_operator_id?: string | null
}

export type UpdateExchangeRequestInput = {
  status?: ExchangeRequestStatus
  customer_visible_note?: string | null
  operator_note?: string | null
  reverse_logistics_provider?: ReverseLogisticsProvider | null
  reverse_tracking_code?: string | null
  reverse_authorization_code?: string | null
  reverse_label_reference?: string | null
}

export type AdminCreateExchangeRequestResult = {
  exchange_request: ExchangeRequestRecord
}

export type AdminUpdateExchangeRequestResult = {
  exchange_request: ExchangeRequestRecord
}
