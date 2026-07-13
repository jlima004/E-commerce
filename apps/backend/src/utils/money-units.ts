type BrlMajorPrimitive = number | string | bigint

const MAX_SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_UNWRAP_DEPTH = 12

class MoneyUnitError extends Error {
  constructor(code: string) {
    super(code)
    this.name = "MoneyUnitError"
  }
}

function fail(code: string): never {
  throw new MoneyUnitError(code)
}

function unwrapAmountLike(
  value: unknown,
  seen: Set<object> = new Set(),
  depth = 0
): BrlMajorPrimitive {
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "bigint"
  ) {
    return value
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail("BRL_AMOUNT_INVALID")
  }

  if (depth >= MAX_UNWRAP_DEPTH || seen.has(value)) {
    return fail("BRL_AMOUNT_INVALID")
  }

  seen.add(value)

  const amountLike = value as {
    rawAmount?: unknown
    numeric?: unknown
    valueOf?: () => unknown
    toString?: () => string
  }

  if (amountLike.rawAmount !== undefined) {
    return unwrapAmountLike(amountLike.rawAmount, seen, depth + 1)
  }

  if (amountLike.numeric !== undefined) {
    return unwrapAmountLike(amountLike.numeric, seen, depth + 1)
  }

  try {
    if (typeof amountLike.valueOf === "function") {
      const resolved = amountLike.valueOf.call(value)
      if (resolved !== value) {
        return unwrapAmountLike(resolved, seen, depth + 1)
      }
    }

    if (typeof amountLike.toString === "function") {
      const resolved = amountLike.toString.call(value)
      if (resolved && resolved !== "[object Object]") {
        return unwrapAmountLike(resolved, seen, depth + 1)
      }
    }
  } catch {
    return fail("BRL_AMOUNT_INVALID")
  }

  return fail("BRL_AMOUNT_INVALID")
}

function expandDecimal(
  source: string,
  options: { allowExponent: boolean }
): { negative: boolean; integer: string; fraction: string } {
  const trimmed = source.trim()
  if (!trimmed || (!options.allowExponent && /e/i.test(trimmed))) {
    return fail("BRL_MAJOR_AMOUNT_INVALID")
  }

  const match = trimmed.match(
    /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/
  )
  if (!match) {
    return fail("BRL_MAJOR_AMOUNT_INVALID")
  }

  const sign = match[1]
  const integerDigits = match[2] ?? "0"
  const fractionDigits = match[3] ?? match[4] ?? ""
  const exponent = match[5] ? Number(match[5]) : 0

  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1_000) {
    return fail("BRL_MAJOR_AMOUNT_INVALID")
  }

  const digits = `${integerDigits}${fractionDigits}`
  const decimalIndex = integerDigits.length + exponent
  let integer: string
  let fraction: string

  if (decimalIndex <= 0) {
    integer = "0"
    fraction = `${"0".repeat(-decimalIndex)}${digits}`
  } else if (decimalIndex >= digits.length) {
    integer = `${digits}${"0".repeat(decimalIndex - digits.length)}`
    fraction = ""
  } else {
    integer = digits.slice(0, decimalIndex)
    fraction = digits.slice(decimalIndex)
  }

  integer = integer.replace(/^0+(?=\d)/, "") || "0"
  fraction = fraction.replace(/0+$/, "")

  if (fraction.length > 2) {
    return fail("BRL_MAJOR_AMOUNT_TOO_PRECISE")
  }

  return {
    negative: sign === "-",
    integer,
    fraction,
  }
}

function majorToMinorBigInt(value: unknown): bigint {
  const primitive = unwrapAmountLike(value)

  if (typeof primitive === "number" && !Number.isFinite(primitive)) {
    return fail("BRL_MAJOR_AMOUNT_INVALID")
  }

  const decimal = expandDecimal(String(primitive), {
    allowExponent: typeof primitive === "number",
  })
  const fractionalMinor = decimal.fraction.padEnd(2, "0") || "00"
  const magnitude = BigInt(decimal.integer) * 100n + BigInt(fractionalMinor)

  if (decimal.negative && magnitude > 0n) {
    return fail("BRL_MAJOR_AMOUNT_NEGATIVE")
  }

  if (magnitude > MAX_SAFE_MINOR) {
    return fail("BRL_MINOR_AMOUNT_OVERFLOW")
  }

  return magnitude
}

function assertBrlMinorInteger(value: unknown): number {
  const primitive = unwrapAmountLike(value)
  let amount: bigint

  if (typeof primitive === "bigint") {
    amount = primitive
  } else if (typeof primitive === "number") {
    if (!Number.isSafeInteger(primitive)) {
      return fail("BRL_MINOR_AMOUNT_INVALID")
    }
    amount = BigInt(primitive)
  } else {
    const trimmed = primitive.trim()
    if (!/^[+-]?\d+$/.test(trimmed)) {
      return fail("BRL_MINOR_AMOUNT_INVALID")
    }
    amount = BigInt(trimmed)
  }

  if (amount > MAX_SAFE_MINOR || amount < -MAX_SAFE_MINOR) {
    return fail("BRL_MINOR_AMOUNT_OVERFLOW")
  }

  return Number(amount)
}

export function normalizeBrlMajorAmount(value: unknown): number {
  const minor = majorToMinorBigInt(value)
  const normalized = Number(minor) / 100

  if (!Number.isFinite(normalized)) {
    return fail("BRL_MAJOR_AMOUNT_INVALID")
  }

  return normalized
}

export function brlMajorToMinor(value: unknown): number {
  return Number(majorToMinorBigInt(value))
}

export function assertPositiveBrlMinorAmount(value: unknown): number {
  const amount = assertBrlMinorInteger(value)

  if (amount <= 0) {
    return fail("BRL_MINOR_AMOUNT_NOT_POSITIVE")
  }

  return amount
}

export function assertNonNegativeBrlMinorAmount(value: unknown): number {
  const amount = assertBrlMinorInteger(value)

  if (amount < 0) {
    return fail("BRL_MINOR_AMOUNT_NEGATIVE")
  }

  return amount
}
