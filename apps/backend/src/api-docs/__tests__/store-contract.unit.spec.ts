import { CLIENT_MONEY_BODY_FIELDS } from "../../api/store/carts/payment-attempts/validators"
import { AUTH_HTTP_CONTRACT } from "../../api/auth-surface/contracts"
import {
  CartMergeRejectedItemSchema,
  CartMergeRequestSchema,
  CartMergeResponseSchema,
  CartReviewAcknowledgeBodySchema,
  CartReviewAcknowledgeResponseSchema,
  CartReviewStateSchema,
} from "../../api/store/carts/merge-review-validators"
import {
  serializeCartMergeResponse,
  serializeCartReviewAcknowledgeResponse,
  serializeStoreCartPreOrder,
} from "../../api/store/carts/serializers"
import { verifyCoverage } from "../coverage/verify-coverage"
import { STORE_DOCUMENTATION_AUTH_OPERATIONS } from "../coverage/verify-coverage"
import { discoverRoutes } from "../coverage/discover-routes"
import { ROUTE_EXCLUSIONS } from "../coverage/exclusions"
import { buildContracts } from "../generation/build-documents"
import { STORE_CUSTOMER_CART_ATTACH_SUPPORT_SCHEMAS } from "../operations/store/schemas"
import { createFoundationRegistry } from "../registry"
import { assertSafeExamples } from "../safe-examples"
import { STORE_AUTH_ACCESS_BEARER } from "../components/security-schemes"
import {
  CART_MERGE_OUTCOMES,
  CART_MERGE_REJECTION_REASONS,
} from "../../modules/cart-merge/types"
import {
  lookupStoreSurfaceEntry,
  STORE_SURFACE_M1_ENABLED_OPERATIONS,
  STORE_SURFACE_MANIFEST,
} from "../../api/store-surface/manifest"

const LEGACY_STORE_DOCUMENTATION_KEYS = [
  "GET /health/live",
  "GET /health/ready",
  "GET /store/carts/active",
  "GET /store/products",
  "GET /store/products/{id}",
  "POST /store/carts/active",
  "POST /store/carts/{id}/line-items",
  "POST /store/carts/{id}/line-items/{line_id}",
  "DELETE /store/carts/{id}/line-items/{line_id}",
  "DELETE /store/carts/{id}/line-items",
  "POST /store/carts/{id}/payment-attempts/card",
  "POST /store/carts/{id}/payment-attempts/pix",
  "POST /store/tracking/lookup",
] as const

const PHASE16_STORE_DOCUMENTATION_KEYS = [
  "POST /store/customers/me/cart/merge",
  "POST /store/carts/{id}/review/acknowledge",
] as const

const PHASE14_STORE_DOCUMENTATION_KEYS = AUTH_HTTP_CONTRACT.map(
  (entry) => `${entry.method} ${entry.path}`
)

const STORE_DOCUMENTATION_OPERATION_KEYS = [
  ...LEGACY_STORE_DOCUMENTATION_KEYS,
  ...PHASE14_STORE_DOCUMENTATION_KEYS,
  ...PHASE16_STORE_DOCUMENTATION_KEYS,
].sort()

const STORE_DOCUMENT_PATHS = [
  "/health/live",
  "/health/ready",
  "/store/carts/active",
  "/store/carts/{id}/line-items",
  "/store/carts/{id}/line-items/{line_id}",
  "/store/carts/{id}/review/acknowledge",
  "/store/customers/me/cart/merge",
  ...AUTH_HTTP_CONTRACT.map((entry) => entry.path),
].sort()

const PHASE16_SCHEMA_NAMES = [
  "CartMergeRequest",
  "CartMergeOutcome",
  "CartMergeRejectedItem",
  "CartReviewState",
  "CartMergeResponse",
  "CartReviewAcknowledgeRequest",
  "CartReviewAcknowledgeResponse",
] as const

const SENSITIVE_EXAMPLE_CANARIES = [
  "guest_capability_canary",
  "customer_jwt_canary",
  "raw_idempotency_key_canary",
  "bff_service_secret_canary",
  "provider_id_canary",
  "customer@example.test",
  "pix_payload_canary",
  "tracking_token_canary",
  "internal_review_id_canary",
  "credential_derived_hash_canary",
  "raw_provider_payload_canary",
] as const

const SENSITIVE_EXAMPLE_PATTERNS = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+/,
  /\bwhsec_[A-Za-z0-9]+/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\b(?:guest[_-]?cart[_-]?(?:token|capability)|(?:raw[_-]?)?idempotency[_-]?key|bff[_-]?service[_-]?(?:secret|credential)|provider[_-]?(?:id|payload)|pix[_-]?payload|tracking[_-]?token|internal[_-]?review[_-]?id|credential[_-]?derived[_-]?hash)\b/i,
] as const

function collectValuesForKeys(
  value: unknown,
  keys: ReadonlySet<string>,
  path = "document"
): Array<{ path: string; value: unknown }> {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectValuesForKeys(entry, keys, `${path}[${index}]`)
    )
  }
  if (typeof value !== "object" || value === null) {
    return []
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => [
      ...(keys.has(key)
        ? [{ path: `${path}.${key}`, value: child }]
        : []),
      ...collectValuesForKeys(child, keys, `${path}.${key}`),
    ]
  )
}

