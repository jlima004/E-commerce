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
    prices: [{ currency_code: "brl", amount: 99 }],
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
    total: 99,
    items: [
      {
        id: "item_01",
        quantity: 1,
        unit_price: 99,
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
  it("deriva major Medusa e minor provider a partir de cart.total", () => {
    expect(derivePaymentAmountFromCart(buildCompleteCart())).toEqual({
      medusa_amount_major: 99,
      provider_amount_minor: 9900,
      currency_code: "BRL",
    })
  })

  it("deriva amount a partir de valores monetarios BigNumber-like do Medusa", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: bigNumberLike(99),
        })
      )
    ).toEqual({
      medusa_amount_major: 99,
      provider_amount_minor: 9900,
      currency_code: "BRL",
    })
  })

  it("retorna null quando cart.total ausente mesmo com line items somaveis", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: undefined,
          items: [
            {
              id: "item_01",
              quantity: 2,
              unit_price: 50,
              variant_id: "variant_01",
              variant: sellableVariant(),
            },
          ],
        })
      )
    ).toBeNull()
  })

  it("retorna null quando cart.total esta nulo mesmo com item_total", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: null,
          item_total: 99,
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
    ).toBeNull()
  })

  it("retorna null quando cart.total ausente mesmo com shipping tax e discount", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: undefined,
          shipping_total: 15,
          tax_total: 2,
          discount_total: 7,
        })
      )
    ).toBeNull()
  })

  it("retorna null quando cart.total ausente mesmo com line items e ajustes que somariam valor valido", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: undefined,
          shipping_total: 15,
          tax_total: 5,
          discount_total: 10,
          items: [
            {
              id: "item_01",
              quantity: 1,
              unit_price: 100,
              variant_id: "variant_01",
              variant: sellableVariant({
                prices: [{ currency_code: "brl", amount: 100 }],
              }),
            },
          ],
        })
      )
    ).toBeNull()
  })

  it("retorna null quando cart.total ausente mesmo com credito extra reconstruivel", () => {
    const cart = {
      ...buildCompleteCart({
        total: undefined,
        shipping_total: 15,
        tax_total: 5,
        discount_total: 10,
        items: [
          {
            id: "item_01",
            quantity: 1,
            unit_price: 100,
            variant_id: "variant_01",
            variant: sellableVariant({
              prices: [{ currency_code: "brl", amount: 100 }],
            }),
          },
        ],
      }),
      credit_total: 20,
    } as PaymentStartCartSnapshot

    expect(derivePaymentAmountFromCart(cart)).toBeNull()
  })

  it("deriva S=11000 de cart.total 110 e nao de line item 100 no cenario combinado", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: 110,
          shipping_total: 15,
          discount_total: 10,
          tax_total: 5,
          items: [
            {
              id: "item_01",
              quantity: 1,
              unit_price: 100,
              variant_id: "variant_01",
              variant: sellableVariant({
                prices: [{ currency_code: "brl", amount: 100 }],
              }),
            },
          ],
        })
      )
    ).toEqual({
      medusa_amount_major: 110,
      provider_amount_minor: 11000,
      currency_code: "BRL",
    })
  })

  it("deriva S=9000 de cart.total 90 no cenario com credito e nao 10000 nem 11000", () => {
    const cart = {
      ...buildCompleteCart({
        total: 90,
        shipping_total: 15,
        discount_total: 10,
        tax_total: 5,
        items: [
          {
            id: "item_01",
            quantity: 1,
            unit_price: 100,
            variant_id: "variant_01",
            variant: sellableVariant({
              prices: [{ currency_code: "brl", amount: 100 }],
            }),
          },
        ],
      }),
      credit_total: 20,
    } as PaymentStartCartSnapshot

    expect(derivePaymentAmountFromCart(cart)).toEqual({
      medusa_amount_major: 90,
      provider_amount_minor: 9000,
      currency_code: "BRL",
    })
  })

  it("retorna null para moeda fora de BRL", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          currency_code: "usd",
          total: 99,
        })
      )
    ).toBeNull()
  })

  it("retorna null para currency_code ausente", () => {
    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          currency_code: undefined,
          total: 100,
        })
      )
    ).toBeNull()
  })

  it("retorna null para total zero, negativo, ausente ou nulo", () => {
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
          total: -1,
        })
      )
    ).toBeNull()

    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: undefined,
        })
      )
    ).toBeNull()

    expect(
      derivePaymentAmountFromCart(
        buildCompleteCart({
          total: null,
        })
      )
    ).toBeNull()
  })

  it.each([99.999, NaN, Infinity, "90071992547409.92"])(
    "retorna null para cart.total invalido %p",
    (total) => {
      expect(
        derivePaymentAmountFromCart(
          buildCompleteCart({
            total: total as unknown as number,
          })
        )
      ).toBeNull()
    }
  )
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
        medusa_amount_major: 99,
        provider_amount_minor: 9900,
        currency_code: "BRL",
        cart_id: "cart_guest_01",
        payment_method_type: paymentMethod,
      })
    }
  })

  it("card e pix compartilham S=9000 no cenario com credito de cart.total 90", () => {
    const cart = {
      ...buildCompleteCart({
        total: 90,
        shipping_total: 15,
        discount_total: 10,
        tax_total: 5,
        items: [
          {
            id: "item_01",
            quantity: 1,
            unit_price: 100,
            variant_id: "variant_01",
            variant: sellableVariant({
              prices: [{ currency_code: "brl", amount: 100 }],
            }),
          },
        ],
      }),
      credit_total: 20,
    } as PaymentStartCartSnapshot

    const amounts: number[] = []

    for (const paymentMethod of ["card", "pix"] as const) {
      const result = evaluatePaymentStartEligibility(
        buildEligibleInput({ cart, paymentMethod })
      )

      expect(result.eligible).toBe(true)
      if (result.eligible) {
        expect(result.medusa_amount_major).toBe(90)
        expect(result.provider_amount_minor).toBe(9000)
        expect(result.provider_amount_minor).not.toBe(10000)
        expect(result.provider_amount_minor).not.toBe(11000)
        amounts.push(result.provider_amount_minor)
      }
    }

    expect(amounts).toEqual([9000, 9000])
  })

  it("card e pix compartilham S=11000 no cenario combinado de cart.total 110", () => {
    const cart = buildCompleteCart({
      total: 110,
      shipping_total: 15,
      discount_total: 10,
      tax_total: 5,
      items: [
        {
          id: "item_01",
          quantity: 1,
          unit_price: 100,
          variant_id: "variant_01",
          variant: sellableVariant({
            prices: [{ currency_code: "brl", amount: 100 }],
          }),
        },
      ],
    })

    const amounts: number[] = []

    for (const paymentMethod of ["card", "pix"] as const) {
      const result = evaluatePaymentStartEligibility(
        buildEligibleInput({ cart, paymentMethod })
      )

      expect(result.eligible).toBe(true)
      if (result.eligible) {
        expect(result.medusa_amount_major).toBe(110)
        expect(result.provider_amount_minor).toBe(11000)
        expect(result.provider_amount_minor).not.toBe(10000)
        amounts.push(result.provider_amount_minor)
      }
    }

    expect(amounts).toEqual([11000, 11000])
  })

  it("rejeita INVALID_CART_TOTAL quando cart.total ausente com checkout completo", () => {
    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({
        cart: buildCompleteCart({
          total: undefined,
        }),
      })
    )

    expect(result).toMatchObject({
      eligible: false,
      code: "INVALID_CART_TOTAL",
    })
  })

  it("rejeita INVALID_CART_TOTAL quando cart.total ausente mesmo com credito extra reconstruivel", () => {
    const cart = {
      ...buildCompleteCart({
        total: undefined,
        shipping_total: 15,
        tax_total: 5,
        discount_total: 10,
        items: [
          {
            id: "item_01",
            quantity: 1,
            unit_price: 100,
            variant_id: "variant_01",
            variant: sellableVariant({
              prices: [{ currency_code: "brl", amount: 100 }],
            }),
          },
        ],
      }),
      credit_total: 20,
    } as PaymentStartCartSnapshot

    const result = evaluatePaymentStartEligibility(
      buildEligibleInput({ cart })
    )

    expect(result).toMatchObject({
      eligible: false,
      code: "INVALID_CART_TOTAL",
    })
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
      medusa_amount_major: 99,
      provider_amount_minor: 9900,
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
      medusa_amount_major: 99,
      provider_amount_minor: 9900,
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

describe("payment eligibility pure contract", () => {
  it("nao decide review como authority e permanece elegivel para cart completo", () => {
    const eligibilitySource = require("fs").readFileSync(
      require("path").join(__dirname, "../eligibility.ts"),
      "utf8"
    )

    expect(eligibilitySource).not.toMatch(
      /requiresReview|REVIEW_REQUIRED|cart_review|acknowledgeCartReview/
    )
    expect(evaluatePaymentStartEligibility(buildEligibleInput())).toMatchObject({
      eligible: true,
      provider_amount_minor: 9900,
      currency_code: "BRL",
    })
  })
})
