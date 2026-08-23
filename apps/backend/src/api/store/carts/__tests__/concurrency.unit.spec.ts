import { MedusaError } from "@medusajs/framework/utils"
import {
  CartVersionMismatchError,
  formatCartEtag,
  parseIfMatchHeader,
  requireIfMatch,
} from "../concurrency"
import {
  isPublicStoreCartPreOrderSnapshot,
  STORE_ERROR_CODES,
  toStoreErrorResponse,
} from "../../../store-surface/errors"
import type { StoreCartPreOrderRecord, PublicStoreCartPreOrder } from "../serializers"

describe("Store Cart Concurrency Primitives (CART-07/08)", () => {
  describe("formatCartEtag", () => {
    it("formats positive integers into quoted strings", () => {
      expect(formatCartEtag(1)).toBe('"1"')
      expect(formatCartEtag(42)).toBe('"42"')
      expect(formatCartEtag(999999)).toBe('"999999"')
    })

    it("throws on invalid or non-positive version values", () => {
      expect(() => formatCartEtag(0)).toThrow("CART_VERSION_INVALID")
      expect(() => formatCartEtag(-1)).toThrow("CART_VERSION_INVALID")
      expect(() => formatCartEtag(1.5)).toThrow("CART_VERSION_INVALID")
      expect(() => formatCartEtag(NaN)).toThrow("CART_VERSION_INVALID")
      expect(() => formatCartEtag(Infinity)).toThrow("CART_VERSION_INVALID")
    })
  })

  describe("parseIfMatchHeader", () => {
    it("accepts valid quoted positive integers", () => {
      expect(parseIfMatchHeader('"1"')).toBe(1)
      expect(parseIfMatchHeader('"42"')).toBe(42)
      expect(parseIfMatchHeader('  "100"  ')).toBe(100)
    })

    it("rejects weak ETags", () => {
      expect(parseIfMatchHeader('W/"1"')).toBeNull()
      expect(parseIfMatchHeader('w/"1"')).toBeNull()
      expect(parseIfMatchHeader('W/"42"')).toBeNull()
    })

    it("rejects unquoted tokens", () => {
      expect(parseIfMatchHeader("1")).toBeNull()
      expect(parseIfMatchHeader("42")).toBeNull()
      expect(parseIfMatchHeader("cart_version_1")).toBeNull()
    })

    it("rejects non-integer or negative or zero versions", () => {
      expect(parseIfMatchHeader('"0"')).toBeNull()
      expect(parseIfMatchHeader('"-1"')).toBeNull()
      expect(parseIfMatchHeader('"1.5"')).toBeNull()
      expect(parseIfMatchHeader('"abc"')).toBeNull()
      expect(parseIfMatchHeader('""')).toBeNull()
      expect(parseIfMatchHeader('" "')).toBeNull()
    })

    it("rejects non-string inputs or empty strings", () => {
      expect(parseIfMatchHeader(null)).toBeNull()
      expect(parseIfMatchHeader(undefined)).toBeNull()
      expect(parseIfMatchHeader("")).toBeNull()
      expect(parseIfMatchHeader("   ")).toBeNull()
      expect(parseIfMatchHeader(123)).toBeNull()
      expect(parseIfMatchHeader({})).toBeNull()
    })
  })

  describe("requireIfMatch", () => {
    it("returns parsed integer when If-Match header is present and valid", () => {
      expect(requireIfMatch({ headers: { "if-match": '"1"' } })).toBe(1)
      expect(requireIfMatch({ headers: { "If-Match": '"42"' } })).toBe(42)
    })

    it("throws MedusaError INVALID_DATA when If-Match is missing or malformed", () => {
      expect(() => requireIfMatch({ headers: {} })).toThrow(MedusaError)
      expect(() => requireIfMatch({ headers: { "if-match": "1" } })).toThrow(
        MedusaError
      )
      expect(() => requireIfMatch({ headers: { "if-match": 'W/"1"' } })).toThrow(
        MedusaError
      )
    })
  })

  describe("CartVersionMismatchError and 412 snapshot", () => {
    const mockCartRecord: StoreCartPreOrderRecord = {
      id: "cart_01HXYZ",
      currency_code: "brl",
      email: "buyer@example.com",
      created_at: "2026-08-19T00:00:00.000Z",
      updated_at: "2026-08-19T00:00:00.000Z",
      total: 10000,
      subtotal: 10000,
      item_total: 10000,
      shipping_total: 0,
      tax_total: 0,
      discount_total: 0,
      items: [
        {
          id: "item_01",
          quantity: 2,
          title: "Camiseta Preta G",
          unit_price: 5000,
        },
      ],
      shipping_address: {
        first_name: "João",
        last_name: "Silva",
        address_1: "Rua A, 100",
        city: "São Paulo",
        province: "SP",
        postal_code: "01001-000",
        country_code: "br",
        metadata: {
          federal_tax_id: "529.982.247-25",
        },
      },
    }

    it("constructs CartVersionMismatchError with serialized cart snapshot and ETag", () => {
      const error = new CartVersionMismatchError(mockCartRecord, 3)
      expect(error.code).toBe("CART_VERSION_MISMATCH")
      expect(error.statusCode).toBe(412)
      expect(error.currentVersion).toBe(3)
      expect(error.currentEtag).toBe('"3"')
      expect(error.cart).toBeDefined()
      expect(error.cart?.id).toBe("cart_01HXYZ")
      expect(error.cart?.shipping_address?.masked_federal_tax_id).toBe(
        "***.***.***-25"
      )
      expect(isPublicStoreCartPreOrderSnapshot(error.cart)).toBe(true)
    })

    it("maps to 412 CART_VERSION_MISMATCH with allowlisted cart snapshot in toStoreErrorResponse", () => {
      const error = new CartVersionMismatchError(mockCartRecord, 2)
      const normalized = toStoreErrorResponse(error, {
        correlationId: "corr_412_mismatch",
      })

      expect(normalized.statusCode).toBe(412)
      expect(normalized.body.code).toBe(STORE_ERROR_CODES.CART_VERSION_MISMATCH)
      expect(normalized.body.retryable).toBe(false)
      expect(normalized.body.cart).toBeDefined()
      expect(normalized.body.cart?.id).toBe("cart_01HXYZ")
      expect(normalized.body.cart?.checkout_data_complete).toBeDefined()
      expect(normalized.body).not.toHaveProperty("guest_cart_token")
      expect(normalized.body).not.toHaveProperty("version")
      expect(normalized.body.cart).not.toHaveProperty("guest_cart_token")
      expect(normalized.body.cart).not.toHaveProperty("version")
      expect(normalized.body.cart).not.toHaveProperty("capability")
    })

    it("rejects snapshots containing forbidden fields in isPublicStoreCartPreOrderSnapshot", () => {
      const validSnapshot: PublicStoreCartPreOrder = {
        id: "cart_01HXYZ",
        email: "guest@example.com",
        currency_code: "brl",
        locale: "pt-BR",
        total: 10000,
        subtotal: 10000,
        item_total: 10000,
        shipping_total: 0,
        tax_total: 0,
        discount_total: 0,
        region_id: null,
        created_at: "2026-08-19T00:00:00.000Z",
        updated_at: "2026-08-19T00:00:00.000Z",
        checkout_data_complete: false,
        customer: null,
        items: [],
        shipping_address: null,
      }

      expect(isPublicStoreCartPreOrderSnapshot(validSnapshot)).toBe(true)

      // Leaking version
      expect(
        isPublicStoreCartPreOrderSnapshot({
          ...validSnapshot,
          version: 2,
        })
      ).toBe(false)

      // Leaking guest capability
      expect(
        isPublicStoreCartPreOrderSnapshot({
          ...validSnapshot,
          guest_cart_token: "secret_token",
        })
      ).toBe(false)

      // Leaking capability
      expect(
        isPublicStoreCartPreOrderSnapshot({
          ...validSnapshot,
          capability: "cap_123",
        })
      ).toBe(false)
    })
  })
})
