import { HTTP_METHODS } from "../contracts"

const METHOD_ORDER = new Map(
  HTTP_METHODS.map((method, index) => [method.toLowerCase(), index])
)

function compareKeys(parentKey: string | undefined, left: string, right: string) {
  if (parentKey === "paths") {
    return left.localeCompare(right)
  }

  const leftMethod = METHOD_ORDER.get(left)
  const rightMethod = METHOD_ORDER.get(right)
  if (leftMethod !== undefined || rightMethod !== undefined) {
    return (leftMethod ?? Number.MAX_SAFE_INTEGER) -
      (rightMethod ?? Number.MAX_SAFE_INTEGER)
  }

  return left.localeCompare(right)
}

export function canonicalize<T>(value: T, parentKey?: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item)) as T
  }

  if (!value || typeof value !== "object") {
    return value
  }

  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort((a, b) =>
    compareKeys(parentKey, a, b)
  )) {
    output[key] = canonicalize(
      (value as Record<string, unknown>)[key],
      key
    )
  }

  return output as T
}
