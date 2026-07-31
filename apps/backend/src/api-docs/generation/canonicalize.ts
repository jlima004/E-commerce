import { HTTP_METHODS } from "../contracts"

const METHOD_ORDER = new Map(
  HTTP_METHODS.map((method, index) => [method.toLowerCase(), index])
)

function compareKeys(parentKey: string | undefined, left: string, right: string) {
  if (parentKey === "path-item") {
    const leftMethod = METHOD_ORDER.get(left)
    const rightMethod = METHOD_ORDER.get(right)
    if (leftMethod !== undefined || rightMethod !== undefined) {
      return (leftMethod ?? Number.MAX_SAFE_INTEGER) -
        (rightMethod ?? Number.MAX_SAFE_INTEGER)
    }
  }

  return left.localeCompare(right)
}

function canonicalizeAt<T>(value: T, location: string[]): T {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeAt(item, location)) as T
  }

  if (!value || typeof value !== "object") {
    return value
  }

  const isPathItem = location.length === 2 && location[0] === "paths"
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>).sort((a, b) =>
    compareKeys(isPathItem ? "path-item" : undefined, a, b)
  )) {
    output[key] = canonicalizeAt(
      (value as Record<string, unknown>)[key],
      [...location, key]
    )
  }

  return output as T
}

export function canonicalize<T>(value: T): T {
  return canonicalizeAt(value, [])
}
