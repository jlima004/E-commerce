import {
  assertPositiveBrlMinorAmount,
  brlMajorToMinor,
  normalizeBrlMajorAmount,
} from "./money-units"

export type CanonicalCartMoneySnapshot = {
  amount_minor: number
  amount_major: number
  currency_code: "brl"
}

export type CanonicalCartMoneySource = {
  total?: unknown
  currency_code?: unknown
}

export class CanonicalCartMoneyError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = "CanonicalCartMoneyError"
    this.code = code
  }
}

function fail(code: string): never {
  throw new CanonicalCartMoneyError(code)
}

function normalizeBrlCurrencyCode(value: unknown): "brl" {
  if (typeof value !== "string") {
    return fail("CANONICAL_CART_CURRENCY_INVALID")
  }

  const normalized = value.trim().toLowerCase()
  if (normalized !== "brl") {
    return fail("CANONICAL_CART_CURRENCY_INVALID")
  }

  return "brl"
}

export function resolveCanonicalCartPaymentAmount(
  cart: CanonicalCartMoneySource
): CanonicalCartMoneySnapshot {
  const currency_code = normalizeBrlCurrencyCode(cart.currency_code)

  if (cart.total === undefined || cart.total === null) {
    return fail("CANONICAL_CART_TOTAL_MISSING")
  }

  try {
    const amount_major = normalizeBrlMajorAmount(cart.total)
    const amount_minor = assertPositiveBrlMinorAmount(
      brlMajorToMinor(cart.total)
    )

    return {
      amount_minor,
      amount_major,
      currency_code,
    }
  } catch (error) {
    if (error instanceof CanonicalCartMoneyError) {
      throw error
    }

    return fail("CANONICAL_CART_TOTAL_INVALID")
  }
}
