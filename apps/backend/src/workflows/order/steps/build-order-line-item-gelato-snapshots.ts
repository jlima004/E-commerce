import { buildGelatoSnapshot } from "../../../modules/catalog/gelato-snapshot"
import type { GelatoSnapshot } from "../../../modules/catalog/gelato-snapshot"

type CartVariantRecord = {
  id?: string | null
  sku?: string | null
  metadata?: Record<string, unknown> | null
  prices?: Array<{
    amount: number
    currency_code: string
  }> | null
}

type CartLineItemRecord = {
  id: string
  title?: string | null
  metadata?: Record<string, unknown> | null
  variant?: CartVariantRecord | null
}

const GELATO_SNAPSHOT_KEYS = [
  "gelato_product_uid",
  "gelato_template_id",
  "gelato_variant_options",
  "template_mode",
  "source_product_variant_id",
  "source_product_variant_sku",
  "captured_at",
] as const

const GELATO_VARIANT_OPTION_KEYS = ["size", "color"] as const

export type BuildOrderLineItemGelatoSnapshotsInput = {
  items: CartLineItemRecord[]
  captured_at?: string
}

export type OrderLineItemGelatoSnapshotPatch = {
  id: string
  metadata: Record<string, unknown>
  gelato_snapshot: GelatoSnapshot
}

export class OrderLineItemGelatoSnapshotError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "OrderLineItemGelatoSnapshotError"
    this.code = code
  }
}

function assertLineItemId(value: string | null | undefined): string {
  const normalized = value?.trim()

  if (!normalized) {
    throw new OrderLineItemGelatoSnapshotError(
      "ORDER_LINE_ITEM_ID_REQUIRED",
      "Line item sem identificador para persistir o snapshot."
    )
  }

  return normalized
}

function getErrorCode(error: Error): string | null {
  const code = (error as { code?: unknown }).code

  return typeof code === "string" ? code : null
}

function sanitizeSnapshotError(error: unknown): OrderLineItemGelatoSnapshotError {
  if (error instanceof OrderLineItemGelatoSnapshotError) {
    return error
  }

  if (error instanceof Error) {
    const code = getErrorCode(error)

    if (!code) {
      return new OrderLineItemGelatoSnapshotError(
        "ORDER_GELATO_SNAPSHOT_BUILD_FAILED",
        "Nao foi possivel gerar o snapshot Gelato para o item do carrinho."
      )
    }

    return new OrderLineItemGelatoSnapshotError(
      `ORDER_${code}`,
      "Nao foi possivel gerar o snapshot Gelato para o item do carrinho."
    )
  }

  return new OrderLineItemGelatoSnapshotError(
    "ORDER_GELATO_SNAPSHOT_BUILD_FAILED",
    "Nao foi possivel gerar o snapshot Gelato para o item do carrinho."
  )
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const keys = Object.keys(value)

  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
}

function assertExactGelatoSnapshotV1Shape(snapshot: GelatoSnapshot): GelatoSnapshot {
  if (
    !hasExactKeys(snapshot as unknown as Record<string, unknown>, GELATO_SNAPSHOT_KEYS) ||
    !hasExactKeys(
      snapshot.gelato_variant_options as unknown as Record<string, unknown>,
      GELATO_VARIANT_OPTION_KEYS
    )
  ) {
    throw new OrderLineItemGelatoSnapshotError(
      "ORDER_GELATO_SNAPSHOT_SHAPE_INVALID",
      "Snapshot Gelato fora do contrato v1."
    )
  }

  return snapshot
}

export function buildOrderLineItemGelatoSnapshots(
  input: BuildOrderLineItemGelatoSnapshotsInput
): OrderLineItemGelatoSnapshotPatch[] {
  const capturedAt = input.captured_at ?? new Date().toISOString()

  return input.items.map((item) => {
    const itemId = assertLineItemId(item.id)
    const variant = item.variant

    if (!variant) {
      throw new OrderLineItemGelatoSnapshotError(
        "ORDER_GELATO_SNAPSHOT_VARIANT_REQUIRED",
        "Nao foi possivel gerar o snapshot Gelato para um item sem variant carregada."
      )
    }

    try {
      const snapshot = buildGelatoSnapshot(
        {
          id: variant.id ?? undefined,
          sku: variant.sku ?? undefined,
          metadata: variant.metadata ?? undefined,
          prices: variant.prices ?? undefined,
        },
        { capturedAt }
      )
      const gelatoSnapshot = assertExactGelatoSnapshotV1Shape(snapshot)

      return {
        id: itemId,
        metadata: {
          ...(item.metadata ?? {}),
          gelato_snapshot: gelatoSnapshot,
        },
        gelato_snapshot: gelatoSnapshot,
      }
    } catch (error) {
      throw sanitizeSnapshotError(error)
    }
  })
}
