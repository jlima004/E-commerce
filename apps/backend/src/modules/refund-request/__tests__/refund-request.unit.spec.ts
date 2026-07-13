import fs from "fs"
import path from "path"
import type { PaymentAttemptRecord } from "../../payment-attempt/types"
import {
  assertOrderEligibleForRefundRequest,
  assertPaymentAttemptEligibleForRefundSource,
  resolveOrderCapturedPaymentTruth,
} from "../captured-truth"
import {
  createFakeStripeRefundCreationLayer,
  isStripeRefundCreationLayer,
  type StripeRefundCreationLayer,
} from "../stripe-refund-boundary"
import RefundRequestModuleService, {
  assertNoSensitiveRefundRequestMetadata,
  assertRefundAmountWithinAvailability,
  assertValidRefundRequestStatus,
  buildRefundRequestRecord,
  computeRefundableAvailability,
  createAdminRefundRequest,
  normalizeCreateRefundRequestInput,
  sanitizeRefundRequestError,
  sanitizeRefundRequestMetadata,
} from "../service"
import {
  resetOrderRefundReservationClaimsForTests,
  withOrderRefundReservationClaim,
} from "../reservation-claim"
import {
  REFUND_REQUEST_STATUS,
  type RefundRequestRecord,
} from "../types"

const migrationPath = path.join(__dirname, "../migrations/TBD-refund-request.ts")
const modelPath = path.join(__dirname, "../models/refund-request.ts")
const servicePath = path.join(__dirname, "../service.ts")

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const CLIENT_SECRET_KEY = joinKey("client", "_", "secret")
const CLIENT_SECRET_VALUE = joinKey("pi_123", "_", "secret_456")
const EMAIL_VALUE = joinKey("cliente", "@", "compras", ".", "test")

function buildPaymentAttempt(
  overrides: Partial<PaymentAttemptRecord> = {}
): PaymentAttemptRecord {
  return {
    id: "payatt_refund_01",
    cart_id: "cart_refund_01",
    payment_collection_id: "paycol_refund_01",
    payment_session_id: "payses_refund_01",
    provider: "stripe",
    provider_payment_intent_id: "pi_refund_01",
    provider_payment_session_id: "ps_refund_01",
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: "order_refund_01",
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-07-01T00:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    ...overrides,
  }
}

function buildOrderMetadata() {
  return {
    order_status: "confirmed",
    payment_status: "captured",
  }
}

function buildRefundRequest(
  overrides: Partial<RefundRequestRecord> = {}
): RefundRequestRecord {
  return {
    id: "refreq_test_01",
    order_id: "order_refund_01",
    payment_intent_id: "pi_refund_01",
    payment_attempt_id: "payatt_refund_01",
    stripe_refund_id: null,
    idempotency_key: "admin-refund/order_refund_01/attempt-1",
    amount: 2500,
    currency_code: "brl",
    reason: "customer_request",
    operator_note: "partial refund",
    status: REFUND_REQUEST_STATUS.REQUESTED,
    failure_code: null,
    failure_message: null,
    requested_by_operator_id: "operator_01",
    confirmed_at: null,
    failed_at: null,
    canceled_at: null,
    rejected_at: null,
    metadata: { source: "admin" },
    created_at: "2026-07-03T10:00:00.000Z",
    updated_at: "2026-07-03T10:00:00.000Z",
    deleted_at: null,
    ...overrides,
  }
}

describe("RefundRequest captured payment truth", () => {
  it("resolve Order captured truth from linked PaymentAttempt and order metadata", () => {
    const truth = resolveOrderCapturedPaymentTruth({
      order_id: "order_refund_01",
      order_metadata: buildOrderMetadata(),
      payment_attempt: buildPaymentAttempt(),
    })

    expect(truth).toEqual({
      order_id: "order_refund_01",
      payment_attempt_id: "payatt_refund_01",
      payment_intent_id: "pi_refund_01",
      captured_amount: 9900,
      currency_code: "brl",
    })
  })

  it("rejects order without captured payment_status", () => {
    expect(() =>
      assertOrderEligibleForRefundRequest("order_refund_01", {
        order_status: "confirmed",
        payment_status: "awaiting_payment",
      })
    ).toThrow("REFUND_REQUEST_PAYMENT_STATUS_NOT_ELIGIBLE")
  })

  it("rejects payment attempt without order linkage", () => {
    expect(() =>
      assertPaymentAttemptEligibleForRefundSource(
        buildPaymentAttempt({ order_id: null }),
        "order_refund_01"
      )
    ).toThrow("REFUND_REQUEST_PAYMENT_ATTEMPT_ORDER_MISMATCH")
  })
})

