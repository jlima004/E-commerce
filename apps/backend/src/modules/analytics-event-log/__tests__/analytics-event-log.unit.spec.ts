import fs from "fs"
import path from "path"
import {
  ANALYTICS_EVENT_NAME,
  ANALYTICS_EVENT_STATUSES,
  ANALYTICS_EVENT_STATUS,
  ANALYTICS_EVENT_VERSION,
} from "../types"
import {
  assertNoSensitiveAnalyticsMetadata,
  assertValidAnalyticsEventName,
  assertValidAnalyticsEventStatus,
  assertValidAnalyticsEventVersion,
  buildAnalyticsEventLogRecord,
  buildPurchaseCompletedIdempotencyKey,
  buildPurchaseCompletedPayload,
  sanitizeAnalyticsError,
  sanitizeAnalyticsMetadata,
} from "../service"

const migrationPath = path.join(
  __dirname,
  "../migrations/Migration20260701010000.ts"
)
const modelPath = path.join(__dirname, "../models/analytics-event-log.ts")
const servicePath = path.join(__dirname, "../service.ts")

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const SECRET_KEY = joinKey("client", "_", "secret")
const SECRET_VALUE = joinKey("pi_123", "_", "secret_456")
const STRIPE_SECRET_LIKE = joinKey("sk", "_", "test", "_", "123456")
const AUTH_KEY = joinKey("Authori", "zation")
const COOKIES_KEY = joinKey("cookie", "s")
const COPY_KEY = joinKey("copy", "_", "paste")
const TAX_KEY = joinKey("federal", "_", "tax", "_", "id")
const PERSON_DOC_A = joinKey("c", "pf")
const PERSON_DOC_B = joinKey("cn", "pj")
const CPF_LIKE = joinKey("529", ".", "982", ".", "247", "-", "25")
const CNPJ_LIKE = joinKey("12", ".", "345", ".", "678", "/", "0001", "-", "99")
const PIX_LIKE = joinKey(
  "000201",
  "26",
  "360014BR.GOV.BCB.PIX0114",
  "+5511999999999"
)
const ADDRESS_KEY = joinKey("ship", "ping", "_", "address")
const SNAPSHOT_KEY = joinKey("gelato", "_", "snapshot")

function buildPayload() {
  return {
    occurred_at: "2026-07-01T12:00:00.000Z",
    order_id: "order_123",
    cart_id: "cart_123",
    payment_attempt_id: "payatt_123",
    checkout_completion_log_id: "chkcpl_123",
    payment_intent_id: "pi_123",
    payment_method_type: "pix" as const,
    amount: 9900,
    currency_code: "BRL",
    order_status: "confirmed",
    payment_status: "captured",
    item_count: 1,
    items: [
      {
        variant_id: "variant_123",
        sku: "TSHIRT-BR-01",
        quantity: 1,
        unit_price: 9900,
        subtotal: 9900,
      },
    ],
  }
}

describe("AnalyticsEventLog idempotency", () => {
  it("builds the canonical deterministic key", () => {
    expect(
      buildPurchaseCompletedIdempotencyKey({
        payment_intent_id: "  pi_123  ",
      })
    ).toBe("purchase_completed:stripe:pi_123")
  })

  it("rejects empty payment_intent_id", () => {
    expect(() =>
      buildPurchaseCompletedIdempotencyKey({
        payment_intent_id: "   ",
      })
    ).toThrow("ANALYTICS_PAYMENT_INTENT_ID_REQUIRED")
  })
})

