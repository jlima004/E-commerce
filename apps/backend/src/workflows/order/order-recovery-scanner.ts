import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import {
  ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY,
  validateOrderBirthMarkerOnOrder,
} from "./order-birth-marker"
import { brlMajorToMinor } from "../../utils/money-units"

export const DEFAULT_SCAN_PAGE_SIZE = 50
export const DEFAULT_WINDOW_SAFETY_MARGIN_MS = 15 * 60 * 1000 // 15-minute backward safety margin from authority timestamp

export type ScanOrdersForRecoveryInput = {
  cclId: string
  expectedCartId: string
  expectedPaymentAttemptId: string
  expectedPaymentIntentId: string
  expectedAmountMinor: number
  cclCreatedAt: Date | string
  cclExecutionStartedAt?: Date | string | null
  existingCclOrderId?: string | null
  existingPaOrderId?: string | null
  pageSize?: number
  windowSafetyMarginMs?: number
}

export type OrderRecoveryScanWindowResult =
  | { ok: true; windowStart: Date }
  | { ok: false; reason: string }

function isExecutionStartedAtPresent(
  value: Date | string | null | undefined
): boolean {
  return value !== null && value !== undefined && value !== ""
}

export function resolveOrderRecoveryScanWindow(input: {
  cclCreatedAt: Date | string
  cclExecutionStartedAt?: Date | string | null
  windowSafetyMarginMs?: number
}): OrderRecoveryScanWindowResult {
  const marginMs = input.windowSafetyMarginMs ?? DEFAULT_WINDOW_SAFETY_MARGIN_MS

  if (isExecutionStartedAtPresent(input.cclExecutionStartedAt)) {
    const executionDate = new Date(input.cclExecutionStartedAt as Date | string)
    if (isNaN(executionDate.getTime())) {
      return { ok: false, reason: "INVALID_EXECUTION_STARTED_AT_TIMESTAMP" }
    }

    const windowStart = new Date(executionDate.getTime() - marginMs)
    return { ok: true, windowStart }
  }

  const createdAtDate = new Date(input.cclCreatedAt)
  if (isNaN(createdAtDate.getTime())) {
    return { ok: false, reason: "INVALID_CCL_CREATED_AT_TIMESTAMP" }
  }

  const windowStart = new Date(createdAtDate.getTime() - marginMs)
  return { ok: true, windowStart }
}

export type OrderRecoveryScanResult =
  | {
      status: "EXACT_ONE"
      order: Record<string, unknown>
      orderId: string
      totalScanned: number
    }
  | {
      status: "ZERO"
      totalScanned: number
      executionStarted: boolean
    }
  | {
      status: "MULTIPLE"
      matchingOrders: Array<Record<string, unknown>>
      totalScanned: number
      conflictReason: string
    }
  | {
      status: "SCAN_INCOMPLETE"
      totalScanned: number
      reason: string
    }
  | {
      status: "AUTHORITY_CONFLICT"
      reason: string
    }

