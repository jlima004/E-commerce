import {
  type CatalogVariantInput,
  GELATO_TEMPLATE_MODE_FIXED,
  assertSellableVariantMetadata,
} from "./gelato-metadata"

export type GelatoSnapshot = {
  gelato_product_uid: string
  gelato_template_id: string
  gelato_variant_options: {
    size: string
    color: string
  }
  template_mode: typeof GELATO_TEMPLATE_MODE_FIXED
  source_product_variant_id: string
  source_product_variant_sku: string
  captured_at: string
}

export type BuildGelatoSnapshotInput = CatalogVariantInput

export type BuildGelatoSnapshotOptions = {
  capturedAt?: string
}

export type GelatoSnapshotErrorCode =
  | "GELATO_SNAPSHOT_SOURCE_VARIANT_ID_MISSING"
  | "GELATO_SNAPSHOT_SOURCE_VARIANT_SKU_MISSING"
  | "GELATO_SNAPSHOT_CAPTURED_AT_INVALID"

export class GelatoSnapshotError extends Error {
  readonly code: GelatoSnapshotErrorCode

  constructor(code: GelatoSnapshotErrorCode) {
    super(code)
    this.name = "GelatoSnapshotError"
    this.code = code
  }
}

function assertNonEmptyString(
  value: string | undefined,
  code: GelatoSnapshotErrorCode
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GelatoSnapshotError(code)
  }

  return value.trim()
}

function resolveCapturedAt(capturedAt?: string): string {
  const candidate = capturedAt ?? new Date().toISOString()
  const parsed = new Date(candidate)

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== candidate) {
    throw new GelatoSnapshotError("GELATO_SNAPSHOT_CAPTURED_AT_INVALID")
  }

  return candidate
}

export function buildGelatoSnapshot(
  variant: BuildGelatoSnapshotInput,
  options: BuildGelatoSnapshotOptions = {}
): GelatoSnapshot {
  const metadata = assertSellableVariantMetadata(variant)
  const sourceVariantId = assertNonEmptyString(
    variant.id,
    "GELATO_SNAPSHOT_SOURCE_VARIANT_ID_MISSING"
  )
  const sourceVariantSku = assertNonEmptyString(
    variant.sku,
    "GELATO_SNAPSHOT_SOURCE_VARIANT_SKU_MISSING"
  )
  const capturedAt = resolveCapturedAt(options.capturedAt)

  return Object.freeze({
    gelato_product_uid: metadata.gelato_product_uid,
    gelato_template_id: metadata.gelato_template_id,
    gelato_variant_options: Object.freeze({
      size: metadata.gelato_variant_options.size,
      color: metadata.gelato_variant_options.color,
    }),
    template_mode: metadata.template_mode,
    source_product_variant_id: sourceVariantId,
    source_product_variant_sku: sourceVariantSku,
    captured_at: capturedAt,
  })
}
