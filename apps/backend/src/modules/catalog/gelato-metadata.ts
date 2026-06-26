import {
  CatalogVariantInput,
  GelatoMetadataErrorCode,
  GelatoMetadataErrorPayload,
  GelatoMetadataField,
  GelatoMetadataReadResult,
  GelatoVariantMetadata,
  GelatoVariantOptions,
  GELATO_TEMPLATE_MODE_FIXED,
} from "./types"

export {
  CatalogVariantInput,
  GelatoMetadataErrorCode,
  GelatoMetadataErrorPayload,
  GelatoMetadataField,
  GelatoMetadataReadResult,
  GelatoVariantMetadata,
  GelatoVariantOptions,
  GELATO_TEMPLATE_MODE_FIXED,
} from "./types"

export class GelatoMetadataError extends Error {
  readonly code: GelatoMetadataErrorCode
  readonly payload: GelatoMetadataErrorPayload

  constructor(payload: GelatoMetadataErrorPayload) {
    super(payload.code)
    this.name = "GelatoMetadataError"
    this.code = payload.code
    this.payload = payload
  }

  toPayload(): GelatoMetadataErrorPayload {
    return this.payload
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function parseVariantOptions(value: unknown): {
  options?: Partial<GelatoVariantOptions>
  missing: GelatoMetadataField[]
  invalid: boolean
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { missing: ["gelato_variant_options"], invalid: true }
  }

  const record = value as Record<string, unknown>
  const missing: GelatoMetadataField[] = []
  const options: Partial<GelatoVariantOptions> = {}

  if (isNonEmptyString(record.size)) {
    options.size = record.size.trim()
  } else {
    missing.push("gelato_variant_options.size")
  }

  if (isNonEmptyString(record.color)) {
    options.color = record.color.trim()
  } else {
    missing.push("gelato_variant_options.color")
  }

  if (missing.length > 0) {
    return {
      options:
        Object.keys(options).length > 0
          ? (options as Partial<GelatoVariantOptions>)
          : undefined,
      missing,
      invalid: false,
    }
  }

  return {
    options: options as GelatoVariantOptions,
    missing: [],
    invalid: false,
  }
}

function getBrlPriceAmount(variant: CatalogVariantInput): number | undefined {
  const brlPrice = variant.prices?.find(
    (price) => price.currency_code.toLowerCase() === "brl"
  )

  return brlPrice?.amount
}

function isIntegerCents(amount: number): boolean {
  return Number.isFinite(amount) && Number.isInteger(amount) && amount >= 0
}

export function readGelatoMetadata(
  variant: CatalogVariantInput
): GelatoMetadataReadResult {
  const metadata = variant.metadata ?? {}
  const missing: GelatoMetadataField[] = []
  const data: Partial<GelatoVariantMetadata> = {}

  if (isNonEmptyString(metadata.gelato_product_uid)) {
    data.gelato_product_uid = metadata.gelato_product_uid.trim()
  } else {
    missing.push("gelato_product_uid")
  }

  if (isNonEmptyString(metadata.gelato_template_id)) {
    data.gelato_template_id = metadata.gelato_template_id.trim()
  } else {
    missing.push("gelato_template_id")
  }

  const optionsResult = parseVariantOptions(metadata.gelato_variant_options)
  if (optionsResult.invalid) {
    missing.push("gelato_variant_options")
  } else if (optionsResult.options) {
    data.gelato_variant_options = optionsResult.options as GelatoVariantOptions
  }
  missing.push(...optionsResult.missing)

  if (metadata.template_mode === GELATO_TEMPLATE_MODE_FIXED) {
    data.template_mode = GELATO_TEMPLATE_MODE_FIXED
  } else {
    missing.push("template_mode")
  }

  const uniqueMissing = [...new Set(missing)]

  if (uniqueMissing.length === 0) {
    return {
      status: "complete",
      data: data as GelatoVariantMetadata,
      missing: [],
    }
  }

  return {
    status: "incomplete",
    data,
    missing: uniqueMissing,
  }
}

export function isSellableVariant(variant: CatalogVariantInput): boolean {
  const metadata = readGelatoMetadata(variant)
  if (metadata.status !== "complete") {
    return false
  }

  const brlAmount = getBrlPriceAmount(variant)
  return brlAmount !== undefined && isIntegerCents(brlAmount)
}

export function assertSellableVariantMetadata(
  variant: CatalogVariantInput
): GelatoVariantMetadata {
  const rawTemplateMode = variant.metadata?.template_mode
  if (
    rawTemplateMode !== undefined &&
    rawTemplateMode !== GELATO_TEMPLATE_MODE_FIXED
  ) {
    throw new GelatoMetadataError({
      code: "GELATO_TEMPLATE_MODE_INVALID",
      expected: GELATO_TEMPLATE_MODE_FIXED,
      received:
        typeof rawTemplateMode === "string" ? rawTemplateMode : String(rawTemplateMode),
    })
  }

  const metadata = readGelatoMetadata(variant)

  if (metadata.status !== "complete") {
    throw new GelatoMetadataError({
      code: "GELATO_METADATA_INCOMPLETE",
      missing: metadata.missing,
    })
  }

  const rawOptions = variant.metadata?.gelato_variant_options
  if (
    rawOptions === null ||
    typeof rawOptions !== "object" ||
    Array.isArray(rawOptions)
  ) {
    throw new GelatoMetadataError({
      code: "GELATO_VARIANT_OPTIONS_INVALID",
      reason: "not_object",
    })
  }

  const emptyOptionFields: Array<"size" | "color"> = []
  const options = rawOptions as Record<string, unknown>
  if (!isNonEmptyString(options.size)) {
    emptyOptionFields.push("size")
  }
  if (!isNonEmptyString(options.color)) {
    emptyOptionFields.push("color")
  }

  if (emptyOptionFields.length > 0) {
    throw new GelatoMetadataError({
      code: "GELATO_VARIANT_OPTIONS_EMPTY",
      missing: emptyOptionFields,
    })
  }

  const brlAmount = getBrlPriceAmount(variant)
  if (brlAmount === undefined) {
    throw new GelatoMetadataError({
      code: "GELATO_PRICE_MISSING",
      currency_code: "brl",
    })
  }

  if (!isIntegerCents(brlAmount)) {
    throw new GelatoMetadataError({
      code: "GELATO_PRICE_INVALID",
      currency_code: "brl",
      reason: "amount_must_be_integer_cents",
    })
  }

  return metadata.data
}
