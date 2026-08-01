import storeDocument from "../generated/store.openapi.json"
import adminDocument from "../generated/admin.openapi.json"
import webhooksDocument from "../generated/webhooks.openapi.json"

const storeOpenApiDocument = Object.freeze(storeDocument)
const adminOpenApiDocument = Object.freeze(adminDocument)
const webhooksOpenApiDocument = Object.freeze(webhooksDocument)

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
