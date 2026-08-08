import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_MEDUSA_VERSION,
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
  "GET /store/carts/active",
  "POST /store/carts/active",
  "POST /store/carts/{id}/payment-attempts/card",
  "POST /store/carts/{id}/payment-attempts/pix",
  "POST /store/tracking/lookup",
] as const

describe("Store surface manifest (FND-01)", () => {
  const counts = summarizeStoreSurfaceManifest()
  const violations = validateStoreSurfaceManifest()

  it("locks Medusa 2.16.0 and exact inventory 58 = 51 native identity + 7 local", () => {
    expect(STORE_SURFACE_MEDUSA_VERSION).toBe("2.16.0")
    expect(counts.total).toBe(58)
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
    expect(localOnly).toHaveLength(7)
    expect(counts.nativeLocalExtension).toBe(2)
  })

  it("locks classification distribution 0/10/17/31 with zero UNKNOWN", () => {
    expect(counts.authorized).toBe(0)
    expect(counts.extended).toBe(10)
    expect(counts.blocked).toBe(17)
    expect(counts.outsideFrontendM1).toBe(31)
    expect(
      counts.authorized +
        counts.extended +
        counts.blocked +
        counts.outsideFrontendM1
    ).toBe(58)
  })

  it("keeps Phase 13 M1 enablement and M1_ENABLED policy at zero", () => {
    expect(counts.m1EnabledPolicy).toBe(0)
    expect(counts.m1EnablementEnabled).toBe(0)
    expect(
      STORE_SURFACE_MANIFEST.every(
        (entry) => entry.m1_enablement === "disabled"
      )
    ).toBe(true)
    expect(
      STORE_SURFACE_MANIFEST.every(
        (entry) => entry.runtime_policy !== "M1_ENABLED"
      )
    ).toBe(true)
  })

  it("requires DENY+PRESERVE_LEGACY=58 with BLOCKED always DENY", () => {
    expect(counts.deny + counts.preserveLegacy).toBe(58)
    expect(counts.preserveLegacy).toBe(PRESERVE_LEGACY_KEYS.length)
    expect(counts.deny).toBe(58 - PRESERVE_LEGACY_KEYS.length)

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
    expect(lineItems?.runtime_policy).toBe("DENY")
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
    expect(scan.discovered).toHaveLength(58)
    expect(scan.missingFromManifest).toEqual([])
    expect(scan.missingFromInstalled).toEqual([])
    expect(scan.duplicatesInstalled).toEqual([])
    expect(scan.counts.extended).toBe(10)
    expect(scan.counts.blocked).toBe(17)
    expect(scan.counts.outsideFrontendM1).toBe(31)
    expect(scan.counts.m1EnabledPolicy).toBe(0)

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
