import { domainToASCII } from "node:url"

export const CUSTOMER_AUTH_EMAIL_NORMALIZATION_VERSION = "p14-d12-v1" as const

export class CustomerAuthEmailNormalizationError extends Error {
  readonly code = "CUSTOMER_AUTH_EMAIL_INVALID"

  constructor() {
    super("Invalid customer auth email")
    this.name = "CustomerAuthEmailNormalizationError"
  }
}

function invalidEmail(): never {
  throw new CustomerAuthEmailNormalizationError()
}

/**
 * The only email identity normalization allowed by Phase 14.
 * Provider-specific aliases (+ tags and dots) are intentionally preserved.
 */
export function normalizeCustomerAuthEmail(input: string): string {
  if (typeof input !== "string") {
    return invalidEmail()
  }

  const trimmed = input.trim()
  if (
    trimmed.length === 0 ||
    [...trimmed].filter((value) => value === "@").length !== 1
  ) {
    return invalidEmail()
  }

  const separator = trimmed.indexOf("@")
  const localPart = trimmed.slice(0, separator)
  const rawDomain = trimmed.slice(separator + 1)

  if (
    localPart.length === 0 ||
    localPart.length > 64 ||
    !/^[\x21-\x7e]+$/.test(localPart) ||
    rawDomain.length === 0
  ) {
    return invalidEmail()
  }

  let asciiDomain: string
  try {
    asciiDomain = domainToASCII(rawDomain)
  } catch {
    return invalidEmail()
  }

  const normalizedDomain = asciiDomain.toLowerCase()
  const labels = normalizedDomain.split(".")
  if (
    normalizedDomain.length === 0 ||
    normalizedDomain.length > 253 ||
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-")
    )
  ) {
    return invalidEmail()
  }

  const normalized = `${localPart.toLowerCase()}@${normalizedDomain}`
  if (normalized.length > 254) {
    return invalidEmail()
  }

  return normalized
}
