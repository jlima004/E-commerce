import {
  OrderLineItemGelatoSnapshotError,
  buildOrderLineItemGelatoSnapshots,
} from "../steps/build-order-line-item-gelato-snapshots"

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
          amount: 9900,
          currency_code: "brl",
        },
      ],
    },
    ...overrides,
  }
}

describe("buildOrderLineItemGelatoSnapshots", () => {
  it("gera snapshot canonico e preserva metadata existente", () => {
    const patches = buildOrderLineItemGelatoSnapshots({
      items: [buildItem(), buildItem({ id: "line_item_02" })],
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
  })

  it("falha sem variant carregada", () => {
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

  it("sanitiza falha quando faltam dados obrigatorios da variant", () => {
    expect(() =>
      buildOrderLineItemGelatoSnapshots({
        items: [buildItem({ variant: { id: "", sku: "", metadata: {}, prices: [] } })],
        captured_at: "2026-06-30T15:00:00.000Z",
      })
    ).toThrow("Nao foi possivel gerar o snapshot Gelato")
  })
})
