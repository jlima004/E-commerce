export const GELATO_TEMPLATE_MODE_FIXED = "fixed" as const

export type GelatoTemplateMode = typeof GELATO_TEMPLATE_MODE_FIXED

export type GelatoVariantOptions = {
  size: string
  color: string
}

export type GelatoVariantMetadata = {
  gelato_product_uid: string
  gelato_template_id: string
  gelato_variant_options: GelatoVariantOptions
  template_mode: GelatoTemplateMode
}

export type GelatoMetadataField =
  | keyof GelatoVariantMetadata
  | "gelato_variant_options.size"
  | "gelato_variant_options.color"

export type GelatoMetadataReadResult =
  | {
      status: "complete"
      data: GelatoVariantMetadata
      missing: []
    }
  | {
      status: "incomplete"
      data: Partial<GelatoVariantMetadata>
      missing: GelatoMetadataField[]
    }

export type CatalogVariantPrice = {
  currency_code: string
  amount: number
}

export type CatalogVariantInput = {
  id?: string
  sku?: string
  metadata?: Record<string, unknown> | null
  prices?: CatalogVariantPrice[]
}

export type GelatoMetadataErrorCode =
  | "GELATO_METADATA_INCOMPLETE"
  | "GELATO_TEMPLATE_MODE_INVALID"
  | "GELATO_VARIANT_OPTIONS_INVALID"
  | "GELATO_VARIANT_OPTIONS_EMPTY"
  | "GELATO_PRICE_MISSING"
  | "GELATO_PRICE_INVALID"

export type GelatoMetadataErrorPayload =
  | {
      code: "GELATO_METADATA_INCOMPLETE"
      missing: GelatoMetadataField[]
    }
  | {
      code: "GELATO_TEMPLATE_MODE_INVALID"
      expected: GelatoTemplateMode
      received: string
    }
  | {
      code: "GELATO_VARIANT_OPTIONS_INVALID"
      reason: "not_object"
    }
  | {
      code: "GELATO_VARIANT_OPTIONS_EMPTY"
      missing: Array<"size" | "color">
    }
  | {
      code: "GELATO_PRICE_MISSING"
      currency_code: "brl"
    }
  | {
      code: "GELATO_PRICE_INVALID"
      currency_code: "brl"
      reason: "amount_must_be_positive_major_units_with_at_most_two_decimals"
    }
