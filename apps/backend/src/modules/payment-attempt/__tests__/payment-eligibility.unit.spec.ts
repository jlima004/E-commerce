import { MedusaError } from "@medusajs/framework/utils"
import type { CatalogVariantInput } from "../../catalog/types"
import {
  assertPaymentStartEligible,
  derivePaymentAmountFromCart,
  evaluatePaymentStartEligibility,
  type PaymentStartCartSnapshot,
  type PaymentStartEligibilityInput,
} from "../eligibility"
import {
  getPaymentStartRejectedBodyMessage,
  normalizePaymentStartRequestBody,
  rejectClientMoneyFields,
} from "../../../api/store/carts/payment-attempts/validators"

const COMPLETE_GELATO_METADATA = {
  gelato_product_uid: "prod_gelato_abc123",
  gelato_template_id: "template_fixed_001",
  gelato_variant_options: {
    size: "M",
    color: "black",
  },
  template_mode: "fixed",
} as const

const VALID_CPF = "52998224725"

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

function buildCompleteCart(
  overrides: Partial<PaymentStartCartSnapshot> = {}
): PaymentStartCartSnapshot {
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
    total: 9900,
    items: [
      {
        id: "item_01",
        quantity: 1,
        unit_price: 9900,
        variant_id: "variant_01",
        variant: sellableVariant(),
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
        federal_tax_id: VALID_CPF,
      },
    },
    region: {
      countries: [{ iso_2: "br" }],
    },
    ...overrides,
  }
}

function bigNumberLike(value: number): number {
  return {
    valueOf: () => value,
    toString: () => String(value),
    toJSON: () => value,
  } as unknown as number
}

function buildEligibleInput(
  overrides: Partial<PaymentStartEligibilityInput> = {}
): PaymentStartEligibilityInput {
  return {
    cart: buildCompleteCart(),
    actor: {
      actorType: "guest",
      actorId: "guest_actor_01",
      sessionId: "sess_01",
    },
    paymentMethod: "card",
    sessionActiveCartId: "cart_guest_01",
    ...overrides,
  }
}

describe("derivePaymentAmountFromCart", () => {
  it("deriva amount e currency_code=BRL a partir de cart.total", () => {
    expect(derivePaymentAmountFromCart(buildCompleteCart())).toEqual({
      amount: 9900,
      currency_code: "BRL",
    })
  })

  it("deriva amount a partir de valores monetarios BigNumber-like do Medusa", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: bigNumberLike(9900),
        })
      )
    ).toEqual({
      amount: 9900,
      currency_code: "BRL",
    })
  })

  it("deriva amount somando line items quando cart.total ausente", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: undefined,
          items: [
            {
              id: "item_01",
              quantity: 2,
              unit_price: 5000,
              variant_id: "variant_01",
              variant: sellableVariant(),
            },
          ],
        })
      )
    ).toEqual({
      amount: 10000,
      currency_code: "BRL",
    })
  })

  it("deriva amount de item_total calculado quando cart.total esta nulo", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: null,
          item_total: 9900,
          items: [
            {
              id: "item_01",
              quantity: 1,
              unit_price: null,
              variant_id: "variant_01",
              variant: sellableVariant(),
            },
          ],
        })
      )
    ).toEqual({
      amount: 9900,
      currency_code: "BRL",
    })
  })

  it("inclui shipping_total, tax_total e discount_total quando cart.total ausente", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: undefined,
          shipping_total: 1500,
          tax_total: 200,
          discount_total: 700,
        })
      )
    ).toEqual({
      amount: 10900,
      currency_code: "BRL",
    })
  })

  it("retorna null para moeda fora de BRL", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          currency_code: "usd",
          total: 9900,
        })
      )
    ).toBeNull()
  })

  it("retorna null para total zero, negativo ou nao inteiro", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: 0,
        })
      )
    ).toBeNull()

    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: -100,
        })
      )
    ).toBeNull()

    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: undefined,
          items: [],
        })
      )
    ).toBeNull()
  })
})

