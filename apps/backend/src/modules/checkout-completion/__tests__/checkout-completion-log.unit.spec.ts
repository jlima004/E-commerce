import fs from "fs"
import path from "path"
import {
  assertNoSensitiveCheckoutCompletionMetadata,
  assertValidCheckoutCompletionOperation,
  assertValidCheckoutCompletionStatus,
  buildCheckoutCompletionIdempotencyKey,
  buildCheckoutCompletionLogRecord,
  resolveCheckoutCompletionClaimDecision,
  sanitizeCheckoutCompletionMetadata,
} from "../service"
import {
  CHECKOUT_COMPLETION_STALE_AFTER_MS,
  isCheckoutCompletionLockedStale,
} from "../staleness"
import {
  CHECKOUT_COMPLETION_OPERATION,
  CHECKOUT_COMPLETION_STATUS,
} from "../types"

const migrationPath = path.join(
  __dirname,
  "../migrations/Migration20260702000000.ts"
)
const modelPath = path.join(
  __dirname,
  "../models/checkout-completion-log.ts"
)
const servicePath = path.join(__dirname, "../service.ts")
const CLIENT_SECRET_KEY = ["client", "secret"].join("_")
const CLIENT_SECRET_VALUE = ["pi_123", "secret_456"].join("_")
const AUTHORIZATION_KEY = ["Authori", "zation"].join("")
const COOKIES_KEY = ["cookie", "s"].join("")
const COPY_PASTE_KEY = ["copy", "paste"].join("_")

describe("CheckoutCompletionLog idempotency helpers", () => {
  it("builds a deterministic idempotency key from payment_intent_id", () => {
    const first = buildCheckoutCompletionIdempotencyKey({
      payment_intent_id: "pi_123",
    })
    const second = buildCheckoutCompletionIdempotencyKey({
      payment_intent_id: "  pi_123  ",
    })

    expect(first).toBe("pi_123")
    expect(second).toBe("pi_123")
    expect(first).toBe(second)
  })

  it("supports composite idempotency keys as cart_id:payment_intent_id", () => {
    expect(
      buildCheckoutCompletionIdempotencyKey({
        payment_intent_id: "pi_123",
        cart_id: "cart_456",
        composite: true,
      })
    ).toBe("cart_456:pi_123")
  })

  it("rejects missing payment_intent_id", () => {
    expect(() =>
      buildCheckoutCompletionIdempotencyKey({
        payment_intent_id: "   ",
      })
    ).toThrow("CHECKOUT_COMPLETION_PAYMENT_INTENT_ID_REQUIRED")
  })
})

describe("CheckoutCompletionLog status and operation vocabulary", () => {
  it("accepts the canonical operation", () => {
    expect(() =>
      assertValidCheckoutCompletionOperation(
        CHECKOUT_COMPLETION_OPERATION.COMPLETE_CHECKOUT_CREATE_ORDER
      )
    ).not.toThrow()
  })

  it("rejects unknown operations", () => {
    expect(() => assertValidCheckoutCompletionOperation("create_order")).toThrow(
      "CHECKOUT_COMPLETION_OPERATION_INVALID"
    )
  })

  it("accepts processing, completed and failed statuses", () => {
    for (const status of [
      CHECKOUT_COMPLETION_STATUS.PROCESSING,
      CHECKOUT_COMPLETION_STATUS.COMPLETED,
      CHECKOUT_COMPLETION_STATUS.FAILED,
    ]) {
      expect(() => assertValidCheckoutCompletionStatus(status)).not.toThrow()
    }
  })

  it("rejects unknown statuses", () => {
    expect(() => assertValidCheckoutCompletionStatus("paid")).toThrow(
      "CHECKOUT_COMPLETION_STATUS_INVALID"
    )
  })
})

