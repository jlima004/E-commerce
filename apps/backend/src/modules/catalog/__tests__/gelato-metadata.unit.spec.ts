import {
  GelatoMetadataError,
  assertSellableVariantMetadata,
  isSellableVariant,
  readGelatoMetadata,
} from "../gelato-metadata"
import type { CatalogVariantInput } from "../types"

const COMPLETE_GELATO_METADATA = {
  gelato_product_uid: "prod_gelato_abc123",
  gelato_template_id: "template_fixed_001",
  gelato_variant_options: {
    size: "M",
    color: "black",
  },
  template_mode: "fixed",
} as const

function variant(
  overrides: Partial<CatalogVariantInput> = {}
): CatalogVariantInput {
  return {
    id: "variant_01",
    sku: "TSH-M-BLK",
    metadata: { ...COMPLETE_GELATO_METADATA },
    prices: [{ currency_code: "brl", amount: 99 }],
    ...overrides,
  }
}

describe("readGelatoMetadata", () => {
  describe("parse complete metadata", () => {
    it("parse returns the canonical Gelato contract for complete variant metadata", () => {
      const result = readGelatoMetadata(variant())

      expect(result.status).toBe("complete")
      expect(result.data).toEqual(COMPLETE_GELATO_METADATA)
    })
  })

  describe("parse missing or incomplete metadata", () => {
    it("parse marks metadata as incomplete when gelato fields are absent", () => {
      const result = readGelatoMetadata(
        variant({
          metadata: {},
        })
      )

      expect(result.status).toBe("incomplete")
      expect(result.missing).toEqual(
        expect.arrayContaining([
          "gelato_product_uid",
          "gelato_template_id",
          "gelato_variant_options",
          "template_mode",
        ])
      )
    })

    it("parse marks metadata as incomplete when only a subset of required fields is present", () => {
      const result = readGelatoMetadata(
        variant({
          metadata: {
            gelato_product_uid: "prod_gelato_abc123",
          },
        })
      )

      expect(result.status).toBe("incomplete")
      expect(result.missing).toEqual(
        expect.arrayContaining([
          "gelato_template_id",
          "gelato_variant_options",
          "template_mode",
        ])
      )
    })

    it("parse treats null metadata as incomplete draft", () => {
      const result = readGelatoMetadata(
        variant({
          metadata: null,
        })
      )

      expect(result.status).toBe("incomplete")
      expect(result.missing.length).toBeGreaterThan(0)
    })
  })

  describe("parse template_mode and variant options", () => {
    it("parse rejects non-fixed template_mode as incomplete", () => {
      const result = readGelatoMetadata(
        variant({
          metadata: {
            ...COMPLETE_GELATO_METADATA,
            template_mode: "dynamic",
          },
        })
      )

      expect(result.status).toBe("incomplete")
      expect(result.missing).toContain("template_mode")
    })

    it("parse marks empty gelato_variant_options as incomplete", () => {
      const result = readGelatoMetadata(
        variant({
          metadata: {
            ...COMPLETE_GELATO_METADATA,
            gelato_variant_options: {},
          },
        })
      )

      expect(result.status).toBe("incomplete")
      expect(result.missing).toEqual(
        expect.arrayContaining(["gelato_variant_options.size", "gelato_variant_options.color"])
      )
    })
  })
})

describe("isSellableVariant", () => {
  it("sellable returns true only for complete metadata with valid BRL major units", () => {
    expect(isSellableVariant(variant())).toBe(true)
  })

  it("sellable returns false for incomplete draft metadata", () => {
    expect(
      isSellableVariant(
        variant({
          metadata: {
            gelato_product_uid: "prod_gelato_abc123",
          },
        })
      )
    ).toBe(false)
  })

  it("sellable returns false when template_mode is not fixed", () => {
    expect(
      isSellableVariant(
        variant({
          metadata: {
            ...COMPLETE_GELATO_METADATA,
            template_mode: "dynamic",
          },
        })
      )
    ).toBe(false)
  })

  it("sellable returns false when gelato_variant_options are empty", () => {
    expect(
      isSellableVariant(
        variant({
          metadata: {
            ...COMPLETE_GELATO_METADATA,
            gelato_variant_options: { size: "", color: "black" },
          },
        })
      )
    ).toBe(false)
  })

  describe("BRL price in major units", () => {
    it.each([99, 99.9, 0.01, 49.5, 9900])(
      "sellable accepts positive BRL major amount %s with at most two decimals",
      (amount) => {
        expect(
          isSellableVariant(
            variant({
              prices: [{ currency_code: "brl", amount }],
            })
          )
        ).toBe(true)
      }
    )

    it.each([0, -1, 99.999, Number.NaN, Number.POSITIVE_INFINITY])(
      "sellable rejects invalid BRL major amount %s",
      (amount) => {
        expect(
          isSellableVariant(
            variant({
              prices: [{ currency_code: "brl", amount }],
            })
          )
        ).toBe(false)
      }
    )

    it("sellable rejects missing BRL price", () => {
      expect(
        isSellableVariant(
          variant({
            prices: [{ currency_code: "usd", amount: 99 }],
          })
        )
      ).toBe(false)
    })
  })
})

describe("assertSellableVariantMetadata typed errors", () => {
  it("required fields throw stable typed errors for incomplete draft metadata", () => {
    try {
      assertSellableVariantMetadata(
        variant({
          metadata: {},
        })
      )
      throw new Error("Expected assertSellableVariantMetadata to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(GelatoMetadataError)
      expect((error as GelatoMetadataError).code).toBe("GELATO_METADATA_INCOMPLETE")
      expect((error as GelatoMetadataError).toPayload()).toEqual({
        code: "GELATO_METADATA_INCOMPLETE",
        missing: expect.arrayContaining([
          "gelato_product_uid",
          "gelato_template_id",
          "gelato_variant_options",
          "template_mode",
        ]),
      })
      expect((error as GelatoMetadataError).toPayload()).not.toHaveProperty("stack")
    }
  })

  it("typed error distinguishes draft incomplete from sellable-invalid template_mode", () => {
    try {
      assertSellableVariantMetadata(
        variant({
          metadata: {
            ...COMPLETE_GELATO_METADATA,
            template_mode: "dynamic",
          },
        })
      )
      throw new Error("Expected assertSellableVariantMetadata to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(GelatoMetadataError)
      expect((error as GelatoMetadataError).code).toBe("GELATO_TEMPLATE_MODE_INVALID")
      expect((error as GelatoMetadataError).toPayload()).toEqual({
        code: "GELATO_TEMPLATE_MODE_INVALID",
        expected: "fixed",
        received: "dynamic",
      })
    }
  })

  it("typed error reports invalid BRL price without exposing raw stack traces", () => {
    try {
      assertSellableVariantMetadata(
        variant({
          prices: [{ currency_code: "brl", amount: 99.999 }],
        })
      )
      throw new Error("Expected assertSellableVariantMetadata to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(GelatoMetadataError)
      expect((error as GelatoMetadataError).code).toBe("GELATO_PRICE_INVALID")
      expect((error as GelatoMetadataError).toPayload()).toEqual({
        code: "GELATO_PRICE_INVALID",
        currency_code: "brl",
        reason: "amount_must_be_positive_major_units_with_at_most_two_decimals",
      })
      expect((error as GelatoMetadataError).toPayload()).not.toHaveProperty("stack")
    }
  })

  it("does not throw for sellable variant metadata", () => {
    expect(() => assertSellableVariantMetadata(variant())).not.toThrow()
  })
})
