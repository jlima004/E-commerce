import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { POST as adminCreateRefundRequestRoute } from "../../src/api/admin/refunds/request/route"
import { handleAdminCreateRefundRequest } from "../../src/api/admin/refunds/request/route"
import type { AdminActionLogAppendService } from "../../src/api/admin/_shared/audit-admin-action"
import type { AdminActionFact } from "../../src/modules/admin-action-log"
import type { PaymentAttemptRecord } from "../../src/modules/payment-attempt/types"
import { withOrderRefundReservationClaim } from "../../src/modules/refund-request/reservation-claim"
import { createFakeStripeRefundCreationLayer } from "../../src/modules/refund-request/stripe-refund-boundary"
import { REFUND_REQUEST_STATUS } from "../../src/modules/refund-request/types"
import type { RefundRequestRecord } from "../../src/modules/refund-request/types"

const ORDER_ID = "order_admin_refund_01"
const PAYMENT_INTENT_ID = "pi_admin_refund_01"
const ADMIN_ACTOR_ID = "user_admin_refund_01"

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const SENSITIVE_CANARIES = {
  email: joinKey("cliente", "@", "compras", ".", "test"),
  clientSecret: joinKey("pi_test", "_", "secret_value"),
  webhookSecret: joinKey("whsec_", "test_canary_value"),
} as const

function buildPaymentAttempt(): PaymentAttemptRecord {
  return {
    id: "payatt_admin_refund_01",
    cart_id: "cart_admin_refund_01",
    payment_collection_id: "paycol_admin_refund_01",
    payment_session_id: "payses_admin_refund_01",
    provider: "stripe",
    provider_payment_intent_id: PAYMENT_INTENT_ID,
    provider_payment_session_id: "ps_admin_refund_01",
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
    amount: 9900,
    currency_code: "brl",
    expires_at: null,
    order_id: ORDER_ID,
    metadata: null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: "2026-07-01T00:00:00.000Z",
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
  }
}

function createResponse() {
  const response = {
    statusCode: 200,
    status: jest.fn(function status(code: number) {
      response.statusCode = code
      return response
    }),
    json: jest.fn(function json(body: unknown) {
      return body
    }),
  }

  return response as MedusaResponse & {
    statusCode: number
    status: jest.Mock
    json: jest.Mock
  }
}

function buildFact(
  overrides: Partial<AdminActionFact> = {}
): AdminActionFact {
  return {
    id: "admact_01",
    action_attempt_id: "attempt_01",
    correlation_id: "corr_01",
    audit_stage: "intent",
    admin_id: ADMIN_ACTOR_ID,
    admin_email: null,
    action: "refund_order",
    entity_type: "refund_request",
    entity_id: "refreq_01",
    result: "requested",
    severity: "info",
    reason: null,
    previous_state: null,
    new_state: null,
    metadata: null,
    idempotency_key: null,
    created_at: "2026-07-20T12:00:00.000Z",
    updated_at: "2026-07-20T12:00:00.000Z",
    ...overrides,
  }
}

function createAuditDouble(options?: {
  intentError?: Error
  outcomeError?: Error | (() => Error)
}) {
  const calls: Array<{ stage: string; payload: Record<string, unknown> }> = []
  let outcomeCalls = 0

  const audit: AdminActionLogAppendService = {
    appendIntent: jest.fn(async (payload) => {
      if (options?.intentError) {
        throw options.intentError
      }
      calls.push({ stage: "intent", payload: payload as never })
      return buildFact({
        action_attempt_id: String(payload.action_attempt_id),
        correlation_id: String(payload.correlation_id),
        entity_id: String(payload.entity_id),
        audit_stage: "intent",
        result: "requested",
        idempotency_key: (payload.idempotency_key as string | null) ?? null,
      })
    }),
    appendOutcome: jest.fn(async (payload) => {
      outcomeCalls += 1
      const error =
        typeof options?.outcomeError === "function"
          ? options.outcomeError()
          : options?.outcomeError
      if (error) {
        throw error
      }
      calls.push({ stage: "outcome", payload: payload as never })
      return buildFact({
        action_attempt_id: String(payload.action_attempt_id),
        correlation_id: String(payload.correlation_id),
        entity_id: String(payload.entity_id),
        audit_stage: "outcome",
        result: payload.result,
        idempotency_key: (payload.idempotency_key as string | null) ?? null,
      })
    }),
  }

  return { audit, calls, getOutcomeCalls: () => outcomeCalls }
}

