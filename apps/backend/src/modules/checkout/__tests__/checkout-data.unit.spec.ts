import {
  calculateCheckoutDataComplete,
  maskFederalTaxId,
  normalizeBrazilPostalCode,
  normalizeBrazilProvince,
  normalizeCheckoutEmail,
  normalizeFederalTaxId,
  validateBrazilShippingAddress,
  type CheckoutDataIncompleteReason,
} from "../checkout-data"
import type { CatalogVariantInput } from "../../catalog/types"

const COMPLETE_GELATO_METADATA = {
  gelato_product_uid: "prod_gelato_abc123",
  gelato_template_id: "template_fixed_001",
  gelato_variant_options: {
    size: "M",
    color: "black",
  },
  template_mode: "fixed",
} as const

function sellableVariant(
  overrides: Partial<CatalogVariantInput> = {}
): CatalogVariantInput {
  return {
    id: "variant_01",
    sku: "TSH-M-BLK",
    metadata: { ...COMPLETE_GELATO_METADATA },
    prices: [{ currency_code: "brl", amount: 9900 }],
    ...overrides,
  }
}

function expectIncomplete(
  result: ReturnType<typeof calculateCheckoutDataComplete>,
  reasons: CheckoutDataIncompleteReason[]
) {
  expect(result.checkout_data_complete).toBe(false)
  expect(result.incomplete_reasons).toEqual(
    expect.arrayContaining(reasons)
  )
}

describe("normalizeCheckoutEmail", () => {
  it("usa customer.email como fonte de verdade quando autenticado", () => {
    expect(
      normalizeCheckoutEmail({
        actorType: "customer",
        customerEmail: "CLIENTE@EXEMPLO.COM  ",
        guestEmail: "guest@exemplo.com",
      })
    ).toEqual({
      email: "cliente@exemplo.com",
      isValid: true,
      source: "customer",
    })
  })

  it("usa email guest quando nao autenticado", () => {
    expect(
      normalizeCheckoutEmail({
        actorType: "guest",
        guestEmail: "  guest@exemplo.com ",
      })
    ).toEqual({
      email: "guest@exemplo.com",
      isValid: true,
      source: "guest",
    })
  })

  it("nao bloqueia uso basico quando email estiver ausente ou invalido", () => {
    expect(
      normalizeCheckoutEmail({
        actorType: "guest",
      })
    ).toEqual({
      email: null,
      isValid: false,
      source: "none",
    })

    expect(
      normalizeCheckoutEmail({
        actorType: "guest",
        guestEmail: "nao-valido",
      })
    ).toEqual({
      email: "nao-valido",
      isValid: false,
      source: "guest",
    })
  })
})

describe("normalizadores Brasil", () => {
  it("normaliza CEP com ou sem mascara para oito digitos", () => {
    expect(normalizeBrazilPostalCode("01311-000")).toBe("01311000")
    expect(normalizeBrazilPostalCode("01311000")).toBe("01311000")
    expect(normalizeBrazilPostalCode("13.110-00")).toBeNull()
  })

  it("normaliza province/UF para formato canonico", () => {
    expect(normalizeBrazilProvince("sp")).toBe("SP")
    expect(normalizeBrazilProvince(" São Paulo ")).toBe("SP")
    expect(normalizeBrazilProvince("XX")).toBeNull()
  })

  it("normaliza province por nome usando o mesmo formato de normalizeTextKey", () => {
    expect(normalizeBrazilProvince("Distrito Federal")).toBe("DF")
    expect(normalizeBrazilProvince("Mato Grosso do Sul")).toBe("MS")
    expect(normalizeBrazilProvince("Rio de Janeiro")).toBe("RJ")
    expect(normalizeBrazilProvince("Rio Grande do Norte")).toBe("RN")
    expect(normalizeBrazilProvince("Rio Grande do Sul")).toBe("RS")
  })

  it("normaliza CPF e CNPJ validos com digitos verificadores", () => {
    expect(normalizeFederalTaxId("529.982.247-25")).toEqual({
      kind: "cpf",
      value: "52998224725",
    })

    expect(normalizeFederalTaxId("11.444.777/0001-61")).toEqual({
      kind: "cnpj",
      value: "11444777000161",
    })
  })

  it("rejeita CPF/CNPJ invalidos sem expor valor cru", () => {
    expect(normalizeFederalTaxId("111.111.111-11")).toBeNull()
    expect(normalizeFederalTaxId("11.444.777/0001-62")).toBeNull()
  })
})

describe("validateBrazilShippingAddress", () => {
  const baseInput = {
    full_name: "Maria Silva",
    address_1: "Rua A, 100",
    city: "Sao Paulo",
    province: "sp",
    postal_code: "01311-000",
    country_code: "br",
    federal_tax_id: "529.982.247-25",
  }

  it("aceita endereco valido e mantem campos opcionais opcionais", () => {
    const result = validateBrazilShippingAddress({
      ...baseInput,
      phone: "",
      address_2: "",
      company: "",
      state_tax_id: "",
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error("expected address to be valid")
    }

    expect(result.normalized).toEqual({
      full_name: "Maria Silva",
      address_1: "Rua A, 100",
      address_2: undefined,
      city: "Sao Paulo",
      province: "SP",
      postal_code: "01311000",
      country_code: "BR",
      phone: undefined,
      company: undefined,
      state_tax_id: undefined,
      metadata: {
        federal_tax_id: "52998224725",
        federal_tax_id_kind: "cpf",
      },
    })
    expect(result.maskedFederalTaxId).toBe("***.***.***-25")
  })

  it("retorna erros saneados por codigo/campo quando endereco e invalido", () => {
    const result = validateBrazilShippingAddress({
      ...baseInput,
      country_code: "US",
      federal_tax_id: "111.111.111-11",
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error("expected address to be invalid")
    }

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "CHECKOUT_COUNTRY_CODE_INVALID",
          field: "country_code",
        }),
        expect.objectContaining({
          code: "CHECKOUT_FEDERAL_TAX_ID_INVALID",
          field: "federal_tax_id",
          masked_federal_tax_id: "***.***.***-11",
        }),
      ])
    )

    const serialized = JSON.stringify(result.errors)
    expect(serialized).not.toContain("111.111.111-11")
    expect(serialized).not.toContain("11111111111")
  })
})

