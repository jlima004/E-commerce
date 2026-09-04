import {
  ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY,
  CartOrderBirthMarkerConflictError,
  inspectCartOrderBirthMarker,
  validateOrderBirthMarkerOnOrder,
  ensureCartOrderBirthMarkerDurable,
} from "../order-birth-marker"

describe("Order Birth Marker (Subagent C)", () => {
  describe("canonical key", () => {
    it("is exactly 'order_birth_checkout_completion_log_id'", () => {
      expect(ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY).toBe(
        "order_birth_checkout_completion_log_id"
      )
    })
  })

  describe("inspectCartOrderBirthMarker", () => {
    it("returns 'absent' when cart has no metadata or key is missing", () => {
      expect(inspectCartOrderBirthMarker(null, "chkcpl_01")).toEqual({
        state: "absent",
      })
      expect(inspectCartOrderBirthMarker({}, "chkcpl_01")).toEqual({
        state: "absent",
      })
      expect(
        inspectCartOrderBirthMarker({ metadata: {} }, "chkcpl_01")
      ).toEqual({ state: "absent" })
      expect(
        inspectCartOrderBirthMarker(
          { metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: null } },
          "chkcpl_01"
        )
      ).toEqual({ state: "absent" })
    })

    it("returns 'matches' when cart metadata has exact matching cclId", () => {
      const result = inspectCartOrderBirthMarker(
        {
          metadata: {
            [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: "chkcpl_exact_01",
          },
        },
        "chkcpl_exact_01"
      )
      expect(result).toEqual({ state: "matches", cclId: "chkcpl_exact_01" })
    })

    it("returns 'conflict' when cart metadata has a different cclId", () => {
      const result = inspectCartOrderBirthMarker(
        {
          metadata: {
            [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: "chkcpl_DIFFERENT_02",
          },
        },
        "chkcpl_exact_01"
      )
      expect(result).toEqual({
        state: "conflict",
        existingCclId: "chkcpl_DIFFERENT_02",
      })
    })
  })

  describe("validateOrderBirthMarkerOnOrder", () => {
    it("returns true only when order metadata contains exact CCL ID", () => {
      expect(
        validateOrderBirthMarkerOnOrder(
          {
            id: "order_01",
            metadata: {
              [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: "chkcpl_target_01",
            },
          },
          "chkcpl_target_01"
        )
      ).toBe(true)
    })

    it("returns false if order metadata has different marker or is missing", () => {
      expect(
        validateOrderBirthMarkerOnOrder(
          {
            id: "order_01",
            metadata: {
              [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: "chkcpl_OTHER",
            },
          },
          "chkcpl_target_01"
        )
      ).toBe(false)

      expect(
        validateOrderBirthMarkerOnOrder(
          { id: "order_01", metadata: {} },
          "chkcpl_target_01"
        )
      ).toBe(false)

      expect(validateOrderBirthMarkerOnOrder(null, "chkcpl_target_01")).toBe(
        false
      )
    })
  })

  describe("ensureCartOrderBirthMarkerDurable", () => {
    it("persists marker via cartModule when absent", async () => {
      let updatedPayload: any = null
      const mockCartModule = {
        retrieveCart: jest.fn().mockResolvedValue({
          id: "cart_01",
          metadata: { existing_key: "value" },
        }),
        updateCarts: jest.fn().mockImplementation((cartId, data) => {
          updatedPayload = { cartId, data }
          return Promise.resolve()
        }),
      }

      const mockContainer = {
        resolve: jest.fn().mockReturnValue(mockCartModule),
      }

      await ensureCartOrderBirthMarkerDurable(
        mockContainer as any,
        "cart_01",
        "chkcpl_new_01"
      )

      expect(mockCartModule.retrieveCart).toHaveBeenCalledWith("cart_01", {
        select: ["id", "metadata"],
      })
      expect(updatedPayload).toEqual({
        cartId: "cart_01",
        data: {
          metadata: {
            existing_key: "value",
            [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: "chkcpl_new_01",
          },
        },
      })
    })

    it("is idempotent when cart already contains the same marker", async () => {
      const mockCartModule = {
        retrieveCart: jest.fn().mockResolvedValue({
          id: "cart_01",
          metadata: {
            [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: "chkcpl_same_01",
          },
        }),
        updateCarts: jest.fn(),
      }

      const mockContainer = {
        resolve: jest.fn().mockReturnValue(mockCartModule),
      }

      await ensureCartOrderBirthMarkerDurable(
        mockContainer as any,
        "cart_01",
        "chkcpl_same_01"
      )

      expect(mockCartModule.updateCarts).not.toHaveBeenCalled()
    })

    it("fails closed when cart has a conflicting marker", async () => {
      const mockCartModule = {
        retrieveCart: jest.fn().mockResolvedValue({
          id: "cart_01",
          metadata: {
            [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: "chkcpl_OWNER_A",
          },
        }),
        updateCarts: jest.fn(),
      }

      const mockContainer = {
        resolve: jest.fn().mockReturnValue(mockCartModule),
      }

      await expect(
        ensureCartOrderBirthMarkerDurable(
          mockContainer as any,
          "cart_01",
          "chkcpl_OWNER_B"
        )
      ).rejects.toThrow(CartOrderBirthMarkerConflictError)

      expect(mockCartModule.updateCarts).not.toHaveBeenCalled()
    })
  })
})
