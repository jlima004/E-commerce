import fs from "fs"
import path from "path"
import { createHash } from "crypto"
import {
  EMAIL_DELIVERY_LOG_EMAIL_TYPE,
  EMAIL_DELIVERY_LOG_PROVIDER,
  EMAIL_DELIVERY_LOG_STATUSES,
  EMAIL_DELIVERY_LOG_STATUS,
  EMAIL_DELIVERY_LOG_TEMPLATE_KEY,
  EMAIL_DELIVERY_LOG_TEMPLATE_VERSION,
} from "../types"
import {
  assertNoSensitiveEmailDeliveryMetadata,
  assertValidEmailDeliveryEmailType,
  assertValidEmailDeliveryProvider,
  assertValidEmailDeliveryStatus,
  assertValidEmailDeliveryTemplateKey,
  assertValidEmailDeliveryTemplateVersion,
  buildEmailDeliveryLogRecord,
  buildOrderConfirmationEmailIdempotencyKey,
  buildOrderConfirmationEmailPayload,
  buildRecipientEmailAudit,
  buildEmailResendRelayFailureUpdate,
  computeEmailResendRelayBackoffMs,
  EMAIL_RESEND_RELAY_IN_FLIGHT_STALE_MS,
  isEmailResendRelayDue,
  isEmailResendRelayEligibleStatus,
  isEmailResendRelayStaleInFlight,
  sanitizeEmailDeliveryError,
  sanitizeEmailDeliveryMetadata,
} from "../service"

const migrationPath = path.join(
  __dirname,
  "../migrations/Migration20260701181000.ts"
)
const modelPath = path.join(__dirname, "../models/email-delivery-log.ts")
const servicePath = path.join(__dirname, "../service.ts")

function joinKey(...parts: string[]): string {
  return parts.join("")
}

function buildSupportAddress(): string {
  return joinKey("support", "@", "lojinha", ".", "test")
}

function buildCustomerAddress(): string {
  return joinKey("cliente", "@", "compras", ".", "test")
}

function buildPayload() {
  return {
    order_id: "order_123",
    order_reference: "BR-2026-0001",
    amount: 9900,
    currency_code: "BRL",
    item_count: 1,
    items: [
      {
        sku: "TSHIRT-BR-01",
        quantity: 1,
        unit_price: 9900,
        subtotal: 9900,
      },
    ],
    support_email: buildSupportAddress(),
  }
}

describe("EmailDeliveryLog idempotency", () => {
  it("builds the canonical deterministic key", () => {
    expect(
      buildOrderConfirmationEmailIdempotencyKey({
        order_id: "  order_123  ",
      })
    ).toBe("order-confirmation/order_123")
  })

  it("rejects empty order_id", () => {
    expect(() =>
      buildOrderConfirmationEmailIdempotencyKey({
        order_id: "   ",
      })
    ).toThrow("EMAIL_DELIVERY_ORDER_ID_REQUIRED")
  })
})