describe("OpenAPI Store contract wave", () => {
  const registry = createFoundationRegistry()
  const storeOperations = registry.getOperations("store")
  const contracts = buildContracts(registry)
  const store = contracts.find((contract) => contract.surface === "store")

  it("covers every included Store route and both native catalog extensions", () => {
    expect(() => verifyCoverage("store", registry, discoverRoutes())).not.toThrow()

    expect(storeOperations).toHaveLength(27)
    expect(
      storeOperations.map((operation) => `${operation.method} ${operation.path}`).sort()
    ).toEqual(STORE_DOCUMENTATION_OPERATION_KEYS)
    expect(
      storeOperations.filter((operation) => operation.path.startsWith("/auth/"))
        .map((operation) => `${operation.method} ${operation.path}`)
        .sort()
    ).toEqual([...STORE_DOCUMENTATION_AUTH_OPERATIONS].sort())
    expect(
      storeOperations.some(
        (operation) =>
          operation.method === "POST" &&
          operation.path === "/store/customers/me/cart/attach"
      )
    ).toBe(false)
    expect(Object.keys(store?.document.paths ?? {}).sort()).toEqual(
      STORE_DOCUMENT_PATHS
    )
    expect(storeOperations.some((operation) => operation.path.startsWith("/store/")))
      .toBe(true)
  })

  it("documents exactly the six executable Cart M1 operations", () => {
    const cartM1 = storeOperations.filter((operation) =>
      [
        "GET /store/carts/active",
        "POST /store/carts/active",
        "POST /store/carts/{id}/line-items",
        "POST /store/carts/{id}/line-items/{line_id}",
        "DELETE /store/carts/{id}/line-items/{line_id}",
        "DELETE /store/carts/{id}/line-items",
      ].includes(`${operation.method} ${operation.path}`)
    )

    expect(cartM1).toHaveLength(6)
    expect(cartM1.map((operation) => operation.operationId).sort()).toEqual([
      "addCartLineItem",
      "clearCartLineItems",
      "createActiveStoreCart",
      "getActiveStoreCart",
      "removeCartLineItem",
      "updateCartLineItem",
    ])
    expect(cartM1.every((operation) => operation.interactiveCandidate === false)).toBe(
      true
    )
    expect(cartM1.every((operation) => operation.nonInteractive === true)).toBe(true)
  })

  it("registers merge and review operations with exact security and parameters", () => {
    const merge = storeOperations.find(
      (operation) =>
        operation.method === "POST" &&
        operation.path === "/store/customers/me/cart/merge"
    )
    const acknowledge = storeOperations.find(
      (operation) =>
        operation.method === "POST" &&
        operation.path === "/store/carts/{id}/review/acknowledge"
    )

    expect(merge).toEqual(
      expect.objectContaining({
        operationId: "mergeCustomerCart",
        security: STORE_AUTH_ACCESS_BEARER,
        interactiveCandidate: false,
        nonInteractive: true,
      })
    )
    expect(acknowledge).toEqual(
      expect.objectContaining({
        operationId: "acknowledgeCartReview",
        security: STORE_AUTH_ACCESS_BEARER,
        interactiveCandidate: false,
        nonInteractive: true,
      })
    )

    const parameterIdentity = (parameter: unknown): string => {
      if (
        typeof parameter === "object" &&
        parameter !== null &&
        "$ref" in parameter
      ) {
        return (parameter as { $ref: string }).$ref
      }
      const inline = parameter as { in?: string; name?: string }
      return `${inline.in}:${inline.name}`
    }

    expect(merge?.parameters.map(parameterIdentity)).toEqual([
      "header:x-correlation-id",
      "#/components/parameters/XIndicioGuestCartMergeCapability",
      "#/components/parameters/IdempotencyKey",
      "#/components/parameters/IfMatch",
    ])
    expect(acknowledge?.parameters.map(parameterIdentity)).toEqual([
      "header:x-correlation-id",
      "path:id",
      "#/components/parameters/IfMatch",
    ])
    expect(store?.document.components.parameters).toEqual(
      expect.objectContaining({
        XIndicioGuestCartMergeCapability: expect.objectContaining({
          name: "x-indicio-guest-cart-token",
          in: "header",
          required: true,
          "x-bff-only": true,
          "x-not-browser-credential": true,
          "x-sensitive": true,
        }),
        XIndicioGuestCartToken: expect.objectContaining({
          name: "x-indicio-guest-cart-token",
          in: "header",
          required: false,
        }),
      })
    )
    expect(
      store?.document.components.parameters.XIndicioGuestCartMergeCapability
    ).not.toEqual(
      expect.objectContaining({
        example: expect.anything(),
        examples: expect.anything(),
      })
    )

    expect(merge?.requestBody).toEqual(
      expect.objectContaining({
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CartMergeRequest" },
          },
        },
      })
    )
    expect(acknowledge?.requestBody).toEqual(
      expect.objectContaining({
        required: true,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/CartReviewAcknowledgeRequest",
            },
          },
        },
      })
    )
  })

  it("documents exact merge/review responses, errors, and provenance", () => {
    const operations = [
      storeOperations.find(
        (operation) =>
          operation.method === "POST" &&
          operation.path === "/store/customers/me/cart/merge"
      ),
      storeOperations.find(
        (operation) =>
          operation.method === "POST" &&
          operation.path === "/store/carts/{id}/review/acknowledge"
      ),
    ]
    const expectedStatuses = [
      "200",
      "400",
      "401",
      "404",
      "409",
      "412",
      "500",
      "503",
    ]

    expect(operations).toHaveLength(2)
    for (const operation of operations) {
      expect(operation).toBeDefined()
      expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(
        expectedStatuses
      )
      expect(operation).toEqual(
        expect.objectContaining({
          summary: expect.any(String),
          tags: ["Cart"],
          sourceClassification: "project-custom",
          sourceFiles: expect.arrayContaining([
            "apps/backend/src/api/store/carts/merge-review-validators.ts",
            "apps/backend/src/api/store/carts/serializers.ts",
            "apps/backend/src/modules/cart-merge/service.ts",
            "apps/backend/src/api/middlewares.ts",
          ]),
          testEvidence: expect.arrayContaining([
            "apps/backend/integration-tests/http/cart-merge-review.spec.ts",
          ]),
          officialReference: expect.stringContaining(
            "github.com/jlima004/E-commerce/blob/main/"
          ),
          inclusionReason: expect.any(String),
          interactiveCandidate: false,
          nonInteractive: true,
        })
      )

      expect(operation?.responses["200"]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            ETag: { $ref: "#/components/headers/ETag" },
            "Cache-Control": expect.objectContaining({
              schema: { type: "string", const: "no-store" },
            }),
          }),
        })
      )
      expect(operation?.responses["409"]).toEqual(
        expect.objectContaining({
          description: expect.stringMatching(
            /authority|state|idempotency|review/i
          ),
        })
      )
      expect(operation?.responses["409"]?.description).toMatch(
        /(?:^|[^A-Z0-9_])REVIEW_REQUIRED(?:$|[^A-Z0-9_])/
      )
      expect(operation?.responses["409"]?.description).not.toMatch(
        /CART_REVIEW_REQUIRED|CART_REVIEW_CONFLICT|CART_REVIEW_VERSION_CONFLICT/
      )
      expect(operation?.responses["409"]?.description).not.toMatch(
        /CART_VERSION_MISMATCH/
      )
      expect(operation?.responses["412"]).toEqual(
        expect.objectContaining({
          description: expect.stringMatching(
            /CART_VERSION_MISMATCH.*If-Match.*stale/i
          ),
          headers: {
            "x-correlation-id": {
              $ref: "#/components/headers/XCorrelationId",
            },
            ETag: {
              $ref: "#/components/headers/ETag",
            },
          },
        })
      )
      expect(operation?.responses["412"]?.content).toEqual({
        "application/json": {
          schema: { $ref: "#/components/schemas/StoreErrorResponse" },
        },
      })
      expect(operation?.responses["412"]?.description).not.toMatch(
        /REVIEW_REQUIRED|idempotency/i
      )
      expect(operation?.responses["412"]).not.toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            "Cache-Control": expect.anything(),
          }),
        })
      )
    }

    expect(operations[0]?.responses["200"]?.content).toEqual({
      "application/json": {
        schema: { $ref: "#/components/schemas/CartMergeResponse" },
      },
    })
    expect(operations[1]?.responses["200"]?.content).toEqual({
      "application/json": {
        schema: { $ref: "#/components/schemas/CartReviewAcknowledgeResponse" },
      },
    })
  })

  it("requires BFF authority on every Cart M1 security alternative", () => {
    const cartM1Keys = new Set([
      "GET /store/carts/active",
      "POST /store/carts/active",
      "POST /store/carts/{id}/line-items",
      "POST /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items",
    ])
    const cartM1 = storeOperations.filter((operation) =>
      cartM1Keys.has(`${operation.method} ${operation.path}`)
    )
    const expectedSecurity = [
      { bffServiceCredential: [], publishableApiKey: [] },
      {
        bffServiceCredential: [],
        publishableApiKey: [],
        customerBearer: [],
      },
      {
        bffServiceCredential: [],
        publishableApiKey: [],
        customerSession: [],
      },
    ]

    expect(cartM1).toHaveLength(6)
    for (const operation of cartM1) {
      expect(operation.security).toHaveLength(3)
      expect(operation.security).toEqual(expectedSecurity)

      for (const requirement of operation.security) {
        expect(requirement).toHaveProperty("bffServiceCredential")
        expect(requirement).toHaveProperty("publishableApiKey")
        expect(
          Object.prototype.hasOwnProperty.call(
            requirement,
            "publishableApiKey"
          ) &&
            !Object.prototype.hasOwnProperty.call(
              requirement,
              "bffServiceCredential"
            )
        ).toBe(false)
        expect(
          Object.prototype.hasOwnProperty.call(requirement, "customerBearer") &&
            Object.prototype.hasOwnProperty.call(requirement, "customerSession")
        ).toBe(false)
      }
    }

    expect(cartM1[0]?.security[0]).toEqual({
      bffServiceCredential: [],
      publishableApiKey: [],
    })
    expect(cartM1[0]?.security[0]).not.toEqual(
      expect.objectContaining({
        customerBearer: expect.anything(),
        customerSession: expect.anything(),
      })
    )
    expect(cartM1[0]?.security[1]).toEqual({
      bffServiceCredential: [],
      publishableApiKey: [],
      customerBearer: [],
    })
    expect(cartM1[0]?.security[2]).toEqual({
      bffServiceCredential: [],
      publishableApiKey: [],
      customerSession: [],
    })
  })

  it("requires the optional guest capability request header on every Cart M1 operation", () => {
    const cartM1Keys = new Set([
      "GET /store/carts/active",
      "POST /store/carts/active",
      "POST /store/carts/{id}/line-items",
      "POST /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items",
    ])
    const cartM1 = storeOperations.filter((operation) =>
      cartM1Keys.has(`${operation.method} ${operation.path}`)
    )
    const guestParameterRef = {
      $ref: "#/components/parameters/XIndicioGuestCartToken",
    }

    expect(cartM1).toHaveLength(6)
    for (const operation of cartM1) {
      expect(operation.parameters).toEqual(
        expect.arrayContaining([guestParameterRef])
      )
    }

    const parameter = store?.document.components.parameters
      .XIndicioGuestCartToken as Record<string, unknown>
    expect(parameter).toEqual(
      expect.objectContaining({
        name: "x-indicio-guest-cart-token",
        in: "header",
        required: false,
        "x-bff-only": true,
        "x-not-browser-credential": true,
        "x-sensitive": true,
      })
    )
    expect(parameter).not.toHaveProperty("example")
    expect(parameter).not.toHaveProperty("examples")
  })

  it("emits the capability response header only for guest mint 201", () => {
    const activeGet = storeOperations.find(
      (operation) => operation.method === "GET" && operation.path === "/store/carts/active"
    )
    const activePost = storeOperations.find(
      (operation) => operation.method === "POST" && operation.path === "/store/carts/active"
    )
    const mutations = storeOperations.filter((operation) =>
      [
        "/store/carts/{id}/line-items",
        "/store/carts/{id}/line-items/{line_id}",
      ].includes(operation.path)
    )
    const capabilityHeader = "x-indicio-guest-cart-token"

    expect(activePost?.responses["201"]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          [capabilityHeader]: expect.any(Object),
        }),
      })
    )
    expect(activePost?.responses["200"]).not.toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ [capabilityHeader]: expect.anything() }),
      })
    )
    expect(activeGet?.responses["200"]).not.toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ [capabilityHeader]: expect.anything() }),
      })
    )
    for (const operation of mutations) {
      for (const response of Object.values(operation.responses)) {
        expect(response).not.toEqual(
          expect.objectContaining({
            headers: expect.objectContaining({ [capabilityHeader]: expect.anything() }),
          })
        )
      }
    }
  })

  it("documents mutation preconditions and the approved cart snapshot on 412", () => {
    const mutations = storeOperations.filter((operation) =>
      [
        "POST /store/carts/{id}/line-items",
        "POST /store/carts/{id}/line-items/{line_id}",
        "DELETE /store/carts/{id}/line-items/{line_id}",
        "DELETE /store/carts/{id}/line-items",
      ].includes(`${operation.method} ${operation.path}`)
    )

    for (const operation of mutations) {
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          { $ref: "#/components/parameters/IfMatch" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ])
      )
      expect(operation.responses["412"]).toEqual(
        expect.objectContaining({
          description: expect.stringMatching(/CART_VERSION_MISMATCH/),
          headers: {
            "x-correlation-id": {
              $ref: "#/components/headers/XCorrelationId",
            },
            ETag: {
              $ref: "#/components/headers/ETag",
            },
          },
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StoreErrorResponse" },
            },
          },
        })
      )
    }

    expect(store?.document.components.schemas.StoreErrorResponse).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          cart: expect.objectContaining({
            $ref: "#/components/schemas/PublicStoreCartPreOrder",
          }),
        }),
      })
    )
  })

  it("documents the active-cart 409 categories as public CONFLICT", () => {
    const activePost = storeOperations.find(
      (operation) =>
        operation.method === "POST" && operation.path === "/store/carts/active"
    )
    const conflict = activePost?.responses["409"]

    expect(conflict).toEqual(
      expect.objectContaining({
        description: expect.stringMatching(
          /CONFLICT.*semantic Idempotency-Key conflict.*operation currently in progress.*terminal replay\/reconciliation conflict/i
        ),
        headers: {
          "x-correlation-id": {
            $ref: "#/components/headers/XCorrelationId",
          },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/StoreErrorResponse" },
          },
        },
      })
    )
    expect(JSON.stringify(conflict)).not.toMatch(
      /IDEMPOTENCY_KEY_REUSE_CONFLICT|IDEMPOTENCY_KEY_IN_PROGRESS/
    )
  })

  it("passes the sensitive example walker without capability or token examples", () => {
    expect(() =>
      assertSafeExamples(store?.document, {
        isUnsafeExampleValue: (value) => /token|capability|pix|credential/i.test(value),
        errorMessage: "Sensitive OpenAPI example detected",
        rootLocation: "document",
      })
    ).not.toThrow()
  })

  it("omits ambiguous object and recursive catalog query parameters", () => {
    const catalog = storeOperations.filter((operation) =>
      ["/store/products", "/store/products/{id}"].includes(operation.path)
    )
    const omittedNames = [
      "created_at",
      "updated_at",
      "deleted_at",
      "variants",
      "$and",
      "$or",
      "variants[$and]",
      "variants[$or]",
    ]

    expect(catalog).toHaveLength(2)
    for (const operation of catalog) {
      const queryNames = (operation.parameters ?? [])
        .filter(
          (parameter): parameter is { name: string; in: string } =>
            typeof parameter === "object" &&
            parameter !== null &&
            "name" in parameter &&
            "in" in parameter &&
            (parameter as { in: string }).in === "query"
        )
        .map((parameter) => parameter.name)

      for (const omittedName of omittedNames) {
        expect(queryNames).not.toContain(omittedName)
      }
    }
  })

  it("documents explicit bracket leaves on both catalog operations", () => {
    const requiredLeaves = [
      "created_at[$gte]",
      "updated_at[$lte]",
      "deleted_at[$eq]",
      "variants[sku]",
      "variants[options][value]",
      "variants[created_at][$gte]",
      "variants[updated_at][$lte]",
      "variants[deleted_at][$eq]",
    ]

    for (const path of ["/store/products", "/store/products/{id}"]) {
      const operation = storeOperations.find((candidate) => candidate.path === path)
      const queryNames = (operation?.parameters ?? [])
        .filter(
          (parameter): parameter is { name: string; in: string } =>
            typeof parameter === "object" &&
            parameter !== null &&
            "name" in parameter &&
            "in" in parameter &&
            (parameter as { in: string }).in === "query"
        )
        .map((parameter) => parameter.name)

      expect(queryNames).toEqual(expect.arrayContaining(requiredLeaves))
    }
  })

  it("keeps explicitly excluded routes valid and undocumented", () => {
    expect(
      ROUTE_EXCLUSIONS.map((entry) => `${entry.method} ${entry.path}`).sort()
    ).toEqual(
      [
        "GET /admin/custom",
        "GET /store/custom",
        "POST /store/carts/{id}/complete",
        "POST /store/customers/me/cart/attach",
      ].sort()
    )
    expect(
      storeOperations.some(
        (operation) =>
          operation.path === "/store/custom" ||
          operation.path === "/admin/custom" ||
          operation.path === "/store/carts/{id}/complete" ||
          operation.path === "/store/customers/me/cart/attach"
      )
    ).toBe(false)
  })

  it("registers complete provenance metadata on every Store operation", () => {
    for (const operation of storeOperations) {
      expect(operation.operationId).toMatch(
        /^(?:store[A-Z].*|getActiveStoreCart|createActiveStoreCart|addCartLineItem|updateCartLineItem|removeCartLineItem|clearCartLineItems|mergeCustomerCart|acknowledgeCartReview)$/
      )
      expect(operation.summary.trim().length).toBeGreaterThan(0)
      expect(operation.tags.length).toBeGreaterThan(0)
      expect(operation.sourceFiles.length).toBeGreaterThan(0)
      expect(operation.testEvidence.length).toBeGreaterThan(0)
      expect(operation.officialReference.trim().length).toBeGreaterThan(0)
      expect(operation.inclusionReason.trim().length).toBeGreaterThan(0)
      expect(Object.keys(operation.responses).length).toBeGreaterThan(0)
      expect(operation.nonInteractive).toBe(true)
    }
  })

  it("classifies native Store catalog extensions correctly", () => {
    const native = storeOperations.filter((operation) =>
      ["/store/products", "/store/products/{id}"].includes(operation.path)
    )
    expect(native).toHaveLength(2)
    expect(
      native.every(
        (operation) => operation.sourceClassification === "project-extension"
      )
    ).toBe(true)
    expect(
      native.every((operation) =>
        operation.officialReference.includes(
          "github.com/medusajs/medusa/blob/v2.16.0/"
        )
      )
    ).toBe(true)
  })

  it("documents path and query parameters for catalog and payment routes", () => {
    const list = storeOperations.find(
      (operation) => operation.path === "/store/products"
    )
    const retrieve = storeOperations.find(
      (operation) => operation.path === "/store/products/{id}"
    )
    const card = storeOperations.find(
      (operation) =>
        operation.path === "/store/carts/{id}/payment-attempts/card"
    )

    expect(list?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "limit", in: "query" }),
        expect.objectContaining({ name: "offset", in: "query" }),
      ])
    )
    expect(retrieve?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", required: true }),
      ])
    )
    expect(card?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", required: true }),
      ])
    )
  })

  it("documents evidenced success status codes for carts, payments, and health", () => {
    const activePost = storeOperations.find(
      (operation) =>
        operation.method === "POST" && operation.path === "/store/carts/active"
    )
    const card = storeOperations.find(
      (operation) =>
        operation.path === "/store/carts/{id}/payment-attempts/card"
    )
    const ready = storeOperations.find(
      (operation) => operation.path === "/health/ready"
    )

    expect(Object.keys(activePost?.responses ?? {}).sort()).toEqual(
      expect.arrayContaining(["200", "201"])
    )
    expect(Object.keys(card?.responses ?? {})).toContain("201")
    expect(Object.keys(ready?.responses ?? {}).sort()).toEqual(
      expect.arrayContaining(["200", "503"])
    )
  })

  it("generates deterministic Store bytes without absolute paths or secrets", () => {
    const again = buildContracts(registry).find(
      (contract) => contract.surface === "store"
    )
    expect(store?.bytes).toBe(again?.bytes)
    const storeBytesWithoutSchemaPattern = store?.bytes.replace(
      /"pattern": "\.\*\\\\S\.\*"/g,
      ""
    )
    expect(storeBytesWithoutSchemaPattern).not.toMatch(/\/home\/|\/Users\/|\\/)
    expect(store?.bytes).not.toMatch(/sk_(?:live|test)_|whsec_|Bearer\s+\w{8,}/)
    expect(store?.document.components.schemas.PublicStoreCatalogProduct).toBeDefined()
    expect(store?.document.components.schemas.PublicStoreCartPreOrder).toBeDefined()
    expect(
      store?.document.components.schemas.StorePaymentAttemptAmountMinor
    ).toBeDefined()
  })

  it("publishes the closed Store 1.1 transversal component foundation", () => {
    const document = store?.document
    const schemas = document?.components.schemas ?? {}
    const parameters = document?.components.parameters ?? {}
    const headers = document?.components.headers ?? {}
    const securitySchemes = document?.components.securitySchemes ?? {}

    expect(document?.info.version).toBe("1.1.0")
    expect(schemas.StoreErrorResponse).toEqual(
      expect.objectContaining({
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "retryable"],
      })
    )
    expect(parameters).toEqual(
      expect.objectContaining({
        IdempotencyKey: expect.objectContaining({ name: "Idempotency-Key" }),
        IfMatch: expect.objectContaining({ name: "If-Match" }),
        XCorrelationId: expect.objectContaining({ name: "x-correlation-id" }),
      })
    )
    expect(headers).toEqual(
      expect.objectContaining({
        ETag: expect.any(Object),
        XCorrelationId: expect.any(Object),
        RetryAfter: expect.any(Object),
      })
    )
    expect(schemas.StoreMajorMoney).toEqual(
      expect.objectContaining({ additionalProperties: false })
    )
    expect(schemas.StoreMinorMoney).toEqual(
      expect.objectContaining({ additionalProperties: false })
    )
    expect(JSON.stringify(schemas.StoreMajorMoney)).toMatch(/BRL.*major/)
    expect(JSON.stringify(schemas.StoreMinorMoney)).toMatch(/BRL.*minor/)

    for (const scheme of Object.values(securitySchemes) as Array<{
      description?: string
    }>) {
      expect(scheme.description).toMatch(/BFF|server-to-server/i)
      expect(scheme.description).toMatch(/browser/i)
    }
  })

  it("describes Idempotency-Key as retry identity and never as authority", () => {
    const parameter = store?.document.components.parameters.IdempotencyKey as {
      description?: string
    }
    expect(parameter.description).toMatch(/retry identity/i)
    expect(parameter.description).toMatch(/not authentication/i)
    expect(parameter.description).toMatch(/not authorization/i)
    expect(parameter.description).toMatch(/not ownership/i)
    expect(parameter.description).toMatch(/not (?:a )?capability/i)
  })

  it("does not register Admin or Webhook operations in the Store registry", () => {
    expect(
      storeOperations.some(
        (operation) =>
          operation.path.startsWith("/admin/") ||
          operation.path.startsWith("/hooks/")
      )
    ).toBe(false)
    expect(Object.keys(store?.document.paths ?? {}).some((path) =>
      path.startsWith("/admin/")
    )).toBe(false)
    expect(Object.keys(store?.document.paths ?? {}).some((path) =>
      path.startsWith("/hooks/")
    )).toBe(false)
  })

  it("documents optional shared request bodies for card and pix payment starts", () => {
    const card = storeOperations.find(
      (operation) =>
        operation.path === "/store/carts/{id}/payment-attempts/card"
    )
    const pix = storeOperations.find(
      (operation) =>
        operation.path === "/store/carts/{id}/payment-attempts/pix"
    )
    const startSchema = store?.document.components.schemas
      .StorePaymentAttemptStartRequest as {
      type?: string
      description?: string
      additionalProperties?: boolean
      propertyNames?: { not?: { enum?: string[] } }
      properties?: Record<string, unknown>
      required?: string[]
    }

    expect(card?.requestBody).not.toBeNull()
    expect(pix?.requestBody).not.toBeNull()
    expect(card?.requestBody).toEqual(
      expect.objectContaining({
        required: false,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/StorePaymentAttemptStartRequest",
            },
          },
        },
      })
    )
    expect(pix?.requestBody).toEqual(
      expect.objectContaining({
        required: false,
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/StorePaymentAttemptStartRequest",
            },
          },
        },
      })
    )

    expect(startSchema?.type).toBe("object")
    expect(startSchema?.additionalProperties).toBe(true)
    expect(startSchema?.required).toBeUndefined()
    expect(startSchema?.properties).toBeUndefined()
    expect(startSchema?.description).toMatch(
      /client money|rejectClientMoneyFields/i
    )
    expect(startSchema?.propertyNames?.not?.enum).toEqual([
      ...CLIENT_MONEY_BODY_FIELDS,
    ])
    expect(CLIENT_MONEY_BODY_FIELDS).toEqual(
      expect.arrayContaining(["amount", "currency_code"])
    )
    expect(new Set(CLIENT_MONEY_BODY_FIELDS).size).toBe(
      CLIENT_MONEY_BODY_FIELDS.length
    )
  })

  it("retains attach support schemas without publishing attach path+method", () => {
    expect(store?.document.paths?.["/store/customers/me/cart/attach"]).toBeUndefined()
    expect(
      store?.document.components.schemas.StoreCustomerCartAttachRequest
    ).toBeUndefined()

    const attachSchema =
      STORE_CUSTOMER_CART_ATTACH_SUPPORT_SCHEMAS.StoreCustomerCartAttachRequest
    expect(
      (attachSchema as { additionalProperties?: boolean }).additionalProperties
    ).not.toBe(false)
    expect(
      (attachSchema as { required?: string[] }).required
    ).toBeUndefined()
    expect(attachSchema.properties.cart_id.type).toBe("string")
  })

  it("keeps deprecated attach outside M1 and native attach fail-closed", () => {
    const attachExclusion = ROUTE_EXCLUSIONS.find(
      (entry) =>
        entry.method === "POST" &&
        entry.path === "/store/customers/me/cart/attach"
    )
    expect(attachExclusion).toEqual(
      expect.objectContaining({
        owner: expect.stringContaining("Phase 16"),
        reason: expect.stringMatching(
          /deprecated compatibility facade.*outside Frontend M1.*not a second attach engine.*delegates to canonical Phase 16 merge.*HUMAN GATE/i
        ),
        reviewTrigger: expect.stringMatching(
          /consumer migration.*HUMAN GATE REQUIRED/i
        ),
      })
    )
    expect(attachExclusion?.reason).not.toMatch(/\b20\d{2}[-/]\d{1,2}/)
    expect(attachExclusion?.reviewTrigger).not.toMatch(/\b20\d{2}[-/]\d{1,2}/)

    const attachManifest = STORE_SURFACE_MANIFEST.find(
      (entry) =>
        entry.method === "POST" &&
        entry.pathTemplate === "/store/customers/me/cart/attach"
    )
    expect(attachManifest).toEqual(
      expect.objectContaining({
        classification: "OUTSIDE_FRONTEND_M1",
        runtime_policy: "PRESERVE_LEGACY",
        m1_enablement: "disabled",
        openapi_m1_expectation: "exclude",
        owner_phase: "16",
      })
    )
    expect(
      storeOperations.some(
        (operation) =>
          operation.method === "POST" &&
          operation.path === "/store/customers/me/cart/attach"
      )
    ).toBe(false)

    const nativeAttach = lookupStoreSurfaceEntry(
      "POST",
      "/store/carts/{id}/customer"
    )
    expect(nativeAttach).toEqual(
      expect.objectContaining({
        classification: "BLOCKED",
        runtime_policy: "DENY",
        openapi_m1_expectation: "exclude",
      })
    )
    expect(
      storeOperations.some(
        (operation) =>
          operation.method === "POST" &&
          operation.path === "/store/carts/{id}/customer"
      )
    ).toBe(false)

    for (const neighbor of [
      "/store/customers/me/cart/attach/legacy",
      "/store/customers/me/cart/merge/attach",
      "/store/carts/{id}/customer/attach",
    ]) {
      expect(lookupStoreSurfaceEntry("POST", neighbor)).toBeUndefined()
      expect(store?.document.paths?.[neighbor]).toBeUndefined()
    }
  })

  it("keeps the exact fourteen-operation M1 set with only Phase 16 cart additions", () => {
    const expectedM1Keys = [
      "POST /store/carts/{id}/line-items",
      "POST /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items",
      "GET /store/customers/me",
      "GET /store/carts/active",
      "POST /store/carts/active",
      "POST /store/customers/me/verify",
      "POST /store/customers/verify/resend",
      "POST /store/customers/verify",
      "GET /store/customers/me/verify/status",
      "POST /store/customers/me/password",
      "POST /store/customers/me/cart/merge",
      "POST /store/carts/{id}/review/acknowledge",
    ].sort()

    expect([...STORE_SURFACE_M1_ENABLED_OPERATIONS].sort()).toEqual(
      expectedM1Keys
    )
    expect(STORE_SURFACE_M1_ENABLED_OPERATIONS).toHaveLength(14)

    const documentedM1Keys = storeOperations
      .map((operation) => `${operation.method} ${operation.path}`)
      .filter((key) => expectedM1Keys.includes(key))
      .sort()
    expect(documentedM1Keys).toEqual(expectedM1Keys)
    expect(documentedM1Keys).not.toContain(
      "POST /store/customers/me/cart/attach"
    )
  })

  it("keeps Phase 16 security, schemas, examples, and public fields secret-free", () => {
    const document = store?.document
    const components = document?.components
    const schemas = components?.schemas ?? {}
    const parameters = components?.parameters ?? {}
    const securitySchemes = components?.securitySchemes ?? {}
    const noCredentialDefaults = new Set(["example", "examples", "default"])

    const merge = storeOperations.find(
      (operation) =>
        operation.method === "POST" &&
        operation.path === "/store/customers/me/cart/merge"
    )
    const acknowledge = storeOperations.find(
      (operation) =>
        operation.method === "POST" &&
        operation.path === "/store/carts/{id}/review/acknowledge"
    )
    expect(merge?.security).toEqual(STORE_AUTH_ACCESS_BEARER)
    expect(acknowledge?.security).toEqual(STORE_AUTH_ACCESS_BEARER)

    for (const name of [
      "XIndicioGuestCartToken",
      "XIndicioGuestCartMergeCapability",
      "IdempotencyKey",
    ]) {
      expect(
        collectValuesForKeys(parameters[name], noCredentialDefaults)
      ).toEqual([])
    }

    expect(securitySchemes.customerBearer).toEqual(
      expect.objectContaining({
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      })
    )
    for (const name of [
      "bffServiceCredential",
      "publishableApiKey",
      "customerBearer",
    ]) {
      expect(
        collectValuesForKeys(securitySchemes[name], noCredentialDefaults)
      ).toEqual([])
    }

    for (const name of PHASE16_SCHEMA_NAMES) {
      expect(
        collectValuesForKeys(schemas[name], noCredentialDefaults)
      ).toEqual([])
    }

    const configuredExampleValues = collectValuesForKeys(
      document,
      new Set(["example", "examples"])
    )
    const configuredExampleText = configuredExampleValues
      .map(({ value }) => JSON.stringify(value) ?? "")
      .join("\n")
    for (const canary of SENSITIVE_EXAMPLE_CANARIES) {
      expect(configuredExampleText).not.toContain(canary)
    }
    for (const pattern of SENSITIVE_EXAMPLE_PATTERNS) {
      expect(configuredExampleText).not.toMatch(pattern)
    }
    expect(configuredExampleText).not.toContain("CUSTOMER_CART_PRESERVED")

    const forbiddenPublicFields = [
      "mergeReceipt",
      "currentState",
      "actorId",
      "customerId",
      "cartId",
      "createdAt",
      "acknowledgedAt",
      "workflowId",
      "audit",
      "metadata",
      "providerId",
      "providerOrderId",
      "fingerprint",
      "tokenHash",
      "jwt",
      "secret",
    ]
    for (const name of [
      "CartMergeRejectedItem",
      "CartReviewState",
      "CartMergeResponse",
      "CartReviewAcknowledgeResponse",
    ]) {
      const propertyNames = Object.keys(
        (schemas[name] as { properties?: Record<string, unknown> }).properties ??
          {}
      )
      expect(propertyNames).not.toEqual(
        expect.arrayContaining(forbiddenPublicFields)
      )
    }

    expect(schemas.CartMergeOutcome).not.toHaveProperty("example")
    expect(schemas.CartMergeOutcome).not.toHaveProperty("examples")
    expect(schemas.CartMergeOutcome).not.toHaveProperty("default")
  })

  it("documents synchronous PaymentAttempt status consts for card and pix", () => {
    const card = store?.document.components.schemas
      .StoreCardPaymentAttemptResponse as {
      properties?: { status?: { const?: string; enum?: string[] } }
    }
    const pix = store?.document.components.schemas
      .StorePixPaymentAttemptResponse as {
      properties?: { status?: { const?: string; enum?: string[] } }
    }

    expect(card?.properties?.status).toEqual({
      type: "string",
      const: "card_client_secret_created",
    })
    expect(pix?.properties?.status).toEqual({
      type: "string",
      const: "awaiting_pix_payment",
    })
  })

  it("maps cart access denial to 400 (not 403) on card and pix payment attempts", () => {
    const paymentAttemptPaths = [
      "/store/carts/{id}/payment-attempts/card",
      "/store/carts/{id}/payment-attempts/pix",
    ] as const

    for (const path of paymentAttemptPaths) {
      const operation = storeOperations.find(
        (candidate) =>
          candidate.method === "POST" && candidate.path === path
      )
      expect(operation).toBeDefined()

      const responseKeys = Object.keys(operation?.responses ?? {})
      expect(responseKeys).toEqual(
        expect.arrayContaining(["201", "400", "401", "404", "500"])
      )
      expect(responseKeys).not.toContain("403")
      expect(operation?.responses["400"]).toBeDefined()
      expect(operation?.responses["403"]).toBeUndefined()

      const registered400 = operation?.responses["400"] as {
        description?: string
      }
      expect(registered400?.description).toMatch(
        /access denied|ownership|access/i
      )

      expect(store?.document.paths?.[path]).toBeUndefined()
    }
  })

  it("documents StoreCatalogPrice.amount as integer", () => {
    const price = store?.document.components.schemas.StoreCatalogPrice as {
      properties?: {
        amount?: { type?: string; "x-money-unit"?: string }
      }
    }

    expect(price?.properties?.amount?.type).toBe("integer")
    expect(price?.properties?.amount?.["x-money-unit"]).toBe("brl-major")
  })

  it("accepts serialized public carts and rejects internal cart fields at runtime", () => {
    const publicCart = {
      id: "cart_public_01",
      email: "buyer@example.test",
      currency_code: "brl",
      locale: "pt-BR",
      total: 79.9,
      subtotal: 79.9,
      item_total: 79.9,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      region_id: "region_br",
      created_at: "2026-08-19T00:00:00.000Z",
      updated_at: "2026-08-19T00:00:00.000Z",
      checkout_data_complete: false,
      customer: {
        id: "customer_public_01",
        email: "buyer@example.test",
      },
      items: [
        {
          id: "item_public_01",
          quantity: 1,
          title: "Camiseta básica",
          variant_id: "variant_public_01",
          variant_title: "M",
          unit_price: 79.9,
        },
      ],
      shipping_address: {
        first_name: "Ana",
        last_name: "Silva",
        company: null,
        address_1: "Rua A, 1",
        address_2: null,
        city: "São Paulo",
        postal_code: "01000-000",
        country_code: "br",
        province: "SP",
        phone: null,
        masked_federal_tax_id: null,
      },
    }
    const review = {
      requiresReview: false,
      reviewRef: null,
      rejectedItems: [],
    }

    expect(
      CartMergeResponseSchema.safeParse({
        outcome: "MERGED",
        cart: publicCart,
        review,
      }).success
    ).toBe(true)
    expect(
      CartReviewAcknowledgeResponseSchema.safeParse({
        cart: publicCart,
        review,
      }).success
    ).toBe(true)

    const cartWithInternalField = {
      ...publicCart,
      metadata: { internal: "must-not-be-public" },
    }
    expect(
      CartMergeResponseSchema.safeParse({
        outcome: "MERGED",
        cart: cartWithInternalField,
        review,
      }).success
    ).toBe(false)
    expect(
      CartReviewAcknowledgeResponseSchema.safeParse({
        cart: cartWithInternalField,
        review,
      }).success
    ).toBe(false)
  })

  it("normalizes raw cart Date timestamps without weakening the public contract", () => {
    const rawCart = {
      id: "cart_raw_01",
      created_at: new Date("2026-08-25T10:00:00.000Z"),
      updated_at: new Date("2026-08-25T10:00:01.000Z"),
    }
    const serialized = serializeStoreCartPreOrder(rawCart)

    expect(serialized).toEqual(
      expect.objectContaining({
        created_at: "2026-08-25T10:00:00.000Z",
        updated_at: "2026-08-25T10:00:01.000Z",
      })
    )

    const mergeResponse = serializeCartMergeResponse({
      outcome: "MERGED",
      cart: rawCart,
      review: {
        requiresReview: false,
        reviewRef: null,
        rejectedItems: [],
      },
    })

    expect(mergeResponse.cart).toEqual(
      expect.objectContaining({
        created_at: "2026-08-25T10:00:00.000Z",
        updated_at: "2026-08-25T10:00:01.000Z",
      })
    )
    expect(CartMergeResponseSchema.safeParse(mergeResponse).success).toBe(true)

    expect(
      serializeStoreCartPreOrder({ id: "cart_null_01", created_at: null, updated_at: null })
    ).toEqual(expect.objectContaining({ created_at: null, updated_at: null }))
    expect(
      serializeStoreCartPreOrder({ id: "cart_undefined_01" })
    ).toEqual(expect.objectContaining({ created_at: null, updated_at: null }))
  })

  it("fails closed for invalid raw cart Date timestamps", () => {
    expect(() =>
      serializeStoreCartPreOrder({
        id: "cart_invalid_timestamp",
        created_at: new Date(Number.NaN),
        updated_at: new Date("2026-08-25T10:00:01.000Z"),
      })
    ).toThrow("STORE_CART_TIMESTAMP_INVALID")
  })

  it("preserves already-public replay timestamps and fields byte-for-byte", () => {
    const publicSnapshot = {
      id: "cart_public_replay_01",
      email: "buyer@example.test",
      currency_code: "brl",
      locale: "pt-BR",
      total: 79.9,
      subtotal: 79.9,
      item_total: 79.9,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      region_id: "region_br",
      created_at: "2026-08-25T10:00:00+00:00",
      updated_at: "2026-08-25T10:00:01+00:00",
      checkout_data_complete: true,
      customer: {
        id: "customer_public_replay_01",
        email: "buyer@example.test",
      },
      items: [
        {
          id: "item_public_replay_01",
          quantity: 1,
          title: "Camiseta básica",
          variant_id: "variant_public_replay_01",
          variant_title: "M",
          unit_price: 79.9,
        },
      ],
      shipping_address: {
        first_name: "Ana",
        last_name: "Silva",
        company: null,
        address_1: "Rua A, 1",
        address_2: null,
        city: "São Paulo",
        postal_code: "01000-000",
        country_code: "br",
        province: "SP",
        phone: null,
        masked_federal_tax_id: "masked-original",
      },
    }

    const response = serializeCartMergeResponse({
      outcome: "MERGED",
      cart: publicSnapshot,
      review: {
        requiresReview: false,
        reviewRef: null,
        rejectedItems: [],
      },
    })

    expect(response.cart).toEqual(publicSnapshot)
    expect(JSON.stringify(response.cart)).toBe(JSON.stringify(publicSnapshot))
  })

  it("keeps merge and review runtime bodies strict and exact", () => {
    expect(Object.keys(CartMergeRequestSchema.shape)).toEqual(["guestCartId"])
    expect(
      CartMergeRequestSchema.safeParse({ guestCartId: "cart_guest_01" }).success
    ).toBe(true)
    expect(
      CartMergeRequestSchema.safeParse({
        guestCartId: "cart_guest_01",
        customerCartId: "cart_customer_01",
      }).success
    ).toBe(false)
    expect(
      CartMergeRequestSchema.safeParse({ guest_cart_id: "cart_guest_01" }).success
    ).toBe(false)
    expect(
      CartMergeRequestSchema.safeParse({ guestCartId: " \t\n " }).success
    ).toBe(false)
    expect(
      CartMergeRequestSchema.safeParse({ guestCartId: "   " }).success
    ).toBe(false)

    expect(Object.keys(CartReviewAcknowledgeBodySchema.shape)).toEqual([
      "reviewRef",
    ])
    expect(CartReviewAcknowledgeBodySchema.safeParse({ reviewRef: null }).success).toBe(
      true
    )
    expect(
      CartReviewAcknowledgeBodySchema.safeParse({ reviewRef: "review_01" }).success
    ).toBe(true)
    expect(
      CartReviewAcknowledgeBodySchema.safeParse({
        reviewRef: null,
        idempotencyKey: "retry-key",
      }).success
    ).toBe(false)
    expect(
      CartReviewAcknowledgeBodySchema.safeParse({}).success
    ).toBe(false)
  })

  it("proves closed merge/review registry schemas and exact public sets", () => {
    type Schema = {
      additionalProperties?: unknown
      description?: string
      enum?: unknown
      example?: unknown
      examples?: unknown
      minimum?: unknown
      minLength?: unknown
      pattern?: unknown
      properties?: Record<string, Schema>
      required?: unknown
      type?: unknown
      oneOf?: unknown
    }

    const schemas = store?.document.components.schemas ?? {}
    const schema = (name: string): Schema => schemas[name] as Schema
    const propertyNames = (name: string): string[] =>
      Object.keys(schema(name).properties ?? {})
    const requiredNames = (name: string): string[] =>
      (schema(name).required ?? []) as string[]

    expect(propertyNames("CartMergeRequest")).toEqual(["guestCartId"])
    expect(requiredNames("CartMergeRequest")).toEqual(["guestCartId"])
    expect(schema("CartMergeRequest").additionalProperties).toBe(false)
    expect(schema("CartMergeRequest").properties?.guestCartId).toEqual(
      expect.objectContaining({
        type: "string",
        minLength: 1,
        pattern: ".*\\S.*",
      })
    )

    expect(schema("CartMergeOutcome").enum).toEqual([...CART_MERGE_OUTCOMES])
    expect(schema("CartMergeOutcome")).not.toHaveProperty("example")
    expect(schema("CartMergeOutcome")).not.toHaveProperty("examples")
    expect(schema("CartMergeOutcome").description).toMatch(/reserved/i)

    expect(propertyNames("CartMergeRejectedItem")).toEqual([
      "variantId",
      "requestedQuantity",
      "acceptedQuantity",
      "rejectedQuantity",
      "reason",
    ])
    expect(requiredNames("CartMergeRejectedItem")).toEqual([
      "variantId",
      "requestedQuantity",
      "acceptedQuantity",
      "rejectedQuantity",
      "reason",
    ])
    expect(schema("CartMergeRejectedItem").additionalProperties).toBe(false)
    expect(schema("CartMergeRejectedItem").properties?.variantId).toEqual(
      expect.objectContaining({ type: "string", minLength: 1 })
    )
    expect(schema("CartMergeRejectedItem").properties?.requestedQuantity).toEqual(
      expect.objectContaining({ type: "integer", minimum: 1 })
    )
    expect(schema("CartMergeRejectedItem").properties?.acceptedQuantity).toEqual(
      expect.objectContaining({ type: "integer", minimum: 0, maximum: 99 })
    )
    expect(schema("CartMergeRejectedItem").properties?.rejectedQuantity).toEqual(
      expect.objectContaining({ type: "integer", minimum: 0 })
    )
    expect(schema("CartMergeRejectedItem").properties?.reason).toEqual(
      expect.objectContaining({
        type: "string",
        enum: [...CART_MERGE_REJECTION_REASONS],
      })
    )

    expect(propertyNames("CartReviewState")).toEqual([
      "requiresReview",
      "reviewRef",
      "rejectedItems",
    ])
    expect(requiredNames("CartReviewState")).toEqual([
      "requiresReview",
      "reviewRef",
      "rejectedItems",
    ])
    expect(schema("CartReviewState").additionalProperties).toBe(false)
    expect(schema("CartReviewState").oneOf).toEqual([
      { $ref: "#/components/schemas/CartReviewPendingState" },
      { $ref: "#/components/schemas/CartReviewClearState" },
    ])
    expect(schema("CartReviewPendingState")).toEqual(
      expect.objectContaining({
        type: "object",
        additionalProperties: false,
        required: ["requiresReview", "reviewRef", "rejectedItems"],
        properties: expect.objectContaining({
          requiresReview: { type: "boolean", const: true },
          reviewRef: { type: "string", minLength: 1 },
        }),
      })
    )
    expect(schema("CartReviewClearState")).toEqual(
      expect.objectContaining({
        type: "object",
        additionalProperties: false,
        required: ["requiresReview", "reviewRef", "rejectedItems"],
        properties: expect.objectContaining({
          requiresReview: { type: "boolean", const: false },
          reviewRef: { type: "null" },
        }),
      })
    )

    expect(propertyNames("CartMergeResponse")).toEqual([
      "outcome",
      "cart",
      "review",
    ])
    expect(requiredNames("CartMergeResponse")).toEqual([
      "outcome",
      "cart",
      "review",
    ])
    expect(schema("CartMergeResponse").additionalProperties).toBe(false)
    expect(schema("CartMergeResponse").oneOf).toEqual([
      { $ref: "#/components/schemas/CartMergePartialResponse" },
      { $ref: "#/components/schemas/CartMergeClearResponse" },
    ])
    expect(schema("CartMergePartialResponse")).toEqual(
      expect.objectContaining({
        additionalProperties: false,
        properties: expect.objectContaining({
          outcome: { type: "string", const: "MERGED_PARTIAL" },
          review: {
            $ref: "#/components/schemas/CartReviewPendingState",
          },
        }),
      })
    )
    expect(schema("CartMergeClearResponse")).toEqual(
      expect.objectContaining({
        additionalProperties: false,
        properties: expect.objectContaining({
          outcome: {
            type: "string",
            enum: [
              "MERGED",
              "GUEST_CART_ATTACHED",
              "CUSTOMER_CART_PRESERVED",
              "NO_ITEMS",
            ],
          },
          review: {
            $ref: "#/components/schemas/CartReviewClearState",
          },
        }),
      })
    )

    expect(propertyNames("CartReviewAcknowledgeRequest")).toEqual(["reviewRef"])
    expect(requiredNames("CartReviewAcknowledgeRequest")).toEqual(["reviewRef"])
    expect(schema("CartReviewAcknowledgeRequest").additionalProperties).toBe(false)
    expect(schema("CartReviewAcknowledgeRequest").properties?.reviewRef).toEqual(
      expect.objectContaining({ type: ["string", "null"], minLength: 1 })
    )

    expect(propertyNames("CartReviewAcknowledgeResponse")).toEqual([
      "cart",
      "review",
    ])
    expect(requiredNames("CartReviewAcknowledgeResponse")).toEqual([
      "cart",
      "review",
    ])
    expect(schema("CartReviewAcknowledgeResponse").additionalProperties).toBe(false)
    expect(schema("CartReviewAcknowledgeResponse").properties?.cart).toEqual({
      oneOf: [
        { $ref: "#/components/schemas/PublicStoreCartPreOrder" },
        { type: "null" },
      ],
    })

    expect(
      CartMergeRejectedItemSchema.safeParse({
        variantId: "variant_public",
        requestedQuantity: 30,
        acceptedQuantity: 19,
        rejectedQuantity: 11,
        reason: "QUANTITY_LIMIT_EXCEEDED",
      }).success
    ).toBe(true)
    expect(
      CartMergeRejectedItemSchema.safeParse({
        variantId: "variant_public",
        requestedQuantity: 30,
        acceptedQuantity: 20,
        rejectedQuantity: 11,
        reason: "QUANTITY_LIMIT_EXCEEDED",
      }).success
    ).toBe(false)
    expect(
      CartReviewStateSchema.safeParse({
        requiresReview: true,
        reviewRef: "review_pending",
        rejectedItems: [],
      }).success
    ).toBe(true)
    expect(
      CartReviewStateSchema.safeParse({
        requiresReview: true,
        reviewRef: null,
        rejectedItems: [],
      }).success
    ).toBe(false)
    expect(
      CartReviewStateSchema.safeParse({
        requiresReview: false,
        reviewRef: null,
        rejectedItems: [],
      }).success
    ).toBe(true)
    expect(
      CartReviewStateSchema.safeParse({
        requiresReview: false,
        reviewRef: "review_clear",
        rejectedItems: [],
      }).success
    ).toBe(false)
    expect(() =>
      serializeCartMergeResponse({
        outcome: "MERGED_PARTIAL",
        cart: null,
        review: {
          requiresReview: true,
          reviewRef: "review_opaque_01",
          rejectedItems: [
            {
              variantId: "variant_public",
              requestedQuantity: 30,
              acceptedQuantity: 20,
              rejectedQuantity: 11,
              reason: "QUANTITY_LIMIT_EXCEEDED",
            },
          ],
        },
      })
    ).toThrow()
  })

  it("keeps review relation, response sets, forbidden fields, and replay shape closed", () => {
    const partialReview = {
      requiresReview: true,
      reviewRef: "review_opaque_01",
      rejectedItems: [
        {
          variantId: "variant_public",
          requestedQuantity: 3,
          acceptedQuantity: 2,
          rejectedQuantity: 1,
          reason: "VARIANT_UNAVAILABLE" as const,
        },
      ],
    }
    const cleanReview = {
      requiresReview: false,
      reviewRef: null,
      rejectedItems: [],
    }

    expect(
      CartReviewStateSchema.safeParse(partialReview).success
    ).toBe(true)
    expect(
      CartMergeResponseSchema.safeParse({
        outcome: "MERGED_PARTIAL",
        cart: null,
        review: partialReview,
      }).success
    ).toBe(true)
    expect(
      CartMergeResponseSchema.safeParse({
        outcome: "MERGED",
        cart: null,
        review: partialReview,
      }).success
    ).toBe(false)
    expect(
      CartReviewAcknowledgeResponseSchema.safeParse({
        cart: null,
        review: cleanReview,
      }).success
    ).toBe(true)

    const mergeResponse = serializeCartMergeResponse({
      outcome: "MERGED_PARTIAL",
      cart: null,
      review: partialReview,
      mergeReceipt: "internal-receipt",
      currentState: "internal-state",
      actorId: "internal-actor",
    } as never)
    const acknowledgeResponse = serializeCartReviewAcknowledgeResponse({
      cart: null,
      review: cleanReview,
      mergeReceipt: "internal-receipt",
      currentState: "internal-state",
    } as never)

    expect(Object.keys(mergeResponse)).toEqual(["outcome", "cart", "review"])
    expect(Object.keys(acknowledgeResponse)).toEqual(["cart", "review"])
    expect(JSON.stringify(mergeResponse)).not.toMatch(
      /mergeReceipt|currentState|actorId|internal-receipt|internal-state|internal-actor/
    )
    expect(JSON.stringify(acknowledgeResponse)).not.toMatch(
      /mergeReceipt|currentState|internal-receipt|internal-state/
    )
    expect(
      CartMergeResponseSchema.safeParse(mergeResponse).success
    ).toBe(true)
    expect(
      CartReviewAcknowledgeResponseSchema.safeParse(acknowledgeResponse).success
    ).toBe(true)
  })
})