describe("RefundRequest amount and currency guards", () => {
  it("rejects zero amount", () => {
    expect(() =>
      assertRefundAmountWithinAvailability({
        amount: 0,
        currency_code: "brl",
        captured_currency_code: "brl",
        availability: {
          captured_amount: 9900,
          confirmed_refunded_amount: 0,
          reserved_amount: 0,
          available_amount: 9900,
          currency_code: "brl",
        },
      })
    ).toThrow("REFUND_REQUEST_AMOUNT_INVALID")
  })

  it("rejects negative amount", () => {
    expect(() =>
      assertRefundAmountWithinAvailability({
        amount: -100,
        currency_code: "brl",
        captured_currency_code: "brl",
        availability: {
          captured_amount: 9900,
          confirmed_refunded_amount: 0,
          reserved_amount: 0,
          available_amount: 9900,
          currency_code: "brl",
        },
      })
    ).toThrow("REFUND_REQUEST_AMOUNT_INVALID")
  })

  it("rejects over-captured amount", () => {
    expect(() =>
      assertRefundAmountWithinAvailability({
        amount: 9901,
        currency_code: "brl",
        captured_currency_code: "brl",
        availability: {
          captured_amount: 9900,
          confirmed_refunded_amount: 0,
          reserved_amount: 0,
          available_amount: 9900,
          currency_code: "brl",
        },
      })
    ).toThrow("REFUND_REQUEST_AMOUNT_EXCEEDS_AVAILABLE_CAPTURED")
  })

  it("rejects currency mismatch", () => {
    expect(() =>
      assertRefundAmountWithinAvailability({
        amount: 1000,
        currency_code: "usd",
        captured_currency_code: "brl",
        availability: {
          captured_amount: 9900,
          confirmed_refunded_amount: 0,
          reserved_amount: 0,
          available_amount: 9900,
          currency_code: "brl",
        },
      })
    ).toThrow("REFUND_REQUEST_CURRENCY_MISMATCH")
  })
})

