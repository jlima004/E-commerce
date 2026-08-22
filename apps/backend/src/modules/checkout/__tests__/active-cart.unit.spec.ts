import {
  assertNoPaymentOrOrderFields,
  isCartUsableForCheckout,
  markCartSupersededInput,
  resolveActiveCartIdentity,
  resolveM1CartActor,
  type CheckoutCartLike,
} from "../active-cart"
import type { CustomerAuthAccessContext, CustomerAuthAccessDecision } from "../../customer-auth/access-guard"
import type { GuestCartCapabilityRecord } from "../../guest-cart-capability/types"

const SELLABLE_VARIANT = {
  id: "variant_sellable",
  metadata: {
    gelato_product_uid: "prod_gelato_abc123",
    gelato_template_id: "template_fixed_001",
    gelato_variant_options: {
      size: "M",
      color: "black",
    },
    template_mode: "fixed",
  },
  prices: [{ currency_code: "brl", amount: 99 }],
}

function buildCart(
  overrides: Partial<CheckoutCartLike> = {}
): CheckoutCartLike {
  return {
    id: "cart_01",
    currency_code: "brl",
    metadata: null,
    items: [
      {
        id: "item_01",
        quantity: 1,
        variant: SELLABLE_VARIANT,
      },
    ],
    ...overrides,
  }
}

function createSyntheticCapabilityRecord(
  overrides: Partial<GuestCartCapabilityRecord> = {}
): GuestCartCapabilityRecord {
  return {
    id: "gccap_01",
    cart_id: "cart_guest_01",
    token_hash: "hash_01",
    status: "active",
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    consumed_at: null,
    revoked_at: null,
    last_used_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  }
}

describe("resolveActiveCartIdentity (legacy helper)", () => {
  it("deriva customer autenticado da auth_context sem confiar em body arbitrario", () => {
    const identity = resolveActiveCartIdentity({
      auth_context: {
        actor_id: "cus_123",
        actor_type: "customer",
      },
      session: {
        active_cart_id: "cart_guest_01",
      },
      customer: {
        email: "cliente@exemplo.com",
      },
      body: {
        customer_id: "cus_spoofed",
      },
    })

    expect(identity).toEqual({
      actorType: "customer",
      actorId: "cus_123",
      customerId: "cus_123",
      email: "cliente@exemplo.com",
    })
  })

  it("deriva guest cart da sessao atual sem exigir email", () => {
    const identity = resolveActiveCartIdentity({
      session: {
        id: "sess_01",
        active_cart_id: "cart_guest_01",
      },
      body: {
        customer_id: "cus_spoofed",
      },
    })

    expect(identity).toEqual({
      actorType: "guest",
      actorId: "sess_01",
      sessionId: "sess_01",
      activeCartId: "cart_guest_01",
    })
  })
})

