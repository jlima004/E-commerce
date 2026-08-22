import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  lookupStoreSurfaceEntry,
  storeSurfaceOperationKey,
  type StoreSurfaceEntry,
} from "../../src/api/store-surface/manifest"

export const GUEST_CART_TEST_HARNESS_FORBIDDEN =
  "GUEST_CART_TEST_HARNESS_FORBIDDEN"

export const GUEST_CART_DENIED_NATIVE_OPERATIONS = [
  "POST /store/carts",
  "GET /store/carts/{id}",
  "POST /store/carts/{id}/complete",
  "POST /store/customers/me/cart/attach",
  "POST /store/carts/{id}/shipping-methods",
  "GET /store/shipping-options",
  "POST /store/shipping-options/{id}/calculate",
] as const

type GuestCartTestHarnessError = Error & { code: string }

function assertGuestCartTestHarnessAllowed(): void {
  if (process.env.NODE_ENV !== "test") {
    const error = new Error(
      GUEST_CART_TEST_HARNESS_FORBIDDEN
    ) as GuestCartTestHarnessError
    error.code = GUEST_CART_TEST_HARNESS_FORBIDDEN
    throw error
  }
}

assertGuestCartTestHarnessAllowed()

/**
 * Asserts that the 6 Phase-14 Auth M1 operations remain intact and M1_ENABLED.
 */
export function assertAuthPhase14ExactSetPreserved(
  manifest: readonly StoreSurfaceEntry[] = STORE_SURFACE_MANIFEST
): void {
  assertGuestCartTestHarnessAllowed()

  const phase14Set = new Set<string>(STORE_SURFACE_PHASE14_ENABLED_OPERATIONS)
  if (phase14Set.size !== 6) {
    throw new Error("GUEST_CART_EXACT_SET_AUTH_COUNT_INVALID")
  }

  for (const key of STORE_SURFACE_PHASE14_ENABLED_OPERATIONS) {
    const [method, pathTemplate] = key.split(" ")
    const entry = lookupStoreSurfaceEntry(method, pathTemplate, manifest)
    if (!entry) {
      throw new Error(`GUEST_CART_EXACT_SET_AUTH_MISSING:${key}`)
    }
    if (entry.runtime_policy !== "M1_ENABLED" || entry.m1_enablement !== "enabled") {
      throw new Error(`GUEST_CART_EXACT_SET_AUTH_NOT_ENABLED:${key}`)
    }
  }
}

/**
 * Asserts that the total number of native-like identities does not drop below 51.
 */
export function assertStoreSurfaceNativeIdentityFloor(
  manifest: readonly StoreSurfaceEntry[] = STORE_SURFACE_MANIFEST,
  minNativeIdentity = 51
): number {
  assertGuestCartTestHarnessAllowed()

  const nativeLike = manifest.filter(
    (entry) =>
      entry.origin === "native" || entry.origin === "native+local_extension"
  )

  if (nativeLike.length < minNativeIdentity) {
    throw new Error(
      `GUEST_CART_EXACT_SET_NATIVE_IDENTITY_BELOW_FLOOR:${nativeLike.length}<${minNativeIdentity}`
    )
  }

  return nativeLike.length
}

/**
 * Asserts that native cart operations that must remain DENY are indeed DENY.
 */
export function assertGuestCartNativeRoutesDenied(
  manifest: readonly StoreSurfaceEntry[] = STORE_SURFACE_MANIFEST
): void {
  assertGuestCartTestHarnessAllowed()

  for (const key of GUEST_CART_DENIED_NATIVE_OPERATIONS) {
    const [method, pathTemplate] = key.split(" ")
    const entry = lookupStoreSurfaceEntry(method, pathTemplate, manifest)
    if (!entry) {
      throw new Error(`GUEST_CART_EXACT_SET_DENIED_ROUTE_MISSING:${key}`)
    }
    if (entry.runtime_policy !== "DENY" || entry.classification !== "BLOCKED") {
      throw new Error(`GUEST_CART_EXACT_SET_DENIED_ROUTE_NOT_DENIED:${key}`)
    }
  }
}

/**
 * Asserts that cart route promotions are explicit and match the allowed set.
 */
export function assertGuestCartPromotionsExplicit(
  manifest: readonly StoreSurfaceEntry[] = STORE_SURFACE_MANIFEST,
  allowedPromotedCartKeys: readonly string[] = []
): void {
  assertGuestCartTestHarnessAllowed()

  const allowedSet = new Set<string>(allowedPromotedCartKeys)

  const cartEntries = manifest.filter(
    (entry) =>
      entry.pathTemplate.startsWith("/store/carts") ||
      entry.owner_domain === "cart"
  )

  for (const entry of cartEntries) {
    const key = storeSurfaceOperationKey(entry.method, entry.pathTemplate)
    const isPromoted =
      entry.runtime_policy === "M1_ENABLED" ||
      entry.m1_enablement === "enabled"

    if (isPromoted && !allowedSet.has(key)) {
      throw new Error(`GUEST_CART_UNAPPROVED_PROMOTION_DETECTED:${key}`)
    }
  }
}

/**
 * Comprehensive verification for surface exact-set during Phase 15.
 */
export function validateGuestCartSurfaceExactSet(
  manifest: readonly StoreSurfaceEntry[] = STORE_SURFACE_MANIFEST,
  allowedPromotedCartKeys: readonly string[] = []
): {
  authM1Count: number
  nativeIdentityCount: number
  deniedCount: number
} {
  assertGuestCartTestHarnessAllowed()
  assertAuthPhase14ExactSetPreserved(manifest)
  const nativeIdentityCount = assertStoreSurfaceNativeIdentityFloor(manifest)
  assertGuestCartNativeRoutesDenied(manifest)
  assertGuestCartPromotionsExplicit(manifest, allowedPromotedCartKeys)

  return {
    authM1Count: STORE_SURFACE_PHASE14_ENABLED_OPERATIONS.length,
    nativeIdentityCount,
    deniedCount: GUEST_CART_DENIED_NATIVE_OPERATIONS.length,
  }
}
