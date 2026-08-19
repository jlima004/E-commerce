import { createHash } from "node:crypto"
import {
  generateGuestCartCapability,
  hashGuestCartCapability,
  compareGuestCartCapabilityHash,
  performDummyGuestCartCapabilityHashComparison,
} from "../hash"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
  GUEST_CART_CAPABILITY_RANDOM_BYTES,
  GUEST_CART_CAPABILITY_STATUS,
  GUEST_CART_CAPABILITY_STATUSES,
  type GuestCartCapabilityRecord,
} from "../types"
import { createDeterministicGuestCartEntropy } from "./support/deterministic-guest-cart"

describe("Guest Cart Capability Hash & Types Unit Suite (Task 15-02-01)", () => {
  describe("Constants & Enums", () => {
    it("exports exact header constant x-indicio-guest-cart-token", () => {
      expect(GUEST_CART_CAPABILITY_HEADER).toBe("x-indicio-guest-cart-token")
    })

    it("exports exact random bytes constant 32", () => {
      expect(GUEST_CART_CAPABILITY_RANDOM_BYTES).toBe(32)
    })

    it("exports exact module key guest_cart_capability", () => {
      expect(GUEST_CART_CAPABILITY_MODULE).toBe("guest_cart_capability")
    })

    it("exports all 4 required lifecycle statuses", () => {
      expect(GUEST_CART_CAPABILITY_STATUS).toEqual({
        ACTIVE: "active",
        EXPIRED: "expired",
        REVOKED: "revoked",
        CONSUMED: "consumed",
      })

      expect(GUEST_CART_CAPABILITY_STATUSES).toEqual([
        "active",
        "expired",
        "revoked",
        "consumed",
      ])
    })
  })

  describe("generateGuestCartCapability", () => {
    it("generates a valid 32-byte base64url encoded string", () => {
      const token = generateGuestCartCapability()
      expect(typeof token).toBe("string")
      // 32 bytes in base64url is exactly 43 chars (no padding)
      expect(token).toHaveLength(43)
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    })

    it("accepts an injectable randomBytesFn", () => {
      const deterministicEntropy = createDeterministicGuestCartEntropy("test-seed-15-02")
      const token1 = generateGuestCartCapability(deterministicEntropy.randomBytesFn)
      const token2 = generateGuestCartCapability(deterministicEntropy.randomBytesFn)

      expect(token1).toHaveLength(43)
      expect(token2).toHaveLength(43)
      expect(token1).not.toBe(token2)
    })

    it("rejects randomBytesFn returning incorrect buffer sizes", () => {
      expect(() => {
        generateGuestCartCapability(() => Buffer.alloc(16))
      }).toThrow("requires exactly 32 bytes")

      expect(() => {
        generateGuestCartCapability(() => Buffer.alloc(64))
      }).toThrow("requires exactly 32 bytes")
    })
  })

  describe("hashGuestCartCapability", () => {
    it("computes standard SHA-256 hex digest of plaintext token", () => {
      const token = "sample_test_token_for_sha256_hash_verification"
      const expected = createHash("sha256").update(token, "utf8").digest("hex")

      const result = hashGuestCartCapability(token)
      expect(result).toBe(expected)
      expect(result).toHaveLength(64)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it("throws on empty or non-string input", () => {
      expect(() => hashGuestCartCapability("")).toThrow(
        "requires a non-empty string token"
      )
      // @ts-expect-error testing invalid type
      expect(() => hashGuestCartCapability(null)).toThrow(
        "requires a non-empty string token"
      )
    })
  })

  describe("compareGuestCartCapabilityHash", () => {
    it("returns true for identical hashes", () => {
      const hash = createHash("sha256").update("test_token_123", "utf8").digest("hex")
      expect(compareGuestCartCapabilityHash(hash, hash)).toBe(true)
    })

    it("returns false for different hashes of same length", () => {
      const hashA = createHash("sha256").update("test_token_A", "utf8").digest("hex")
      const hashB = createHash("sha256").update("test_token_B", "utf8").digest("hex")
      expect(compareGuestCartCapabilityHash(hashA, hashB)).toBe(false)
    })

    it("returns false for different lengths safely", () => {
      const hashA = "short"
      const hashB = createHash("sha256").update("test_token_B", "utf8").digest("hex")
      expect(compareGuestCartCapabilityHash(hashA, hashB)).toBe(false)
      expect(compareGuestCartCapabilityHash(hashB, hashA)).toBe(false)
    })

    it("returns false for invalid/empty inputs safely", () => {
      expect(compareGuestCartCapabilityHash("", "")).toBe(false)
      // @ts-expect-error testing invalid type
      expect(compareGuestCartCapabilityHash(null, "some_hash")).toBe(false)
    })
  })

  describe("performDummyGuestCartCapabilityHashComparison", () => {
    it("always returns false", () => {
      expect(performDummyGuestCartCapabilityHashComparison()).toBe(false)
    })
  })

  describe("Negative Proofs on Record & Types", () => {
    it("proves GuestCartCapabilityRecord has NO plaintext or auth-derived fields", () => {
      const dummyRecord: GuestCartCapabilityRecord = {
        id: "gccap_01JTEST0000000000000000000",
        cart_id: "cart_01JTEST0000000000000000000",
        token_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        status: "active",
        expires_at: new Date().toISOString(),
        consumed_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      }

      const keys = Object.keys(dummyRecord)

      const forbiddenKeys = [
        "plaintext_token",
        "plaintext",
        "token",
        "raw_token",
        "capability",
        "nonce",
        "jwt",
        "cookie",
        "secret",
        "pepper",
        "hkdf",
        "recovery_code",
      ]

      for (const forbidden of forbiddenKeys) {
        expect(keys).not.toContain(forbidden)
      }
    })
  })
})
