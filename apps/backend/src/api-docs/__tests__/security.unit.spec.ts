import { buildContracts } from "../generation/build-documents"
import { createFoundationRegistry } from "../registry"

describe("OpenAPI Store security contract", () => {
  const registry = createFoundationRegistry()
  const storeOperations = registry.getOperations("store")
  const storeDocument = buildContracts(registry).find(
    (contract) => contract.surface === "store"
  )?.document

  it("registers exactly ten Store operations and keeps Admin/Webhooks empty", () => {
    expect(storeOperations).toHaveLength(10)
    expect(registry.getOperations("admin")).toHaveLength(0)
    expect(registry.getOperations("webhooks")).toHaveLength(0)

    const contracts = buildContracts(registry)
    expect(contracts.find((item) => item.surface === "admin")?.document.paths).toEqual(
      {}
    )
    expect(
      contracts.find((item) => item.surface === "webhooks")?.document.paths
    ).toEqual({})
  })

  it("marks every Store operation non-interactive and preserves four candidates", () => {
    expect(storeOperations.every((operation) => operation.nonInteractive)).toBe(
      true
    )
    const candidates = storeOperations.filter(
      (operation) => operation.interactiveCandidate
    )
    expect(candidates.map((operation) => `${operation.method} ${operation.path}`).sort()).toEqual(
      [
        "GET /health/live",
        "GET /health/ready",
        "GET /store/products",
        "GET /store/products/{id}",
      ]
    )
  })

  it("documents health checks as public Infrastructure operations", () => {
    const health = storeOperations.filter((operation) =>
      operation.path.startsWith("/health/")
    )
    expect(health).toHaveLength(2)
    for (const operation of health) {
      expect(operation.tags).toEqual(["Infrastructure"])
      expect(operation.security).toEqual([])
    }
  })

  it("requires publishable API key on Store business routes", () => {
    const business = storeOperations.filter(
      (operation) => !operation.path.startsWith("/health/")
    )
    for (const operation of business) {
      expect(
        operation.security.some((requirement) =>
          Object.prototype.hasOwnProperty.call(requirement, "publishableApiKey")
        )
      ).toBe(true)
    }
  })

  it("requires customer auth alternatives only on cart attach", () => {
    const attach = storeOperations.find(
      (operation) => operation.path === "/store/customers/me/cart/attach"
    )
    expect(attach?.security).toEqual([
      { publishableApiKey: [], customerBearer: [] },
      { publishableApiKey: [], customerSession: [] },
    ])

    const optionalCustomer = storeOperations.filter((operation) =>
      [
        "/store/products",
        "/store/products/{id}",
        "/store/carts/active",
        "/store/carts/{id}/payment-attempts/card",
        "/store/carts/{id}/payment-attempts/pix",
      ].includes(operation.path)
    )
    for (const operation of optionalCustomer) {
      expect(operation.security).toEqual(
        expect.arrayContaining([{ publishableApiKey: [] }])
      )
      expect(operation.security.length).toBeGreaterThan(1)
    }
  })

  it("keeps tracking token out of path/query and omits usable token examples", () => {
    const tracking = storeOperations.find(
      (operation) => operation.path === "/store/tracking/lookup"
    )
    expect(tracking?.parameters).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ name: "token", in: "query" }),
        expect.objectContaining({ name: "token", in: "path" }),
      ])
    )
    expect(tracking?.requestBody).toEqual(
      expect.objectContaining({
        required: true,
      })
    )

    const serialized = JSON.stringify(storeDocument)
    expect(serialized).not.toMatch(/"token"\s*:\s*"[^"]{8,}"/)
    expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9._~-]{8,}/)
    expect(serialized).not.toMatch(/pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/)
  })

  it("emits Store security schemes without leaking them into Admin/Webhooks", () => {
    expect(
      Object.keys(storeDocument?.components.securitySchemes ?? {}).sort()
    ).toEqual(["customerBearer", "customerSession", "publishableApiKey"])

    const contracts = buildContracts(registry)
    for (const surface of ["admin", "webhooks"] as const) {
      expect(
        contracts.find((item) => item.surface === surface)?.document.components
          .securitySchemes
      ).toEqual({})
    }
  })
})
