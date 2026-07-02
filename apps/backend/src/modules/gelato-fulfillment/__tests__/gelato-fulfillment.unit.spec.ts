import fs from "fs"
import path from "path"
import {
  GELATO_FULFILLMENT_PROVIDER,
  GELATO_FULFILLMENT_STATUSES,
  GELATO_FULFILLMENT_STATUS,
} from "../types"
import {
  assertNoSensitiveGelatoFulfillmentMetadata,
  assertSingleActiveGelatoFulfillmentForOrder,
  assertValidGelatoFulfillmentProvider,
  assertValidGelatoFulfillmentStatus,
  buildGelatoDeadLetterUpdate,
  buildGelatoDispatchIdempotencyKey,
  buildGelatoFulfillmentRecord,
  buildGelatoFulfillmentRequestSummary,
  buildGelatoFulfillmentResponseSummary,
  buildGelatoFulfillmentTrackingSummary,
  isGelatoFulfillmentActiveStatus,
  isGelatoFulfillmentTerminalStatus,
  sanitizeGelatoFulfillmentError,
  sanitizeGelatoFulfillmentMetadata,
} from "../service"

const migrationPath = path.join(
  __dirname,
  "../migrations/TBD-gelato-fulfillment.ts"
)
const modelPath = path.join(__dirname, "../models/gelato-fulfillment.ts")

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const SECRET_HEADER = joinKey("X", "-", "API", "-", "KEY")
const SECRET_ENV = joinKey("GELATO", "_", "API", "_", "KEY")
const AUTH_KEY = joinKey("Authori", "zation")
const BEARER_VALUE = joinKey("Bear", "er ", "abc", ".", "123")
const RAW_KEY = joinKey("raw", "_", "body")
const PIX_KEY = joinKey("pix", "_", "copy", "_", "paste")
const TRACKING_KEY = joinKey("track", "ing", "_", "token")
const TRACKING_URL_KEY = joinKey("tracking", "_", "url")
const ADDRESS_KEY = joinKey("ship", "ping", "_", "address")
const EMAIL_KEY = joinKey("customer", "_", "email")
const REFUND_KEY = joinKey("re", "fund")
const EXCHANGE_KEY = joinKey("Ex", "change")
const CPF_KEY = joinKey("c", "pf")
const CNPJ_KEY = joinKey("cn", "pj")
const CPF_VALUE = joinKey("529", ".", "982", ".", "247", "-", "25")
const CNPJ_VALUE = joinKey("12", ".", "345", ".", "678", "/", "0001", "-", "99")
const PIX_VALUE = joinKey(
  "000201",
  "26",
  "360014BR.GOV.BCB.PIX0114",
  "+5511999999999"
)
const EMAIL_VALUE = joinKey("cliente", "@", "compras", ".", "test")
const PHONE_VALUE = joinKey("+55 ", "11 ", "98888", "-", "7777")

function buildRequestSummaryInput() {
  return {
    order_id: "order_123",
    cart_id: "cart_123",
    payment_attempt_id: "payatt_123",
    checkout_completion_log_id: "chkcpl_123",
    analytics_event_log_id: "anlevt_123",
    email_delivery_log_id: "emlog_123",
    idempotency_key: "gelato-dispatch:order_123",
    request_hash: "sha256:123",
    item_count: 2,
    currency_code: "BRL",
    status: GELATO_FULFILLMENT_STATUS.RECORDED,
    connected_order_ids: ["order_123", "order_456", "order_456", "order_789"],
  }
}

describe("GelatoFulfillment idempotency", () => {
  it("builds the canonical deterministic key", () => {
    expect(
      buildGelatoDispatchIdempotencyKey({
        order_id: "  order_123  ",
      })
    ).toBe("gelato-dispatch:order_123")
  })

  it("rejects empty order_id", () => {
    expect(() =>
      buildGelatoDispatchIdempotencyKey({
        order_id: "   ",
      })
    ).toThrow("GELATO_FULFILLMENT_ORDER_ID_REQUIRED")
  })
})