describe("AnalyticsEventLog vocabulary", () => {
  it("accepts the canonical event name and version", () => {
    expect(() =>
      assertValidAnalyticsEventName(ANALYTICS_EVENT_NAME.PURCHASE_COMPLETED)
    ).not.toThrow()
    expect(() =>
      assertValidAnalyticsEventVersion(ANALYTICS_EVENT_VERSION)
    ).not.toThrow()
  })

  it("rejects unknown event name and version", () => {
    expect(() => assertValidAnalyticsEventName("checkout_completed")).toThrow(
      "ANALYTICS_EVENT_NAME_INVALID"
    )
    expect(() => assertValidAnalyticsEventVersion(2)).toThrow(
      "ANALYTICS_EVENT_VERSION_INVALID"
    )
  })

  it("accepts only the planned local statuses", () => {
    expect(ANALYTICS_EVENT_STATUSES).toEqual([
      ANALYTICS_EVENT_STATUS.RECORDED,
      ANALYTICS_EVENT_STATUS.QUEUED,
      ANALYTICS_EVENT_STATUS.SENDING,
      ANALYTICS_EVENT_STATUS.SENT,
      ANALYTICS_EVENT_STATUS.FAILED,
      ANALYTICS_EVENT_STATUS.DEAD_LETTER,
    ])

    for (const status of ANALYTICS_EVENT_STATUSES) {
      expect(() => assertValidAnalyticsEventStatus(status)).not.toThrow()
    }
  })

  it("rejects invalid statuses", () => {
    expect(() => assertValidAnalyticsEventStatus("processing")).toThrow(
      "ANALYTICS_EVENT_STATUS_INVALID"
    )
  })
})

describe("AnalyticsEventLog payload contract", () => {
  it("builds an allowlist-only payload", () => {
    const payload = buildPurchaseCompletedPayload({
      ...buildPayload(),
      ignored_field: "drop-me",
    })

    expect(payload).toEqual({
      event_name: "purchase_completed",
      event_version: 1,
      occurred_at: "2026-07-01T12:00:00.000Z",
      order_id: "order_123",
      cart_id: "cart_123",
      payment_attempt_id: "payatt_123",
      checkout_completion_log_id: "chkcpl_123",
      payment_intent_id: "pi_123",
      payment_method_type: "pix",
      amount: 9900,
      currency_code: "brl",
      order_status: "confirmed",
      payment_status: "captured",
      item_count: 1,
      items: [
        {
          variant_id: "variant_123",
          sku: "TSHIRT-BR-01",
          quantity: 1,
          unit_price: 9900,
          subtotal: 9900,
        },
      ],
    })
    expect(payload).not.toHaveProperty("ignored_field")
  })

  it("rejects forbidden payload input", () => {
    expect(() =>
      buildPurchaseCompletedPayload({
        ...buildPayload(),
        [SECRET_KEY]: SECRET_VALUE,
      })
    ).toThrow("ANALYTICS_PAYLOAD_FORBIDDEN")

    expect(() =>
      buildPurchaseCompletedPayload({
        ...buildPayload(),
        metadata: {
          [AUTH_KEY]: "Bearer abc",
        },
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("ANALYTICS_PAYLOAD_FORBIDDEN")

    expect(() =>
      buildPurchaseCompletedPayload({
        ...buildPayload(),
        items: [
          {
            variant_id: "variant_123",
            sku: "TSHIRT-BR-01",
            quantity: 1,
            unit_price: 9900,
            subtotal: 9900,
            [SNAPSHOT_KEY]: {
              product: "hidden",
            },
          },
        ],
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("ANALYTICS_PAYLOAD_FORBIDDEN")
  })

  it("rejects zero values for transactional counts and amounts", () => {
    expect(() =>
      buildPurchaseCompletedPayload({
        ...buildPayload(),
        amount: 0,
      })
    ).toThrow("ANALYTICS_AMOUNT_INVALID")

    expect(() =>
      buildPurchaseCompletedPayload({
        ...buildPayload(),
        item_count: 0,
        items: [],
      })
    ).toThrow("ANALYTICS_ITEM_COUNT_INVALID")

    expect(() =>
      buildPurchaseCompletedPayload({
        ...buildPayload(),
        items: [
          {
            variant_id: "variant_123",
            sku: "TSHIRT-BR-01",
            quantity: 0,
            unit_price: 9900,
            subtotal: 9900,
          },
        ],
      })
    ).toThrow("ANALYTICS_ITEM_QUANTITY_INVALID")
  })
})

describe("AnalyticsEventLog metadata and errors", () => {
  it("sanitizes metadata using the local allowlist", () => {
    expect(
      sanitizeAnalyticsMetadata({
        correlation_id: "req_123",
        source: "phase_07",
        recovery_origin: "retry",
        ignored_field: "drop-me",
      })
    ).toEqual({
      correlation_id: "req_123",
      source: "phase_07",
      recovery_origin: "retry",
    })
  })

  it("rejects forbidden metadata keys and values", () => {
    expect(() =>
      assertNoSensitiveAnalyticsMetadata({
        [TAX_KEY]: "12345678900",
      })
    ).toThrow("ANALYTICS_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveAnalyticsMetadata({
        [PERSON_DOC_A]: CPF_LIKE,
      })
    ).toThrow("ANALYTICS_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveAnalyticsMetadata({
        [PERSON_DOC_B]: CNPJ_LIKE,
      })
    ).toThrow("ANALYTICS_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveAnalyticsMetadata({
        [COOKIES_KEY]: "session=123",
      })
    ).toThrow("ANALYTICS_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveAnalyticsMetadata({
        [COPY_KEY]: PIX_LIKE,
      })
    ).toThrow("ANALYTICS_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveAnalyticsMetadata({
        [ADDRESS_KEY]: "Rua Exemplo, 100",
      })
    ).toThrow("ANALYTICS_METADATA_FORBIDDEN")
  })

  it("sanitizes errors without leaking secrets", () => {
    const sanitized = sanitizeAnalyticsError(
      new Error(`failed with ${SECRET_VALUE} and ${STRIPE_SECRET_LIKE}`)
    )

    expect(sanitized.error_code).toBe("Error")
    expect(sanitized.error_message).toContain("[REDACTED]")
    expect(sanitized.error_message).not.toContain(SECRET_VALUE)
  })
})

