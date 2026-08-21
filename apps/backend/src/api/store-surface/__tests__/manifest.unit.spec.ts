import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_MEDUSA_VERSION,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS,
  STORE_SURFACE_M1_ENABLED_OPERATIONS,
  lookupStoreSurfaceEntry,
  storeSurfaceOperationKey,
  summarizeStoreSurfaceManifest,
  validateStoreSurfaceManifest,
  type StoreSurfaceEntry,
} from "../manifest"
import { scanInstalledStoreSurface } from "../../../../scripts/store-surface/scan-installed"

const PRESERVE_LEGACY_KEYS = [
  "GET /store/products",
  "GET /store/products/{id}",
  "POST /store/carts/{id}/payment-attempts/card",
  "POST /store/carts/{id}/payment-attempts/pix",
  "POST /store/tracking/lookup",
] as const

describe("Store surface manifest (FND-01)", () => {
  const counts = summarizeStoreSurfaceManifest()
  const violations = validateStoreSurfaceManifest()

  it("locks Medusa 2.16.0 and exact inventory 64 = 51 native identity + 13 local", () => {
    expect(STORE_SURFACE_MEDUSA_VERSION).toBe("2.16.0")
    expect(counts.total).toBe(64)
    expect(counts.duplicates).toEqual([])
    expect(
      STORE_SURFACE_MANIFEST.every(
        (entry) => entry.medusaVersion === "2.16.0"
      )
    ).toBe(true)

    const nativeLike = STORE_SURFACE_MANIFEST.filter(
      (entry) =>
        entry.origin === "native" || entry.origin === "native+local_extension"
    )
    const localOnly = STORE_SURFACE_MANIFEST.filter(
      (entry) => entry.origin === "local"
    )
    expect(nativeLike).toHaveLength(51)
    expect(localOnly).toHaveLength(13)
    expect(counts.nativeLocalExtension).toBe(5)
  })

  it("locks classification distribution 0/16/17/31 with zero UNKNOWN", () => {
    expect(counts.authorized).toBe(0)
    expect(counts.extended).toBe(16)
    expect(counts.blocked).toBe(17)
    expect(counts.outsideFrontendM1).toBe(31)
    expect(
      counts.authorized +
        counts.extended +
        counts.blocked +
        counts.outsideFrontendM1
    ).toBe(64)
  })

  it("locks M1_ENABLED exact-set to STORE_SURFACE_M1_ENABLED_OPERATIONS (Phase 14 Auth 6 + Phase 15 Cart 6 = 12)", () => {
    expect(counts.m1EnabledPolicy).toBe(12)
    expect(counts.m1EnablementEnabled).toBe(12)
    expect(counts.m1EnabledPolicy).toBe(
      STORE_SURFACE_M1_ENABLED_OPERATIONS.length
    )

    const m1EnabledEntries = STORE_SURFACE_MANIFEST.filter(
      (entry) =>
        entry.runtime_policy === "M1_ENABLED" &&
        entry.m1_enablement === "enabled"
    )
    const m1EnabledKeys = m1EnabledEntries.map((entry) =>
      storeSurfaceOperationKey(entry.method, entry.pathTemplate)
    )

    expect(m1EnabledEntries).toHaveLength(12)
    expect([...m1EnabledKeys].sort()).toEqual(
      [...STORE_SURFACE_M1_ENABLED_OPERATIONS].sort()
    )
    expect(m1EnabledKeys).toEqual([...STORE_SURFACE_M1_ENABLED_OPERATIONS])

    for (const key of STORE_SURFACE_M1_ENABLED_OPERATIONS) {
      const [method, pathTemplate] = key.split(" ")
      const entry = lookupStoreSurfaceEntry(method, pathTemplate)
      expect(entry).toBeDefined()
      expect(entry!.runtime_policy).toBe("M1_ENABLED")
      expect(entry!.m1_enablement).toBe("enabled")
    }

    const m1Keys = new Set<string>(STORE_SURFACE_M1_ENABLED_OPERATIONS)
    const extraM1 = STORE_SURFACE_MANIFEST.filter((entry) => {
      const key = storeSurfaceOperationKey(entry.method, entry.pathTemplate)
      return (
        !m1Keys.has(key) &&
        (entry.runtime_policy === "M1_ENABLED" ||
          entry.m1_enablement === "enabled")
      )
    })
    expect(extraM1).toEqual([])
  })

  it("keeps the Phase 14 Auth and Phase 15 Cart six-route sets explicit", () => {
    expect(STORE_SURFACE_PHASE14_ENABLED_OPERATIONS).toHaveLength(6)
    expect(STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS).toEqual([
      "POST /store/carts/{id}/line-items",
      "POST /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items/{line_id}",
      "DELETE /store/carts/{id}/line-items",
      "GET /store/carts/active",
      "POST /store/carts/active",
    ])
    expect(STORE_SURFACE_M1_ENABLED_OPERATIONS).toHaveLength(12)
    expect(
      STORE_SURFACE_M1_ENABLED_OPERATIONS.filter((operation) =>
        STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS.includes(operation as never)
      )
    ).toHaveLength(6)
  })

  it("requires DENY 47 + PRESERVE_LEGACY 5 + M1_ENABLED 12 = 64 with BLOCKED always DENY", () => {
    expect(counts.deny).toBe(47)
    expect(counts.preserveLegacy).toBe(5)
    expect(counts.preserveLegacy).toBe(PRESERVE_LEGACY_KEYS.length)
    expect(counts.m1EnabledPolicy).toBe(12)
    expect(
      counts.deny + counts.preserveLegacy + counts.m1EnabledPolicy
    ).toBe(64)

    for (const entry of STORE_SURFACE_MANIFEST) {
      if (entry.classification === "BLOCKED") {
        expect(entry.runtime_policy).toBe("DENY")
      }
    }

    for (const key of PRESERVE_LEGACY_KEYS) {
      const [method, pathTemplate] = key.split(" ")
      const entry = lookupStoreSurfaceEntry(method, pathTemplate)
      expect(entry).toBeDefined()
      expect(entry!.runtime_policy).toBe("PRESERVE_LEGACY")
      expect(entry!.m1_enablement).toBe("disabled")
      expect(entry!.runtime_policy).not.toBe("M1_ENABLED")
    }
  })

  it("assigns individual runtime_policy+rationale without class-wide inference", () => {
    expect(violations).toEqual([])

    for (const entry of STORE_SURFACE_MANIFEST) {
      expect(entry.rationale.trim().length).toBeGreaterThan(0)
      expect(entry.openapi_m1_expectation).toMatch(
        /^(include_executable_m1|exclude|support_only)$/
      )
      expect(entry.origin).toMatch(/^(native|local|native\+local_extension)$/)
    }

    const attach = lookupStoreSurfaceEntry(
      "POST",
      "/store/customers/me/cart/attach"
    )
    expect(attach?.classification).toBe("BLOCKED")
    expect(attach?.runtime_policy).toBe("DENY")

    const scaffold = lookupStoreSurfaceEntry("GET", "/store/custom")
    expect(scaffold?.classification).toBe("BLOCKED")
    expect(scaffold?.runtime_policy).toBe("DENY")

    const pix = lookupStoreSurfaceEntry(
      "POST",
      "/store/carts/{id}/payment-attempts/pix"
    )
    expect(pix?.classification).toBe("OUTSIDE_FRONTEND_M1")
    expect(pix?.runtime_policy).toBe("PRESERVE_LEGACY")

    const lineItems = lookupStoreSurfaceEntry(
      "POST",
      "/store/carts/{id}/line-items"
    )
    expect(lineItems?.classification).toBe("EXTENDED")
    expect(lineItems?.origin).toBe("native+local_extension")
    expect(lineItems?.runtime_policy).toBe("M1_ENABLED")
    expect(lineItems?.m1_enablement).toBe("enabled")

    const deleteLineItems = lookupStoreSurfaceEntry(
      "DELETE",
      "/store/carts/{id}/line-items/{line_id}"
    )
    expect(deleteLineItems?.origin).toBe("native+local_extension")
    expect(deleteLineItems?.runtime_policy).toBe("M1_ENABLED")

    const clearLineItems = lookupStoreSurfaceEntry(
      "DELETE",
      "/store/carts/{id}/line-items"
    )
    expect(clearLineItems?.origin).toBe("local")
    expect(clearLineItems?.runtime_policy).toBe("M1_ENABLED")
  })

  it("assigns catalog product routes owner_phase 21 (not Cart Merge 16)", () => {
    const list = lookupStoreSurfaceEntry("GET", "/store/products")
    const detail = lookupStoreSurfaceEntry("GET", "/store/products/{id}")
    expect(list?.owner_domain).toBe("catalog")
    expect(detail?.owner_domain).toBe("catalog")
    expect(list?.owner_phase).toBe("21")
    expect(detail?.owner_phase).toBe("21")
    expect(list?.classification).toBe("EXTENDED")
    expect(detail?.classification).toBe("EXTENDED")
    expect(list?.runtime_policy).toBe("PRESERVE_LEGACY")
    expect(detail?.runtime_policy).toBe("PRESERVE_LEGACY")
  })

  it("rejects invalid combinations in validateStoreSurfaceManifest", () => {
    const broken: StoreSurfaceEntry[] = [
      {
        ...STORE_SURFACE_MANIFEST[0],
        classification: "BLOCKED",
        runtime_policy: "PRESERVE_LEGACY",
        rationale: "invalid combo fixture",
      },
    ]
    const brokenViolations = validateStoreSurfaceManifest(broken)
    expect(
      brokenViolations.some((item) => item.code === "BLOCKED_MUST_DENY")
    ).toBe(true)
  })

  it("scanner exact-set matches manifest against installed Medusa+local routes", () => {
    const scan = scanInstalledStoreSurface()
    expect(scan.errors).toEqual([])
    expect(scan.ok).toBe(true)
    expect(scan.medusaVersion).toBe("2.16.0")
    expect(scan.discovered).toHaveLength(64)
    expect(scan.missingFromManifest).toEqual([])
    expect(scan.missingFromInstalled).toEqual([])
    expect(scan.duplicatesInstalled).toEqual([])
    expect(scan.counts.extended).toBe(16)
    expect(scan.counts.blocked).toBe(17)
    expect(scan.counts.outsideFrontendM1).toBe(31)
    expect(scan.counts.m1EnabledPolicy).toBe(12)

    const installedKeys = new Set(scan.discoveredKeys)
    for (const entry of STORE_SURFACE_MANIFEST) {
      expect(
        installedKeys.has(
          storeSurfaceOperationKey(entry.method, entry.pathTemplate)
        )
      ).toBe(true)
    }
  })
})