describe("GelatoFulfillment vocabulary", () => {
  it("accepts only the planned provider and statuses", () => {
    expect(GELATO_FULFILLMENT_PROVIDER.GELATO).toBe("gelato")
    expect(GELATO_FULFILLMENT_STATUSES).toEqual([
      "recorded",
      "eligible",
      "queued",
      "dispatching",
      "submitted",
      "accepted",
      "in_production",
      "partially_shipped",
      "shipped",
      "delivered",
      "failed",
      "dead_letter",
      "canceled",
    ])

    expect(() =>
      assertValidGelatoFulfillmentProvider(GELATO_FULFILLMENT_PROVIDER.GELATO)
    ).not.toThrow()

    for (const status of GELATO_FULFILLMENT_STATUSES) {
      expect(() => assertValidGelatoFulfillmentStatus(status)).not.toThrow()
    }
  })

  it("rejects values outside the planned vocabulary", () => {
    expect(() => assertValidGelatoFulfillmentProvider("rest")).toThrow(
      "GELATO_FULFILLMENT_PROVIDER_INVALID"
    )
    expect(() => assertValidGelatoFulfillmentStatus("processing")).toThrow(
      "GELATO_FULFILLMENT_STATUS_INVALID"
    )
  })
})

describe("GelatoFulfillment lifecycle helpers", () => {
  it("classifies active versus terminal statuses", () => {
    expect(isGelatoFulfillmentActiveStatus("recorded")).toBe(true)
    expect(isGelatoFulfillmentActiveStatus("shipped")).toBe(true)
    expect(isGelatoFulfillmentActiveStatus("dead_letter")).toBe(false)
    expect(isGelatoFulfillmentTerminalStatus("dead_letter")).toBe(true)
    expect(isGelatoFulfillmentTerminalStatus("delivered")).toBe(true)
    expect(isGelatoFulfillmentTerminalStatus("queued")).toBe(false)
  })

  it("enforces the single-active guard per order_id", () => {
    expect(() =>
      assertSingleActiveGelatoFulfillmentForOrder({
        order_id: "order_123",
        existing: {
          order_id: "order_123",
          status: GELATO_FULFILLMENT_STATUS.QUEUED,
        },
      })
    ).toThrow("GELATO_FULFILLMENT_ORDER_ALREADY_ACTIVE")

    expect(() =>
      assertSingleActiveGelatoFulfillmentForOrder({
        order_id: "order_123",
        existing: {
          order_id: "order_123",
          status: GELATO_FULFILLMENT_STATUS.DELIVERED,
        },
      })
    ).toThrow("GELATO_FULFILLMENT_ORDER_ALREADY_RECORDED")

    expect(() =>
      assertSingleActiveGelatoFulfillmentForOrder({
        order_id: "order_123",
        existing: {
          order_id: "order_999",
          status: GELATO_FULFILLMENT_STATUS.QUEUED,
        },
      })
    ).not.toThrow()
  })
})

