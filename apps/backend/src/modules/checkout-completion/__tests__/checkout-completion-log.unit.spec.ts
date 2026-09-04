import fs from "fs"
import path from "path"
import {
  acquireCheckoutOrderBirthAuthorityInTransaction,
  assertNoSensitiveCheckoutCompletionMetadata,
  assertValidCheckoutCompletionOperation,
  assertValidCheckoutCompletionStatus,
  buildCheckoutCompletionIdempotencyKey,
  buildCheckoutCompletionLogRecord,
  CheckoutCompletionAuthorityConflictError,
  CHECKOUT_COMPLETION_AUTHORITY_CONFLICT,
  markOrderBirthExecutionStartedInTransaction,
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
  "../migrations/Migration20260901130100.ts"
)
const paymentMigrationPath = path.join(
  __dirname,
  "../../payment-attempt/migrations/Migration20260901130000.ts"
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

  it("accepts every R3 status, including reconciliation_required", () => {
    for (const status of [
      CHECKOUT_COMPLETION_STATUS.PROCESSING,
      CHECKOUT_COMPLETION_STATUS.COMPLETED,
      CHECKOUT_COMPLETION_STATUS.FAILED,
      CHECKOUT_COMPLETION_STATUS.RECONCILIATION_REQUIRED,
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
  it("keeps reconciliation migrations self-contained with immutable historical literals", () => {
    const checkoutMigration = fs.readFileSync(migrationPath, "utf8")
    const paymentMigration = fs.readFileSync(paymentMigrationPath, "utf8")
    const runtimeReasonCodesImport =
      'from "../../../reconciliation/reason-codes"'

    expect(checkoutMigration).not.toContain(runtimeReasonCodesImport)
    expect(paymentMigration).not.toContain(runtimeReasonCodesImport)
    expect(paymentMigration).toContain(
      'const LEGACY_PROVIDER_DISPATCH_UNKNOWN = "LEGACY_PROVIDER_DISPATCH_UNKNOWN"'
    )
    expect(checkoutMigration).toContain(
      'const ORDER_BIRTH_EXECUTION_AMBIGUOUS = "ORDER_BIRTH_EXECUTION_AMBIGUOUS"'
    )
    expect(checkoutMigration).toContain(
      'const ORDER_RECOVERY_INCOMPLETE = "ORDER_RECOVERY_INCOMPLETE"'
    )
  })

  it("keeps canonical unique indexes and lookup indexes in the migration draft", () => {
    const migration = fs.readFileSync(migrationPath, "utf8")
    const model = fs.readFileSync(modelPath, "utf8")

    expect(migration).toContain('"idempotency_key"')
    expect(migration).toContain("UQ_checkout_completion_log_operation_idempotency_key")
    expect(migration).toContain("UQ_checkout_completion_log_operation_cart_id")
    expect(migration).toContain("UQ_checkout_completion_log_operation_payment_intent_id")
    expect(migration).toContain("UQ_checkout_completion_log_operation_payment_attempt_id")
    expect(migration).toContain("UQ_checkout_completion_log_operation_order_id")
    expect(migration).toContain('"payment_intent_id"')
    expect(migration).toContain('"cart_id"')
    expect(migration).toContain('"payment_attempt_id"')
    expect(migration).toContain('"order_id"')
    expect(model).toContain('"status", "locked_at"')
    expect(model).toContain("CHECKOUT_COMPLETION_OPERATION.COMPLETE_CHECKOUT_CREATE_ORDER")
    expect(model).toContain("CHECKOUT_COMPLETION_STATUS.RECONCILIATION_REQUIRED")
    expect(migration).toContain("reconciliation_required")
    expect(migration).toContain("ORDER_BIRTH_EXECUTION_AMBIGUOUS")
    expect(migration).toContain("ORDER_RECOVERY_INCOMPLETE")
    expect(migration).toContain("deleted_at")
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
    expect(record.execution_started_at).toBeNull()
    expect(record.last_reconciliation_at).toBeNull()
    expect(record.reconciliation_reason_code).toBeNull()
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

describe("acquireCheckoutOrderBirthAuthorityInTransaction", () => {
  function createMockTrx(initialRows: Array<Record<string, unknown>> = []) {
    const store = [...initialRows]
    return {
      store,
      trx: {
        raw: jest.fn(async (sql: string, bindings: unknown[] = []) => {
          if (sql.trim().toLowerCase().startsWith("select")) {
            if (sql.includes("cart_id = ?")) {
              const cartId = bindings[1]
              const found = store.find((r) => r.cart_id === cartId)
              return { rows: found ? [found] : [] }
            }
            if (sql.includes("idempotency_key = ?")) {
              const idemp = bindings[1]
              const found = store.find((r) => r.idempotency_key === idemp)
              return { rows: found ? [found] : [] }
            }
            return { rows: [] }
          }
          if (sql.trim().toLowerCase().startsWith("insert")) {
            const [
              id, operation, idempotency_key, cart_id, payment_intent_id,
              payment_attempt_id, execution_started_at, locked_at,
              metadata, created_at, updated_at
            ] = bindings
            // Check unique constraint violation
            if (store.some((r) => r.cart_id === cart_id)) {
              const err: any = new Error("duplicate key value violates unique constraint")
              err.code = "23505"
              throw err
            }
            const row = {
              id,
              operation,
              idempotency_key,
              cart_id,
              payment_intent_id,
              payment_attempt_id,
              order_id: null,
              status: "processing",
              execution_started_at,
              locked_at,
              last_reconciliation_at: null,
              reconciliation_reason_code: null,
              deleted_at: null,
              created_at,
              updated_at,
            }
            store.push(row)
            return { rows: [row] }
          }
          return { rows: [] }
        }),
      },
    }
  }

  it("creates a new Order-birth authority when none exists for the cart", async () => {
    const { trx, store } = createMockTrx([])
    const result = await acquireCheckoutOrderBirthAuthorityInTransaction(trx as any, {
      cart_id: "cart_01",
      payment_attempt_id: "payatt_01",
      payment_intent_id: "pi_01",
    })

    expect(result.action).toBe("created")
    expect(result.authority.cart_id).toBe("cart_01")
    expect(result.authority.payment_attempt_id).toBe("payatt_01")
    expect(result.authority.payment_intent_id).toBe("pi_01")
    expect(result.authority.status).toBe("processing")
    expect(result.authority.execution_started_at).toBeNull()
    expect(result.authority.id).toMatch(/^chkcpl_/)
    expect(store).toHaveLength(1)
  })

  it("reuses existing authority for the same cart and financial identity", async () => {
    const existing = {
      id: "chkcpl_existing_01",
      operation: "complete_checkout_create_order",
      idempotency_key: "pi_01",
      cart_id: "cart_01",
      payment_intent_id: "pi_01",
      payment_attempt_id: "payatt_01",
      order_id: "order_existing",
      status: "completed",
      execution_started_at: "2026-08-01T10:00:00.000Z",
      last_reconciliation_at: null,
      reconciliation_reason_code: null,
      deleted_at: null,
    }
    const { trx, store } = createMockTrx([existing])

    const result = await acquireCheckoutOrderBirthAuthorityInTransaction(trx as any, {
      cart_id: "cart_01",
      payment_attempt_id: "payatt_01",
      payment_intent_id: "pi_01",
    })

    expect(result.action).toBe("reused")
    expect(result.authority.id).toBe("chkcpl_existing_01")
    expect(result.authority.order_id).toBe("order_existing")
    expect(store).toHaveLength(1)
  })

  it("fails closed when conflicting payment_attempt_id attempts to claim cart authority", async () => {
    const existing = {
      id: "chkcpl_existing_01",
      operation: "complete_checkout_create_order",
      idempotency_key: "pi_01",
      cart_id: "cart_01",
      payment_intent_id: "pi_01",
      payment_attempt_id: "payatt_01",
      order_id: null,
      status: "processing",
      execution_started_at: "2026-08-01T10:00:00.000Z",
      last_reconciliation_at: null,
      reconciliation_reason_code: null,
      deleted_at: null,
    }
    const { trx } = createMockTrx([existing])

    await expect(
      acquireCheckoutOrderBirthAuthorityInTransaction(trx as any, {
        cart_id: "cart_01",
        payment_attempt_id: "payatt_CONFLICT",
        payment_intent_id: "pi_01",
      })
    ).rejects.toThrow(CheckoutCompletionAuthorityConflictError)
  })

  it("fails closed when conflicting payment_intent_id attempts to claim cart authority", async () => {
    const existing = {
      id: "chkcpl_existing_01",
      operation: "complete_checkout_create_order",
      idempotency_key: "pi_01",
      cart_id: "cart_01",
      payment_intent_id: "pi_01",
      payment_attempt_id: "payatt_01",
      order_id: null,
      status: "processing",
      execution_started_at: "2026-08-01T10:00:00.000Z",
      last_reconciliation_at: null,
      reconciliation_reason_code: null,
      deleted_at: null,
    }
    const { trx } = createMockTrx([existing])

    await expect(
      acquireCheckoutOrderBirthAuthorityInTransaction(trx as any, {
        cart_id: "cart_01",
        payment_attempt_id: "payatt_01",
        payment_intent_id: "pi_CONFLICT",
      })
    ).rejects.toThrow(CheckoutCompletionAuthorityConflictError)
  })

  it("accounts for soft-deleted authority and reuses it without creating a second authority", async () => {
    const softDeleted = {
      id: "chkcpl_soft_deleted_01",
      operation: "complete_checkout_create_order",
      idempotency_key: "pi_01",
      cart_id: "cart_01",
      payment_intent_id: "pi_01",
      payment_attempt_id: "payatt_01",
      order_id: null,
      status: "processing",
      execution_started_at: "2026-08-01T10:00:00.000Z",
      last_reconciliation_at: null,
      reconciliation_reason_code: null,
      deleted_at: "2026-08-01T12:00:00.000Z",
    }
    const { trx, store } = createMockTrx([softDeleted])

    const result = await acquireCheckoutOrderBirthAuthorityInTransaction(trx as any, {
      cart_id: "cart_01",
      payment_attempt_id: "payatt_01",
      payment_intent_id: "pi_01",
    })

    expect(result.action).toBe("reused")
    expect(result.authority.id).toBe("chkcpl_soft_deleted_01")
    expect(result.authority.deleted_at).toBe("2026-08-01T12:00:00.000Z")
    expect(store).toHaveLength(1)
  })
})

describe("markOrderBirthExecutionStartedInTransaction", () => {
  const authorityRow = {
    id: "chkcpl_exec_01",
    operation: "complete_checkout_create_order",
    idempotency_key: "pi_exec_01",
    cart_id: "cart_exec_01",
    payment_intent_id: "pi_exec_01",
    payment_attempt_id: "payatt_exec_01",
    order_id: null,
    status: "processing",
    execution_started_at: null,
    last_reconciliation_at: null,
    reconciliation_reason_code: null,
    deleted_at: null,
    created_at: "2026-08-01T10:00:00.000Z",
  }

  function createCasTrx(row: Record<string, unknown> = authorityRow) {
    const calls: Array<{ sql: string; bindings: unknown[] }> = []
    const trx = {
      raw: jest.fn(async (sql: string, bindings: unknown[] = []) => {
        calls.push({ sql, bindings })
        const normalized = sql.replace(/\s+/g, " ").toLowerCase()
        if (normalized.startsWith("update checkout_completion_log")) {
          const whereHasPaymentAttempt =
            normalized.includes("and payment_attempt_id = ?")
          const idMatches = bindings[0] === row.id
          const cartMatches = bindings[1] === row.cart_id
          const piMatches = bindings[2] === row.payment_intent_id
          const paMatches = bindings[3] === row.payment_attempt_id
          const canWin =
            whereHasPaymentAttempt &&
            idMatches &&
            cartMatches &&
            piMatches &&
            paMatches &&
            row.execution_started_at == null &&
            row.order_id == null &&
            row.deleted_at == null
          if (!canWin) {
            return { rows: [] }
          }
          return {
            rows: [
              {
                ...row,
                execution_started_at: "DB_CURRENT_TIMESTAMP",
                updated_at: "DB_CURRENT_TIMESTAMP",
              },
            ],
          }
        }
        if (normalized.startsWith("select")) {
          if (bindings[0] === row.id) {
            return { rows: [row] }
          }
          return { rows: [] }
        }
        return { rows: [] }
      }),
    }
    return { trx, calls }
  }

  it("seals the irreversible execution CAS SQL with payment_attempt_id = ?", async () => {
    const serviceSource = fs.readFileSync(servicePath, "utf8")
    expect(serviceSource).toContain("and payment_attempt_id = ?")
    expect(serviceSource).toContain("execution_started_at = CURRENT_TIMESTAMP")
    expect(serviceSource).toContain("updated_at = CURRENT_TIMESTAMP")
    expect(serviceSource).not.toMatch(/IS NOT DISTINCT FROM/i)

    const { trx, calls } = createCasTrx()
    await markOrderBirthExecutionStartedInTransaction(trx as any, {
      id: "chkcpl_exec_01",
      cart_id: "cart_exec_01",
      payment_intent_id: "pi_exec_01",
      payment_attempt_id: "payatt_exec_01",
    })

    const update = calls.find(({ sql }) =>
      sql.replace(/\s+/g, " ").toLowerCase().startsWith("update checkout_completion_log")
    )
    expect(update).toBeDefined()
    const normalizedSql = update!.sql.replace(/\s+/g, " ")
    expect(normalizedSql).toContain("payment_attempt_id = ?")
    expect(normalizedSql).toContain("execution_started_at = CURRENT_TIMESTAMP")
    expect(normalizedSql).toContain("updated_at = CURRENT_TIMESTAMP")
    expect(normalizedSql).not.toMatch(/IS NOT DISTINCT FROM/i)
    expect(normalizedSql).toMatch(
      /set execution_started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP/
    )
    expect(update!.bindings).toEqual([
      "chkcpl_exec_01",
      "cart_exec_01",
      "pi_exec_01",
      "payatt_exec_01",
    ])
  })

  it("fails closed before UPDATE when payment_attempt_id is null or blank", async () => {
    const { trx } = createCasTrx()

    await expect(
      markOrderBirthExecutionStartedInTransaction(trx as any, {
        id: "chkcpl_exec_01",
        cart_id: "cart_exec_01",
        payment_intent_id: "pi_exec_01",
        payment_attempt_id: null,
      } as any)
    ).rejects.toThrow("CHECKOUT_COMPLETION_PAYMENT_ATTEMPT_ID_REQUIRED")

    await expect(
      markOrderBirthExecutionStartedInTransaction(trx as any, {
        id: "chkcpl_exec_01",
        cart_id: "cart_exec_01",
        payment_intent_id: "pi_exec_01",
        payment_attempt_id: "   ",
      })
    ).rejects.toThrow("CHECKOUT_COMPLETION_PAYMENT_ATTEMPT_ID_REQUIRED")

    expect(trx.raw).not.toHaveBeenCalled()
  })

  it("wins CAS without writing payment_attempt_id when identities match", async () => {
    const { trx, calls } = createCasTrx()
    const result = await markOrderBirthExecutionStartedInTransaction(trx as any, {
      id: "chkcpl_exec_01",
      cart_id: "cart_exec_01",
      payment_intent_id: "pi_exec_01",
      payment_attempt_id: "payatt_exec_01",
    })

    expect(result.won).toBe(true)
    expect(result.authority.execution_started_at).toBe("DB_CURRENT_TIMESTAMP")
    const updateSql = calls[0]?.sql.replace(/\s+/g, " ") ?? ""
    const setClause = updateSql.slice(
      updateSql.toLowerCase().indexOf("set "),
      updateSql.toLowerCase().indexOf(" where ")
    )
    expect(setClause).toContain("execution_started_at = CURRENT_TIMESTAMP")
    expect(setClause).toContain("updated_at = CURRENT_TIMESTAMP")
    expect(setClause).not.toMatch(/payment_attempt_id/i)
  })

  it("fails closed with PAYMENT_ATTEMPT_MISMATCH when the owner is NULL", async () => {
    const { trx } = createCasTrx({
      ...authorityRow,
      payment_attempt_id: null,
    })

    await expect(
      markOrderBirthExecutionStartedInTransaction(trx as any, {
        id: "chkcpl_exec_01",
        cart_id: "cart_exec_01",
        payment_intent_id: "pi_exec_01",
        payment_attempt_id: "payatt_exec_01",
      })
    ).rejects.toMatchObject({
      name: "CheckoutCompletionAuthorityConflictError",
      code: CHECKOUT_COMPLETION_AUTHORITY_CONFLICT,
      message: expect.stringContaining("PAYMENT_ATTEMPT_MISMATCH"),
    })
  })

  it("fails closed with PAYMENT_ATTEMPT_MISMATCH when caller PA differs from owner", async () => {
    const { trx } = createCasTrx()

    await expect(
      markOrderBirthExecutionStartedInTransaction(trx as any, {
        id: "chkcpl_exec_01",
        cart_id: "cart_exec_01",
        payment_intent_id: "pi_exec_01",
        payment_attempt_id: "payatt_CONFLICT",
      })
    ).rejects.toThrow(CheckoutCompletionAuthorityConflictError)

    await expect(
      markOrderBirthExecutionStartedInTransaction(trx as any, {
        id: "chkcpl_exec_01",
        cart_id: "cart_exec_01",
        payment_intent_id: "pi_exec_01",
        payment_attempt_id: "payatt_CONFLICT",
      })
    ).rejects.toThrow(/PAYMENT_ATTEMPT_MISMATCH/)
  })

  it("returns won=false when the same PaymentAttempt retries after execution already started", async () => {
    const { trx } = createCasTrx({
      ...authorityRow,
      execution_started_at: "2026-08-01T10:05:00.000Z",
    })

    const result = await markOrderBirthExecutionStartedInTransaction(trx as any, {
      id: "chkcpl_exec_01",
      cart_id: "cart_exec_01",
      payment_intent_id: "pi_exec_01",
      payment_attempt_id: "payatt_exec_01",
    })

    expect(result.won).toBe(false)
    expect(result.authority.execution_started_at).toBe("2026-08-01T10:05:00.000Z")
  })
})
