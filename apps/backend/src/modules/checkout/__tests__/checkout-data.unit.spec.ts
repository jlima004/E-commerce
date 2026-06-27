import {
  calculateCheckoutDataComplete,
  maskFederalTaxId,
  normalizeBrazilPostalCode,
  normalizeBrazilProvince,
  normalizeCheckoutEmail,
  normalizeFederalTaxId,
  validateBrazilShippingAddress,
} from "../checkout-data"

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

describe("calculateCheckoutDataComplete", () => {
  const validAddress = {
    full_name: "Maria Silva",
    address_1: "Rua A, 100",
    city: "Sao Paulo",
    province: "SP",
    postal_code: "01311-000",
    country_code: "BR",
    federal_tax_id: "529.982.247-25",
  }

  it("retorna true apenas quando cart preenche email+endereco+itens+BRL", () => {
    expect(
      calculateCheckoutDataComplete({
        actorType: "guest",
        guestEmail: "guest@exemplo.com",
        shippingAddress: validAddress,
        hasShippableItems: true,
        currencyCode: "brl",
      })
    ).toBe(true)
  })

  it("retorna false quando email invalido, sem impedir uso basico do cart", () => {
    expect(
      calculateCheckoutDataComplete({
        actorType: "guest",
        guestEmail: "email-invalido",
        shippingAddress: validAddress,
        hasShippableItems: true,
        currencyCode: "brl",
      })
    ).toBe(false)
  })

  it("retorna false quando qualquer requisito estrutural faltar", () => {
    expect(
      calculateCheckoutDataComplete({
        actorType: "customer",
        customerEmail: "cliente@exemplo.com",
        shippingAddress: validAddress,
        hasShippableItems: false,
        currencyCode: "brl",
      })
    ).toBe(false)

    expect(
      calculateCheckoutDataComplete({
        actorType: "customer",
        customerEmail: "cliente@exemplo.com",
        shippingAddress: validAddress,
        hasShippableItems: true,
        currencyCode: "usd",
      })
    ).toBe(false)
  })
})
