import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import storeArtifact from "../generated/store.openapi.json"
import adminArtifact from "../generated/admin.openapi.json"
import webhooksArtifact from "../generated/webhooks.openapi.json"
import {
  getAdminOpenApiDocument,
  getStoreOpenApiDocument,
  getWebhooksOpenApiDocument,
} from "../runtime/documents"

describe("runtime documents", () => {
  it("loads all three committed OpenAPI documents", () => {
    expect(getStoreOpenApiDocument()).toBeDefined()
    expect(getAdminOpenApiDocument()).toBeDefined()
    expect(getWebhooksOpenApiDocument()).toBeDefined()
  })

  it("exposes info titles and openapi version fields per surface", () => {
    const store = getStoreOpenApiDocument()
    const admin = getAdminOpenApiDocument()
    const webhooks = getWebhooksOpenApiDocument()

    expect(store.openapi).toMatch(/^3\.\d+\.\d+$/)
    expect(admin.openapi).toMatch(/^3\.\d+\.\d+$/)
    expect(webhooks.openapi).toMatch(/^3\.\d+\.\d+$/)

    expect(store.info?.title).toBe("Indicio Cult Store API")
    expect(admin.info?.title).toBe("Indicio Cult Admin API")
    expect(webhooks.info?.title).toBe("Indicio Cult Webhooks API")
  })

  it("returns frozen artifacts matching committed JSON imports", () => {
    expect(getStoreOpenApiDocument()).toBe(storeArtifact)
    expect(getAdminOpenApiDocument()).toBe(adminArtifact)
    expect(getWebhooksOpenApiDocument()).toBe(webhooksArtifact)
  })

  it("returns the same object reference on repeated access (not request-derived)", () => {
    const first = getStoreOpenApiDocument()
    const second = getStoreOpenApiDocument()
    expect(first).toBe(second)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it("does not import generation, registry, or buildContracts in documents.ts", () => {
    const source = readFileSync(
      resolve(__dirname, "../runtime/documents.ts"),
      "utf8"
    )

    expect(source).not.toMatch(/from\s+["'].*generation/)
    expect(source).not.toMatch(/from\s+["'].*registry/)
    expect(source).not.toMatch(/buildContracts/)
    expect(source).not.toMatch(/createFoundationRegistry/)
  })
})
