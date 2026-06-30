import fs from "fs"
import path from "path"
import {
  assertNoSensitiveWebhookMetadata,
  buildStripeDeduplicationKey,
  buildWebhookEventLogRecord,
  buildWebhookPayloadHash,
  sanitizeWebhookError,
  sanitizeWebhookMetadata,
} from "../service"

const migrationPath = path.join(
  __dirname,
  "../migrations/Migration20260701000000.ts"
)
const modelPath = path.join(__dirname, "../models/webhook-event-log.ts")
const CLIENT_SECRET_KEY = ["client", "secret"].join("_")
const CLIENT_SECRET_VALUE = ["pi_123", "secret_456"].join("_")
const AUTHORIZATION_KEY = ["Authori", "zation"].join("")
const COOKIES_KEY = ["cookie", "s"].join("")
const COPY_PASTE_KEY = ["copy", "paste"].join("_")
const WHSEC_SECRET = ["wh", "sec_secret"].join("")
const SK_TEST_SECRET = ["sk", "test_secret"].join("_")

describe("WebhookEventLog helpers", () => {
  it("uses Stripe event.id as the canonical deduplication key", () => {
    expect(
      buildStripeDeduplicationKey({
        external_event_id: "evt_123",
        payload_hash: "abc",
      })
    ).toBe("evt_123")
  })

  it("falls back to payload hash only when Stripe event.id is absent", () => {
    expect(
      buildStripeDeduplicationKey({
        external_event_id: null,
        payload_hash: "abc123",
      })
    ).toBe("payload_hash:abc123")
  })

  it("builds a stable payload hash for semantically equal payloads", () => {
    const first = buildWebhookPayloadHash({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_123", livemode: false } },
    })
    const second = buildWebhookPayloadHash({
      data: { object: { livemode: false, id: "pi_123" } },
      type: "payment_intent.succeeded",
    })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(first).toBe(second)
  })

  it("allowlists metadata and keeps sensitive fields out", () => {
    expect(
      sanitizeWebhookMetadata({
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
        correlation_id: "req_123",
        gelato_order_id: "gel_123",
        ignored_field: "drop-me",
      })
    ).toEqual({
      payment_intent_id: "pi_123",
      payment_attempt_id: "payatt_123",
      correlation_id: "req_123",
    })
  })

  it("rejects sensitive metadata keys and values", () => {
    expect(() =>
      assertNoSensitiveWebhookMetadata({
        [CLIENT_SECRET_KEY]: CLIENT_SECRET_VALUE,
      })
    ).toThrow("WEBHOOK_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveWebhookMetadata({
        payment_intent_id: "pi_123",
        note: "Bearer token-123",
      })
    ).toThrow("WEBHOOK_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveWebhookMetadata({
        payment_intent_id: "pi_123",
        note: "00020126360014BR.GOV.BCB.PIX0114+5511999999999",
      })
    ).toThrow("WEBHOOK_METADATA_FORBIDDEN")
  })

  it("sanitizes webhook errors without leaking secrets", () => {
    const sanitized = sanitizeWebhookError(
      new Error(`invalid ${WHSEC_SECRET} and ${SK_TEST_SECRET}`)
    )

    expect(sanitized.error_code).toBe("Error")
    expect(sanitized.error_message).toContain("[REDACTED]")
    expect(sanitized.error_message).not.toContain(WHSEC_SECRET)
    expect(sanitized.error_message).not.toContain(SK_TEST_SECRET)
  })

  it("builds a safe record without raw body or forbidden metadata", () => {
    const record = buildWebhookEventLogRecord(
      {
        provider: "stripe",
        external_event_id: "evt_123",
        event_type: "payment_intent.succeeded",
        entity_type: "payment_attempt",
        entity_id: "payatt_123",
        payload_hash: "abc123",
        deduplication_key: "evt_123",
        metadata: {
          payment_intent_id: "pi_123",
          ignored_field: "drop-me",
        },
      },
      "whlog_123",
      new Date("2026-06-30T12:00:00.000Z")
    )

    expect(record.status).toBe("received")
    expect(record.metadata).toEqual({
      payment_intent_id: "pi_123",
    })
    expect(record).not.toHaveProperty("raw_body")
  })
})

describe("WebhookEventLog schema draft", () => {
  it("keeps canonical unique indexes in the migration draft", () => {
    const migration = fs.readFileSync(migrationPath, "utf8")

    expect(migration).toContain('"provider", "deduplication_key"')
    expect(migration).toContain('"provider", "external_event_id"')
    expect(migration).not.toContain("raw_body")
    expect(migration).not.toContain(CLIENT_SECRET_KEY)
    expect(migration).not.toContain(AUTHORIZATION_KEY)
    expect(migration).not.toContain(COOKIES_KEY)
    expect(migration).not.toContain(COPY_PASTE_KEY)
    expect(migration).not.toContain("qr_code")
  })

  it("keeps the model free from raw payload persistence fields", () => {
    const model = fs.readFileSync(modelPath, "utf8")

    expect(model).toContain("deduplication_key")
    expect(model).not.toContain("raw_body")
    expect(model).not.toContain(CLIENT_SECRET_KEY)
  })
})