describe("evaluatePaymentStartEligibility", () => {
  it("aprova cart completo em BRL para card e pix", () => {
    for (const paymentMethod of ["card", "pix"] as const) {
      expect(
        evaluatePaymentStartEligibility(
          buildEligibleInput({ paymentMethod })
        )
      ).toEqual({
        eligible: true,
        checkout_data_complete: true,
        amount: 9900,
        currency_code: "BRL",
        cart_id: "cart_guest_01",
        payment_method_type: paymentMethod,
      })
    }
  })

  it("rejeita cart incompleto por checkout_data_complete=false", () => {
    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({ email: null }),
      })
    )

    expect(result.eligible).toBe(false)
    if (!result.eligible) {
      expect(result.code).toBe("CHECKOUT_DATA_INCOMPLETE")
      expect(result.incomplete_reasons).toEqual(
        expect.arrayContaining(["EMAIL_INVALID"])
      )
      expect(result.message).not.toMatch(/529\.982\.247-25|52998224725/)
      expect(result.message).not.toMatch(/Rua A/)
    }
  })

  it("rejeita cart sem line items", () => {
    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({
          items: [],
          total: undefined,
        }),
      })
    )

    expect(result).toMatchObject({
      eligible: false,
      code: "CHECKOUT_DATA_INCOMPLETE",
      incomplete_reasons: expect.arrayContaining(["NO_LINE_ITEMS"]),
    })
  })

  it("rejeita cart sem shipping address valido", () => {
    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({
          shipping_address: null,
        }),
      })
    )

    expect(result).toMatchObject({
      eligible: false,
      code: "CHECKOUT_DATA_INCOMPLETE",
      incomplete_reasons: expect.arrayContaining(["SHIPPING_ADDRESS_MISSING"]),
    })
  })

  it("rejeita cart fora de BR/BRL", () => {
    const currencyResult = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({
          currency_code: "usd",
        }),
      })
    )

    expect(currencyResult).toMatchObject({
      eligible: false,
      code: "CHECKOUT_DATA_INCOMPLETE",
      incomplete_reasons: expect.arrayContaining(["INVALID_CURRENCY"]),
    })

    const regionResult = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({
          region: {
            countries: [{ iso_2: "us" }],
          },
        }),
      })
    )

    expect(regionResult).toMatchObject({
      eligible: false,
      code: "CHECKOUT_DATA_INCOMPLETE",
      incomplete_reasons: expect.arrayContaining(["INVALID_REGION"]),
    })
  })

  it("rejeita cart sem region ou sem region.countries", () => {
    const withoutRegion = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({
          region: undefined,
        }),
      })
    )

    expect(withoutRegion).toMatchObject({
      eligible: false,
      code: "CHECKOUT_DATA_INCOMPLETE",
      incomplete_reasons: expect.arrayContaining(["INVALID_REGION"]),
    })

    const withoutCountries = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({
          region: { countries: [] },
        }),
      })
    )

    expect(withoutCountries).toMatchObject({
      eligible: false,
      code: "CHECKOUT_DATA_INCOMPLETE",
      incomplete_reasons: expect.arrayContaining(["INVALID_REGION"]),
    })
  })

  it("rejeita total invalido mesmo com checkout_data_complete", () => {
    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({
          total: 0,
          items: [
            {
              id: "item_01",
              quantity: 1,
              unit_price: 0,
              variant_id: "variant_01",
              variant: sellableVariant(),
            },
          ],
        }),
      })
    )

    expect(result).toMatchObject({
      eligible: false,
      code: "INVALID_CART_TOTAL",
    })
  })

  it("rejeita guest quando cart nao pertence a sessao", () => {
    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({
        sessionActiveCartId: "cart_outro",
      })
    )

    expect(result).toMatchObject({
      eligible: false,
      code: "CART_ACCESS_DENIED",
    })
  })

  it("rejeita guest quando sessionActiveCartId ausente", () => {
    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({
        sessionActiveCartId: undefined,
      })
    )

    expect(result).toMatchObject({
      eligible: false,
      code: "CART_ACCESS_DENIED",
    })
  })

  it("rejeita guest quando sessionActiveCartId vazio", () => {
    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({
        sessionActiveCartId: "   ",
      })
    )

    expect(result).toMatchObject({
      eligible: false,
      code: "CART_ACCESS_DENIED",
    })
  })

  it("rejeita customer quando cart nao pertence ao cliente", () => {
    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({
          customer: {
            id: "cus_outro",
            email: "outro@exemplo.com",
          },
        }),
        actor: {
          actorType: "customer",
          actorId: "cus_01",
          customerId: "cus_01",
        },
      })
    )

    expect(result).toMatchObject({
      eligible: false,
      code: "CART_ACCESS_DENIED",
    })
  })

  it("rejeita cart ja concluido pre-Order", () => {
    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({
          completed_at: "2026-06-27T12:00:00.000Z",
        }),
      })
    )

    expect(result).toMatchObject({
      eligible: false,
      code: "CART_ALREADY_COMPLETED",
    })
  })
})

