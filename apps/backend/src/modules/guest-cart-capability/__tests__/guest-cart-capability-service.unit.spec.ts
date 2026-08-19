import {
  assertRecordHasNoPlaintext,
  buildGuestCartCapabilityConsumptionUpdate,
  buildGuestCartCapabilityExpiryUpdate,
  buildGuestCartCapabilityRecord,
  buildGuestCartCapabilityRevocationUpdate,
  buildGuestCartCapabilityTouchRollingUpdate,
  computeInitialExpiresAt,
  computeRollingExpiresAt,
  GuestCartCapabilityModuleService,
  GUEST_CART_CAPABILITY_TTL_MAX_MS,
  GUEST_CART_CAPABILITY_TTL_ROLLING_MS,
  isGuestCartCapabilityActive,
  isGuestCartCapabilityExpired,
  mintGuestCartCapabilityInMemory,
} from "../service"
import {
  lookupGuestCartCapabilityByPresentedToken,
} from "../lookup"
import {
  GUEST_CART_CAPABILITY_LOOKUP_INVALID,
  GUEST_CART_CAPABILITY_PLAINTEXT_FORBIDDEN,
  GUEST_CART_CAPABILITY_STATUS,
  type GuestCartCapabilityRecord,
} from "../types"
import {
  createDeterministicGuestCartClock,
  createDeterministicGuestCartEntropy,
} from "./support/deterministic-guest-cart"