describe("GelatoFulfillment summaries and local record", () => {
  it("keeps connectedOrderIds aggregated in the same local fulfillment", () => {
    const summary = buildGelatoFulfillmentRequestSummary(buildRequestSummaryInput())

    expect(summary.connected_order_ids).toEqual(["order_456", "order_789"])
  })

  it("builds an allowlist-only request_summary", () => {
    const summary = buildGelatoFulfillmentRequestSummary({
      ...buildRequestSummaryInput(),
      ignored_field: "drop-me",
    })

    expect(summary).toEqual({
      order_id: "order_123",
      cart_id: "cart_123",
      payment_attempt_id: "payatt_123",
      checkout_completion_log_id: "chkcpl_123",
      analytics_event_log_id: "anlevt_123",
      email_delivery_log_id: "emlog_123",
      idempotency_key: "gelato-dispatch:order_123",
      request_hash: "sha256:123",
      item_count: 2,
      currency_code: "brl",
      status: "recorded",
      connected_order_ids: ["order_456", "order_789"],
    })
    expect(summary).not.toHaveProperty("ignored_field")
  })

  it("builds an allowlist-only response_summary", () => {
    const summary = buildGelatoFulfillmentResponseSummary({
      provider: "gelato",
      status: "submitted",
      connected_order_ids: ["order_456"],
      gelato_primary_order_id: "gelato_local_123",
      provider_status: "accepted_by_provider",
      provider_reference_id: "provider_ref_123",
      ignored_field: "drop-me",
    })

    expect(summary).toEqual({
      provider: "gelato",
      status: "submitted",
      connected_order_ids: ["order_456"],
      gelato_primary_order_id: "gelato_local_123",
      provider_status: "accepted_by_provider",
      provider_reference_id: "provider_ref_123",
    })
    expect(summary).not.toHaveProperty("ignored_field")
  })

  it("builds a local-only tracking_summary without public tracking data", () => {
    const summary = buildGelatoFulfillmentTrackingSummary({
      status: "accepted",
      tracking_status: "awaiting_provider_tracking",
      connected_order_ids: ["order_456"],
    })

    expect(summary).toEqual({
      status: "accepted",
      tracking_status: "awaiting_provider_tracking",
      connected_order_ids: ["order_456"],
    })
  })

  it("builds a local record with operator-alert fields and no second row semantics", () => {
    const now = new Date("2026-07-02T12:00:00.000Z")
    const record = buildGelatoFulfillmentRecord(
      {
        order_id: "order_123",
        cart_id: "cart_123",
        payment_attempt_id: "payatt_123",
        checkout_completion_log_id: "chkcpl_123",
        analytics_event_log_id: "anlevt_123",
        email_delivery_log_id: "emlog_123",
        request_hash: "sha256:123",
        request_summary: buildRequestSummaryInput(),
        response_summary: {
          provider: "gelato",
          status: "submitted",
          connected_order_ids: ["order_456"],
          gelato_primary_order_id: "gelato_local_123",
          provider_status: "accepted_by_provider",
          provider_reference_id: "provider_ref_123",
        },
        tracking_summary: {
          status: "accepted",
          tracking_status: "awaiting_provider_tracking",
          connected_order_ids: ["order_456"],
        },
        metadata: {
          correlation_id: "req_123",
          source: "phase-09-01",
          ignored_field: "drop-me",
        },
        requires_operator_attention: false,
      },
      "gelful_123",
      now
    )

    expect(record).toMatchObject({
      id: "gelful_123",
      order_id: "order_123",
      idempotency_key: "gelato-dispatch:order_123",
      order_reference_id: "order_123",
      status: "recorded",
      connected_order_ids: ["order_456", "order_789"],
      requires_operator_attention: false,
      operator_alert_code: null,
      operator_alert_message: null,
      operator_alerted_at: null,
      metadata: {
        correlation_id: "req_123",
        source: "phase-09-01",
      },
    })
    expect(record.metadata).not.toHaveProperty("ignored_field")
  })
})

