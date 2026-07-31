import fs from "fs"
import os from "os"
import path from "path"
import {
  STORE_PRODUCT_LIST_QUERY,
  STORE_PRODUCT_RETRIEVE_QUERY,
} from "../components/parameters"
import {
  CANONICAL_NATIVE_EXTENSION_MATRIX,
  NATIVE_EXTENSIONS,
  verifyNativeExtensions,
  type NativeExtensionEntry,
} from "../coverage/native-routes"
import { createFoundationRegistry } from "../registry"

function cloneEntries(): NativeExtensionEntry[] {
  return JSON.parse(JSON.stringify(NATIVE_EXTENSIONS)) as NativeExtensionEntry[]
}

/** Top-level StoreGetProductsParams query names (Medusa 2.16.0). */
const STORE_GET_PRODUCTS_QUERY_NAMES = [
  "fields",
  "limit",
  "offset",
  "order",
  "with_deleted",
  "region_id",
  "country_code",
  "province",
  "cart_id",
  "sales_channel_id",
  "q",
  "id",
  "title",
  "handle",
  "is_giftcard",
  "category_id",
  "external_id",
  "collection_id",
  "tag_id",
  "type_id",
  "created_at",
  "updated_at",
  "deleted_at",
  "$and",
  "$or",
  "variants",
] as const


describe("native Medusa extension manifest", () => {
  it("contains exactly the approved six versioned operations and official URLs", () => {
    expect(CANONICAL_NATIVE_EXTENSION_MATRIX).toHaveLength(6)
    expect(
      NATIVE_EXTENSIONS.map((entry) => `${entry.method} ${entry.path}`)
    ).toEqual([
      "GET /store/products",
      "GET /store/products/{id}",
      "POST /admin/products",
      "POST /admin/products/{id}",
      "POST /admin/products/{id}/variants",
      "POST /admin/products/{id}/variants/{variant_id}",
    ])
    expect(new Set(NATIVE_EXTENSIONS.map((entry) => entry.officialReference)).size)
      .toBe(6)
    expect(
      NATIVE_EXTENSIONS.every(
        (entry) =>
          entry.medusaVersion === "2.16.0" &&
          entry.officialReference.startsWith(
            "https://github.com/medusajs/medusa/blob/v2.16.0/"
          ) &&
          entry.inclusionReason.length > 0
      )
    ).toBe(true)
  })

  it("verifies every local evidence file and all 24 bound fingerprints", () => {
    expect(
      NATIVE_EXTENSIONS.reduce(
        (count, entry) => count + Object.keys(entry.fingerprints).length,
        0
      )
    ).toBe(24)
    expect(() => verifyNativeExtensions()).not.toThrow()
  })

  it("fails when local evidence changes", () => {
    const repositoryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "api-docs-native-")
    )
    const uniqueEvidence = new Set(
      NATIVE_EXTENSIONS.flatMap((entry) => entry.evidenceFiles)
    )
    for (const sourceFile of uniqueEvidence) {
      const target = path.join(repositoryRoot, sourceFile)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.resolve(__dirname, "../../../../..", sourceFile), target)
    }

    expect(() =>
      verifyNativeExtensions(cloneEntries(), repositoryRoot)
    ).not.toThrow()

    const changed = path.join(
      repositoryRoot,
      NATIVE_EXTENSIONS[0].evidenceFiles[0]
    )
    fs.appendFileSync(changed, "\n// drift\n", "utf8")
    expect(() =>
      verifyNativeExtensions(cloneEntries(), repositoryRoot)
    ).toThrow("fingerprint drift")

    fs.rmSync(repositoryRoot, { recursive: true, force: true })
  })

  it("does not allow fingerprints to be exchanged between operations", () => {
    const entries = cloneEntries()
    const sourceFile = entries[1].evidenceFiles[0]
    entries[1].fingerprints[sourceFile] =
      entries[0].fingerprints[entries[0].evidenceFiles[0]]

    expect(() => verifyNativeExtensions(entries)).toThrow("fingerprint drift")
  })

  it.each([
    ["surface", "admin"],
    ["owningContract", "admin.openapi.json"],
    ["officialReference", "https://example.test/wrong-reference"],
    ["method", "POST"],
    ["path", "/store/wrong-path"],
    ["medusaVersion", "2.15.0"],
  ] as const)("rejects canonical %s drift", (field, value) => {
    const entries = cloneEntries()
    Object.assign(entries[0], { [field]: value })

    expect(() => verifyNativeExtensions(entries)).toThrow(
      "canonical matrix mismatch"
    )
  })
})

