import {
  GelatoMetadataError,
  GELATO_TEMPLATE_MODE_FIXED,
} from "../gelato-metadata"
import {
  buildGelatoSnapshot,
  type BuildGelatoSnapshotInput,
  type GelatoSnapshot,
} from "../gelato-snapshot"

const COMPLETE_GELATO_METADATA = {
  gelato_product_uid: "prod_gelato_abc123",
  gelato_template_id: "template_fixed_001",
  gelato_variant_options: {
    size: "M",
    color: "black",
  },
  template_mode: GELATO_TEMPLATE_MODE_FIXED,
} as const

function variant(
  overrides: Partial<BuildGelatoSnapshotInput> = {}
): BuildGelatoSnapshotInput {
  return {
    id: "variant_01",
    sku: "TSH-M-BLK",
    metadata: { ...COMPLETE_GELATO_METADATA },
    prices: [{ currency_code: "brl", amount: 9900 }],
    ...overrides,
  }
}

describe("buildGelatoSnapshot", () => {
  it("builds the canonical immutable snapshot from a validated variant with id and sku", () => {
    const capturedAt = "2026-06-27T10:30:00.000Z"

    const snapshot = buildGelatoSnapshot(variant(), {
      capturedAt,
    })

    expect(snapshot).toEqual({
      gelato_product_uid: "prod_gelato_abc123",
      gelato_template_id: "template_fixed_001",
      gelato_variant_options: {
        size: "M",
        color: "black",
      },
      template_mode: GELATO_TEMPLATE_MODE_FIXED,
      source_product_variant_id: "variant_01",
      source_product_variant_sku: "TSH-M-BLK",
      captured_at: capturedAt,
    } satisfies GelatoSnapshot)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.gelato_variant_options)).toBe(true)
  })

  it("generates captured_at when one is not provided", () => {
    const snapshot = buildGelatoSnapshot(variant())

    expect(snapshot.captured_at).toEqual(expect.any(String))
    expect(new Date(snapshot.captured_at).toISOString()).toBe(snapshot.captured_at)
  })

  it("keeps the built snapshot immutable even if the source variant changes later", () => {
    const input = variant()
    const snapshot = buildGelatoSnapshot(input, {
      capturedAt: "2026-06-27T11:45:00.000Z",
    })

    input.sku = "TSH-L-WHT"
    input.metadata = {
      ...input.metadata,
      gelato_template_id: "template_fixed_999",
      gelato_variant_options: {
        size: "L",
        color: "white",
      },
    }

    expect(snapshot).toEqual({
      gelato_product_uid: "prod_gelato_abc123",
      gelato_template_id: "template_fixed_001",
      gelato_variant_options: {
        size: "M",
        color: "black",
      },
      template_mode: GELATO_TEMPLATE_MODE_FIXED,
      source_product_variant_id: "variant_01",
      source_product_variant_sku: "TSH-M-BLK",
      captured_at: "2026-06-27T11:45:00.000Z",
    } satisfies GelatoSnapshot)
  })

  it("throws a typed error instead of returning a partial snapshot when metadata is missing", () => {
    expect(() =>
      buildGelatoSnapshot(
        variant({
          metadata: {},
        })
      )
    ).toThrow(GelatoMetadataError)

    try {
      buildGelatoSnapshot(
        variant({
          metadata: {},
        })
      )
      throw new Error("Expected buildGelatoSnapshot to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(GelatoMetadataError)
      expect((error as GelatoMetadataError).toPayload()).toEqual({
        code: "GELATO_METADATA_INCOMPLETE",
        missing: expect.arrayContaining([
          "gelato_product_uid",
          "gelato_template_id",
          "gelato_variant_options",
          "template_mode",
        ]),
      })
    }
  })

  it("throws a typed error when metadata is invalid and never emits a snapshot fragment", () => {
    try {
      buildGelatoSnapshot(
        variant({
          metadata: {
            ...COMPLETE_GELATO_METADATA,
            template_mode: "dynamic",
          },
        })
      )
      throw new Error("Expected buildGelatoSnapshot to throw")
    } catch (error) {
      expect(error).toBeInstanceOf(GelatoMetadataError)
      expect((error as GelatoMetadataError).toPayload()).toEqual({
        code: "GELATO_TEMPLATE_MODE_INVALID",
        expected: GELATO_TEMPLATE_MODE_FIXED,
        received: "dynamic",
      })
    }
  })

  it("throws a typed error when variant id or sku is absent", () => {
    expect(() =>
      buildGelatoSnapshot(
        variant({
          id: undefined,
        })
      )
    ).toThrow("GELATO_SNAPSHOT_SOURCE_VARIANT_ID_MISSING")

    expect(() =>
      buildGelatoSnapshot(
        variant({
          sku: undefined,
        })
      )
    ).toThrow("GELATO_SNAPSHOT_SOURCE_VARIANT_SKU_MISSING")
  })
})