describe("resolveM1CartActor (Phase 15 branches A / B / C)", () => {
  describe("Ramo A: capability header PRESENTE", () => {
    it("resolve guest valido a partir da capability e retorna cartId", async () => {
      const record = createSyntheticCapabilityRecord({ cart_id: "cart_guest_42" })
      const lookupMock = jest.fn().mockResolvedValue(record)

      const result = await resolveM1CartActor({
        guestCapabilityHeader: "valid_guest_token_abc",
        lookupGuestCapability: lookupMock,
      })

      expect(lookupMock).toHaveBeenCalledWith("valid_guest_token_abc")
      expect(result).toEqual({
        actorType: "guest",
        mode: "capability",
        capabilityRecord: record,
        cartId: "cart_guest_42",
      })
    })

    it("retorna invalid_guest_capability quando lookup falha (miss, invalido, expirado, revogado, consumido)", async () => {
      const lookupMock = jest.fn().mockRejectedValue(new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID"))

      const result = await resolveM1CartActor({
        guestCapabilityHeader: "invalid_or_expired_token",
        lookupGuestCapability: lookupMock,
      })

      expect(result.actorType).toBe("invalid_guest_capability")
    })

    it("XOR estrito: NUNCA cai para Customer se o header de guest estiver presente, mesmo que Authorization seja valido", async () => {
      const lookupMock = jest.fn().mockRejectedValue(new Error("GUEST_CART_CAPABILITY_LOOKUP_INVALID"))
      const authMock = jest.fn().mockResolvedValue({
        authorized: true,
        customerId: "cus_should_not_be_used",
      } as unknown as CustomerAuthAccessDecision)

      const result = await resolveM1CartActor({
        guestCapabilityHeader: "bad_guest_token",
        authorizationHeader: "Bearer valid_jwt_token",
        lookupGuestCapability: lookupMock,
        authorizeCustomerAccess: authMock,
      })

      expect(result.actorType).toBe("invalid_guest_capability")
      expect(authMock).not.toHaveBeenCalled()
    })
  })

  describe("Ramo B: capability header AUSENTE + Authorization PRESENTE", () => {
    it("resolve Customer autenticado com customerAuthContext pre-resolvido", async () => {
      const customerAuth: CustomerAuthAccessContext = {
        lineageId: "lin_01",
        sid: "sid_01",
        authIdentityId: "ident_01",
        customerId: "cus_777",
        credentialVersion: 1,
        originalAuthenticatedAt: new Date(),
        absoluteExpiresAt: new Date(Date.now() + 3600000),
        claims: {
          sub: "cus_777",
          customer_id: "cus_777",
          identity_id: "ident_01",
          auth_identity_id: "ident_01",
          sid: "sid_01",
          cv: 1,
          token_type: "access",
          jti: "jti_01",
          original_authenticated_at: Math.floor(Date.now() / 1000),
          absolute_expires_at: Math.floor(Date.now() / 1000) + 3600,
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        },
      }

      const result = await resolveM1CartActor({
        customerAuthContext: customerAuth,
      })

      expect(result).toEqual({
        actorType: "customer",
        customerId: "cus_777",
        customerAuth,
      })
    })

    it("executa autoridade Customer condicionalmente quando Authorization header esta presente", async () => {
      const authMock = jest.fn().mockResolvedValue({
        authorized: true,
        customerId: "cus_888",
        lineageId: "lin_01",
        sid: "sid_01",
      } as unknown as CustomerAuthAccessDecision)

      const result = await resolveM1CartActor({
        authorizationHeader: "Bearer customer_valid_access_jwt",
        authorizeCustomerAccess: authMock,
      })

      expect(authMock).toHaveBeenCalledWith("Bearer customer_valid_access_jwt")
      expect(result.actorType).toBe("customer")
      if (result.actorType === "customer") {
        expect(result.customerId).toBe("cus_888")
      }
    })

    it("retorna customer_auth_denied quando autorizacao Customer falha", async () => {
      const authMock = jest.fn().mockResolvedValue({
        authorized: false,
        statusCode: 401,
        code: "AUTHENTICATION_REQUIRED",
      } as CustomerAuthAccessDecision)

      const result = await resolveM1CartActor({
        authorizationHeader: "Bearer bad_access_token",
        authorizeCustomerAccess: authMock,
      })

      expect(result).toEqual({
        actorType: "customer_auth_denied",
        statusCode: 401,
        code: "AUTHENTICATION_REQUIRED",
      })
    })
  })

  describe("Ramo C: capability AUSENTE + Authorization AUSENTE", () => {
    it("resolve guest_anonymous quando nao ha headers de guest nem de customer", async () => {
      const result = await resolveM1CartActor({})
      expect(result).toEqual({
        actorType: "guest_anonymous",
      })
    })

    it("sessao sozinha nao concede posse de cart para M1", async () => {
      const result = await resolveM1CartActor({})
      expect(result.actorType).toBe("guest_anonymous")
    })
  })
})

describe("isCartUsableForCheckout", () => {
  it("aceita cart basico de guest sem email quando houver item vendavel e quantidade positiva", () => {
    expect(
      isCartUsableForCheckout(
        buildCart({
          email: undefined,
        })
      )
    ).toBe(true)
  })

  it("rejeita cart superseded por metadata existente sem exigir schema novo", () => {
    expect(
      isCartUsableForCheckout(
        buildCart({
          metadata: {
            active_for_checkout: false,
            superseded_by_cart_id: "cart_02",
          },
        })
      )
    ).toBe(false)
  })

  it("rejeita line item com quantidade nao positiva", () => {
    expect(
      isCartUsableForCheckout(
        buildCart({
          items: [
            {
              id: "item_01",
              quantity: 0,
              variant: SELLABLE_VARIANT,
            },
          ],
        })
      )
    ).toBe(false)
  })

  it("reaproveita a fronteira sellable da Phase 02 sem revalidacao profunda de Gelato", () => {
    expect(
      isCartUsableForCheckout(
        buildCart({
          items: [
            {
              id: "item_01",
              quantity: 1,
              variant: {
                ...SELLABLE_VARIANT,
                metadata: {
                  gelato_product_uid: "prod_gelato_abc123",
                },
              },
            },
          ],
        })
      )
    ).toBe(false)
  })
})

describe("markCartSupersededInput", () => {
  it("marca cart antigo como nao ativo usando somente metadata do core cart", () => {
    expect(
      markCartSupersededInput(buildCart(), {
        supersededByCartId: "cart_02",
        supersededAt: "2026-06-27T12:00:00.000Z",
      })
    ).toEqual({
      id: "cart_01",
      metadata: {
        active_for_checkout: false,
        superseded_by_cart_id: "cart_02",
        superseded_at: "2026-06-27T12:00:00.000Z",
      },
    })
  })
})

describe("assertNoPaymentOrOrderFields", () => {
  it("permite contrato estritamente pre-Order", () => {
    expect(() => assertNoPaymentOrOrderFields(buildCart())).not.toThrow()
  })

  it("falha se o contrato expuser entidades de payment ou order", () => {
    expect(() =>
      assertNoPaymentOrOrderFields(
        buildCart({
          order_id: "order_01",
        })
      )
    ).toThrow("ACTIVE_CART_PREORDER_ONLY")

    expect(() =>
      assertNoPaymentOrOrderFields(
        buildCart({
          payment_collection: {
            id: "paycol_01",
          },
        })
      )
    ).toThrow("ACTIVE_CART_PREORDER_ONLY")
  })
})
