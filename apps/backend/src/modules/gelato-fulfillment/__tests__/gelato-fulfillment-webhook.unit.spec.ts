import {
  GELATO_FULFILLMENT_PROVIDER,
  GELATO_FULFILLMENT_STATUS,
} from "../types"
import {
  applyGelatoOrderStatusUpdatedWebhookToFulfillment,
  buildGelatoWebhookFulfillmentUpdate,
  mapGelatoFulfillmentStatusFromWebhook,
  parseGelatoOrderStatusUpdatedWebhookPayload,
  resolveGelatoFulfillmentForWebhook,
  shouldApplyGelatoWebhookStatusUpdate,
} from "../service"

function buildFulfillment(
  overrides: Record<string, unknown> = {}
): ReturnType<typeof applyGelatoOrderStatusUpdatedWebhookToFulfillment> {
  return {
    id: "gelful_123",
    order_id: "order_123",
    cart_id: "cart_123",
    payment_attempt_id: "payatt_123",
    checkout_completion_log_id: "chkcpl_123",
    analytics_event_log_id: "anlevt_123",
    email_delivery_log_id: "emlog_123",
    idempotency_key: "gelato-dispatch:order_123",
    order_reference_id: "order_123",
    customer_reference_id: null,
    status: GELATO_FULFILLMENT_STATUS.ACCEPTED,
    gelato_primary_order_id: "gel_primary_001",
    connected_order_ids: ["gel_connected_002"],
    request_hash: "sha256:123",
    request_summary: {
      order_id: "order_123",
      cart_id: "cart_123",
      payment_attempt_id: "payatt_123",
      checkout_completion_log_id: "chkcpl_123",
      analytics_event_log_id: "anlevt_123",
      email_delivery_log_id: "emlog_123",
      idempotency_key: "gelato-dispatch:order_123",
      request_hash: "sha256:123",
      item_count: 1,
      currency_code: "brl",
      status: GELATO_FULFILLMENT_STATUS.ACCEPTED,
      connected_order_ids: ["gel_connected_002"],
    },
    response_summary: {
      provider: GELATO_FULFILLMENT_PROVIDER.GELATO,
      status: GELATO_FULFILLMENT_STATUS.ACCEPTED,
      connected_order_ids: ["gel_connected_002"],
      gelato_primary_order_id: "gel_primary_001",
      provider_status: "accepted",
      provider_reference_id: "gel_primary_001",
    },
    tracking_summary: null,
    metadata: null,
    attempt_count: 0,
    last_error_code: null,
    last_error_message: null,
    next_retry_at: null,
    requires_operator_attention: false,
    operator_alert_code: null,
    operator_alert_message: null,
    operator_alerted_at: null,
    recorded_at: "2026-07-02T10:00:00.000Z",
    queued_at: null,
    dispatching_started_at: null,
    submitted_at: "2026-07-02T10:05:00.000Z",
    accepted_at: "2026-07-02T10:06:00.000Z",
    failed_at: null,
    dead_lettered_at: null,
    created_at: "2026-07-02T10:00:00.000Z",
    updated_at: "2026-07-02T10:06:00.000Z",
    deleted_at: null,
    ...overrides,
  } as ReturnType<typeof applyGelatoOrderStatusUpdatedWebhookToFulfillment>
}

function buildPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "gel_evt_001",
    event: "order_status_updated",
    orderId: "gel_connected_002",
    orderReferenceId: "order_123",
    fulfillmentStatus: "shipped",
    connectedOrderIds: ["gel_connected_002", "gel_connected_003"],
    items: [
      {
        itemReferenceId: "line_1",
        fulfillmentStatus: "shipped",
        fulfillments: [
          {
            trackingCode: "TRACK123",
            trackingUrl: "https://example.com/track/secret",
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe("Gelato webhook fulfillment helpers", () => {
  it("parseia apenas order_status_updated", () => {
    const parsed = parseGelatoOrderStatusUpdatedWebhookPayload(buildPayload())

    expect(parsed).toEqual(
      expect.objectContaining({
        id: "gel_evt_001",
        event: "order_status_updated",
        orderId: "gel_connected_002",
        orderReferenceId: "order_123",
        fulfillmentStatus: "shipped",
      })
    )
  })

  it("mapeia fulfillmentStatus Gelato para status local conservador", () => {
    expect(mapGelatoFulfillmentStatusFromWebhook("shipped")).toBe(
      GELATO_FULFILLMENT_STATUS.SHIPPED
    )
    expect(mapGelatoFulfillmentStatusFromWebhook("delivered")).toBe(
      GELATO_FULFILLMENT_STATUS.DELIVERED
    )
    expect(mapGelatoFulfillmentStatusFromWebhook("in_production")).toBe(
      GELATO_FULFILLMENT_STATUS.IN_PRODUCTION
    )
    expect(mapGelatoFulfillmentStatusFromWebhook("partially_shipped")).toBe(
      GELATO_FULFILLMENT_STATUS.PARTIALLY_SHIPPED
    )
    expect(mapGelatoFulfillmentStatusFromWebhook("unknown_status")).toBeNull()
  })

  it("nao degrada status terminal local", () => {
    expect(
      shouldApplyGelatoWebhookStatusUpdate(
        GELATO_FULFILLMENT_STATUS.DELIVERED,
        GELATO_FULFILLMENT_STATUS.IN_PRODUCTION
      )
    ).toBe(false)
  })

  it("resolve fulfillment por orderReferenceId e orderId conectado", () => {
    const fulfillment = buildFulfillment()
    const resolved = resolveGelatoFulfillmentForWebhook(
      [fulfillment],
      parseGelatoOrderStatusUpdatedWebhookPayload(buildPayload())
    )

    expect(resolved?.id).toBe("gelful_123")
  })

  it("rejeita orderId Gelato que nao bate com primary/connected", () => {
    const fulfillment = buildFulfillment()
    const resolved = resolveGelatoFulfillmentForWebhook([fulfillment], {
      orderReferenceId: "order_123",
      orderId: "gel_unknown_999",
      connectedOrderIds: [],
    })

    expect(resolved).toBeNull()
  })

  it("atualiza o mesmo aggregate local para split order conectado", () => {
    const fulfillment = buildFulfillment()
    const updated = applyGelatoOrderStatusUpdatedWebhookToFulfillment({
      fulfillment,
      payload: parseGelatoOrderStatusUpdatedWebhookPayload(
        buildPayload({
          orderId: "gel_connected_003",
          connectedOrderIds: ["gel_connected_002", "gel_connected_003"],
        })
      ),
      at: new Date("2026-07-02T12:00:00.000Z"),
    })

    expect(updated.status).toBe(GELATO_FULFILLMENT_STATUS.SHIPPED)
    expect(updated.connected_order_ids).toEqual(
      expect.arrayContaining(["gel_connected_002", "gel_connected_003"])
    )
    expect(updated.tracking_summary).toEqual(
      expect.objectContaining({
        tracking_status: "shipped",
      })
    )
    expect(JSON.stringify(updated)).not.toContain("trackingUrl")
    expect(JSON.stringify(updated)).not.toContain("TRACK123")
  })

  it("mantem status terminal quando evento chega fora de ordem", () => {
    const fulfillment = buildFulfillment({
      status: GELATO_FULFILLMENT_STATUS.DELIVERED,
      response_summary: {
        provider: GELATO_FULFILLMENT_PROVIDER.GELATO,
        status: GELATO_FULFILLMENT_STATUS.DELIVERED,
        connected_order_ids: ["gel_connected_002"],
        gelato_primary_order_id: "gel_primary_001",
        provider_status: "delivered",
        provider_reference_id: "gel_primary_001",
      },
    })

    const update = buildGelatoWebhookFulfillmentUpdate({
      fulfillment,
      payload: parseGelatoOrderStatusUpdatedWebhookPayload(
        buildPayload({
          fulfillmentStatus: "in_production",
        })
      ),
      at: new Date("2026-07-02T12:00:00.000Z"),
    })

    expect(update.status).toBe(GELATO_FULFILLMENT_STATUS.DELIVERED)
  })
})