describe("assertPaymentStartEligible", () => {
  it("retorna sucesso para cart elegivel", () => {
    expect(assertPaymentStartEligible(buildEligibleInput())).toEqual({
      eligible: true,
      checkout_data_complete: true,
      amount: 9900,
      currency_code: "BRL",
      cart_id: "cart_guest_01",
      payment_method_type: "card",
    })
  })

  it("lanca MedusaError INVALID_DATA para cart inelegivel", () => {
    expect(() =>
      assertPaymentStartEligible(
        buildEligibleInput({
          cart: buildCompleteCart({ email: null }),
        })
      )
    ).toThrow(MedusaError)

    try {
      assertPaymentStartEligible(
        buildEligibleInput({
          cart: buildCompleteCart({ email: null }),
        })
      )
    } catch (error) {
      expect(error).toBeInstanceOf(MedusaError)
      expect((error as MedusaError).type).toBe(MedusaError.Types.INVALID_DATA)
      expect((error as MedusaError).message).not.toMatch(/guest@exemplo.com/)
    }
  })
})

describe("rejectClientMoneyFields / normalizePaymentStartRequestBody", () => {
  it("rejeita amount, currency e currency_code no body", () => {
    for (const body of [
      { payment_method: "card", amount: 1 },
      { payment_method: "pix", currency: "USD" },
      { payment_method: "card", currency_code: "usd" },
      { payment_method: "pix", total: 100 },
      { payment_method: "card", subtotal: 50 },
      { payment_method: "pix", region_currency: "eur" },
    ]) {
      expect(() => rejectClientMoneyFields(body)).toThrow(MedusaError)
    }
  })

  it("nao ecoa valores monetarios do body na mensagem de erro", () => {
    const bodies = [
      { amount: 1, currency: "USD", currency_code: "usd" },
      { total: 99999, subtotal: 88888 },
    ]

    for (const body of bodies) {
      try {
        rejectClientMoneyFields(body)
      } catch (error) {
        expect(error).toBeInstanceOf(MedusaError)
        const message = (error as MedusaError).message
        expect(message).toBe(getPaymentStartRejectedBodyMessage())
        expect(message).not.toMatch(/USD|usd|99999|88888/)
        expect(message).not.toContain("1")
      }
    }
  })

  it("normaliza payment_method valido apos rejeitar campos monetarios ausentes", () => {
    expect(normalizePaymentStartRequestBody({ payment_method: "pix" })).toEqual({
      payment_method: "pix",
    })
  })

  it("body com amount=1 nao influencia derivacao server-side do cart", () => {
    const body = {
      payment_method: "card",
      amount: 1,
      currency: "USD",
      currency_code: "usd",
      total: 1,
      subtotal: 1,
    }

    expect(() => normalizePaymentStartRequestBody(body)).toThrow(MedusaError)

    const eligibility = evaluatePaymentStartEligibility(buildEligibleInput())
    expect(eligibility).toMatchObject({
      eligible: true,
      amount: 9900,
      currency_code: "BRL",
    })
  })

  it("exige payment_method card ou pix", () => {
    expect(() =>
      normalizePaymentStartRequestBody({ payment_method: "boleto" })
    ).toThrow(MedusaError)
  })
})

describe("amount|currency|money — provas negativas de escopo 04-03", () => {
  it("eligibility nao referencia Order, webhook, completion, purchase_completed ou Gelato", () => {
    const eligibilitySource = require("fs").readFileSync(
      require("path").join(__dirname, "../eligibility.ts"),
      "utf8"
    )

    expect(eligibilitySource).not.toMatch(
      /completeCartWorkflow|WebhookEventLog|CheckoutCompletionLog|purchase_completed|gelato|order\.gelatoapis\.com/i
    )
  })
})