function createInMemoryAdminRefundHarness(options?: {
  auth_context?: MedusaRequest["auth_context"] | null | undefined
  omitAuth?: boolean
}) {
  const orders = new Map([
    [
      ORDER_ID,
      {
        id: ORDER_ID,
        metadata: {
          order_status: "confirmed",
          payment_status: "captured",
        },
      },
    ],
  ])

  const paymentAttempts = [buildPaymentAttempt()]
  const refundRequests: RefundRequestRecord[] = []
  let nextId = 1
  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  }
  const { audit, calls, getOutcomeCalls } = createAuditDouble()

  const req = {
    body: {},
    auth_context: options?.omitAuth
      ? undefined
      : options?.auth_context === undefined
        ? { actor_type: "user", actor_id: ADMIN_ACTOR_ID }
        : options.auth_context,
    scope: {
      resolve: jest.fn((key: string) => {
        if (key === "order") {
          return {
            retrieveOrder: async (id: string) => orders.get(id) ?? null,
          }
        }

        if (key === "paymentAttempt") {
          return {
            listPaymentAttempts: async (filters?: { order_id?: string }) =>
              paymentAttempts.filter(
                (attempt) => attempt.order_id === filters?.order_id
              ),
          }
        }

        if (key === "refund_request") {
          return {
            listRefundRequests: async (filters?: {
              order_id?: string
              idempotency_key?: string
            }) =>
              refundRequests.filter((request) => {
                if (
                  filters?.idempotency_key &&
                  request.idempotency_key !== filters.idempotency_key
                ) {
                  return false
                }

                if (filters?.order_id && request.order_id !== filters.order_id) {
                  return false
                }

                return true
              }),
            createRefundRequests: async (records: RefundRequestRecord[]) => {
              for (const record of records) {
                refundRequests.push(record)
              }

              return records
            },
          }
        }

        if (key === "admin_action_log") {
          return audit
        }

        if (key === "logger") {
          return logger
        }

        throw new Error(`unexpected resolve key: ${key}`)
      }),
    },
  } as unknown as MedusaRequest

  return {
    req,
    refundRequests,
    orders,
    audit,
    auditCalls: calls,
    getOutcomeCalls,
    logger,
    nextIdRef: () => `refreq_http_${nextId++}`,
  }
}

function baseDeps(harness: ReturnType<typeof createInMemoryAdminRefundHarness>) {
  return {
    resolveOrderModule: () => ({
      retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
    }),
    resolvePaymentAttemptModule: () => ({
      listPaymentAttempts: async (filters?: { order_id?: string }) =>
        [buildPaymentAttempt()].filter(
          (attempt) => attempt.order_id === filters?.order_id
        ),
    }),
    resolveRefundRequestModule: () => ({
      listRefundRequests: async (filters?: {
        order_id?: string
        idempotency_key?: string
      }) =>
        harness.refundRequests.filter((request) => {
          if (
            filters?.idempotency_key &&
            request.idempotency_key !== filters.idempotency_key
          ) {
            return false
          }

          if (filters?.order_id && request.order_id !== filters.order_id) {
            return false
          }

          return true
        }),
      createRefundRequests: async (records: RefundRequestRecord[]) => {
        harness.refundRequests.push(...records)
        return records
      },
    }),
    resolveAdminActionLogModule: () => harness.audit,
    resolveLogger: () => harness.logger,
    generateId: harness.nextIdRef,
  }
}