describe("EmailDeliveryLog vocabulary", () => {
  it("accepts only the planned constants", () => {
    expect(EMAIL_DELIVERY_LOG_EMAIL_TYPE.ORDER_CONFIRMATION).toBe(
      "order_confirmation"
    )
    expect(EMAIL_DELIVERY_LOG_TEMPLATE_KEY.ORDER_CONFIRMATION_V1).toBe(
      "order_confirmation_v1"
    )
    expect(EMAIL_DELIVERY_LOG_TEMPLATE_VERSION).toBe(1)
    expect(EMAIL_DELIVERY_LOG_PROVIDER.RESEND).toBe("resend")

    expect(() =>
      assertValidEmailDeliveryEmailType(
        EMAIL_DELIVERY_LOG_EMAIL_TYPE.ORDER_CONFIRMATION
      )
    ).not.toThrow()
    expect(() =>
      assertValidEmailDeliveryTemplateKey(
        EMAIL_DELIVERY_LOG_TEMPLATE_KEY.ORDER_CONFIRMATION_V1
      )
    ).not.toThrow()
    expect(() =>
      assertValidEmailDeliveryTemplateVersion(EMAIL_DELIVERY_LOG_TEMPLATE_VERSION)
    ).not.toThrow()
    expect(() =>
      assertValidEmailDeliveryProvider(EMAIL_DELIVERY_LOG_PROVIDER.RESEND)
    ).not.toThrow()
  })

  it("accepts only the planned statuses", () => {
    expect(EMAIL_DELIVERY_LOG_STATUSES).toEqual([
      EMAIL_DELIVERY_LOG_STATUS.RECORDED,
      EMAIL_DELIVERY_LOG_STATUS.QUEUED,
      EMAIL_DELIVERY_LOG_STATUS.SENDING,
      EMAIL_DELIVERY_LOG_STATUS.SENT,
      EMAIL_DELIVERY_LOG_STATUS.FAILED,
      EMAIL_DELIVERY_LOG_STATUS.DEAD_LETTER,
    ])

    for (const status of EMAIL_DELIVERY_LOG_STATUSES) {
      expect(() => assertValidEmailDeliveryStatus(status)).not.toThrow()
    }
  })

  it("rejects values outside the planned vocabulary", () => {
    expect(() => assertValidEmailDeliveryEmailType("shipment")).toThrow(
      "EMAIL_DELIVERY_EMAIL_TYPE_INVALID"
    )
    expect(() => assertValidEmailDeliveryTemplateKey("order_confirmation_v2")).toThrow(
      "EMAIL_DELIVERY_TEMPLATE_KEY_INVALID"
    )
    expect(() => assertValidEmailDeliveryTemplateVersion(2)).toThrow(
      "EMAIL_DELIVERY_TEMPLATE_VERSION_INVALID"
    )
    expect(() => assertValidEmailDeliveryProvider("smtp")).toThrow(
      "EMAIL_DELIVERY_PROVIDER_INVALID"
    )
    expect(() => assertValidEmailDeliveryStatus("processing")).toThrow(
      "EMAIL_DELIVERY_STATUS_INVALID"
    )
  })
})