describe("GelatoFulfillment sanitization", () => {
  it("sanitizes metadata using the local allowlist", () => {
    expect(
      sanitizeGelatoFulfillmentMetadata({
        correlation_id: "req_123",
        recovery_origin: "retry",
        source: "gelato-relay",
        ignored_field: "drop-me",
      })
    ).toEqual({
      correlation_id: "req_123",
      recovery_origin: "retry",
      source: "gelato-relay",
    })
  })

  it("rejects forbidden metadata and payload fragments", () => {
    expect(() =>
      assertNoSensitiveGelatoFulfillmentMetadata({
        [SECRET_HEADER]: "hidden",
      })
    ).toThrow("GELATO_FULFILLMENT_METADATA_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        [AUTH_KEY]: BEARER_VALUE,
      })
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentResponseSummary({
        provider: "gelato",
        status: "submitted",
        [TRACKING_URL_KEY]: "hidden",
      } as Record<string, unknown> & {
        provider: "gelato"
        status: "submitted"
      })
    ).toThrow("GELATO_FULFILLMENT_RESPONSE_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentTrackingSummary({
        status: "accepted",
        [TRACKING_KEY]: "hidden",
      } as Record<string, unknown> & { status: "accepted" })
    ).toThrow("GELATO_FULFILLMENT_TRACKING_SUMMARY_FORBIDDEN")
  })

  it("redacts prohibited data classes without persisting local secrets", () => {
    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        [SECRET_ENV]: "hidden",
      })
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        [RAW_KEY]: "hidden",
      })
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        [PIX_KEY]: PIX_VALUE,
      })
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        [ADDRESS_KEY]: {
          street: "hidden",
        },
      } as Record<string, unknown> & ReturnType<typeof buildRequestSummaryInput>)
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        [EMAIL_KEY]: EMAIL_VALUE,
      })
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        phone: PHONE_VALUE,
      })
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        [CPF_KEY]: CPF_VALUE,
      })
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        [CNPJ_KEY]: CNPJ_VALUE,
      })
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        [REFUND_KEY]: "hidden",
      })
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")

    expect(() =>
      buildGelatoFulfillmentRequestSummary({
        ...buildRequestSummaryInput(),
        [EXCHANGE_KEY]: "hidden",
      })
    ).toThrow("GELATO_FULFILLMENT_REQUEST_SUMMARY_FORBIDDEN")
  })

  it("sanitizes error surfaces and marks persistent failure as dead_letter", () => {
    const error = new Error(
      `${AUTH_KEY}: ${BEARER_VALUE} ${EMAIL_VALUE} ${PHONE_VALUE} ${CPF_VALUE}`
    )
    error.name = "GelatoRelayError"

    const sanitized = sanitizeGelatoFulfillmentError(error)

    expect(sanitized.error_code).toBe("GelatoRelayError")
    expect(sanitized.error_message).toContain("[REDACTED]")
    expect(sanitized.error_message).not.toContain(BEARER_VALUE)
    expect(sanitized.error_message).not.toContain(EMAIL_VALUE)
    expect(sanitized.error_message).not.toContain(PHONE_VALUE)
    expect(sanitized.error_message).not.toContain(CPF_VALUE)

    const update = buildGelatoDeadLetterUpdate(
      {
        error,
        operator_alert_code: `${AUTH_KEY}:${SECRET_HEADER}`,
        operator_alert_message: `${EMAIL_VALUE} ${PHONE_VALUE}`,
      },
      new Date("2026-07-02T12:30:00.000Z")
    )

    expect(update).toMatchObject({
      status: "dead_letter",
      requires_operator_attention: true,
      operator_alerted_at: "2026-07-02T12:30:00.000Z",
      dead_lettered_at: "2026-07-02T12:30:00.000Z",
    })
    expect(update.operator_alert_code).toContain("[REDACTED]")
    expect(update.operator_alert_message).toContain("[REDACTED]")
  })
})

describe("GelatoFulfillment migration/model source", () => {
  it("keeps the planned indexes and constraints in the draft migration", () => {
    const source = fs.readFileSync(migrationPath, "utf8")

    expect(source).toContain('"status" in')
    expect(source).toContain('"attempt_count" >= 0')
    expect(source).toContain('"requires_operator_attention" boolean not null default false')
    expect(source).toContain('"operator_alert_code" text null')
    expect(source).toContain('"operator_alert_message" text null')
    expect(source).toContain('"operator_alerted_at" timestamptz null')
    expect(source).toContain('"IDX_gelato_fulfillment_order_id_unique"')
    expect(source).toContain('"IDX_gelato_fulfillment_idempotency_key_unique"')
    expect(source).toContain('"IDX_gelato_fulfillment_status_next_retry_at"')
    expect(source).toContain('"IDX_gelato_fulfillment_order_id"')
    expect(source).toContain('"IDX_gelato_fulfillment_analytics_event_log_id"')
    expect(source).toContain('"IDX_gelato_fulfillment_email_delivery_log_id"')
    expect(source).toContain('"IDX_gelato_fulfillment_payment_attempt_id"')
    expect(source).toContain('"IDX_gelato_fulfillment_checkout_completion_log_id"')
  })

  it("keeps the local model aligned with the planned aggregate fields", () => {
    const source = fs.readFileSync(modelPath, "utf8")

    expect(source).toContain('define("gelato_fulfillment"')
    expect(source).toContain("connected_order_ids: model.json()")
    expect(source).toContain("request_summary: model.json()")
    expect(source).toContain("response_summary: model.json().nullable()")
    expect(source).toContain("tracking_summary: model.json().nullable()")
    expect(source).toContain("requires_operator_attention: model.boolean().default(false)")
  })
})
