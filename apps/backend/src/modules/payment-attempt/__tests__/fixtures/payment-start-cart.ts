import type { StoreCartPreOrderRecord } from "../../../../api/store/carts/serializers"

const VALID_CPF_NORMALIZED = "52998224725"

export function buildCompleteGuestCart(
  overrides: Partial<StoreCartPreOrderRecord> = {}
): StoreCartPreOrderRecord & { total?: number | null } {
  return {
    id: "cart_guest_01",
    email: "guest@exemplo.com",
    currency_code: "brl",
    locale: "pt-BR",
    region_id: "reg_br",
    created_at: "2026-06-27T10:00:00.000Z",
    updated_at: "2026-06-27T10:00:00.000Z",
    metadata: null,
    customer: null,
    total: 99,
    items: [
      {
        id: "item_01",
        quantity: 1,
        title: "Camiseta Essential",
        variant_id: "variant_sellable",
        variant_title: "Preto / M",
        unit_price: 99,
        variant: {
          id: "variant_sellable",
          sku: "TSHIRT-BLACK-M",
          metadata: {
            gelato_product_uid: "prod_gelato_abc123",
            gelato_template_id: "template_fixed_001",
            gelato_variant_options: { size: "M", color: "Preto" },
            template_mode: "fixed",
          },
          prices: [{ currency_code: "brl", amount: 99 }],
        },
      },
    ],
    shipping_address: {
      first_name: "Maria",
      last_name: "Silva",
      company: null,
      address_1: "Rua A, 100",
      address_2: null,
      city: "Sao Paulo",
      postal_code: "01311000",
      country_code: "BR",
      province: "SP",
      phone: "+5511999999999",
      metadata: {
        federal_tax_id: VALID_CPF_NORMALIZED,
      },
    },
    region: {
      countries: [{ iso_2: "br" }],
    },
    ...overrides,
  }
}
