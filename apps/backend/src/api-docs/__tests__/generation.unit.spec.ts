import fs from "fs"
import path from "path"
import { z, type ZodType } from "zod"
import type { OperationMetadata } from "../contracts"
import { CONTRACT_TITLES } from "../document"
import { buildContracts } from "../generation/build-documents"
import { canonicalize } from "../generation/canonicalize"
import { serializeDocument } from "../generation/serialize"
import { ContractRegistryBundle, createFoundationRegistry } from "../registry"
import { parseGenerateArguments } from "../../../scripts/openapi/generate"

function syntheticOperation(
  overrides: Partial<OperationMetadata> = {}
): OperationMetadata {
  return {
    surface: "store",
    method: "GET",
    path: "/store/synthetic",
    operationId: "storeSyntheticGet",
    summary: "Synthetic operation",
    tags: ["Synthetic"],
    security: [],
    parameters: [],
    requestBody: null,
    responses: {
      "200": {
        description: "Synthetic response",
      },
    },
    sourceClassification: "synthetic-test",
    sourceFiles: ["src/api/synthetic/route.ts"],
    testEvidence: ["src/api-docs/__tests__/generation.unit.spec.ts"],
    officialReference: "https://spec.openapis.org/oas/v3.1.2.html",
    inclusionReason: "Synthetic registry invariant proof",
    interactiveCandidate: false,
    nonInteractive: true,
    ...overrides,
  }
}

