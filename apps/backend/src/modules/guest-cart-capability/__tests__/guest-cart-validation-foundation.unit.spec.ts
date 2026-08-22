import {
  GUEST_CART_TEST_HARNESS_FORBIDDEN,
  GUEST_CART_TOKEN_HEADER,
  SYNTHETIC_GUEST_CART_CANARY_TOKEN,
  SYNTHETIC_GUEST_CART_CANARY_TOKEN_HASH,
  X_INDICIO_GUEST_CART_TOKEN,
  createDeterministicGuestCartClock,
  createDeterministicGuestCartEntropy,
  createSyntheticGuestCartCanary,
} from "./support/deterministic-guest-cart"
import {
  GUEST_CART_CAS_BIGINT_FORBIDDEN,
  GUEST_CART_CAS_RESOURCE_TYPE,
  GUEST_CART_CAS_VERSION_INVALID,
  executeGuestCartCasWithMutation,
  executeGuestCartIncrement,
  validateGuestCartExpectedVersion,
} from "../../../../integration-tests/helpers/guest-cart-cas"
import {
  GUEST_CART_CANARIES,
  GUEST_CART_LEAKAGE_SINKS,
  GUEST_CART_SAFE_SINK_KEYS,
  assertGuestCartSinksHaveNoCanaries,
  assertSafeGuestCartSink,
  createGuestCartLeakageCollector,
} from "../../../../integration-tests/helpers/guest-cart-leakage"
import {
  GUEST_CART_DENIED_NATIVE_OPERATIONS,
  assertAuthPhase14ExactSetPreserved,
  assertGuestCartNativeRoutesDenied,
  assertGuestCartPromotionsExplicit,
  assertStoreSurfaceNativeIdentityFloor,
  validateGuestCartSurfaceExactSet,
} from "../../../../integration-tests/helpers/guest-cart-exact-set"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS,
  type StoreSurfaceEntry,
} from "../../../api/store-surface/manifest"

