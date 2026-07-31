import fs from "fs"
import os from "os"
import path from "path"
import qs from "qs"
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

const STORE_GET_PRODUCTS_SIMPLE_QUERY_NAMES = [
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
] as const

const OPERATOR_NAMES = [
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$like",
  "$ilike",
  "$re",
  "$contains",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
] as const

const operatorLeafNames = (prefix: string) =>
  OPERATOR_NAMES.map((operator) => `${prefix}[${operator}]`)

const VARIANT_IDENTITY_QUERY_NAMES = [
  "variants[q]",
  "variants[id]",
  "variants[sku]",
  "variants[ean]",
  "variants[upc]",
  "variants[barcode]",
  "variants[options][value]",
  "variants[options][option_id]",
] as const

const STORE_GET_PRODUCTS_QUERY_NAMES = [
  ...STORE_GET_PRODUCTS_SIMPLE_QUERY_NAMES,
  ...operatorLeafNames("created_at"),
  ...operatorLeafNames("updated_at"),
  ...operatorLeafNames("deleted_at"),
  ...VARIANT_IDENTITY_QUERY_NAMES,
  ...operatorLeafNames("variants[created_at]"),
  ...operatorLeafNames("variants[updated_at]"),
  ...operatorLeafNames("variants[deleted_at]"),
] as const

const OMITTED_RECURSIVE_OR_OBJECT_QUERY_NAMES = [
  "created_at",
  "updated_at",
  "deleted_at",
  "variants",
  "$and",
  "$or",
  "variants[$and]",
  "variants[$or]",
] as const

function serializeFormExplode(name: string, value: string | string[]): string {
  if (Array.isArray(value)) {
    return value.map((item) => `${name}=${item}`).join("&")
  }
  return `${name}=${value}`
}

function parseExpressQuery(raw: string) {
  return qs.parse(raw, { allowPrototypes: true, arrayLimit: 1000 })
}


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

  it("registers the four Admin native extensions in the Admin contract", () => {
    const adminNative = createFoundationRegistry()
      .getOperations("admin")
      .filter((operation) => operation.sourceClassification === "project-extension")

    expect(adminNative.map((operation) => `${operation.method} ${operation.path}`))
      .toEqual([
        "POST /admin/products",
        "POST /admin/products/{id}",
        "POST /admin/products/{id}/variants",
        "POST /admin/products/{id}/variants/{variant_id}",
      ])
    expect(adminNative.every((operation) => operation.officialReference.includes("/v2.16.0/")))
      .toBe(true)
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
  it("documents the explicit StoreGetProductsParams query leaves for list", () => {
    const names = STORE_PRODUCT_LIST_QUERY.map((param) => param.name)
    expect(names).toEqual([...STORE_GET_PRODUCTS_QUERY_NAMES])
    expect(names.slice(0, 20)).toEqual([
      ...STORE_GET_PRODUCTS_SIMPLE_QUERY_NAMES,
    ])
    expect(STORE_PRODUCT_LIST_QUERY).toHaveLength(100)
    expect(names).toEqual(
      expect.arrayContaining([
        "created_at[$gte]",
        "created_at[$eq]",
        "created_at[$in]",
        "updated_at[$lte]",
        "deleted_at[$gt]",
        "variants[sku]",
        "variants[q]",
        "variants[options][value]",
        "variants[options][option_id]",
        "variants[created_at][$gte]",
        "variants[updated_at][$lte]",
        "variants[deleted_at][$eq]",
      ])
    )
    for (const omittedName of OMITTED_RECURSIVE_OR_OBJECT_QUERY_NAMES) {
      expect(names).not.toContain(omittedName)
    }

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

    for (const param of STORE_PRODUCT_LIST_QUERY) {
      const schema = param.schema as {
        type?: string
        oneOf?: readonly { type?: string }[]
      }
      expect(schema.type).not.toBe("object")
      expect(schema.oneOf?.some((candidate) => candidate.type === "object") ?? false)
        .toBe(false)
    }

    const arrayCapableBracketNames = [
      ...[
        "created_at",
        "updated_at",
        "deleted_at",
        "variants[created_at]",
        "variants[updated_at]",
        "variants[deleted_at]",
      ].flatMap((prefix) =>
        ["$eq", "$ne", "$in", "$nin"].map(
          (operator) => `${prefix}[${operator}]`
        )
      ),
      "variants[id]",
      "variants[sku]",
      "variants[ean]",
      "variants[upc]",
      "variants[barcode]",
    ]
    for (const name of arrayCapableBracketNames) {
      expect(
        STORE_PRODUCT_LIST_QUERY.find((param) => param.name === name)
      ).toEqual(expect.objectContaining({ style: "form", explode: true }))
    }
  })

  it("reuses StoreGetProductsParams for retrieve (same middleware validator)", () => {
    expect(STORE_PRODUCT_RETRIEVE_QUERY).toBe(STORE_PRODUCT_LIST_QUERY)
    const names = STORE_PRODUCT_RETRIEVE_QUERY.map((param) => param.name)
    expect(names).toEqual([...STORE_GET_PRODUCTS_QUERY_NAMES])
    expect(names.slice(0, 20)).toEqual([
      ...STORE_GET_PRODUCTS_SIMPLE_QUERY_NAMES,
    ])
    expect(names).toHaveLength(100)
    for (const omittedName of OMITTED_RECURSIVE_OR_OBJECT_QUERY_NAMES) {
      expect(names).not.toContain(omittedName)
    }
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
        expect.objectContaining({ name: "created_at[$gte]", in: "query" }),
        expect.objectContaining({ name: "variants[sku]", in: "query" }),
      ])
    )
  })

  it("serializes form+explode bracket leaves into Medusa nested filters", () => {
    const cases = [
      {
        name: "created_at[$gte]",
        value: "2026-01-01T00:00:00.000Z",
        expected: {
          created_at: { $gte: "2026-01-01T00:00:00.000Z" },
        },
      },
      {
        name: "variants[sku]",
        value: "SKU-001",
        expected: { variants: { sku: "SKU-001" } },
      },
      {
        name: "variants[options][value]",
        value: "Preto",
        expected: { variants: { options: { value: "Preto" } } },
      },
      {
        name: "variants[sku]",
        value: ["SKU1", "SKU2"],
        expected: { variants: { sku: ["SKU1", "SKU2"] } },
      },
    ] as const

    const documentedNames = STORE_PRODUCT_LIST_QUERY.map((param) => param.name)
    for (const { name, value, expected } of cases) {
      expect(documentedNames).toContain(name)
      expect(
        parseExpressQuery(
          serializeFormExplode(name, value as string | string[])
        )
      ).toEqual(expected)
    }

    const timestamp = "2026-01-01T00:00:00.000Z"
    const encodedQuery = `${encodeURIComponent(
      "created_at[$gte]"
    )}=${encodeURIComponent(timestamp)}`
    const expected = { created_at: { $gte: timestamp } }
    expect(parseExpressQuery(encodedQuery)).toEqual(expected)
    expect(parseExpressQuery(decodeURIComponent(encodedQuery))).toEqual(expected)
  })
})