describe("OpenAPI foundation generation", () => {
  it("builds three deterministic populated OpenAPI 3.1.2 documents", () => {
    const first = buildContracts()
    const second = buildContracts()

    expect(first.map((contract) => contract.surface)).toEqual([
      "store",
      "admin",
      "webhooks",
    ])
    expect(first.map((contract) => contract.bytes)).toEqual(
      second.map((contract) => contract.bytes)
    )

    for (const contract of first) {
      expect(contract.document.openapi).toBe("3.1.2")
      expect(contract.document.info.version).toBe("1.0.0")
      expect(contract.document.info.title).toBe(CONTRACT_TITLES[contract.surface])
      expect(contract.document["x-medusa-version"]).toBe("2.16.0")
      expect(contract.document.servers).toEqual([
        { url: "/", description: "Same-origin" },
      ])
      expect(contract.bytes.endsWith("\n")).toBe(true)
      expect(contract.bytes.endsWith("\n\n")).toBe(false)
      expect(contract.bytes).not.toMatch(
        /(?:generatedAt|gitSha|\/home\/|localhost|herokuapp)/i
      )
    }

    const store = first.find((contract) => contract.surface === "store")
    const admin = first.find((contract) => contract.surface === "admin")
    const webhooks = first.find((contract) => contract.surface === "webhooks")
    expect(Object.keys(store?.document.paths ?? {}).sort()).toEqual([
      "/health/live",
      "/health/ready",
      "/store/carts/active",
      "/store/carts/{id}/payment-attempts/card",
      "/store/carts/{id}/payment-attempts/pix",
      "/store/customers/me/cart/attach",
      "/store/products",
      "/store/products/{id}",
      "/store/tracking/lookup",
    ])
    expect(Object.keys(admin?.document.paths ?? {}).sort()).toEqual([
      "/admin/exchanges",
      "/admin/exchanges/{id}",
      "/admin/operational-alerts",
      "/admin/operational-alerts/{id}",
      "/admin/products",
      "/admin/products/{id}",
      "/admin/products/{id}/variants",
      "/admin/products/{id}/variants/{variant_id}",
      "/admin/refunds/request",
    ])
    expect(Object.keys(webhooks?.document.paths ?? {}).sort()).toEqual([
      "/hooks/gelato",
      "/hooks/stripe",
    ])
  })

  it("uses an explicit operation description and otherwise falls back to summary", () => {
    const registry = new ContractRegistryBundle()
    registry.registerOperation(syntheticOperation())
    registry.registerOperation(
      syntheticOperation({
        method: "POST",
        path: "/store/synthetic-described",
        operationId: "storeSyntheticDescribed",
        description: "Explicit operation description",
      })
    )

    const store = buildContracts(registry).find(
      (contract) => contract.surface === "store"
    )?.document
    expect((store?.paths["/store/synthetic"] as { get: { description: string } }).get.description)
      .toBe("Synthetic operation")
    expect((store?.paths["/store/synthetic-described"] as { post: { description: string } }).post.description)
      .toBe("Explicit operation description")
  })

  it("uses canonical HTTP method order only inside Path Items", () => {
    const value = canonicalize({
      paths: {
        "/z": { head: {}, patch: {}, get: {}, post: {} },
        "/a": { delete: {}, put: {} },
      },
    })
    expect(Object.keys(value.paths)).toEqual(["/a", "/z"])
    expect(Object.keys(value.paths["/z"])).toEqual([
      "get",
      "post",
      "patch",
      "head",
    ])
  })

  it("uses lexical ordering for schema properties that look like HTTP methods", () => {
    const value = canonicalize({
      components: {
        schemas: {
          Synthetic: {
            properties: {
              post: {},
              get: {},
              alpha: {},
            },
          },
        },
      },
    })

    expect(
      Object.keys(value.components.schemas.Synthetic.properties)
    ).toEqual(["alpha", "get", "post"])
  })

  it("rejects duplicate method/path and duplicate operationId", () => {
    const registry = new ContractRegistryBundle()
    registry.registerOperation(syntheticOperation())

    expect(() =>
      registry.registerOperation(
        syntheticOperation({ operationId: "storeSyntheticDuplicate" })
      )
    ).toThrow("Duplicate method/path")

    expect(() =>
      registry.registerOperation(
        syntheticOperation({
          method: "POST",
          path: "/store/another",
        })
      )
    ).toThrow("Duplicate operationId")
  })

  it("rejects duplicate components and unrepresentable component values", () => {
    const registry = new ContractRegistryBundle()
    registry.registerComponent("shared", "schemas", "Synthetic", {
      type: "string",
    })
    expect(() =>
      registry.registerComponent("shared", "schemas", "Synthetic", {
        type: "number",
      })
    ).toThrow("Duplicate component")

    expect(() =>
      registry.registerComponent("shared", "schemas", "Invalid", {
        type: "string",
        invalid: () => "not-json",
      } as never)
    ).toThrow("unrepresentable")
  })

  it("rejects a surface component that collides with a shared component", () => {
    const registry = new ContractRegistryBundle()
    registry.registerComponent("shared", "schemas", "SharedCollision", {
      type: "string",
    })
    expect(() =>
      registry.registerComponent("store", "schemas", "SharedCollision", {
        type: "string",
      })
    ).toThrow("Duplicate shared component")
  })

  it("rejects missing provenance, inclusion reason, response metadata, and security schemes", () => {
    expect(() =>
      new ContractRegistryBundle().registerOperation(
        syntheticOperation({ sourceFiles: [] })
      )
    ).toThrow("missing provenance")
    expect(() =>
      new ContractRegistryBundle().registerOperation(
        syntheticOperation({ inclusionReason: "" })
      )
    ).toThrow("inclusionReason")
    expect(() =>
      new ContractRegistryBundle().registerOperation(
        syntheticOperation({ responses: {} })
      )
    ).toThrow("response metadata")
    expect(() =>
      new ContractRegistryBundle().registerOperation(
        syntheticOperation({ security: [{ missingScheme: [] }] })
      )
    ).toThrow("Unknown security scheme")
  })

  it("rejects unsafe examples", () => {
    expect(() =>
      new ContractRegistryBundle().registerOperation(
        syntheticOperation({
          responses: {
            "200": {
              description: "Unsafe",
              content: {
                "application/json": {
                  example: { authorization: "Bearer token-value" },
                },
              },
            },
          },
        })
      )
    ).toThrow("unsafe example")
  })

  it("shares only direction-safe Zod schemas", () => {
    const registry = new ContractRegistryBundle()
    const shared = z.strictObject({ value: z.string() })
    const registered = registry.registerSharedSchema(
      "shared",
      "SharedSynthetic",
      shared
    )
    expect(registered.parse({ value: "safe" })).toEqual({ value: "safe" })

    const transformed = z.string().transform((value) => value.length)
    expect(() =>
      registry.registerSchema("shared", "TransformedSynthetic", transformed, "shared")
    ).toThrow("cannot coerce, preprocess, transform, or default")
  })

  it("rejects transformed request and response schemas", () => {
    const transformedRequest: ZodType = z
      .string()
      .transform((value) => value.length)
    const transformedResponse: ZodType = z
      .string()
      .transform((value) => value.length)

    expect(() =>
      new ContractRegistryBundle().registerDirectionalSchemas(
        "shared",
        "SyntheticRequest",
        transformedRequest,
        "SyntheticResponse",
        z.number().int()
      )
    ).toThrow("cannot coerce, preprocess, transform, or default")

    expect(() =>
      new ContractRegistryBundle().registerDirectionalSchemas(
        "shared",
        "SyntheticRequest",
        z.string(),
        "SyntheticResponse",
        transformedResponse
      )
    ).toThrow("cannot coerce, preprocess, transform, or default")
  })

  it("accepts stable request and response schemas with distinct names", () => {
    const registry = new ContractRegistryBundle()
    const request = z.strictObject({ input: z.string() })
    const response = z.strictObject({ output: z.string() })

    const registered = registry.registerDirectionalSchemas(
      "shared",
      "SyntheticRequest",
      request,
      "SyntheticResponse",
      response
    )
    expect(registered.request.parse({ input: "abc" })).toEqual({ input: "abc" })
    expect(registered.response.parse({ output: "abc" })).toEqual({ output: "abc" })
    expect(
      Object.keys(buildContracts(registry)[0].document.components.schemas)
    ).toEqual(["SyntheticRequest", "SyntheticResponse"])
  })

  it("requires distinct names for directional schemas", () => {
    expect(() =>
      new ContractRegistryBundle().registerDirectionalSchemas(
        "shared",
        "Synthetic",
        z.string(),
        "Synthetic",
        z.string()
      )
    ).toThrow("distinct names")
  })

  it("rejects coercion, defaults, stripping, and nested unsafe schemas", () => {
    const unsafeSchemas: ZodType[] = [
      z.coerce.number(),
      z.string().default("fallback"),
      z.object({ value: z.string() }),
      z.strictObject({
        nested: z.string().transform((value) => value.length),
      }),
    ]

    for (const [index, schema] of unsafeSchemas.entries()) {
      expect(() =>
        new ContractRegistryBundle().registerSchema(
          "shared",
          `UnsafeSynthetic${index}`,
          schema,
          "request"
        )
      ).toThrow()
    }
  })

  it("imports only public zod-to-openapi entry points", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "registry.ts"),
      "utf8"
    )
    expect(source).toContain('from "@asteasolutions/zod-to-openapi"')
    expect(source).not.toMatch(/@asteasolutions\/zod-to-openapi\//)
  })

  it("serializes the same document to identical bytes twice", () => {
    const document = buildContracts(createFoundationRegistry())[0].document
    expect(serializeDocument(document)).toBe(serializeDocument(document))
  })

  it("requires an explicit valid generator surface", () => {
    expect(parseGenerateArguments(["--write", "--surface", "all"])).toBe("all")
    expect(() => parseGenerateArguments(["--write"])).toThrow(
      "--surface is required"
    )
    expect(() =>
      parseGenerateArguments(["--write", "--surface", "unknown"])
    ).toThrow("--surface must be")
  })
})
