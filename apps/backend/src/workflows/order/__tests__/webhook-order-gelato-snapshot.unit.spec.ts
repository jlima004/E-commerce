import {
  OrderLineItemGelatoSnapshotError,
  buildOrderLineItemGelatoSnapshots,
} from "../steps/build-order-line-item-gelato-snapshots"

const EXACT_GELATO_SNAPSHOT_KEYS = [
  "gelato_product_uid",
  "gelato_template_id",
  "gelato_variant_options",
  "template_mode",
  "source_product_variant_id",
  "source_product_variant_sku",
  "captured_at",
]

function buildItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "line_item_01",
    metadata: {
      custom_flag: true,
    },
    variant: {
      id: "variant_01",
      sku: "SKU-01",
      metadata: {
        gelato_product_uid: "gelato_prod_01",
        gelato_template_id: "tmpl_01",
        gelato_variant_options: {
          size: "M",
          color: "Preto",
        },
        template_mode: "fixed",
      },
      prices: [
        {
          amount: 99,
          currency_code: "brl",
        },
      ],
    },
    ...overrides,
  }
}

describe("buildOrderLineItemGelatoSnapshots", () => {
  it("edge multi-line gera snapshot canonico v1, captured_at unico e preserva metadata existente", () => {
    const patches = buildOrderLineItemGelatoSnapshots({
      items: [
        buildItem(),
        buildItem({
          id: "line_item_02",
          metadata: {
            safe_note: "preservar",
            custom_flag: false,
          },
          variant: {
            id: "variant_02",
            sku: "SKU-02",
            metadata: {
              gelato_product_uid: "gelato_prod_02",
              gelato_template_id: "tmpl_02",
              gelato_variant_options: {
                size: "G",
                color: "Branco",
              },
              template_mode: "fixed",
            },
            prices: [
              {
                amount: 109,
                currency_code: "brl",
              },
            ],
          },
        }),
      ],
      captured_at: "2026-06-30T15:00:00.000Z",
    })

    expect(patches).toHaveLength(2)
    expect(patches[0]).toEqual({
      id: "line_item_01",
      metadata: expect.objectContaining({
        custom_flag: true,
        gelato_snapshot: {
          gelato_product_uid: "gelato_prod_01",
          gelato_template_id: "tmpl_01",
          gelato_variant_options: {
            size: "M",
            color: "Preto",
          },
          template_mode: "fixed",
          source_product_variant_id: "variant_01",
          source_product_variant_sku: "SKU-01",
          captured_at: "2026-06-30T15:00:00.000Z",
        },
      }),
      gelato_snapshot: expect.objectContaining({
        captured_at: "2026-06-30T15:00:00.000Z",
      }),
    })
    expect(patches[0]?.gelato_snapshot.captured_at).toBe(
      patches[1]?.gelato_snapshot.captured_at
    )
    expect(Object.keys(patches[0]?.gelato_snapshot ?? {})).toEqual(
      EXACT_GELATO_SNAPSHOT_KEYS
    )
    expect(
      Object.keys(patches[0]?.gelato_snapshot.gelato_variant_options ?? {})
    ).toEqual(["size", "color"])
    expect(patches[1]?.metadata).toEqual(
      expect.objectContaining({
        safe_note: "preservar",
        custom_flag: false,
        gelato_snapshot: expect.objectContaining({
          source_product_variant_id: "variant_02",
          source_product_variant_sku: "SKU-02",
        }),
      })
    )
  })

  it("edge falha sem variant carregada", () => {
    expect(() =>
      buildOrderLineItemGelatoSnapshots({
        items: [buildItem({ variant: null })],
        captured_at: "2026-06-30T15:00:00.000Z",
      })
    ).toThrow(OrderLineItemGelatoSnapshotError)

    expect(() =>
      buildOrderLineItemGelatoSnapshots({
        items: [buildItem({ variant: null })],
        captured_at: "2026-06-30T15:00:00.000Z",
      })
    ).toThrow("variant carregada")
  })

  it("edge falha sanitizada quando SKU esta ausente", () => {
    expect(() =>
      buildOrderLineItemGelatoSnapshots({
        items: [
          buildItem({
            variant: {
              id: "variant_01",
              sku: " ",
              metadata: {
                gelato_product_uid: "gelato_prod_01",
                gelato_template_id: "tmpl_01",
                gelato_variant_options: {
                  size: "M",
                  color: "Preto",
                },
                template_mode: "fixed",
              },
              prices: [
                {
                  amount: 99,
                  currency_code: "brl",
                },
              ],
            },
          }),
        ],
        captured_at: "2026-06-30T15:00:00.000Z",
      })
    ).toThrow("Nao foi possivel gerar o snapshot Gelato")

    try {
      buildOrderLineItemGelatoSnapshots({
        items: [
          buildItem({
            variant: {
              id: "variant_01",
              sku: " ",
              metadata: {
                gelato_product_uid: "gelato_prod_01",
                gelato_template_id: "tmpl_01",
                gelato_variant_options: {
                  size: "M",
                  color: "Preto",
                },
                template_mode: "fixed",
              },
              prices: [
                {
                  amount: 99,
                  currency_code: "brl",
                },
              ],
            },
          }),
        ],
        captured_at: "2026-06-30T15:00:00.000Z",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(OrderLineItemGelatoSnapshotError)
      expect((error as OrderLineItemGelatoSnapshotError).code).toBe(
        "ORDER_GELATO_SNAPSHOT_SOURCE_VARIANT_SKU_MISSING"
      )
      expect((error as Error).message).not.toContain("SKU-")
    }
  })

  it("edge falha sanitizada quando metadata Gelato e invalida", () => {
    expect(() =>
      buildOrderLineItemGelatoSnapshots({
        items: [
          buildItem({
            variant: {
              id: "variant_01",
              sku: "SKU-01",
              metadata: {
                gelato_product_uid: "gelato_prod_01",
                gelato_template_id: "tmpl_01",
                gelato_variant_options: "M/Preto",
                template_mode: "fixed",
              },
              prices: [
                {
                  amount: 99,
                  currency_code: "brl",
                },
              ],
            },
          }),
        ],
        captured_at: "2026-06-30T15:00:00.000Z",
      })
    ).toThrow("Nao foi possivel gerar o snapshot Gelato")
  })

  it("edge falha sanitizada quando captured_at e invalido", () => {
    expect(() =>
      buildOrderLineItemGelatoSnapshots({
        items: [buildItem()],
        captured_at: "2026-06-30 15:00:00",
      })
    ).toThrow("Nao foi possivel gerar o snapshot Gelato")

    try {
      buildOrderLineItemGelatoSnapshots({
        items: [buildItem()],
        captured_at: "2026-06-30 15:00:00",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(OrderLineItemGelatoSnapshotError)
      expect((error as OrderLineItemGelatoSnapshotError).code).toBe(
        "ORDER_GELATO_SNAPSHOT_CAPTURED_AT_INVALID"
      )
    }
  })
})
