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

function sanitizeSnapshotError(error: unknown): OrderLineItemGelatoSnapshotError {
  if (error instanceof OrderLineItemGelatoSnapshotError) {
    return error
  }

  if (error instanceof Error && typeof (error as { code?: unknown }).code === "string") {
    const code = String((error as { code: string }).code)

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

      return {
        id: itemId,
        metadata: {
          ...(item.metadata ?? {}),
          gelato_snapshot: snapshot,
        },
        gelato_snapshot: snapshot,
      }
    } catch (error) {
      throw sanitizeSnapshotError(error)
    }
  })
}
