import { MedusaError } from "@medusajs/framework/utils"
import {
  GelatoMetadataError,
  type GelatoMetadataErrorPayload,
} from "../../../modules/catalog/gelato-metadata"

const CANARY_PATTERNS = [
  /whsec_/i,
  /sk_(live|test)_/i,
  /postgresql:\/\//i,
  /redis:\/\//i,
  /supersecret/i,
  /at\s+[\w./-]+\.(?:ts|js):\d+:\d+/i,
]

function assertSafeOperatorMessage(message: string): string {
  for (const pattern of CANARY_PATTERNS) {
    if (pattern.test(message)) {
      throw new Error("Unsafe operator message leaked internal details")
    }
  }

  return message
}

function formatMissingFields(missing: string[]): string {
  return missing.join(", ")
}

export function formatGelatoMetadataAdminMessage(
  payload: GelatoMetadataErrorPayload
): string {
  switch (payload.code) {
    case "GELATO_METADATA_INCOMPLETE":
      return assertSafeOperatorMessage(
        `Variant cannot be published or sold: Gelato metadata is incomplete. Missing: ${formatMissingFields(payload.missing)}.`
      )
    case "GELATO_TEMPLATE_MODE_INVALID":
      return assertSafeOperatorMessage(
        `Variant cannot be published or sold: template_mode must be "${payload.expected}" (received "${payload.received}").`
      )
    case "GELATO_VARIANT_OPTIONS_INVALID":
      return assertSafeOperatorMessage(
        "Variant cannot be published or sold: gelato_variant_options must be an object with size and color."
      )
    case "GELATO_VARIANT_OPTIONS_EMPTY":
      return assertSafeOperatorMessage(
        `Variant cannot be published or sold: gelato_variant_options is missing ${formatMissingFields(payload.missing)}.`
      )
    case "GELATO_PRICE_MISSING":
      return assertSafeOperatorMessage(
        "Variant cannot be published or sold: a BRL price is required."
      )
    case "GELATO_PRICE_INVALID":
      return assertSafeOperatorMessage(
        "Variant cannot be published or sold: BRL price must be positive major units with at most two decimal places."
      )
    default:
      return assertSafeOperatorMessage(
        "Variant cannot be published or sold: invalid Gelato metadata."
      )
  }
}

export function toSellableVariantMedusaError(error: unknown): MedusaError {
  if (error instanceof GelatoMetadataError) {
    return new MedusaError(
      MedusaError.Types.INVALID_DATA,
      formatGelatoMetadataAdminMessage(error.toPayload())
    )
  }

  if (error instanceof MedusaError) {
    return error
  }

  return new MedusaError(
    MedusaError.Types.INVALID_DATA,
    "Variant cannot be published or sold: invalid Gelato metadata."
  )
}

export function mapGelatoMetadataErrorResponseBody(error: unknown): {
  type: string
  message: string
} {
  const medusaError = toSellableVariantMedusaError(error)

  return {
    type: medusaError.type,
    message: medusaError.message,
  }
}