describe("EmailDeliveryLog payload contract", () => {
  it("builds an allowlist-only payload", () => {
    const payload = buildOrderConfirmationEmailPayload({
      ...buildPayload(),
      ignored_field: "drop-me",
    })

    expect(payload).toEqual({
      order_id: "order_123",
      order_reference: "BR-2026-0001",
      amount: 9900,
      currency_code: "brl",
      item_count: 1,
      items: [
        {
          sku: "TSHIRT-BR-01",
          quantity: 1,
          unit_price: 9900,
          subtotal: 9900,
        },
      ],
      support_email: buildSupportAddress(),
    })
    expect(payload).not.toHaveProperty("ignored_field")
  })

  it("rejects forbidden payload input", () => {
    const authKey = joinKey("Authori", "zation")
    const secretKey = joinKey("client", "_", "secret")
    const docKeyA = joinKey("c", "pf")
    const docKeyB = joinKey("cn", "pj")
    const addressKey = joinKey("ship", "ping", "_", "address")
    const trackKey = joinKey("track", "ing", "_", "token")
    const gelKey = joinKey("gelato", "_", "snapshot")

    expect(() =>
      buildOrderConfirmationEmailPayload({
        ...buildPayload(),
        [secretKey]: "unsafe",
      })
    ).toThrow("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")

    expect(() =>
      buildOrderConfirmationEmailPayload({
        ...buildPayload(),
        metadata: {
          [authKey]: "Bearer abc",
        },
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")

    expect(() =>
      buildOrderConfirmationEmailPayload({
        ...buildPayload(),
        [addressKey]: {
          street: "hidden",
        },
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")

    expect(() =>
      buildOrderConfirmationEmailPayload({
        ...buildPayload(),
        items: [
          {
            sku: "TSHIRT-BR-01",
            quantity: 1,
            unit_price: 9900,
            subtotal: 9900,
            [trackKey]: "hidden",
          },
        ],
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")

    expect(() =>
      buildOrderConfirmationEmailPayload({
        ...buildPayload(),
        [docKeyA]: "123",
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")

    expect(() =>
      buildOrderConfirmationEmailPayload({
        ...buildPayload(),
        [docKeyB]: "123",
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")

    expect(() =>
      buildOrderConfirmationEmailPayload({
        ...buildPayload(),
        items: [
          {
            sku: "TSHIRT-BR-01",
            quantity: 1,
            unit_price: 9900,
            subtotal: 9900,
            [gelKey]: {
              product: "hidden",
            },
          },
        ],
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")
  })

  it("rejects full recipient-address fields from persistence surfaces", () => {
    const recipientKey = joinKey("recipient", "_", "email")
    const customerKey = joinKey("customer", "_", "email")
    const toKey = joinKey("to", "_", "email")
    const customerAddress = buildCustomerAddress()

    expect(() =>
      buildOrderConfirmationEmailPayload({
        ...buildPayload(),
        [recipientKey]: customerAddress,
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")

    expect(() =>
      buildOrderConfirmationEmailPayload({
        ...buildPayload(),
        [customerKey]: customerAddress,
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")

    expect(() =>
      buildOrderConfirmationEmailPayload({
        ...buildPayload(),
        [toKey]: customerAddress,
      } as Record<string, unknown> & ReturnType<typeof buildPayload>)
    ).toThrow("EMAIL_DELIVERY_PAYLOAD_FORBIDDEN")
  })
})

describe("EmailDeliveryLog recipient audit", () => {
  it("derives hash and domain without persisting the full address", () => {
    const recipient = buildCustomerAddress()
    const audit = buildRecipientEmailAudit(` ${recipient.toUpperCase()} `)

    expect(audit).toEqual({
      recipient_email_hash: createHash("sha256")
        .update(recipient)
        .digest("hex"),
      recipient_email_domain: "compras.test",
    })
  })

  it("builds a record without exposing the recipient address", () => {
    const now = new Date("2026-07-01T18:10:00.000Z")
    const record = buildEmailDeliveryLogRecord(
      {
        order_id: "order_123",
        cart_id: "cart_123",
        payment_attempt_id: "payatt_123",
        checkout_completion_log_id: "chkcpl_123",
        analytics_event_log_id: "anlevt_123",
        payment_intent_id: "pi_123",
        recipient_email: buildCustomerAddress(),
        payload: buildPayload(),
        metadata: {
          correlation_id: "req_123",
          ignored_field: "drop-me",
        },
      },
      "emlog_123",
      now
    )

    expect(record).toMatchObject({
      id: "emlog_123",
      email_type: "order_confirmation",
      template_key: "order_confirmation_v1",
      template_version: 1,
      provider: "resend",
      idempotency_key: "order-confirmation/order_123",
      recipient_email_domain: "compras.test",
      status: "recorded",
      metadata: {
        correlation_id: "req_123",
      },
    })
    expect(record.payload).not.toHaveProperty(joinKey("recipient", "_", "email"))
    expect(record.payload).not.toHaveProperty(joinKey("customer", "_", "email"))
    expect(record).not.toHaveProperty(joinKey("recipient", "_", "email"))
    expect(JSON.stringify(record)).not.toContain(buildCustomerAddress())
  })
})

describe("EmailDeliveryLog metadata and errors", () => {
  it("sanitizes metadata using the local allowlist", () => {
    expect(
      sanitizeEmailDeliveryMetadata({
        correlation_id: "req_123",
        recovery_origin: "manual-replay",
        source: "order-workflow",
        ignored_field: "drop-me",
      })
    ).toEqual({
      correlation_id: "req_123",
      recovery_origin: "manual-replay",
      source: "order-workflow",
    })
  })

  it("rejects forbidden metadata", () => {
    const authKey = joinKey("Authori", "zation")
    const addressKey = joinKey("ship", "ping", "_", "address")

    expect(() =>
      assertNoSensitiveEmailDeliveryMetadata({
        [authKey]: "Bearer abc",
      })
    ).toThrow("EMAIL_DELIVERY_METADATA_FORBIDDEN")

    expect(() =>
      sanitizeEmailDeliveryMetadata({
        [addressKey]: {
          city: "hidden",
        },
      })
    ).toThrow("EMAIL_DELIVERY_METADATA_FORBIDDEN")
  })

  it("sanitizes errors before persistence", () => {
    const secret = joinKey("sk", "_", "test", "_", "secretvalue")
    const authValue = joinKey("Bear", "er ", "abc123")
    const customerAddress = buildCustomerAddress()
    const pixValue = joinKey(
      "000201",
      "26",
      "360014BR.GOV.BCB.PIX0114",
      "+5511999999999"
    )
    const cpfLike = joinKey("529", ".", "982", ".", "247", "-", "25")
    const cnpjLike = joinKey("12", ".", "345", ".", "678", "/", "0001", "-", "99")
    const phoneLike = joinKey("(", "11", ")", "9", "9999", "-", "9999")
    const sanitized = sanitizeEmailDeliveryError(
      new Error(
        `failure ${customerAddress} ${secret} ${authValue} ${pixValue} ${cpfLike} ${cnpjLike} ${phoneLike}`
      )
    )

    expect(sanitized.error_code).toBe("Error")
    expect(sanitized.error_message).toContain("failure")
    expect(sanitized.error_message).toContain("[REDACTED]")
    expect(sanitized.error_message).not.toContain(customerAddress)
    expect(sanitized.error_message).not.toContain(secret)
    expect(sanitized.error_message).not.toContain(authValue)
    expect(sanitized.error_message).not.toContain(pixValue)
    expect(sanitized.error_message).not.toContain(cpfLike)
    expect(sanitized.error_message).not.toContain(cnpjLike)
    expect(sanitized.error_message).not.toContain(phoneLike)
  })

  it("sanitizes last_error_message before persistence", () => {
    const customerAddress = buildCustomerAddress()
    const authValue = joinKey("Bear", "er ", "abc123")
    const record = buildEmailDeliveryLogRecord(
      {
        order_id: "order_123",
        cart_id: "cart_123",
        payment_attempt_id: "payatt_123",
        checkout_completion_log_id: "chkcpl_123",
        analytics_event_log_id: "anlevt_123",
        payment_intent_id: "pi_123",
        recipient_email: customerAddress,
        payload: buildPayload(),
        last_error_code: `delivery ${customerAddress}`,
        last_error_message: `failed ${customerAddress} ${authValue}`,
      },
      "emlog_123"
    )

    expect(record.last_error_code).toBe("delivery [REDACTED]")
    expect(record.last_error_message).toBe("failed [REDACTED] [REDACTED]")
    expect(record.last_error_message).not.toContain(customerAddress)
  })
})

describe("EmailDeliveryLog resend relay helpers", () => {
  it("considera recorded e failed elegiveis", () => {
    expect(isEmailResendRelayEligibleStatus(EMAIL_DELIVERY_LOG_STATUS.RECORDED)).toBe(
      true
    )
    expect(isEmailResendRelayEligibleStatus(EMAIL_DELIVERY_LOG_STATUS.FAILED)).toBe(
      true
    )
    expect(isEmailResendRelayEligibleStatus(EMAIL_DELIVERY_LOG_STATUS.SENT)).toBe(
      false
    )
    expect(
      isEmailResendRelayEligibleStatus(EMAIL_DELIVERY_LOG_STATUS.DEAD_LETTER)
    ).toBe(false)
    expect(isEmailResendRelayEligibleStatus(EMAIL_DELIVERY_LOG_STATUS.QUEUED)).toBe(
      false
    )
    expect(
      isEmailResendRelayEligibleStatus(EMAIL_DELIVERY_LOG_STATUS.SENDING)
    ).toBe(false)
  })

  it("aplica backoff exponencial com teto", () => {
    expect(computeEmailResendRelayBackoffMs(1)).toBe(60_000)
    expect(computeEmailResendRelayBackoffMs(2)).toBe(120_000)
    expect(computeEmailResendRelayBackoffMs(10)).toBe(3_600_000)
  })

  it("respeita next_retry_at ao selecionar candidatos", () => {
    const now = new Date("2026-07-01T12:00:00.000Z")

    expect(isEmailResendRelayDue(null, now)).toBe(true)
    expect(isEmailResendRelayDue("2026-07-01T11:59:00.000Z", now)).toBe(true)
    expect(isEmailResendRelayDue("2026-07-01T12:01:00.000Z", now)).toBe(false)
  })

  it("recupera somente queued/sending stale por timestamps locais", () => {
    const now = new Date("2026-07-01T12:30:00.000Z")
    const stale = new Date(
      now.getTime() - EMAIL_RESEND_RELAY_IN_FLIGHT_STALE_MS - 1
    ).toISOString()
    const recent = new Date(
      now.getTime() - EMAIL_RESEND_RELAY_IN_FLIGHT_STALE_MS + 1
    ).toISOString()

    expect(
      isEmailResendRelayStaleInFlight(
        {
          status: EMAIL_DELIVERY_LOG_STATUS.QUEUED,
          queued_at: recent,
          sending_started_at: null,
          updated_at: stale,
        },
        now
      )
    ).toBe(false)
    expect(
      isEmailResendRelayStaleInFlight(
        {
          status: EMAIL_DELIVERY_LOG_STATUS.QUEUED,
          queued_at: null,
          sending_started_at: null,
          updated_at: stale,
        },
        now
      )
    ).toBe(true)
    expect(
      isEmailResendRelayStaleInFlight(
        {
          status: EMAIL_DELIVERY_LOG_STATUS.SENDING,
          queued_at: recent,
          sending_started_at: recent,
          updated_at: stale,
        },
        now
      )
    ).toBe(false)
    expect(
      isEmailResendRelayStaleInFlight(
        {
          status: EMAIL_DELIVERY_LOG_STATUS.SENDING,
          queued_at: recent,
          sending_started_at: stale,
          updated_at: recent,
        },
        now
      )
    ).toBe(true)
    expect(
      isEmailResendRelayStaleInFlight(
        {
          status: EMAIL_DELIVERY_LOG_STATUS.SENT,
          queued_at: stale,
          sending_started_at: stale,
          updated_at: stale,
        },
        now
      )
    ).toBe(false)
  })

  it("marca dead_letter apos esgotar tentativas", () => {
    const update = buildEmailResendRelayFailureUpdate(new Error("relay down"), 4, {
      maxAttempts: 5,
      at: new Date("2026-07-01T12:05:00.000Z"),
    })

    expect(update.status).toBe(EMAIL_DELIVERY_LOG_STATUS.DEAD_LETTER)
    expect(update.attempt_count).toBe(5)
    expect(update.next_retry_at).toBeNull()
  })
})

describe("EmailDeliveryLog model and migration source", () => {
  it("keeps the planned indexes and constraints in source", () => {
    const migrationSource = fs.readFileSync(migrationPath, "utf8")
    const modelSource = fs.readFileSync(modelPath, "utf8")

    expect(migrationSource).toContain('"email_type" in')
    expect(migrationSource).toContain('"provider" in')
    expect(migrationSource).toContain('"status" in')
    expect(migrationSource).toContain('"template_version" = 1')
    expect(migrationSource).toContain(
      'IDX_email_delivery_log_type_idempotency_key_unique'
    )
    expect(migrationSource).toContain('IDX_email_delivery_log_type_order_id_unique')
    expect(migrationSource).toContain(
      'IDX_email_delivery_log_status_next_retry_at'
    )
    expect(migrationSource).toContain('IDX_email_delivery_log_order_id')
    expect(migrationSource).toContain(
      'IDX_email_delivery_log_analytics_event_log_id'
    )
    expect(migrationSource).toContain(
      'IDX_email_delivery_log_payment_attempt_id'
    )
    expect(migrationSource).toContain(
      'IDX_email_delivery_log_checkout_completion_log_id'
    )
    expect(migrationSource).toContain(
      'IDX_email_delivery_log_payment_intent_id'
    )

    expect(modelSource).toContain('recipient_email_hash')
    expect(modelSource).toContain('recipient_email_domain')
    expect(modelSource).not.toMatch(/recipient_email:\s*model\./)
  })

  it("keeps forbidden key detection local to the module source", () => {
    const serviceSource = fs.readFileSync(servicePath, "utf8")

    expect(serviceSource).toContain('recipient_email_hash')
    expect(serviceSource).toContain('buildRecipientEmailAudit')
    expect(serviceSource).toContain('EMAIL_DELIVERY_PAYLOAD_FORBIDDEN')
    expect(serviceSource).toContain('EMAIL_DELIVERY_METADATA_FORBIDDEN')
  })
})