describe("maskFederalTaxId", () => {
  it("mascara cpf e cnpj sem expor documento completo", () => {
    expect(maskFederalTaxId("52998224725")).toBe("***.***.***-25")
    expect(maskFederalTaxId("11444777000161")).toBe("**.***.***/****-61")
    expect(maskFederalTaxId("123")).toBe("[REDACTED]")
  })
})

describe("checkout_data_complete / calculateCheckoutDataComplete", () => {
  const validAddress = {
    full_name: "Maria Silva",
    address_1: "Rua A, 100",
    city: "Sao Paulo",
    province: "SP",
    postal_code: "01311-000",
    country_code: "BR",
    federal_tax_id: "529.982.247-25",
  }

  const validLineItem = {
    id: "item_01",
    quantity: 1,
    variant_id: "variant_01",
    variant: sellableVariant(),
  }

  const completeInput = {
    actorType: "guest" as const,
    guestEmail: "guest@exemplo.com",
    shippingAddress: validAddress,
    lineItems: [validLineItem],
    currencyCode: "brl",
    regionCountryCode: "br",
  }

  it("retorna true apenas quando cart preenche itens+email+endereco+BRL", () => {
    expect(calculateCheckoutDataComplete(completeInput)).toEqual({
      checkout_data_complete: true,
      incomplete_reasons: [],
    })
  })

  it("retorna false quando email invalido, sem impedir uso basico do cart", () => {
    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        guestEmail: "email-invalido",
      }),
      ["EMAIL_INVALID"]
    )
  })

  it("retorna false quando email ausente", () => {
    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        guestEmail: null,
      }),
      ["EMAIL_INVALID"]
    )
  })

  it("retorna false sem line items", () => {
    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        lineItems: [],
      }),
      ["NO_LINE_ITEMS"]
    )
  })

  it("retorna false com quantidade zero ou negativa", () => {
    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        lineItems: [{ ...validLineItem, quantity: 0 }],
      }),
      ["INVALID_LINE_ITEM_QUANTITY"]
    )

    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        lineItems: [{ ...validLineItem, quantity: -1 }],
      }),
      ["INVALID_LINE_ITEM_QUANTITY"]
    )
  })

  it("retorna false quando variante nao e vendavel/publicavel", () => {
    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        lineItems: [
          {
            ...validLineItem,
            variant: sellableVariant({ metadata: {} }),
          },
        ],
      }),
      ["VARIANT_NOT_SELLABLE"]
    )
  })

  it("retorna false quando endereco invalido ou pais diferente de BR", () => {
    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        shippingAddress: {
          ...validAddress,
          country_code: "US",
        },
      }),
      ["SHIPPING_ADDRESS_INVALID"]
    )

    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        shippingAddress: {
          ...validAddress,
          federal_tax_id: "111.111.111-11",
        },
      }),
      ["SHIPPING_ADDRESS_INVALID"]
    )
  })

  it("retorna false quando moeda ou regiao estiverem fora de Brasil/BRL", () => {
    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        currencyCode: "usd",
      }),
      ["INVALID_CURRENCY"]
    )

    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        regionCountryCode: "us",
      }),
      ["INVALID_REGION"]
    )
  })

  it("recalcula completude derivada apos mutacao de item, email ou endereco", () => {
    const base = calculateCheckoutDataComplete(completeInput)
    expect(base.checkout_data_complete).toBe(true)

    const afterEmailChange = calculateCheckoutDataComplete({
      ...completeInput,
      guestEmail: "outro@exemplo.com",
    })
    expect(afterEmailChange.checkout_data_complete).toBe(true)

    const afterItemRemoval = calculateCheckoutDataComplete({
      ...completeInput,
      lineItems: [],
    })
    expect(afterItemRemoval.checkout_data_complete).toBe(false)

    const afterAddressChange = calculateCheckoutDataComplete({
      ...completeInput,
      shippingAddress: {
        ...validAddress,
        city: "",
      },
    })
    expect(afterAddressChange.checkout_data_complete).toBe(false)
  })

  it("nao exporta nome proibido de prontidao da Phase 04 como campo ou simbolo publico", () => {
    const forbiddenReadinessField = ["ready", "for", "payment"].join("_")
    const moduleExports = require("../checkout-data") as Record<string, unknown>
    expect(Object.keys(moduleExports)).not.toContain(forbiddenReadinessField)
    expect(moduleExports).not.toHaveProperty(forbiddenReadinessField)
  })

  it("usa customer.email quando autenticado", () => {
    expect(
      calculateCheckoutDataComplete({
        ...completeInput,
        actorType: "customer",
        customerEmail: "cliente@exemplo.com",
        guestEmail: "guest@exemplo.com",
      })
    ).toEqual({
      checkout_data_complete: true,
      incomplete_reasons: [],
    })
  })

  it("retorna false quando shipping address ausente", () => {
    expectIncomplete(
      calculateCheckoutDataComplete({
        ...completeInput,
        shippingAddress: null,
      }),
      ["SHIPPING_ADDRESS_MISSING"]
    )
  })
})