describe("native Store catalog StoreGetProductsParams query contract", () => {
  it("documents the complete StoreGetProductsParams top-level query set for list", () => {
    const names = STORE_PRODUCT_LIST_QUERY.map((param) => param.name)
    expect(names).toEqual([...STORE_GET_PRODUCTS_QUERY_NAMES])
    expect(STORE_PRODUCT_LIST_QUERY).toHaveLength(26)

    const limit = STORE_PRODUCT_LIST_QUERY.find((param) => param.name === "limit")
    const offset = STORE_PRODUCT_LIST_QUERY.find(
      (param) => param.name === "offset"
    )
    expect(limit?.schema).toEqual(
      expect.objectContaining({ type: "integer", default: 50 })
    )
    expect(offset?.schema).toEqual(
      expect.objectContaining({ type: "integer", default: 0 })
    )

    const fields = STORE_PRODUCT_LIST_QUERY.find(
      (param) => param.name === "fields"
    )
    expect(fields?.description).toMatch(/closed public catalog field set/i)

    for (const filterName of [
      "sales_channel_id",
      "id",
      "title",
      "handle",
      "category_id",
      "collection_id",
      "tag_id",
      "type_id",
    ] as const) {
      const param = STORE_PRODUCT_LIST_QUERY.find((item) => item.name === filterName)
      expect(param?.schema).toEqual(
        expect.objectContaining({
          oneOf: expect.arrayContaining([
            expect.objectContaining({ type: "string" }),
            expect.objectContaining({ type: "array" }),
          ]),
        })
      )
    }

    for (const dateName of ["created_at", "updated_at", "deleted_at"] as const) {
      const param = STORE_PRODUCT_LIST_QUERY.find((item) => item.name === dateName)
      expect(param?.schema).toEqual(
        expect.objectContaining({
          oneOf: expect.arrayContaining([
            expect.objectContaining({ type: "object" }),
          ]),
        })
      )
    }

    expect(
      STORE_PRODUCT_LIST_QUERY.find((param) => param.name === "variants")?.schema
    ).toEqual(expect.objectContaining({ type: "object" }))
    expect(
      STORE_PRODUCT_LIST_QUERY.find((param) => param.name === "$and")?.schema
    ).toEqual(expect.objectContaining({ type: "array" }))
    expect(
      STORE_PRODUCT_LIST_QUERY.find((param) => param.name === "$or")?.schema
    ).toEqual(expect.objectContaining({ type: "array" }))
  })

  it("reuses StoreGetProductsParams for retrieve (same middleware validator)", () => {
    expect(STORE_PRODUCT_RETRIEVE_QUERY).toBe(STORE_PRODUCT_LIST_QUERY)
    expect(STORE_PRODUCT_RETRIEVE_QUERY.map((param) => param.name)).toEqual([
      ...STORE_GET_PRODUCTS_QUERY_NAMES,
    ])
  })

  it("wires list and retrieve operations with the full query parameter set", () => {
    const registry = createFoundationRegistry()
    const list = registry
      .getOperations("store")
      .find((operation) => operation.path === "/store/products")
    const retrieve = registry
      .getOperations("store")
      .find((operation) => operation.path === "/store/products/{id}")

    const listQueryNames = (list?.parameters ?? [])
      .filter(
        (param): param is { name: string; in: string } =>
          typeof param === "object" &&
          param !== null &&
          "name" in param &&
          "in" in param &&
          (param as { in: string }).in === "query"
      )
      .map((param) => param.name)

    const retrieveQueryNames = (retrieve?.parameters ?? [])
      .filter(
        (param): param is { name: string; in: string } =>
          typeof param === "object" &&
          param !== null &&
          "name" in param &&
          "in" in param &&
          (param as { in: string }).in === "query"
      )
      .map((param) => param.name)

    expect(listQueryNames).toEqual(
      expect.arrayContaining([...STORE_GET_PRODUCTS_QUERY_NAMES])
    )
    expect(retrieveQueryNames).toEqual(
      expect.arrayContaining([...STORE_GET_PRODUCTS_QUERY_NAMES])
    )
    expect(retrieve?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", required: true }),
        expect.objectContaining({ name: "fields", in: "query" }),
        expect.objectContaining({ name: "region_id", in: "query" }),
        expect.objectContaining({ name: "sales_channel_id", in: "query" }),
        expect.objectContaining({ name: "variants", in: "query" }),
      ])
    )
  })
})
