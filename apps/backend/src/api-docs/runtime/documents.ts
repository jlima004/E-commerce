import storeDocument from "../generated/store.openapi.json"
import adminDocument from "../generated/admin.openapi.json"
import webhooksDocument from "../generated/webhooks.openapi.json"

function deepFreeze<T>(value: T): Readonly<T> {
  if (value === null || typeof value !== "object") {
    return value
  }

  if (!Object.isFrozen(value)) {
    Object.freeze(value)
  }

  for (const key of Reflect.ownKeys(value)) {
    const property = (value as Record<string | symbol, unknown>)[key]
    if (property !== null && typeof property === "object") {
      deepFreeze(property)
    }
  }

  return value
}

const storeOpenApiDocument = deepFreeze(storeDocument)
const adminOpenApiDocument = deepFreeze(adminDocument)
const webhooksOpenApiDocument = deepFreeze(webhooksDocument)

/**
 * Immutable accessors for committed OpenAPI artifacts.
 * No registry, generation, filesystem paths, or user input.
 */
export function getStoreOpenApiDocument(): Readonly<typeof storeDocument> {
  return storeOpenApiDocument
}

export function getAdminOpenApiDocument(): Readonly<typeof adminDocument> {
  return adminOpenApiDocument
}

export function getWebhooksOpenApiDocument(): Readonly<typeof webhooksDocument> {
  return webhooksOpenApiDocument
}