export async function scanOrdersForRecovery(
  container: MedusaContainer,
  input: ScanOrdersForRecoveryInput
): Promise<OrderRecoveryScanResult> {
  const orderModule = container.resolve(Modules.ORDER) as any
  if (!orderModule || typeof orderModule.listAndCountOrders !== "function") {
    return {
      status: "SCAN_INCOMPLETE",
      totalScanned: 0,
      reason: "ORDER_MODULE_UNAVAILABLE",
    }
  }

  const pageSize = input.pageSize ?? DEFAULT_SCAN_PAGE_SIZE
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    return {
      status: "SCAN_INCOMPLETE",
      totalScanned: 0,
      reason: "INVALID_PAGE_SIZE",
    }
  }

  const windowResult = resolveOrderRecoveryScanWindow({
    cclCreatedAt: input.cclCreatedAt,
    cclExecutionStartedAt: input.cclExecutionStartedAt,
    windowSafetyMarginMs: input.windowSafetyMarginMs,
  })

  if (!windowResult.ok) {
    return {
      status: "SCAN_INCOMPLETE",
      totalScanned: 0,
      reason: windowResult.reason,
    }
  }

  const { windowStart } = windowResult

  const filters = {
    created_at: {
      $gte: windowStart.toISOString(),
    },
  }

  const matchingCandidates: Array<Record<string, unknown>> = []
  let totalScanned = 0
  let expectedTotalCount: number | null = null
  let offset = 0

  while (true) {
    let rows: any[]
    let count: number

    try {
      const result = await orderModule.listAndCountOrders(filters, {
        take: pageSize,
        skip: offset,
        withDeleted: true,
        order: { created_at: "ASC", id: "ASC" },
        select: ["id", "currency_code", "total", "metadata", "created_at", "deleted_at"],
      })

      if (!Array.isArray(result) || result.length < 2) {
        return {
          status: "SCAN_INCOMPLETE",
          totalScanned,
          reason: "INVALID_LIST_AND_COUNT_RETURN_SHAPE",
        }
      }

      rows = result[0]
      count = result[1]
    } catch (scanError) {
      return {
        status: "SCAN_INCOMPLETE",
        totalScanned,
        reason: scanError instanceof Error ? scanError.message : String(scanError),
      }
    }

    if (!Number.isSafeInteger(count) || count < 0) {
      return {
        status: "SCAN_INCOMPLETE",
        totalScanned,
        reason: "INVALID_COUNT",
      }
    }

    if (expectedTotalCount === null) {
      expectedTotalCount = count
    } else if (expectedTotalCount !== count) {
      return {
        status: "SCAN_INCOMPLETE",
        totalScanned,
        reason: `COUNT_INCONSISTENCY: initial=${expectedTotalCount} current=${count}`,
      }
    }

    if (!Array.isArray(rows)) {
      return {
        status: "SCAN_INCOMPLETE",
        totalScanned,
        reason: "INVALID_ROWS_ARRAY",
      }
    }

    for (const order of rows) {
      totalScanned += 1

      if (validateOrderBirthMarkerOnOrder(order, input.cclId)) {
        const currency = String(order.currency_code ?? "").toLowerCase()
        if (currency !== "brl") {
          return {
            status: "AUTHORITY_CONFLICT",
            reason: `RECOVERED_ORDER_CURRENCY_MISMATCH: expected brl, got ${currency}`,
          }
        }

        const orderTotalMinor = brlMajorToMinor(order.total)
        if (orderTotalMinor !== input.expectedAmountMinor) {
          return {
            status: "AUTHORITY_CONFLICT",
            reason: `RECOVERED_ORDER_TOTAL_MISMATCH: expected minor ${input.expectedAmountMinor}, got ${orderTotalMinor}`,
          }
        }

        const orderId = String(order.id)
        if (input.existingCclOrderId && input.existingCclOrderId !== orderId) {
          return {
            status: "AUTHORITY_CONFLICT",
            reason: `CCL_ORDER_ID_CONFLICT: ccl expects ${input.existingCclOrderId}, candidate is ${orderId}`,
          }
        }
        if (input.existingPaOrderId && input.existingPaOrderId !== orderId) {
          return {
            status: "AUTHORITY_CONFLICT",
            reason: `PA_ORDER_ID_CONFLICT: pa expects ${input.existingPaOrderId}, candidate is ${orderId}`,
          }
        }

        matchingCandidates.push(order)
      }
    }

    const previousOffset = offset
    offset += rows.length

    if (rows.length > 0 && offset === previousOffset) {
      return {
        status: "SCAN_INCOMPLETE",
        totalScanned,
        reason: "OFFSET_DID_NOT_ADVANCE",
      }
    }

    if (rows.length === 0 && offset < expectedTotalCount) {
      return {
        status: "SCAN_INCOMPLETE",
        totalScanned,
        reason: "PAGINATION_EMPTY_PAGE",
      }
    }

    if (offset >= expectedTotalCount) {
      break
    }
  }

  if (expectedTotalCount === null) {
    return {
      status: "SCAN_INCOMPLETE",
      totalScanned,
      reason: "MISSING_EXPECTED_TOTAL_COUNT",
    }
  }

  if (totalScanned !== expectedTotalCount) {
    return {
      status: "SCAN_INCOMPLETE",
      totalScanned,
      reason: `SCAN_COUNT_MISMATCH: expected=${expectedTotalCount} scanned=${totalScanned}`,
    }
  }

  if (matchingCandidates.length === 1) {
    const candidate = matchingCandidates[0]
    return {
      status: "EXACT_ONE",
      order: candidate,
      orderId: String(candidate.id),
      totalScanned,
    }
  }

  if (matchingCandidates.length > 1) {
    return {
      status: "MULTIPLE",
      matchingOrders: matchingCandidates,
      totalScanned,
      conflictReason: `MULTIPLE_EXACT_MARKER_ORDERS_FOUND: count=${matchingCandidates.length}`,
    }
  }

  return {
    status: "ZERO",
    totalScanned,
    executionStarted: Boolean(input.cclExecutionStartedAt),
  }
}