describe("CheckoutCompletionLog metadata allowlist", () => {
  it("keeps only allowlisted metadata keys", () => {
    expect(
      sanitizeCheckoutCompletionMetadata({
        stripe_event_id: "evt_123",
        payment_method_type: "pix",
        correlation_id: "req_123",
        order_creation_error_name: "Error",
        order_creation_error_code: "ORDER_ENTRYPOINT_FAILED",
        order_creation_error_message: "completeCart failed",
        order_creation_error_step: "create-order-from-confirmed-attempt",
        cart_id: "cart_123",
        payment_attempt_id: "payatt_123",
        payment_intent_id: "pi_123",
        ignored_field: "drop-me",
      })
    ).toEqual({
      stripe_event_id: "evt_123",
      payment_method_type: "pix",
      correlation_id: "req_123",
      order_creation_error_name: "Error",
      order_creation_error_code: "ORDER_ENTRYPOINT_FAILED",
      order_creation_error_message: "completeCart failed",
      order_creation_error_step: "create-order-from-confirmed-attempt",
      cart_id: "cart_123",
      payment_attempt_id: "payatt_123",
      payment_intent_id: "pi_123",
    })
  })

  it("rejects sensitive metadata keys and values", () => {
    expect(() =>
      assertNoSensitiveCheckoutCompletionMetadata({
        [CLIENT_SECRET_KEY]: CLIENT_SECRET_VALUE,
      })
    ).toThrow("CHECKOUT_COMPLETION_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveCheckoutCompletionMetadata({
        stripe_event_id: "evt_123",
        note: "Bearer token-123",
      })
    ).toThrow("CHECKOUT_COMPLETION_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveCheckoutCompletionMetadata({
        stripe_event_id: "evt_123",
        note: "00020126360014BR.GOV.BCB.PIX0114+5511999999999",
      })
    ).toThrow("CHECKOUT_COMPLETION_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveCheckoutCompletionMetadata({
        cpf: "529.982.247-25",
      })
    ).toThrow("CHECKOUT_COMPLETION_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveCheckoutCompletionMetadata({
        stripe_event_id: "evt_123",
        [AUTHORIZATION_KEY]: "Bearer abc",
      })
    ).toThrow("CHECKOUT_COMPLETION_METADATA_FORBIDDEN")
  })
})

describe("CheckoutCompletionLog schema draft", () => {
  it("keeps canonical unique indexes and lookup indexes in the migration draft", () => {
    const migration = fs.readFileSync(migrationPath, "utf8")

    expect(migration).toContain('"idempotency_key"')
    expect(migration).toContain(
      'IDX_checkout_completion_log_idempotency_key_unique'
    )
    expect(migration).toContain('"payment_intent_id"')
    expect(migration).toContain('"cart_id"')
    expect(migration).toContain('"payment_attempt_id"')
    expect(migration).toContain('"order_id"')
    expect(migration).toContain('"status", "locked_at"')
    expect(migration).toContain('"operation" in')
    expect(migration).toContain('"status" in')
    expect(migration).not.toContain("raw_body")
    expect(migration).not.toContain(CLIENT_SECRET_KEY)
    expect(migration).not.toContain(AUTHORIZATION_KEY)
    expect(migration).not.toContain(COOKIES_KEY)
    expect(migration).not.toContain(COPY_PASTE_KEY)
  })

  it("keeps the model free from raw payload persistence fields", () => {
    const model = fs.readFileSync(modelPath, "utf8")

    expect(model).toContain("idempotency_key")
    expect(model).toContain("IDX_checkout_completion_log_status_locked_at")
    expect(model).not.toContain("raw_body")
    expect(model).not.toContain(CLIENT_SECRET_KEY)
  })
})

describe("CheckoutCompletionLog schema slice side effects", () => {
  it("builds an audit record without order creation side effects", () => {
    const record = buildCheckoutCompletionLogRecord(
      {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
        metadata: {
          stripe_event_id: "evt_123",
          payment_method_type: "card",
          correlation_id: "req_123",
        },
      },
      "chkcpl_123",
      new Date("2026-06-30T12:00:00.000Z")
    )

    expect(record.operation).toBe(
      CHECKOUT_COMPLETION_OPERATION.COMPLETE_CHECKOUT_CREATE_ORDER
    )
    expect(record.status).toBe(CHECKOUT_COMPLETION_STATUS.PROCESSING)
    expect(record.idempotency_key).toBe("pi_123")
    expect(record.order_id).toBeNull()
    expect(record.metadata).toEqual({
      stripe_event_id: "evt_123",
      payment_method_type: "card",
      correlation_id: "req_123",
    })
    expect(record).not.toHaveProperty("raw_body")
  })

  it("does not introduce downstream order or fulfillment runtime strings", () => {
    const migration = fs.readFileSync(migrationPath, "utf8")
    const serviceSource = fs.readFileSync(servicePath, "utf8")
    const forbiddenFragments = [
      ["complete", "Cart", "Workflow"].join(""),
      ["create", "Order", "Workflow"].join(""),
      ["purchase", "_", "completed"].join(""),
      ["Analytics", "EventLog"].join(""),
      ["Email", "DeliveryLog"].join(""),
      ["order", ".gelatoapis.com"].join(""),
    ]

    for (const fragment of forbiddenFragments) {
      expect(migration).not.toContain(fragment)
      expect(serviceSource).not.toContain(fragment)
    }
  })
})