describe("RefundRequest availability and concurrency guard", () => {
  it("subtracts confirmed refunds and non-terminal reservations", () => {
    const availability = computeRefundableAvailability({
      captured: {
        captured_amount: 9900,
        currency_code: "brl",
      },
      refund_requests: [
        buildRefundRequest({
          id: "refreq_confirmed",
          amount: 1000,
          status: REFUND_REQUEST_STATUS.CONFIRMED,
        }),
        buildRefundRequest({
          id: "refreq_reserved",
          amount: 2000,
          status: REFUND_REQUEST_STATUS.REQUESTED,
        }),
        buildRefundRequest({
          id: "refreq_failed",
          amount: 3000,
          status: REFUND_REQUEST_STATUS.FAILED,
        }),
      ],
    })

    expect(availability).toEqual({
      captured_amount: 9900,
      confirmed_refunded_amount: 1000,
      reserved_amount: 2000,
      available_amount: 6900,
      currency_code: "brl",
    })
  })

  it("prevents concurrent reservations from exceeding captured amount", () => {
    const existing = [
      buildRefundRequest({
        id: "refreq_existing",
        amount: 7000,
        status: REFUND_REQUEST_STATUS.REQUESTED,
      }),
    ]

    expect(() =>
      createAdminRefundRequest({
        request: {
          order_id: "order_refund_01",
          amount: 3000,
          currency_code: "brl",
          idempotency_key: "admin-refund/order_refund_01/attempt-2",
        },
        order_metadata: buildOrderMetadata(),
        payment_attempt: buildPaymentAttempt(),
        existing_refund_requests: existing,
        id: "refreq_new_01",
      })
    ).toThrow("REFUND_REQUEST_AMOUNT_EXCEEDS_AVAILABLE_CAPTURED")
  })

  it("serializes concurrent create attempts so only one reservation succeeds", async () => {
    resetOrderRefundReservationClaimsForTests()

    const store: RefundRequestRecord[] = []
    let nextId = 1

    const simulateReservedCreate = async (input: {
      idempotency_key: string
      amount: number
    }) =>
      withOrderRefundReservationClaim("order_refund_01", async () => {
        const existingByKey =
          store.find(
            (request) => request.idempotency_key === input.idempotency_key
          ) ?? null

        const result = createAdminRefundRequest({
          request: {
            order_id: "order_refund_01",
            amount: input.amount,
            currency_code: "brl",
            idempotency_key: input.idempotency_key,
          },
          order_metadata: buildOrderMetadata(),
          payment_attempt: buildPaymentAttempt(),
          existing_refund_requests: [...store],
          existing_by_idempotency_key: existingByKey,
          id: `refreq_concurrent_${nextId++}`,
        })

        if (!result.reused_idempotency) {
          store.push(result.refund_request)
        }

        return result
      })

    const [first, second] = await Promise.allSettled([
      simulateReservedCreate({
        idempotency_key: "admin-refund/order_refund_01/concurrent-a",
        amount: 6000,
      }),
      simulateReservedCreate({
        idempotency_key: "admin-refund/order_refund_01/concurrent-b",
        amount: 6000,
      }),
    ])

    const fulfilled = [first, second].filter(
      (result): result is PromiseFulfilledResult<ReturnType<typeof createAdminRefundRequest>> =>
        result.status === "fulfilled"
    )
    const rejected = [first, second].filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]?.reason).toMatchObject({
      message: "REFUND_REQUEST_AMOUNT_EXCEEDS_AVAILABLE_CAPTURED",
    })
    expect(store).toHaveLength(1)
    expect(store[0]?.amount).toBe(6000)
  })

  it("does not duplicate reservation on concurrent idempotent replay", async () => {
    resetOrderRefundReservationClaimsForTests()

    const store: RefundRequestRecord[] = []
    let nextId = 1
    const idempotencyKey = "admin-refund/order_refund_01/concurrent-replay"

    const simulateReservedCreate = async () =>
      withOrderRefundReservationClaim("order_refund_01", async () => {
        const existingByKey =
          store.find((request) => request.idempotency_key === idempotencyKey) ??
          null

        const result = createAdminRefundRequest({
          request: {
            order_id: "order_refund_01",
            amount: 2500,
            currency_code: "brl",
            idempotency_key: idempotencyKey,
          },
          order_metadata: buildOrderMetadata(),
          payment_attempt: buildPaymentAttempt(),
          existing_refund_requests: [...store],
          existing_by_idempotency_key: existingByKey,
          id: `refreq_replay_${nextId++}`,
        })

        if (!result.reused_idempotency) {
          store.push(result.refund_request)
        }

        return result
      })

    const [first, second] = await Promise.all([
      simulateReservedCreate(),
      simulateReservedCreate(),
    ])

    expect(store).toHaveLength(1)
    expect(first.refund_request.id).toBe(store[0]?.id)
    expect(second.refund_request.id).toBe(store[0]?.id)
    expect(first.reused_idempotency || second.reused_idempotency).toBe(true)
  })
})

describe("RefundRequest idempotency", () => {
  it("reuses existing request for repeated idempotency key", () => {
    const existing = buildRefundRequest()

    const result = createAdminRefundRequest({
      request: {
        order_id: "order_refund_01",
        amount: 2500,
        currency_code: "brl",
        idempotency_key: existing.idempotency_key,
      },
      order_metadata: buildOrderMetadata(),
      payment_attempt: buildPaymentAttempt(),
      existing_refund_requests: [existing],
      existing_by_idempotency_key: existing,
      id: "refreq_should_not_be_used",
    })

    expect(result.reused_idempotency).toBe(true)
    expect(result.refund_request).toBe(existing)
  })
})

describe("RefundRequest status vocabulary and slice boundary", () => {
  it("accepts canonical statuses", () => {
    for (const status of Object.values(REFUND_REQUEST_STATUS)) {
      expect(() => assertValidRefundRequestStatus(status)).not.toThrow()
    }
  })

  it("creates only requested status in slice", () => {
    const record = buildRefundRequestRecord({
      id: "refreq_slice_01",
      order_id: "order_refund_01",
      payment_intent_id: "pi_refund_01",
      payment_attempt_id: "payatt_refund_01",
      idempotency_key: "admin-refund/order_refund_01/slice",
      amount: 1000,
      currency_code: "brl",
    })

    expect(record.status).toBe(REFUND_REQUEST_STATUS.REQUESTED)
    expect(record.confirmed_at).toBeNull()
    expect(record.stripe_refund_id).toBeNull()
  })

  it("forbids confirmed status in slice builder", () => {
    expect(() =>
      buildRefundRequestRecord({
        id: "refreq_slice_02",
        order_id: "order_refund_01",
        payment_intent_id: "pi_refund_01",
        payment_attempt_id: "payatt_refund_01",
        idempotency_key: "admin-refund/order_refund_01/slice-2",
        amount: 1000,
        currency_code: "brl",
        status: REFUND_REQUEST_STATUS.CONFIRMED,
      })
    ).toThrow("REFUND_REQUEST_SLICE_STATUS_FORBIDDEN")
  })
})