describe("Guest Cart Capability Service & Lookup Unit Suite (Task 15-02-02)", () => {
  const clock = createDeterministicGuestCartClock({
    seed: "p15-02-service-seed",
    startMs: new Date("2026-08-19T12:00:00.000Z").getTime(),
  })
  const entropy = createDeterministicGuestCartEntropy("p15-02-entropy-seed")

  describe("Plaintext prohibitions and assertions", () => {
    it("assertRecordHasNoPlaintext allows safe records", () => {
      expect(() => {
        assertRecordHasNoPlaintext({
          id: "gccap_123",
          cart_id: "cart_123",
          token_hash: "hash123",
          status: "active",
        })
      }).not.toThrow()
    })

    it("assertRecordHasNoPlaintext throws on forbidden plaintext keys", () => {
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
      ]

      for (const key of forbiddenKeys) {
        expect(() => {
          assertRecordHasNoPlaintext({
            id: "gccap_123",
            [key]: "sensitive_data",
          })
        }).toThrow(GUEST_CART_CAPABILITY_PLAINTEXT_FORBIDDEN)
      }
    })
  })

  describe("mintGuestCartCapabilityInMemory", () => {
    it("mints record with token_hash only and returns plaintext token once", () => {
      const result = mintGuestCartCapabilityInMemory(
        { cart_id: "cart_01JTESTCART0000000000000" },
        {
          id: "gccap_01JTESTCAP0000000000000",
          now: clock.now(),
          randomBytesFn: entropy.randomBytesFn,
        }
      )

      expect(result.plaintext_token).toBeDefined()
      expect(result.plaintext_token).toHaveLength(43)

      expect(result.record.id).toBe("gccap_01JTESTCAP0000000000000")
      expect(result.record.cart_id).toBe("cart_01JTESTCART0000000000000")
      expect(result.record.token_hash).toHaveLength(64)
      expect(result.record.status).toBe(GUEST_CART_CAPABILITY_STATUS.ACTIVE)
      expect(result.record.consumed_at).toBeNull()
      expect(result.record.revoked_at).toBeNull()
      expect(result.record.last_used_at).toBeNull()

      // Asserts no plaintext in record
      expect("plaintext_token" in result.record).toBe(false)
      expect("token" in result.record).toBe(false)
    })

    it("throws if input contains forbidden plaintext", () => {
      expect(() => {
        mintGuestCartCapabilityInMemory(
          // @ts-expect-error testing invalid property
          { cart_id: "cart_123", plaintext_token: "forbidden" },
          { id: "gccap_123" }
        )
      }).toThrow(GUEST_CART_CAPABILITY_PLAINTEXT_FORBIDDEN)
    })
  })

  describe("TTL Calculations: Rolling 7-day and 30-day absolute Cap (P15-D08)", () => {
    const baseNow = new Date("2026-08-01T00:00:00.000Z")

    it("computeInitialExpiresAt sets exactly 7 days from now", () => {
      const initial = computeInitialExpiresAt(baseNow)
      expect(initial.getTime() - baseNow.getTime()).toBe(GUEST_CART_CAPABILITY_TTL_ROLLING_MS)
      expect(initial.toISOString()).toBe("2026-08-08T00:00:00.000Z")
    })

    it("computeRollingExpiresAt extends by 7 days if within 30-day cap", () => {
      const createdAt = baseNow
      const touchAtDay10 = new Date("2026-08-11T00:00:00.000Z") // 10 days after creation

      const extended = computeRollingExpiresAt(createdAt, touchAtDay10)
      // 10 days + 7 days = 17 days <= 30 days
      expect(extended.toISOString()).toBe("2026-08-18T00:00:00.000Z")
    })

    it("computeRollingExpiresAt caps strictly at 30 days from created_at", () => {
      const createdAt = baseNow
      const touchAtDay26 = new Date("2026-08-27T00:00:00.000Z") // 26 days after creation
      // 26 days + 7 days = 33 days > 30 days -> must cap at 30 days
      const extended = computeRollingExpiresAt(createdAt, touchAtDay26)
      const maxPossible = new Date(createdAt.getTime() + GUEST_CART_CAPABILITY_TTL_MAX_MS)

      expect(extended.toISOString()).toBe(maxPossible.toISOString())
      expect(extended.toISOString()).toBe("2026-08-31T00:00:00.000Z")
    })

    it("buildGuestCartCapabilityTouchRollingUpdate produces correct update object", () => {
      const createdAt = "2026-08-01T00:00:00.000Z"
      const now = new Date("2026-08-05T12:00:00.000Z")

      const update = buildGuestCartCapabilityTouchRollingUpdate(createdAt, now)
      expect(update.last_used_at).toBe("2026-08-05T12:00:00.000Z")
      expect(update.updated_at).toBe("2026-08-05T12:00:00.000Z")
      expect(update.expires_at).toBe(
        new Date(now.getTime() + GUEST_CART_CAPABILITY_TTL_ROLLING_MS).toISOString()
      )
    })
  })

  describe("Lifecycle Status Updates & Activity Checks", () => {
    const now = new Date("2026-08-19T12:00:00.000Z")

    it("buildGuestCartCapabilityExpiryUpdate sets expired status", () => {
      const update = buildGuestCartCapabilityExpiryUpdate(now)
      expect(update.status).toBe("expired")
      expect(update.updated_at).toBe(now.toISOString())
    })

    it("buildGuestCartCapabilityRevocationUpdate sets revoked status and revoked_at", () => {
      const update = buildGuestCartCapabilityRevocationUpdate(now)
      expect(update.status).toBe("revoked")
      expect(update.revoked_at).toBe(now.toISOString())
      expect(update.updated_at).toBe(now.toISOString())
    })

    it("buildGuestCartCapabilityConsumptionUpdate sets consumed status and consumed_at", () => {
      const update = buildGuestCartCapabilityConsumptionUpdate(now)
      expect(update.status).toBe("consumed")
      expect(update.consumed_at).toBe(now.toISOString())
      expect(update.updated_at).toBe(now.toISOString())
    })

    it("isGuestCartCapabilityActive and isGuestCartCapabilityExpired", () => {
      const activeRecord: GuestCartCapabilityRecord = {
        id: "gccap_1",
        cart_id: "cart_1",
        token_hash: "hash_1",
        status: "active",
        expires_at: new Date(now.getTime() + 10000).toISOString(),
        consumed_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        deleted_at: null,
      }

      expect(isGuestCartCapabilityActive(activeRecord, now)).toBe(true)
      expect(isGuestCartCapabilityExpired(activeRecord, now)).toBe(false)

      // Past expiration
      const expiredRecord = {
        ...activeRecord,
        expires_at: new Date(now.getTime() - 10000).toISOString(),
      }
      expect(isGuestCartCapabilityActive(expiredRecord, now)).toBe(false)
      expect(isGuestCartCapabilityExpired(expiredRecord, now)).toBe(true)

      // Revoked
      const revokedRecord = {
        ...activeRecord,
        status: GUEST_CART_CAPABILITY_STATUS.REVOKED,
        revoked_at: now.toISOString(),
      }
      expect(isGuestCartCapabilityActive(revokedRecord, now)).toBe(false)

      // Consumed
      const consumedRecord = {
        ...activeRecord,
        status: GUEST_CART_CAPABILITY_STATUS.CONSUMED,
        consumed_at: now.toISOString(),
      }
      expect(isGuestCartCapabilityActive(consumedRecord, now)).toBe(false)
    })
  })

  describe("lookupGuestCartCapabilityByPresentedToken (exact token semantics)", () => {
    const validMint = mintGuestCartCapabilityInMemory(
      { cart_id: "cart_valid" },
      { id: "gccap_valid", now: clock.now(), randomBytesFn: entropy.randomBytesFn }
    )

    it("resolves record on exact valid token presentation", async () => {
      const record = await lookupGuestCartCapabilityByPresentedToken(
        validMint.plaintext_token,
        {
          listByHash: async (hash) => {
            if (hash === validMint.record.token_hash) {
              return validMint.record
            }
            return null
          },
          now: clock.now(),
        }
      )

      expect(record.id).toBe(validMint.record.id)
      expect(record.cart_id).toBe("cart_valid")
    })

    it("rejects token with whitespace padding (NO trim normalization)", async () => {
      // Must NOT normalize or trim
      await expect(
        lookupGuestCartCapabilityByPresentedToken(` ${validMint.plaintext_token}`, {
          listByHash: async (hash) => {
            if (hash === validMint.record.token_hash) {
              return validMint.record
            }
            return null
          },
          now: clock.now(),
        })
      ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)

      await expect(
        lookupGuestCartCapabilityByPresentedToken(`${validMint.plaintext_token} `, {
          listByHash: async (hash) => {
            if (hash === validMint.record.token_hash) {
              return validMint.record
            }
            return null
          },
          now: clock.now(),
        })
      ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    })

    it("throws uniform GUEST_CART_CAPABILITY_LOOKUP_INVALID on missing or empty token", async () => {
      await expect(
        lookupGuestCartCapabilityByPresentedToken("", {
          listByHash: async () => validMint.record,
          now: clock.now(),
        })
      ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    })

    it("throws uniform GUEST_CART_CAPABILITY_LOOKUP_INVALID on unknown token hash (miss)", async () => {
      await expect(
        lookupGuestCartCapabilityByPresentedToken("unknown_token_that_does_not_exist_in_db", {
          listByHash: async () => null,
          now: clock.now(),
        })
      ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    })

    it("throws uniform GUEST_CART_CAPABILITY_LOOKUP_INVALID on expired record", async () => {
      const expiredRecord = {
        ...validMint.record,
        expires_at: new Date(clock.nowMs() - 1000).toISOString(),
      }

      await expect(
        lookupGuestCartCapabilityByPresentedToken(validMint.plaintext_token, {
          listByHash: async () => expiredRecord,
          now: clock.now(),
        })
      ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    })

    it("throws uniform GUEST_CART_CAPABILITY_LOOKUP_INVALID on revoked or consumed record", async () => {
      const revokedRecord = {
        ...validMint.record,
        status: GUEST_CART_CAPABILITY_STATUS.REVOKED,
        revoked_at: clock.now().toISOString(),
      }

      await expect(
        lookupGuestCartCapabilityByPresentedToken(validMint.plaintext_token, {
          listByHash: async () => revokedRecord,
          now: clock.now(),
        })
      ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)

      const consumedRecord = {
        ...validMint.record,
        status: GUEST_CART_CAPABILITY_STATUS.CONSUMED,
        consumed_at: clock.now().toISOString(),
      }

      await expect(
        lookupGuestCartCapabilityByPresentedToken(validMint.plaintext_token, {
          listByHash: async () => consumedRecord,
          now: clock.now(),
        })
      ).rejects.toThrow(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
    })
  })

  describe("GuestCartCapabilityModuleService persistent methods", () => {
    function createServiceInstance(): GuestCartCapabilityModuleService {
      const service = Object.create(GuestCartCapabilityModuleService.prototype)
      return service
    }

    it("mintGuestCartCapability delegates to createGuestCartCapabilities and returns plaintextToken", async () => {
      const service = createServiceInstance()
      const mockCreated = {
        id: "gccap_mock_1",
        cart_id: "cart_mock_1",
        token_hash: "mock_hash_1",
        status: GUEST_CART_CAPABILITY_STATUS.ACTIVE,
        expires_at: new Date(Date.now() + 7 * 86400 * 1000),
        consumed_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      }

      ;(service as any).createGuestCartCapabilities = jest.fn().mockResolvedValue([mockCreated])

      const result = await service.mintGuestCartCapability({
        cart_id: "cart_mock_1",
        now: clock.now(),
        randomBytesFn: entropy.randomBytesFn,
      })

      expect(result.plaintext_token).toHaveLength(43)
      expect(result.record).toEqual(mockCreated)
      expect((service as any).createGuestCartCapabilities).toHaveBeenCalledTimes(1)
    })

    it("lookupGuestCartCapabilityByPresentedToken performs persistent touch", async () => {
      const service = createServiceInstance()
      const validMint = mintGuestCartCapabilityInMemory(
        { cart_id: "cart_touch_mock" },
        { id: "gccap_touch_mock", now: clock.now(), randomBytesFn: entropy.randomBytesFn }
      )

      const touchedRecord = {
        ...validMint.record,
        last_used_at: clock.now().toISOString(),
        expires_at: computeRollingExpiresAt(validMint.record.created_at, clock.now()).toISOString(),
      }

      ;(service as any).listGuestCartCapabilities = jest.fn().mockResolvedValue([validMint.record])
      ;(service as any).updateGuestCartCapabilities = jest.fn().mockResolvedValue([touchedRecord])

      const result = await service.lookupGuestCartCapabilityByPresentedToken(
        validMint.plaintext_token,
        { now: clock.now(), touch: true }
      )

      expect(result.id).toBe(validMint.record.id)
      expect((service as any).updateGuestCartCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({
          id: validMint.record.id,
          last_used_at: clock.now(),
        }),
        undefined
      )
    })

    it("consumeGuestCartCapability updates status to consumed and records consumed_at", async () => {
      const service = createServiceInstance()
      const consumedRecord = {
        id: "gccap_c1",
        status: GUEST_CART_CAPABILITY_STATUS.CONSUMED,
        consumed_at: clock.now(),
      }

      ;(service as any).updateGuestCartCapabilities = jest.fn().mockResolvedValue([consumedRecord])

      const result = await service.consumeGuestCartCapability("gccap_c1", { now: clock.now() })
      expect(result.status).toBe(GUEST_CART_CAPABILITY_STATUS.CONSUMED)
      expect((service as any).updateGuestCartCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "gccap_c1",
          status: GUEST_CART_CAPABILITY_STATUS.CONSUMED,
          consumed_at: clock.now(),
        }),
        undefined
      )
    })

    it("revokeGuestCartCapability updates status to revoked and records revoked_at", async () => {
      const service = createServiceInstance()
      const revokedRecord = {
        id: "gccap_r1",
        status: GUEST_CART_CAPABILITY_STATUS.REVOKED,
        revoked_at: clock.now(),
      }

      ;(service as any).updateGuestCartCapabilities = jest.fn().mockResolvedValue([revokedRecord])

      const result = await service.revokeGuestCartCapability("gccap_r1", { now: clock.now() })
      expect(result.status).toBe(GUEST_CART_CAPABILITY_STATUS.REVOKED)
      expect((service as any).updateGuestCartCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "gccap_r1",
          status: GUEST_CART_CAPABILITY_STATUS.REVOKED,
          revoked_at: clock.now(),
        }),
        undefined
      )
    })
  })
})
