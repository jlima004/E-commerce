import {
  buildGelatoDispatchAddress,
  buildGelatoDispatchFailureUpdate,
  buildGelatoDispatchPayload,
  buildGelatoDispatchRequestHash,
  resolveGelatoDispatchCandidateDecision,
} from "../service"
import { GELATO_FULFILLMENT_STATUS } from "../types"

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order_gelato_dispatch_01",
    display_id: 7001,
    email: "cliente@lojinha.test",
    shipping_address: {
      first_name: "Julia",
      last_name: "Lima",
      address_1: "Rua das Flores, 123",
      address_2: "Apto 45",
      city: "Sao Paulo",
      province: "SP",
      postal_code: "01000-000",
      country_code: "br",
      phone: "+55 11 98888-7777",
      metadata: {
        federal_tax_id: "529.982.247-25",
      },
    },
    items: [
      {
        id: "ordli_gelato_dispatch_01",
        quantity: 2,
        metadata: {
          gelato_snapshot: {
            gelato_product_uid: "gelato_prod_dispatch_01",
            gelato_template_id: "tmpl_dispatch_01",
            gelato_variant_options: {
              size: "M",
              color: "Preto",
            },
            template_mode: "fixed",
            source_product_variant_id: "variant_dispatch_01",
            source_product_variant_sku: "SKU-DISPATCH-01",
            captured_at: "2026-07-02T12:00:00.000Z",
            files: [
              {
                type: "default",
                url: "https://cdn.lojinha.test/print/front-01.png",
              },
            ],
          },
        },
        variant: {
          id: "variant_mutable_01",
          sku: "SKU-MUTABLE-01",
          metadata: {
            gelato_product_uid: "should_not_be_used",
          },
        },
      },
    ],
    ...overrides,
  }
}

describe("Gelato dispatch payload builder", () => {
  it("usa somente lineItem.metadata.gelato_snapshot para montar items", () => {
    const payload = buildGelatoDispatchPayload({
      order: buildOrder(),
      fulfillment: {
        id: "gelful_dispatch_01",
        order_id: "order_gelato_dispatch_01",
      },
      shipment_method_uid: "normal",
    })

    expect(payload).toEqual({
      orderType: "order",
      orderReferenceId: "order_gelato_dispatch_01",
      customerReferenceId: "order:7001",
      currency: "BRL",
      items: [
        {
          itemReferenceId: "ordli_gelato_dispatch_01",
          productUid: "gelato_prod_dispatch_01",
          quantity: 2,
          files: [
            {
              type: "default",
              url: "https://cdn.lojinha.test/print/front-01.png",
            },
          ],
        },
      ],
      shippingAddress: expect.objectContaining({
        firstName: "Julia",
        lastName: "Lima",
        federalTaxId: "529.982.247-25",
        country: "BR",
      }),
      metadata: {
        order_id: "order_gelato_dispatch_01",
        fulfillment_id: "gelful_dispatch_01",
      },
      shipmentMethodUid: "normal",
    })
  })

  it("falha fechado quando o snapshot esta ausente ou malformado", () => {
    expect(() =>
      buildGelatoDispatchPayload({
        order: buildOrder({
          items: [
            {
              id: "ordli_missing_snapshot",
              quantity: 1,
              metadata: {},
            },
          ],
        }),
        fulfillment: {
          id: "gelful_dispatch_02",
          order_id: "order_gelato_dispatch_01",
        },
      })
    ).toThrow("GELATO_DISPATCH_SNAPSHOT_REQUIRED")

    expect(() =>
      buildGelatoDispatchPayload({
        order: buildOrder({
          items: [
            {
              id: "ordli_missing_files",
              quantity: 1,
              metadata: {
                gelato_snapshot: {
                  gelato_product_uid: "gelato_prod_dispatch_01",
                  gelato_template_id: "tmpl_dispatch_01",
                  gelato_variant_options: {
                    size: "M",
                    color: "Preto",
                  },
                  template_mode: "fixed",
                  source_product_variant_id: "variant_dispatch_01",
                  source_product_variant_sku: "SKU-DISPATCH-01",
                  captured_at: "2026-07-02T12:00:00.000Z",
                },
              },
            },
          ],
        }),
        fulfillment: {
          id: "gelful_dispatch_03",
          order_id: "order_gelato_dispatch_01",
        },
      })
    ).toThrow("GELATO_DISPATCH_FILES_REQUIRED")
  })

  it("monta endereco BR apenas de forma transiente", () => {
    expect(
      buildGelatoDispatchAddress({
        shipping_address: buildOrder().shipping_address as never,
        email: "cliente@lojinha.test",
      })
    ).toEqual(
      expect.objectContaining({
        email: "cliente@lojinha.test",
        phone: expect.stringContaining("[REDACTED]"),
        federalTaxId: "529.982.247-25",
      })
    )
  })

  it("gera request hash deterministico a partir do payload", () => {
    const payload = buildGelatoDispatchPayload({
      order: buildOrder(),
      fulfillment: {
        id: "gelful_dispatch_01",
        order_id: "order_gelato_dispatch_01",
      },
    })

    expect(buildGelatoDispatchRequestHash(payload)).toBe(
      buildGelatoDispatchRequestHash(payload)
    )
  })
})

