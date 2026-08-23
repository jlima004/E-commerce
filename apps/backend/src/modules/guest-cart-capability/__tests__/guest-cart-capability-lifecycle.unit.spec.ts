import {
  computeInitialExpiresAt,
  computeRollingExpiresAt,
  isGuestCartCapabilityActive,
  isGuestCartCapabilityExpired,
  buildGuestCartCapabilityRecord,
  buildGuestCartCapabilityConsumptionUpdate,
  buildGuestCartCapabilityRevocationUpdate,
  buildGuestCartCapabilityExpiryUpdate,
  buildGuestCartCapabilityTouchRollingUpdate,
  GUEST_CART_CAPABILITY_ROLLING_TTL_MS,
  GUEST_CART_CAPABILITY_ABSOLUTE_TTL_MS,
} from "../service"
import {
  lookupGuestCartCapabilityByPresentedToken,
  GuestCartCapabilityLookupInvalidError,
} from "../lookup"
import {
  GUEST_CART_CAPABILITY_LOOKUP_INVALID,
  GUEST_CART_CAPABILITY_STATUS,
  type GuestCartCapabilityRecord,
} from "../types"
import {
  generateGuestCartCapability,
  hashGuestCartCapability,
} from "../hash"

describe("Guest Cart Capability Lifecycle & TTL (CART-03 / P15-D08)", () => {
  const t0 = new Date("2026-08-19T00:00:00.000Z")

  describe("TTL constants and initial mint", () => {
    it("has 7-day rolling TTL and 30-day absolute cap constants", () => {
      expect(GUEST_CART_CAPABILITY_ROLLING_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
      expect(GUEST_CART_CAPABILITY_ABSOLUTE_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000)
    })

    it("computes initial expires_at exactly 7 days from now", () => {
      const initialExpiresAt = computeInitialExpiresAt(t0)
      expect(initialExpiresAt.getTime() - t0.getTime()).toBe(
        GUEST_CART_CAPABILITY_ROLLING_TTL_MS
      )
      expect(initialExpiresAt.toISOString()).toBe("2026-08-26T00:00:00.000Z")
    })
  })

  describe("Rolling touch (7d rolling capped at created_at + 30d)", () => {
    it("rolls expires_at by 7 days on touch at created_at + 6d", () => {
      const t6d = new Date(t0.getTime() + 6 * 24 * 60 * 60 * 1000)
      const rolled = computeRollingExpiresAt(t0, t6d)
      expect(rolled.getTime() - t6d.getTime()).toBe(
        GUEST_CART_CAPABILITY_ROLLING_TTL_MS
      )
      expect(rolled.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    })

    it("caps rolling expires_at at created_at + 30d when touch is near the 30d boundary", () => {
      const t29d23h = new Date(
        t0.getTime() + (29 * 24 + 23) * 60 * 60 * 1000
      )
      const rolled = computeRollingExpiresAt(t0, t29d23h)
      const maxAllowed = new Date(t0.getTime() + GUEST_CART_CAPABILITY_ABSOLUTE_TTL_MS)

      expect(rolled.getTime()).toBe(maxAllowed.getTime())
      expect(rolled.toISOString()).toBe("2026-09-18T00:00:00.000Z")
    })

    it("builds touch update with updated expires_at and last_used_at", () => {
      const t3d = new Date(t0.getTime() + 3 * 24 * 60 * 60 * 1000)
      const update = buildGuestCartCapabilityTouchRollingUpdate(t0, t3d)
      expect(update.last_used_at).toBe(t3d.toISOString())
      expect(new Date(update.expires_at).getTime() - t3d.getTime()).toBe(
        GUEST_CART_CAPABILITY_ROLLING_TTL_MS
      )
    })
  })

  describe("Expiry and terminal status checks", () => {
    it("detects expired capability when now > expires_at", () => {
      const expiresAt = computeInitialExpiresAt(t0)
      const record = buildGuestCartCapabilityRecord(
        { cart_id: "cart_1", token_hash: "hash_1", expires_at: expiresAt },
        "gccap_1",
        t0
      )

      const beforeExpiry = new Date(t0.getTime() + 6 * 24 * 60 * 60 * 1000)
      expect(isGuestCartCapabilityExpired(record, beforeExpiry)).toBe(false)
      expect(isGuestCartCapabilityActive(record, beforeExpiry)).toBe(true)

      const afterExpiry = new Date(t0.getTime() + 8 * 24 * 60 * 60 * 1000)
      expect(isGuestCartCapabilityExpired(record, afterExpiry)).toBe(true)
      expect(isGuestCartCapabilityActive(record, afterExpiry)).toBe(false)
    })

    it("marks status as consumed and inactive on consumption update", () => {
      const update = buildGuestCartCapabilityConsumptionUpdate(t0)
      expect(update.status).toBe(GUEST_CART_CAPABILITY_STATUS.CONSUMED)
      expect(update.consumed_at).toBe(t0.toISOString())

      const record: GuestCartCapabilityRecord = {
        ...buildGuestCartCapabilityRecord(
          { cart_id: "cart_1", token_hash: "hash_1" },
          "gccap_1",
          t0
        ),
        ...update,
      }
      expect(isGuestCartCapabilityActive(record, t0)).toBe(false)
    })

    it("marks status as revoked and inactive on revocation update", () => {
      const update = buildGuestCartCapabilityRevocationUpdate(t0)
      expect(update.status).toBe(GUEST_CART_CAPABILITY_STATUS.REVOKED)
      expect(update.revoked_at).toBe(t0.toISOString())

      const record: GuestCartCapabilityRecord = {
        ...buildGuestCartCapabilityRecord(
          { cart_id: "cart_1", token_hash: "hash_1" },
          "gccap_1",
          t0
        ),
        ...update,
      }
      expect(isGuestCartCapabilityActive(record, t0)).toBe(false)
    })

    it("marks status as expired on expiry update", () => {
      const update = buildGuestCartCapabilityExpiryUpdate(t0)
      expect(update.status).toBe(GUEST_CART_CAPABILITY_STATUS.EXPIRED)
    })
  })

  describe("Uniform non-enumerating lookup error (FE-CART-002)", () => {
    it("returns identical GuestCartCapabilityLookupInvalidError across miss, expired, revoked, and consumed states", async () => {
      const rawToken = generateGuestCartCapability()
      const tokenHash = hashGuestCartCapability(rawToken)

      const activeRecord = buildGuestCartCapabilityRecord(
        { cart_id: "cart_1", token_hash: tokenHash },
        "gccap_active",
        t0
      )
      const expiredRecord: GuestCartCapabilityRecord = {
        ...activeRecord,
        status: GUEST_CART_CAPABILITY_STATUS.EXPIRED,
        expires_at: new Date(t0.getTime() - 1000).toISOString(),
      }
      const revokedRecord: GuestCartCapabilityRecord = {
        ...activeRecord,
        status: GUEST_CART_CAPABILITY_STATUS.REVOKED,
        revoked_at: t0.toISOString(),
      }
      const consumedRecord: GuestCartCapabilityRecord = {
        ...activeRecord,
        status: GUEST_CART_CAPABILITY_STATUS.CONSUMED,
        consumed_at: t0.toISOString(),
      }

      // Miss
      await expect(
        lookupGuestCartCapabilityByPresentedToken(rawToken, {
          listByHash: async () => null,
          now: t0,
        })
      ).rejects.toThrow(GuestCartCapabilityLookupInvalidError)

      // Expired
      await expect(
        lookupGuestCartCapabilityByPresentedToken(rawToken, {
          listByHash: async () => expiredRecord,
          now: t0,
        })
      ).rejects.toThrow(GuestCartCapabilityLookupInvalidError)

      // Revoked
      await expect(
        lookupGuestCartCapabilityByPresentedToken(rawToken, {
          listByHash: async () => revokedRecord,
          now: t0,
        })
      ).rejects.toThrow(GuestCartCapabilityLookupInvalidError)

      // Consumed
      await expect(
        lookupGuestCartCapabilityByPresentedToken(rawToken, {
          listByHash: async () => consumedRecord,
          now: t0,
        })
      ).rejects.toThrow(GuestCartCapabilityLookupInvalidError)

      // All throw exact same error code
      try {
        await lookupGuestCartCapabilityByPresentedToken(rawToken, {
          listByHash: async () => null,
        })
      } catch (err: any) {
        expect(err.code).toBe(GUEST_CART_CAPABILITY_LOOKUP_INVALID)
      }
    })
  })
})