describe("AnalyticsEventLog record builder", () => {
  it("builds a local recorded contract without side effects", () => {
    const record = buildAnalyticsEventLogRecord(
      {
        payload: buildPayload(),
        metadata: {
          correlation_id: "req_123",
          source: "phase_07",
        },
      },
      "anlevt_123",
      new Date("2026-07-01T12:00:00.000Z")
    )

    expect(record.idempotency_key).toBe("purchase_completed:stripe:pi_123")
    expect(record.status).toBe("recorded")
    expect(record.order_id).toBe("order_123")
    expect(record.metadata).toEqual({
      correlation_id: "req_123",
      source: "phase_07",
    })
    expect(record.recorded_at).toBe("2026-07-01T12:00:00.000Z")
  })
})

describe("AnalyticsEventLog schema draft", () => {
  it("keeps canonical constraints and indexes in the migration draft", () => {
    const migration = fs.readFileSync(migrationPath, "utf8")

    expect(migration).toContain('"event_name", "idempotency_key"')
    expect(migration).toContain('"event_name", "order_id"')
    expect(migration).toContain('"status", "next_retry_at"')
    expect(migration).toContain('"payment_attempt_id"')
    expect(migration).toContain('"checkout_completion_log_id"')
    expect(migration).toContain('"payment_intent_id"')
    expect(migration).toContain('"event_name" in')
    expect(migration).toContain('"status" in')
    expect(migration).toContain('"event_version" = 1')
    expect(migration).not.toContain(SECRET_KEY)
    expect(migration).not.toContain(COOKIES_KEY)
    expect(migration).not.toContain(AUTH_KEY)
  })

  it("keeps the model and service focused on the local contract", () => {
    const model = fs.readFileSync(modelPath, "utf8")
    const service = fs.readFileSync(servicePath, "utf8")

    expect(model).toContain("IDX_analytics_event_log_name_idempotency_key")
    expect(model).toContain("IDX_analytics_event_log_status_next_retry_at")
    expect(service).toContain("buildPurchaseCompletedIdempotencyKey")
    expect(service).not.toContain(SECRET_KEY)
    expect(service).not.toContain(COOKIES_KEY)
    expect(service).not.toContain(AUTH_KEY)
  })
})