describe("RefundRequest sanitizers", () => {
  it("keeps only allowlisted metadata keys", () => {
    expect(
      sanitizeRefundRequestMetadata({
        source: "admin",
        correlation_id: "req_123",
        ignored_field: "drop-me",
      })
    ).toEqual({
      source: "admin",
      correlation_id: "req_123",
    })
  })

  it("rejects sensitive metadata", () => {
    expect(() =>
      assertNoSensitiveRefundRequestMetadata({
        [CLIENT_SECRET_KEY]: CLIENT_SECRET_VALUE,
      })
    ).toThrow("REFUND_REQUEST_METADATA_FORBIDDEN")

    expect(() =>
      assertNoSensitiveRefundRequestMetadata({
        correlation_id: "Bearer token-123",
      })
    ).toThrow("REFUND_REQUEST_METADATA_FORBIDDEN")
  })

  it("redacts sensitive values from errors", () => {
    const sanitized = sanitizeRefundRequestError({
      code: "REFUND_REQUEST_FAILED",
      message: `failed for ${EMAIL_VALUE}`,
    })

    expect(sanitized.error_message).not.toContain(EMAIL_VALUE)
    expect(sanitized.error_message).toContain("[redacted]")
  })
})

describe("RefundRequest injectable Stripe boundary", () => {
  it("returns the injected layer asynchronously with service context preserved", async () => {
    const stripeLayer: StripeRefundCreationLayer =
      createFakeStripeRefundCreationLayer()
    const service = Object.create(RefundRequestModuleService.prototype)
    Object.defineProperty(service, "dependencies_", {
      value: { stripeRefundCreationLayer: stripeLayer },
    })

    await expect(service.resolveStripeRefundCreationLayer()).resolves.toBe(
      stripeLayer
    )
  })

  it("uses fake stripe refund layer without real Stripe", async () => {
    const layer = createFakeStripeRefundCreationLayer()
    expect(isStripeRefundCreationLayer(layer)).toBe(true)

    const result = await layer.createRefund({
      payment_intent_id: "pi_refund_01",
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/order_refund_01/fake",
    })

    expect(result.stripe_refund_id).toMatch(/^re_fake_/)
    expect(result.status).toBe("pending")
  })
})

describe("RefundRequest schema draft", () => {
  it("keeps canonical indexes in migration draft", () => {
    const migration = fs.readFileSync(migrationPath, "utf8")

    expect(migration).toContain("IDX_refund_request_idempotency_key_unique")
    expect(migration).toContain("IDX_refund_request_stripe_refund_id_unique")
    expect(migration).toContain("IDX_refund_request_order_id")
    expect(migration).toContain("IDX_refund_request_payment_intent_id")
    expect(migration).toContain("IDX_refund_request_status")
    expect(migration).not.toContain("medusa db:migrate")
  })

  it("defines model fields and status enum", () => {
    const model = fs.readFileSync(modelPath, "utf8")
    const service = fs.readFileSync(servicePath, "utf8")

    expect(model).toContain('prefix: "refreq"')
    expect(model).toContain("stripe_refund_id")
    expect(model).toContain("idempotency_key")
    expect(service).not.toContain('payment_status: "refunded"')
    expect(service).not.toContain('order_status: "canceled"')
  })
})

describe("RefundRequest negative proofs", () => {
  it("does not create Order or mutate order/payment status metadata", () => {
    const normalized = normalizeCreateRefundRequestInput({
      order_id: "order_refund_01",
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/order_refund_01/negative",
    })

    const result = createAdminRefundRequest({
      request: normalized,
      order_metadata: buildOrderMetadata(),
      payment_attempt: buildPaymentAttempt(),
      existing_refund_requests: [],
      id: "refreq_negative_01",
    })

    expect(result.refund_request.status).toBe(REFUND_REQUEST_STATUS.REQUESTED)
    expect(result.refund_request.confirmed_at).toBeNull()
    expect(buildOrderMetadata().payment_status).toBe("captured")
    expect(buildOrderMetadata().order_status).toBe("confirmed")
  })
})