describe("CheckoutCompletionLog retry/idempotency decisions", () => {
  it("prepara criacao sem id e usa payment_intent_id como idempotency_key", () => {
    const first = resolveCheckoutCompletionClaimDecision({
      existing: null,
      next: {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
      },
      at: new Date("2026-07-08T12:00:00.000Z"),
    })
    const second = resolveCheckoutCompletionClaimDecision({
      existing: null,
      next: {
        cart_id: "cart_456",
        payment_intent_id: "pi_456",
        payment_attempt_id: "payatt_456",
      },
      at: new Date("2026-07-08T12:01:00.000Z"),
    })

    expect(first.type).toBe("create")
    expect(second.type).toBe("create")
    if (first.type !== "create" || second.type !== "create") {
      return
    }

    expect(first.record).not.toHaveProperty("id")
    expect(second.record).not.toHaveProperty("id")
    expect(first.record.idempotency_key).toBe("pi_123")
    expect(second.record.idempotency_key).toBe("pi_456")
    expect(first.record.idempotency_key).not.toBe(second.record.idempotency_key)
  })

  it("reusa completed com order_id como resultado terminal idempotente", () => {
    const existing = buildCheckoutCompletionLogRecord(
      {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
        order_id: "order_123",
        status: CHECKOUT_COMPLETION_STATUS.COMPLETED,
        completed_at: "2026-07-08T12:00:00.000Z",
      },
      "chkcpl_123",
      new Date("2026-07-08T12:00:00.000Z")
    )

    const decision = resolveCheckoutCompletionClaimDecision({
      existing,
      next: {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
      },
      at: new Date("2026-07-08T12:05:00.000Z"),
    })

    expect(decision).toEqual({
      type: "reuse_completed",
      log: existing,
      order_id: "order_123",
    })
  })

  it("trata processing sem order_id como retryable antes de nova tentativa", () => {
    const existing = buildCheckoutCompletionLogRecord(
      {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
        status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
        locked_at: "2026-07-06T10:00:00.000Z",
      },
      "chkcpl_123",
      new Date("2026-07-06T10:00:00.000Z")
    )

    const decision = resolveCheckoutCompletionClaimDecision({
      existing,
      next: {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
      },
      at: new Date("2026-07-07T12:00:00.000Z"),
    })

    expect(decision.type).toBe("retry_processing_without_order")
    if (decision.type !== "retry_processing_without_order") {
      return
    }

    expect(decision.failedUpdate).toEqual(
      expect.objectContaining({
        status: CHECKOUT_COMPLETION_STATUS.FAILED,
        error_code: "CHECKOUT_COMPLETION_STALE_PROCESSING_WITHOUT_ORDER",
      })
    )
    expect(decision.retryUpdate).toEqual(
      expect.objectContaining({
        status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
        error_code: null,
        error_message: null,
      })
    )
  })

  it("reclama processing exatamente aos 15 minutos por locked_at", () => {
    const lockedAt = "2026-07-08T12:00:00.000Z"
    const existing = buildCheckoutCompletionLogRecord(
      {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
        status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
        locked_at: lockedAt,
      },
      "chkcpl_123",
      new Date(lockedAt)
    )

    const decision = resolveCheckoutCompletionClaimDecision({
      existing,
      next: {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
      },
      at: new Date("2026-07-08T12:15:00.000Z"),
    })

    expect(decision.type).toBe("retry_processing_without_order")
  })

  it("reclama processing acima de 15 minutos por locked_at", () => {
    const existing = buildCheckoutCompletionLogRecord(
      {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
        status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
        locked_at: "2026-07-08T12:00:00.000Z",
      },
      "chkcpl_123",
      new Date("2026-07-08T12:00:00.000Z")
    )

    const decision = resolveCheckoutCompletionClaimDecision({
      existing,
      next: {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
      },
      at: new Date("2026-07-08T12:15:01.000Z"),
    })

    expect(decision.type).toBe("retry_processing_without_order")
  })

  it("preserva processing fresco abaixo de 15 minutos", () => {
    const existing = buildCheckoutCompletionLogRecord(
      {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
        status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
        locked_at: "2026-07-08T12:00:00.000Z",
      },
      "chkcpl_123",
      new Date("2026-07-08T12:00:00.000Z")
    )

    const decision = resolveCheckoutCompletionClaimDecision({
      existing,
      next: {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
      },
      at: new Date("2026-07-08T12:14:59.000Z"),
    })

    expect(decision.type).toBe("already_processing")
  })

  it("nao reclama processing sem locked_at", () => {
    const existing = buildCheckoutCompletionLogRecord(
      {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
        status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
        locked_at: null,
      },
      "chkcpl_123",
      new Date("2026-07-08T12:00:00.000Z")
    )

    const decision = resolveCheckoutCompletionClaimDecision({
      existing,
      next: {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
      },
      at: new Date("2026-07-08T13:00:00.000Z"),
    })

    expect(decision.type).toBe("already_processing")
  })

  it("nao reclama processing com locked_at invalido", () => {
    const existing = buildCheckoutCompletionLogRecord(
      {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
        status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
        locked_at: "not-a-date",
      },
      "chkcpl_123",
      new Date("2026-07-08T12:00:00.000Z")
    )

    const decision = resolveCheckoutCompletionClaimDecision({
      existing,
      next: {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
      },
      at: new Date("2026-07-08T13:00:00.000Z"),
    })

    expect(decision.type).toBe("already_processing")
  })

  it("nao usa relogio instavel de payment attempt no reclaim de processing", async () => {
    const fs = await import("fs/promises")
    const path = await import("path")
    const source = await fs.readFile(
      path.join(__dirname, "..", "service.ts"),
      "utf8"
    )
    expect(source).toContain("CHECKOUT_COMPLETION_STALE_AFTER_MS")
    expect(source).toContain("isCheckoutCompletionLockedStale")
    expect(source).not.toMatch(
      /PaymentAttempt\.updated_at|paymentAttempt\.updated_at|payment_attempt\.updated_at/
    )
    expect(source).toMatch(/locked_at/)
  })

  it("owns stale claim policy without importing the alert module", async () => {
    const fs = await import("fs/promises")
    const path = await import("path")
    const serviceSource = await fs.readFile(
      path.join(__dirname, "..", "service.ts"),
      "utf8"
    )
    const forbiddenModule = ["operational", "alert"].join("-")
    expect(serviceSource).not.toContain(forbiddenModule)
    expect(serviceSource).toMatch(/from ["']\.\/staleness["']/)
  })

  describe("checkout-completion stale contract", () => {
    const NOW = new Date("2026-07-08T12:15:00.000Z")

    it("exports the fifteen-minute window", () => {
      expect(CHECKOUT_COMPLETION_STALE_AFTER_MS).toBe(15 * 60_000)
    })

    it("returns false for invalid locked_at", () => {
      expect(isCheckoutCompletionLockedStale("not-a-date", NOW)).toBe(false)
    })

    it("returns false for null locked_at", () => {
      expect(isCheckoutCompletionLockedStale(null, NOW)).toBe(false)
    })

    it("returns true exactly at fifteen minutes", () => {
      const lockedAt = new Date(NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS)
      expect(isCheckoutCompletionLockedStale(lockedAt, NOW)).toBe(true)
    })

    it("returns false one millisecond below fifteen minutes", () => {
      const lockedAt = new Date(
        NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS + 1
      )
      expect(isCheckoutCompletionLockedStale(lockedAt, NOW)).toBe(false)
    })

    it("returns true above fifteen minutes", () => {
      const lockedAt = new Date(
        NOW.getTime() - CHECKOUT_COMPLETION_STALE_AFTER_MS - 1
      )
      expect(isCheckoutCompletionLockedStale(lockedAt, NOW)).toBe(true)
    })

    it("accepts a valid Date input", () => {
      const lockedAt = new Date("2026-07-08T12:00:00.000Z")
      expect(isCheckoutCompletionLockedStale(lockedAt, NOW)).toBe(true)
    })

    it("accepts a valid ISO string input", () => {
      expect(
        isCheckoutCompletionLockedStale("2026-07-08T12:00:00.000Z", NOW)
      ).toBe(true)
    })
  })

  it("permite retry controlado de failed sem order_id", () => {
    const existing = buildCheckoutCompletionLogRecord(
      {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
        status: CHECKOUT_COMPLETION_STATUS.FAILED,
        error_code: "ORDER_ENTRYPOINT_FAILED",
        error_message: "Falha anterior.",
        failed_at: "2026-07-08T11:00:00.000Z",
      },
      "chkcpl_123",
      new Date("2026-07-08T11:00:00.000Z")
    )

    const decision = resolveCheckoutCompletionClaimDecision({
      existing,
      next: {
        cart_id: "cart_123",
        payment_intent_id: "pi_123",
        payment_attempt_id: "payatt_123",
      },
      at: new Date("2026-07-08T12:00:00.000Z"),
    })

    expect(decision.type).toBe("retry_failed")
    if (decision.type !== "retry_failed") {
      return
    }

    expect(decision.update).toEqual(
      expect.objectContaining({
        status: CHECKOUT_COMPLETION_STATUS.PROCESSING,
        locked_at: "2026-07-08T12:00:00.000Z",
        completed_at: null,
        failed_at: null,
        error_code: null,
        error_message: null,
      })
    )
  })
})