describe("Guest Cart Validation Foundation (Wave 0 - Plan 15-01)", () => {
  describe("Deterministic Clock & 32-byte Entropy (Task 15-01-01)", () => {
    it("freezes, advances, and deterministically reports time", () => {
      const clock = createDeterministicGuestCartClock({
        seed: "test-clock-seed",
        startMs: 1_700_000_000_000,
      })

      expect(clock.isFrozen()).toBe(true)
      expect(clock.nowMs()).toBe(1_700_000_000_000)
      expect(clock.now().getTime()).toBe(1_700_000_000_000)

      clock.advance(5_000)
      expect(clock.nowMs()).toBe(1_700_000_005_000)
      expect(clock.now().getTime()).toBe(1_700_000_005_000)

      const clock2 = createDeterministicGuestCartClock({
        seed: "test-clock-seed",
        startMs: 1_700_000_000_000,
      })
      expect(clock2.nowMs()).toBe(1_700_000_000_000)
    })

    it("generates exactly 32 bytes of deterministic entropy per step", () => {
      const entropy1 = createDeterministicGuestCartEntropy("seed-alpha")
      const bytes1 = entropy1.bytes()

      expect(Buffer.isBuffer(bytes1)).toBe(true)
      expect(bytes1.length).toBe(32)

      const entropy2 = createDeterministicGuestCartEntropy("seed-alpha")
      const bytes2 = entropy2.bytes()

      expect(bytes1.equals(bytes2)).toBe(true)

      const entropy3 = createDeterministicGuestCartEntropy("seed-beta")
      const bytes3 = entropy3.bytes()

      expect(bytes3.length).toBe(32)
      expect(bytes1.equals(bytes3)).toBe(false)
    })

    it("provides randomBytesFn compatible with crypto.randomBytes returning 32 bytes", () => {
      const entropy = createDeterministicGuestCartEntropy("seed-random-fn")
      const first = entropy.randomBytesFn(32)
      const second = entropy.randomBytesFn(32)

      expect(first.length).toBe(32)
      expect(second.length).toBe(32)
      expect(first.equals(second)).toBe(false)
    })

    it("supports replace with 32-byte buffer and rejects invalid lengths", () => {
      const entropy = createDeterministicGuestCartEntropy("seed-replace")
      const custom32 = Buffer.alloc(32, 0x42)
      entropy.replace(custom32)
      expect(entropy.bytes().equals(custom32)).toBe(true)

      expect(() => entropy.replace(Buffer.alloc(16))).toThrow(
        "GUEST_CART_TEST_ENTROPY_LENGTH_INVALID"
      )
      expect(() => entropy.replace(Buffer.alloc(64))).toThrow(
        "GUEST_CART_TEST_ENTROPY_LENGTH_INVALID"
      )
    })

    it("locks header literal x-indicio-guest-cart-token and provides synthetic canary fixtures", () => {
      expect(GUEST_CART_TOKEN_HEADER).toBe("x-indicio-guest-cart-token")
      expect(X_INDICIO_GUEST_CART_TOKEN).toBe("x-indicio-guest-cart-token")

      expect(SYNTHETIC_GUEST_CART_CANARY_TOKEN).toContain(
        "canary_guest_cart_token_p15w0"
      )
      expect(SYNTHETIC_GUEST_CART_CANARY_TOKEN_HASH).toHaveLength(64)

      const canary = createSyntheticGuestCartCanary("custom")
      expect(canary.token).toContain("canary_guest_cart_token_p15w0_custom")
      expect(canary.tokenHash).toHaveLength(64)
      expect(canary.headerName).toBe("x-indicio-guest-cart-token")
    })
  })

  describe("Negative Proofs & Anti-pattern verification", () => {
    it("keeps production crypto out of the deterministic test harness", () => {
      const helper = require("./support/deterministic-guest-cart")

      expect(helper.generateGuestCartCapability).toBeUndefined()
      expect(helper.hashGuestCartCapability).toBeUndefined()
      expect(helper.compareGuestCartCapabilityHash).toBeUndefined()

      const productionHash = require("../hash")
      expect(productionHash.generateGuestCartCapability).toEqual(
        expect.any(Function)
      )
      expect(productionHash.hashGuestCartCapability).toEqual(
        expect.any(Function)
      )
      expect(productionHash.compareGuestCartCapabilityHash).toEqual(
        expect.any(Function)
      )
    })

    it("confirms no HKDF, nonce, or 45s recovery primitives exist in deterministic-guest-cart", () => {
      const helper = require("./support/deterministic-guest-cart")
      expect(helper.hkdfSync).toBeUndefined()
      expect(helper.deriveSyntheticCapability).toBeUndefined()
      expect(helper.createSyntheticIdempotencyKey).toBeUndefined()
      expect(helper.deriveKeyedBytes).toBeUndefined()
      expect(helper.AUTH_CANARIES).toBeUndefined()
    })
  })

  describe("StoreResourceVersion CAS helper (guest-cart-cas.ts)", () => {
    it("validates expectedVersion as positive integer and rejects bigint / invalid types", () => {
      expect(validateGuestCartExpectedVersion(1)).toBe(1)
      expect(validateGuestCartExpectedVersion(42)).toBe(42)

      expect(() => validateGuestCartExpectedVersion(BigInt(1))).toThrow(
        GUEST_CART_CAS_BIGINT_FORBIDDEN
      )
      expect(() => validateGuestCartExpectedVersion(1.5)).toThrow(
        GUEST_CART_CAS_VERSION_INVALID
      )
      expect(() => validateGuestCartExpectedVersion(0)).toThrow(
        GUEST_CART_CAS_VERSION_INVALID
      )
      expect(() => validateGuestCartExpectedVersion(-1)).toThrow(
        GUEST_CART_CAS_VERSION_INVALID
      )
      expect(() => validateGuestCartExpectedVersion("1")).toThrow(
        GUEST_CART_CAS_VERSION_INVALID
      )
      expect(() => validateGuestCartExpectedVersion(null)).toThrow(
        GUEST_CART_CAS_VERSION_INVALID
      )
    })

    it("calls compareAndSwapWithMutation with resourceType cart", async () => {
      const mockService = {
        compareAndSwapWithMutation: jest.fn().mockResolvedValue({
          type: "updated",
          previousVersion: 1,
          version: 2,
          mutationResult: "ok",
          transactionManagerIdentity: "test-tx",
        }),
        increment: jest.fn().mockResolvedValue({
          type: "updated",
          previousVersion: 1,
          version: 2,
          mutationResult: undefined,
          transactionManagerIdentity: "test-tx",
        }),
      }

      const casResult = await executeGuestCartCasWithMutation({
        versionService: mockService as any,
        cartId: "cart_01HX",
        expectedVersion: 1,
        mutate: async () => "ok",
      })

      expect(mockService.compareAndSwapWithMutation).toHaveBeenCalledTimes(1)
      expect(mockService.compareAndSwapWithMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: GUEST_CART_CAS_RESOURCE_TYPE,
          resourceId: "cart_01HX",
          expectedVersion: 1,
        })
      )
      expect(casResult.type).toBe("updated")

      const incResult = await executeGuestCartIncrement({
        versionService: mockService as any,
        cartId: "cart_01HX",
        expectedVersion: 1,
      })

      expect(mockService.increment).toHaveBeenCalledTimes(1)
      expect(mockService.increment).toHaveBeenCalledWith(
        GUEST_CART_CAS_RESOURCE_TYPE,
        "cart_01HX",
        1,
        undefined
      )
      expect(incResult.type).toBe("updated")
    })
  })

  describe("Multi-sink Leakage Collector (guest-cart-leakage.ts)", () => {
    it("collects snapshots and catches canary token leaks across sinks", () => {
      const collector = createGuestCartLeakageCollector()

      // Header literal name is allowed in logs/OpenAPI contracts
      collector.record("logs", { header: "x-indicio-guest-cart-token" })
      collector.record("openapi", { header: "x-indicio-guest-cart-token" })
      collector.record("db_plaintext", { token_hash: "abc123safehash" })

      expect(() => collector.assertNoCanaries()).not.toThrow()

      // Leak token canary into DB sink
      collector.record("db_plaintext", {
        leaked_field: GUEST_CART_CANARIES.token,
      })
      expect(() => collector.assertNoCanaries()).toThrow(
        "GUEST_CART_LEAKAGE_CANARY_DETECTED:db_plaintext"
      )
    })

    it("assertSafeGuestCartSink enforces safe property keys and absence of canaries", () => {
      const safeSnapshot = {
        id: "gccap_01",
        cart_id: "cart_01",
        token_hash: "safe_hash_hex",
        status: "active",
        expires_at: new Date().toISOString(),
      }

      expect(() => assertSafeGuestCartSink(safeSnapshot)).not.toThrow()

      const unsafeSnapshot = {
        ...safeSnapshot,
        plaintext_token: "secret_val",
      }
      expect(() => assertSafeGuestCartSink(unsafeSnapshot)).toThrow(
        "GUEST_CART_LEAKAGE_UNSAFE_SINK"
      )
    })
  })

  describe("Exact-set and Surface Guards (guest-cart-exact-set.ts)", () => {
    it("proves 6 Auth M1 operations are preserved and enabled in manifest", () => {
      expect(STORE_SURFACE_PHASE14_ENABLED_OPERATIONS).toHaveLength(6)
      expect(() => assertAuthPhase14ExactSetPreserved()).not.toThrow()
    })

    it("proves native identity floor is at least 51", () => {
      const count = assertStoreSurfaceNativeIdentityFloor()
      expect(count).toBeGreaterThanOrEqual(51)
    })

    it("proves native cart operations remain DENY", () => {
      expect(() => assertGuestCartNativeRoutesDenied()).not.toThrow()
      expect(GUEST_CART_DENIED_NATIVE_OPERATIONS).toContain(
        "POST /store/carts"
      )
      expect(GUEST_CART_DENIED_NATIVE_OPERATIONS).toContain(
        "GET /store/carts/{id}"
      )
      expect(GUEST_CART_DENIED_NATIVE_OPERATIONS).toContain(
        "POST /store/carts/{id}/complete"
      )
    })

    it("proves final Cart M1 promotions are explicit", () => {
      expect(STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS).toHaveLength(6)
      expect(() =>
        assertGuestCartPromotionsExplicit(
          STORE_SURFACE_MANIFEST,
          STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS
        )
      ).not.toThrow()

      const mockMutatedManifest: StoreSurfaceEntry[] = [
        ...STORE_SURFACE_MANIFEST,
        {
          method: "POST",
          pathTemplate: "/store/carts/{id}/complete",
          origin: "local",
          medusaVersion: "2.16.0",
          classification: "EXTENDED",
          runtime_policy: "M1_ENABLED",
          m1_enablement: "enabled",
          openapi_m1_expectation: "include_executable_m1",
          rationale: "unauthorized promotion probe",
          owner_domain: "cart",
        },
      ]

      expect(() =>
        assertGuestCartPromotionsExplicit(
          mockMutatedManifest,
          STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS
        )
      ).toThrow("GUEST_CART_UNAPPROVED_PROMOTION_DETECTED")
    })

    it("executes validateGuestCartSurfaceExactSet successfully", () => {
      const result = validateGuestCartSurfaceExactSet(
        STORE_SURFACE_MANIFEST,
        STORE_SURFACE_PHASE15_CART_ENABLED_OPERATIONS
      )
      expect(result.authM1Count).toBe(6)
      expect(result.nativeIdentityCount).toBeGreaterThanOrEqual(51)
      expect(result.deniedCount).toBe(7)
    })
  })
})
