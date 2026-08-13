import { createHash } from "node:crypto"
import {
  CAPABILITY_PURPOSES,
  CAPABILITY_RANDOM_BYTES,
  deriveCustomerAuthCapability,
  generateCustomerAuthCapabilityNonce,
  hashCustomerAuthCapability,
  isCapabilityKeyRemovalAllowed,
  type CapabilityKeyring,
} from "../security/capabilities"
import {
  CustomerAuthEmailNormalizationError,
  normalizeCustomerAuthEmail,
} from "../security/email-normalization"
import { parseEnv } from "../../../config/env"

const SECRET_V1 = "test-capability-secret-v1-32-bytes-0000"
const SECRET_V2 = "test-capability-secret-v2-32-bytes-0000"

const KEYRING: CapabilityKeyring = {
  active: { version: 2, secret: SECRET_V2 },
  previous: [{ version: 1, secret: SECRET_V1 }],
}

describe("customer auth security primitives", () => {
  describe("P14-D12 email normalization", () => {
    it.each([
      ["  Alice+tag.Doe@Example.COM  ", "alice+tag.doe@example.com"],
      ["User@Bücher.de", "user@xn--bcher-kva.de"],
      ["User.Name+tag@例え.テスト", "user.name+tag@xn--r8jz45g.xn--zckzah"],
    ])("normalizes %p to %p", (input, expected) => {
      expect(normalizeCustomerAuthEmail(input)).toBe(expected)
    })

    it.each([
      "user@@example.com",
      "user example@example.com",
      "usér@example.com",
      "user@",
      "@example.com",
      "user@example..com",
    ])("rejects invalid or EAI input %p", (input) => {
      expect(() => normalizeCustomerAuthEmail(input)).toThrow(
        CustomerAuthEmailNormalizationError
      )
    })

    it("does not apply provider-specific plus or dot rewriting", () => {
      expect(normalizeCustomerAuthEmail("First.Last+tag@example.com")).toBe(
        "first.last+tag@example.com"
      )
    })
  })

  describe("hash-only capabilities", () => {
    it("uses 32-byte CSPRNG nonce and persists only hash, nonce and key version", () => {
      const nonce = generateCustomerAuthCapabilityNonce(() => Buffer.alloc(32, 7))
      const first = deriveCustomerAuthCapability({
        keyring: KEYRING,
        purpose: "verification",
        intentId: "intent_01",
        lineageId: "lineage_01",
        generation: 2,
        nonce,
      })

      expect(CAPABILITY_RANDOM_BYTES).toBe(32)
      expect(nonce).toHaveLength(32)
      expect(first.capability).toHaveLength(43)
      expect(first.material).toEqual({
        hash: hashCustomerAuthCapability(first.capability),
        nonce: nonce.toString("base64url"),
        key_version: 2,
      })
      expect(JSON.stringify(first.material)).not.toContain(first.capability)
      expect(Object.keys(first.material).sort()).toEqual([
        "hash",
        "key_version",
        "nonce",
      ])
    })

    it("domain-separates purpose, key version, intent, generation and nonce", () => {
      const input = {
        keyring: KEYRING,
        purpose: "verification" as const,
        intentId: "intent_01",
        lineageId: "lineage_01",
        generation: 2,
        nonce: Buffer.alloc(32, 7),
      }
      const baseline = deriveCustomerAuthCapability(input).capability

      for (const changed of [
        { purpose: "reset" as const },
        { intentId: "intent_02" },
        { generation: 3 },
        { nonce: Buffer.alloc(32, 8) },
        { keyring: { ...KEYRING, active: { version: 3, secret: SECRET_V2 } } },
      ]) {
        expect(deriveCustomerAuthCapability({ ...input, ...changed }).capability).not.toBe(
          baseline
        )
      }

      expect(CAPABILITY_PURPOSES).toEqual(["verification", "reset", "refresh"])
      expect(createHash("sha256").update(baseline).digest("hex")).toHaveLength(64)
    })

    it("allows key removal only after pending material and retention window are gone", () => {
      const now = new Date("2026-08-13T12:00:00.000Z")
      expect(
        isCapabilityKeyRemovalAllowed({
          pendingCount: 1,
          lastPendingExpiresAt: new Date("2026-08-10T12:00:00.000Z"),
          now,
        })
      ).toBe(false)
      expect(
        isCapabilityKeyRemovalAllowed({
          pendingCount: 0,
          lastPendingExpiresAt: new Date("2026-08-12T12:00:00.000Z"),
          now,
        })
      ).toBe(false)
      expect(
        isCapabilityKeyRemovalAllowed({
          pendingCount: 0,
          lastPendingExpiresAt: new Date("2026-08-10T00:00:00.000Z"),
          now,
        })
      ).toBe(true)
    })
  })

  describe("environment keyring", () => {
    it("requires an active versioned key when customer auth is enabled", () => {
      expect(() =>
        parseEnv({
          NODE_ENV: "development",
          CUSTOMER_AUTH_ENABLED: "true",
        })
      ).toThrow("CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY")
    })

    it("rejects duplicate active and previous key versions", () => {
      expect(() =>
        parseEnv({
          NODE_ENV: "development",
          CUSTOMER_AUTH_ENABLED: "true",
          CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY_VERSION: "2",
          CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY: SECRET_V2,
          CUSTOMER_AUTH_CAPABILITY_PREVIOUS_KEYS: JSON.stringify([
            { version: 2, secret: SECRET_V1 },
          ]),
        })
      ).toThrow("duplicate key version")
    })

    it("parses versioned previous keys without returning their raw material in errors", () => {
      const parsed = parseEnv({
        NODE_ENV: "development",
        CUSTOMER_AUTH_ENABLED: "true",
        CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY_VERSION: "2",
        CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY: SECRET_V2,
        CUSTOMER_AUTH_CAPABILITY_PREVIOUS_KEYS: JSON.stringify([
          { version: 1, secret: SECRET_V1 },
        ]),
      })

      expect(parsed.CUSTOMER_AUTH_ENABLED).toBe(true)
      expect(parsed.CUSTOMER_AUTH_CAPABILITY_KEYRING).toEqual(KEYRING)
    })
  })
})