describe("Gelato dispatch failures and stale recovery", () => {
  it("redige dados sensiveis ao persistir falha", () => {
    const update = buildGelatoDispatchFailureUpdate(
      new Error(
        `${["X", "API", "KEY"].join("-")} abc cliente@lojinha.test +55 11 98888-7777`
      ),
      0,
      {
        at: new Date("2026-07-02T12:10:00.000Z"),
      }
    )

    expect(update.status).toBe(GELATO_FULFILLMENT_STATUS.FAILED)
    expect(update.last_error_message).toContain("[REDACTED]")
    expect(update.last_error_message).not.toContain("cliente@lojinha.test")
  })

  it("nao faz retry infinito para 400, 401 e 404", () => {
    for (const statusCode of [400, 401, 404]) {
      const error = Object.assign(new Error(`http_${statusCode}`), { statusCode })
      const update = buildGelatoDispatchFailureUpdate(error, 0, {
        at: new Date("2026-07-02T12:11:00.000Z"),
      })

      expect(update.status).toBe(GELATO_FULFILLMENT_STATUS.DEAD_LETTER)
      expect(update.requires_operator_attention).toBe(true)
      expect(update.next_retry_at).toBeNull()
    }
  })

  it("recupera queued stale e bloqueia redispatch cego em dispatching/submitted stale", () => {
    const now = new Date("2026-07-02T12:30:00.000Z")

    expect(
      resolveGelatoDispatchCandidateDecision(
        {
          status: GELATO_FULFILLMENT_STATUS.QUEUED,
          next_retry_at: null,
          queued_at: "2026-07-02T12:00:00.000Z",
          dispatching_started_at: null,
          submitted_at: null,
          accepted_at: null,
          gelato_primary_order_id: null,
        },
        now
      )
    ).toEqual({
      action: "recover_and_dispatch",
      reason: "queued_stale_recovered",
    })

    expect(
      resolveGelatoDispatchCandidateDecision(
        {
          status: GELATO_FULFILLMENT_STATUS.DISPATCHING,
          next_retry_at: null,
          queued_at: "2026-07-02T12:00:00.000Z",
          dispatching_started_at: "2026-07-02T12:00:00.000Z",
          submitted_at: null,
          accepted_at: null,
          gelato_primary_order_id: null,
        },
        now
      )
    ).toEqual({
      action: "operator_attention",
      reason: "stale_external_uncertain",
    })

    expect(
      resolveGelatoDispatchCandidateDecision(
        {
          status: GELATO_FULFILLMENT_STATUS.SUBMITTED,
          next_retry_at: null,
          queued_at: "2026-07-02T12:00:00.000Z",
          dispatching_started_at: "2026-07-02T12:01:00.000Z",
          submitted_at: "2026-07-02T12:02:00.000Z",
          accepted_at: null,
          gelato_primary_order_id: "gelato_ord_01",
        },
        now
      )
    ).toEqual({
      action: "operator_attention",
      reason: "stale_external_uncertain",
    })
  })

  it("nao redispatcha submitted ou accepted recentes com order id Gelato local", () => {
    const now = new Date("2026-07-02T12:05:00.000Z")

    expect(
      resolveGelatoDispatchCandidateDecision(
        {
          status: GELATO_FULFILLMENT_STATUS.SUBMITTED,
          next_retry_at: null,
          queued_at: "2026-07-02T12:01:00.000Z",
          dispatching_started_at: "2026-07-02T12:02:00.000Z",
          submitted_at: "2026-07-02T12:03:00.000Z",
          accepted_at: null,
          gelato_primary_order_id: "gelato_ord_02",
        },
        now
      )
    ).toEqual({
      action: "skip",
      reason: "already_submitted",
    })

    expect(
      resolveGelatoDispatchCandidateDecision(
        {
          status: GELATO_FULFILLMENT_STATUS.ACCEPTED,
          next_retry_at: null,
          queued_at: "2026-07-02T12:01:00.000Z",
          dispatching_started_at: "2026-07-02T12:02:00.000Z",
          submitted_at: "2026-07-02T12:03:00.000Z",
          accepted_at: "2026-07-02T12:04:00.000Z",
          gelato_primary_order_id: "gelato_ord_02",
        },
        now
      )
    ).toEqual({
      action: "skip",
      reason: "already_accepted",
    })
  })
})