function expectNoCanaries(value: unknown) {
  const serialized = JSON.stringify(value)

  for (const canary of Object.values(SENSITIVE_CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

describe("admin refunds request route", () => {
  const originalAdminRefundEnabled = process.env.ADMIN_REFUND_REQUEST_ENABLED

  beforeEach(() => {
    process.env.ADMIN_REFUND_REQUEST_ENABLED = "true"
  })

  afterAll(() => {
    if (originalAdminRefundEnabled === undefined) {
      delete process.env.ADMIN_REFUND_REQUEST_ENABLED
    } else {
      process.env.ADMIN_REFUND_REQUEST_ENABLED = originalAdminRefundEnabled
    }
  })

  it("creates a local requested refund reservation without financial truth", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const res = createResponse()
    const fixedId = "refreq_pregenerated_01"

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 2500,
      currency_code: "brl",
      idempotency_key: "admin-refund/order_admin_refund_01/1",
      reason: "customer_request",
      operator_note: "partial refund",
      metadata: { source: "admin" },
    }

    await handleAdminCreateRefundRequest(harness.req, res, {
      ...baseDeps(harness),
      generateId: () => fixedId,
      generateActionAttemptId: () => "attempt_refund_01",
      generateCorrelationId: () => "corr_refund_01",
    })

    expect(res.statusCode).toBe(201)
    expect(harness.refundRequests).toHaveLength(1)
    expect(harness.refundRequests[0]?.id).toBe(fixedId)
    expect(harness.refundRequests[0]?.status).toBe(REFUND_REQUEST_STATUS.REQUESTED)
    expect(harness.refundRequests[0]?.requested_by_operator_id).toBe(ADMIN_ACTOR_ID)
    expect(harness.refundRequests[0]?.confirmed_at).toBeNull()
    expect(harness.refundRequests[0]?.stripe_refund_id).toBeNull()

    expect(harness.auditCalls).toHaveLength(2)
    expect(harness.auditCalls[0]?.stage).toBe("intent")
    expect(harness.auditCalls[0]?.payload).toMatchObject({
      action: "refund_order",
      entity_type: "refund_request",
      entity_id: fixedId,
      action_attempt_id: "attempt_refund_01",
      correlation_id: "corr_refund_01",
      admin_id: ADMIN_ACTOR_ID,
      result: "requested",
    })
    expect(harness.auditCalls[1]?.stage).toBe("outcome")
    expect(harness.auditCalls[1]?.payload).toMatchObject({
      result: "requested",
      entity_id: fixedId,
      action_attempt_id: "attempt_refund_01",
      correlation_id: "corr_refund_01",
    })
    expect(harness.auditCalls[1]?.payload.result).not.toBe("succeeded")

    const body = res.json.mock.calls[0]?.[0]
    expect(body.reused_idempotency).toBe(false)
    expect(body.availability.available_amount).toBe(7400)
    expectNoCanaries(body)
    expectNoCanaries(harness.auditCalls)
  })

  it("rejects missing actor before intent or domain", async () => {
    const harness = createInMemoryAdminRefundHarness({ omitAuth: true })
    const createSpy = jest.fn(async (records: RefundRequestRecord[]) => {
      harness.refundRequests.push(...records)
      return records
    })

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/missing-actor",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, createResponse(), {
        ...baseDeps(harness),
        resolveRefundRequestModule: () => ({
          listRefundRequests: async () => [],
          createRefundRequests: createSpy,
        }),
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.UNAUTHORIZED,
      message: "ADMIN_ACTOR_REQUIRED",
    })

    expect(harness.audit.appendIntent).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
    expect(harness.refundRequests).toHaveLength(0)
  })

  it("rejects api-key actor before intent or domain", async () => {
    const harness = createInMemoryAdminRefundHarness({
      auth_context: { actor_type: "api-key", actor_id: "apk_01" },
    })
    const createSpy = jest.fn(async () => [])

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/api-key",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, createResponse(), {
        ...baseDeps(harness),
        resolveRefundRequestModule: () => ({
          listRefundRequests: async () => [],
          createRefundRequests: createSpy,
        }),
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: "ADMIN_ACTOR_TYPE_FORBIDDEN",
    })

    expect(harness.audit.appendIntent).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it("rejects empty actor_id before intent or domain", async () => {
    const harness = createInMemoryAdminRefundHarness({
      auth_context: { actor_type: "user", actor_id: "   " },
    })

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/empty-actor",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, createResponse(), baseDeps(harness))
    ).rejects.toMatchObject({
      message: "ADMIN_ACTOR_REQUIRED",
    })

    expect(harness.audit.appendIntent).not.toHaveBeenCalled()
  })

  it("rejects requested_by_operator_id body spoof", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const createSpy = jest.fn(async () => [])

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/spoof-operator",
      requested_by_operator_id: "spoof_operator",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, createResponse(), {
        ...baseDeps(harness),
        resolveRefundRequestModule: () => ({
          listRefundRequests: async () => [],
          createRefundRequests: createSpy,
        }),
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "REFUND_REQUEST_BODY_INVALID",
    })

    expect(harness.audit.appendIntent).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it("records blocked outcome for factual business guards", async () => {
    const harness = createInMemoryAdminRefundHarness()

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 9901,
      currency_code: "brl",
      idempotency_key: "admin-refund/over-captured-blocked",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, createResponse(), baseDeps(harness))
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "REFUND_REQUEST_AMOUNT_EXCEEDS_AVAILABLE_CAPTURED",
    })

    expect(harness.auditCalls.map((call) => call.stage)).toEqual([
      "intent",
      "outcome",
    ])
    expect(harness.auditCalls[1]?.payload.result).toBe("blocked")
    expect(harness.refundRequests).toHaveLength(0)
  })

  it("records failed outcome for unexpected domain exceptions", async () => {
    const harness = createInMemoryAdminRefundHarness()

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/domain-exception",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, createResponse(), {
        ...baseDeps(harness),
        resolveRefundRequestModule: () => ({
          listRefundRequests: async () => [],
          createRefundRequests: async () => {
            throw new Error("REFUND_REQUEST_STORAGE_FAILED")
          },
        }),
      })
    ).rejects.toMatchObject({
      type: MedusaError.Types.UNEXPECTED_STATE,
      message: "REFUND_REQUEST_STORAGE_FAILED",
    })

    expect(harness.auditCalls[1]?.payload.result).toBe("failed")
    expect(harness.auditCalls[1]?.payload.metadata).toMatchObject({
      error_code: "REFUND_REQUEST_STORAGE_FAILED",
    })
    expectNoCanaries(harness.logger.error.mock.calls)
    expectNoCanaries(harness.auditCalls)
  })

  it("blocks domain when intent append fails", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const failing = createAuditDouble({
      intentError: new Error("audit intent unavailable"),
    })
    const createSpy = jest.fn(async () => [])

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/intent-fail",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, createResponse(), {
        ...baseDeps(harness),
        resolveAdminActionLogModule: () => failing.audit,
        resolveRefundRequestModule: () => ({
          listRefundRequests: async () => [],
          createRefundRequests: createSpy,
        }),
      })
    ).rejects.toMatchObject({
      message: "ADMIN_ACTION_LOG_INTENT_FAILED",
    })

    expect(createSpy).not.toHaveBeenCalled()
    expect(harness.refundRequests).toHaveLength(0)
  })

  it("preserves original domain error when outcome append also fails", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const failing = createAuditDouble({
      outcomeError: new Error("outcome append failed"),
    })

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 9901,
      currency_code: "brl",
      idempotency_key: "admin-refund/domain-and-outcome-fail",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, createResponse(), {
        ...baseDeps(harness),
        resolveAdminActionLogModule: () => failing.audit,
      })
    ).rejects.toMatchObject({
      message: "REFUND_REQUEST_AMOUNT_EXCEEDS_AVAILABLE_CAPTURED",
    })

    expect(failing.calls).toHaveLength(1)
    expect(failing.calls[0]?.stage).toBe("intent")
    expect(harness.logger.error).toHaveBeenCalledWith(
      "ADMIN_ACTION_LOG_OUTCOME_FAILED",
      expect.objectContaining({
        error_code: "ADMIN_ACTION_LOG_OUTCOME_FAILED",
        orphan: true,
      })
    )
    expectNoCanaries(harness.logger.error.mock.calls)
  })

  it("preserves HTTP success when domain succeeds and outcome append fails", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const failing = createAuditDouble({
      outcomeError: new Error("outcome append failed"),
    })
    const createSpy = jest.fn(async (records: RefundRequestRecord[]) => {
      harness.refundRequests.push(...records)
      return records
    })
    const res = createResponse()
    const fixedId = "refreq_orphan_success_01"

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1500,
      currency_code: "brl",
      idempotency_key: "admin-refund/outcome-fail-after-success",
    }

    await handleAdminCreateRefundRequest(harness.req, res, {
      ...baseDeps(harness),
      resolveAdminActionLogModule: () => failing.audit,
      resolveRefundRequestModule: () => ({
        listRefundRequests: async () => [],
        createRefundRequests: createSpy,
      }),
      generateId: () => fixedId,
    })

    expect(res.statusCode).toBe(201)
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(harness.refundRequests).toHaveLength(1)
    expect(harness.refundRequests[0]?.id).toBe(fixedId)
    expect(failing.calls).toHaveLength(1)
    expect(failing.calls[0]?.stage).toBe("intent")
    expect(harness.logger.error).toHaveBeenCalledWith(
      "ADMIN_ACTION_LOG_OUTCOME_FAILED",
      expect.objectContaining({
        orphan: true,
        domain_succeeded: true,
      })
    )
    expectNoCanaries(res.json.mock.calls[0]?.[0])
  })

  it("reuses idempotent admin refund request without duplicating reservation", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const res = createResponse()
    const idempotencyKey = "admin-refund/order_admin_refund_01/replay"
    let attempt = 0

    const bodyInput = {
      order_id: ORDER_ID,
      amount: 2500,
      currency_code: "brl",
      idempotency_key: idempotencyKey,
    }

    const deps = {
      ...baseDeps(harness),
      generateActionAttemptId: () => `attempt_replay_${++attempt}`,
      generateCorrelationId: () => "corr_replay_shared",
    }

    harness.req.body = bodyInput
    await handleAdminCreateRefundRequest(harness.req, createResponse(), deps)

    harness.req.body = bodyInput
    await handleAdminCreateRefundRequest(harness.req, res, deps)

    expect(harness.refundRequests).toHaveLength(1)
    expect(res.statusCode).toBe(200)

    const body = res.json.mock.calls[0]?.[0]
    expect(body.reused_idempotency).toBe(true)

    const outcomePayloads = harness.auditCalls.filter(
      (call) => call.stage === "outcome"
    )
    expect(outcomePayloads).toHaveLength(2)
    expect(outcomePayloads[0]?.payload.action_attempt_id).not.toBe(
      outcomePayloads[1]?.payload.action_attempt_id
    )
    expect(outcomePayloads[1]?.payload.metadata).toMatchObject({
      reused_idempotency: true,
    })
  })

  it("preserves RefundRequest service method context across creation and replay", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const idempotencyKey = "admin-refund/order_admin_refund_01/service-context"
    const refundRequestModule = {
      baseRepository_: { marker: true },
      async listRefundRequests(
        this: { baseRepository_: { marker: boolean } },
        filters?: {
          order_id?: string
          idempotency_key?: string
        }
      ) {
        expect(this.baseRepository_.marker).toBe(true)

        return harness.refundRequests.filter((request) => {
          if (
            filters?.idempotency_key &&
            request.idempotency_key !== filters.idempotency_key
          ) {
            return false
          }

          if (filters?.order_id && request.order_id !== filters.order_id) {
            return false
          }

          return true
        })
      },
      async createRefundRequests(
        this: { baseRepository_: { marker: boolean } },
        records: RefundRequestRecord[]
      ) {
        expect(this.baseRepository_.marker).toBe(true)
        harness.refundRequests.push(...records)
        return records
      },
    }
    const deps = {
      ...baseDeps(harness),
      resolveRefundRequestModule: () => refundRequestModule,
    }
    const bodyInput = {
      order_id: ORDER_ID,
      amount: 2500,
      currency_code: "brl",
      idempotency_key: idempotencyKey,
    }
    const firstResponse = createResponse()
    const replayResponse = createResponse()

    harness.req.body = bodyInput
    await handleAdminCreateRefundRequest(harness.req, firstResponse, deps)

    harness.req.body = bodyInput
    await handleAdminCreateRefundRequest(harness.req, replayResponse, deps)

    expect(firstResponse.statusCode).toBe(201)
    expect(firstResponse.json.mock.calls[0]?.[0].reused_idempotency).toBe(false)
    expect(replayResponse.statusCode).toBe(200)
    expect(replayResponse.json.mock.calls[0]?.[0].reused_idempotency).toBe(true)
    expect(harness.refundRequests).toHaveLength(1)
  })

  it("rejects concurrent over-captured reservations with different idempotency keys", async () => {
    const harness = createInMemoryAdminRefundHarness()

    const deps = {
      ...baseDeps(harness),
      withOrderRefundReservationClaim,
    }

    const firstRequest = handleAdminCreateRefundRequest(
      {
        ...harness.req,
        body: {
          order_id: ORDER_ID,
          amount: 6000,
          currency_code: "brl",
          idempotency_key: "admin-refund/order_admin_refund_01/concurrent-a",
        },
      } as MedusaRequest,
      createResponse(),
      deps
    )

    const secondRequest = handleAdminCreateRefundRequest(
      {
        ...harness.req,
        body: {
          order_id: ORDER_ID,
          amount: 6000,
          currency_code: "brl",
          idempotency_key: "admin-refund/order_admin_refund_01/concurrent-b",
        },
      } as MedusaRequest,
      createResponse(),
      deps
    )

    const [first, second] = await Promise.allSettled([
      firstRequest,
      secondRequest,
    ])

    const fulfilled = [first, second].filter((result) => result.status === "fulfilled")
    const rejected = [first, second].filter((result) => result.status === "rejected")

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        type: MedusaError.Types.INVALID_DATA,
      }),
    })
    expect(harness.refundRequests).toHaveLength(1)
    expect(harness.refundRequests[0]?.amount).toBe(6000)
  })

  it("rejects zero and negative refund amounts", async () => {
    const harness = createInMemoryAdminRefundHarness()

    for (const amount of [0, -100]) {
      const res = createResponse()
      harness.req.body = {
        order_id: ORDER_ID,
        amount,
        currency_code: "brl",
        idempotency_key: `admin-refund/${ORDER_ID}/invalid-${amount}`,
      }

      await expect(
        handleAdminCreateRefundRequest(harness.req, res, baseDeps(harness))
      ).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
      })
    }
  })

  it("rejects over-captured and currency mismatch requests", async () => {
    const harness = createInMemoryAdminRefundHarness()

    const overCapturedRes = createResponse()
    harness.req.body = {
      order_id: ORDER_ID,
      amount: 9901,
      currency_code: "brl",
      idempotency_key: "admin-refund/over-captured",
    }

    await expect(
      handleAdminCreateRefundRequest(harness.req, overCapturedRes, baseDeps(harness))
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })

    const currencyMismatchRes = createResponse()
    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1000,
      currency_code: "usd",
      idempotency_key: "admin-refund/currency-mismatch",
    }

    await expect(
      handleAdminCreateRefundRequest(
        harness.req,
        currencyMismatchRes,
        baseDeps(harness)
      )
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
  })

  it("does not create Order or mutate order metadata", async () => {
    const harness = createInMemoryAdminRefundHarness()
    const orderBefore = harness.orders.get(ORDER_ID)

    harness.req.body = {
      order_id: ORDER_ID,
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/no-order-create",
    }

    await handleAdminCreateRefundRequest(
      harness.req,
      createResponse(),
      baseDeps(harness)
    )

    expect(harness.orders.get(ORDER_ID)).toEqual(orderBefore)
    expect(harness.orders.size).toBe(1)
  })

  it("uses injectable fake Stripe boundary only in tests", async () => {
    const layer = createFakeStripeRefundCreationLayer()
    const result = await layer.createRefund({
      payment_intent_id: PAYMENT_INTENT_ID,
      amount: 1000,
      currency_code: "brl",
      idempotency_key: "admin-refund/fake-stripe",
    })

    expect(result.stripe_refund_id).toMatch(/^re_fake_/)
    expect(result.status).toBe("pending")
  })

  it("exports POST route handler", async () => {
    expect(typeof adminCreateRefundRequestRoute).toBe("function")
  })
})
