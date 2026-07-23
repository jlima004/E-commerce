import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { handleAdminCreateExchangeRequest } from "../../src/api/admin/exchanges/route"
import { handleAdminUpdateExchangeRequest } from "../../src/api/admin/exchanges/[id]/route"
import type { AdminActionLogAppendService } from "../../src/api/admin/_shared/audit-admin-action"
import type { AdminActionFact } from "../../src/modules/admin-action-log"
import {
  EXCHANGE_REQUEST_REASON,
  EXCHANGE_REQUEST_STATUS,
  REVERSE_LOGISTICS_PROVIDER,
  type ExchangeRequestRecord,
} from "../../src/modules/exchange-request/types"

const ORDER_ID = "order_admin_exchange_01"
const ADMIN_ACTOR_ID = "user_admin_exchange_01"

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const SENSITIVE_CANARIES = {
  email: joinKey("cliente", "@", "compras", ".", "test"),
  clientSecret: joinKey("pi_test", "_", "secret_value"),
  webhookSecret: joinKey("whsec_", "test_canary_value"),
} as const

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
    id: "admact_ex_01",
    action_attempt_id: "attempt_ex_01",
    correlation_id: "corr_ex_01",
    audit_stage: "intent",
    admin_id: ADMIN_ACTOR_ID,
    admin_email: null,
    action: "update_exchange",
    entity_type: "exchange_request",
    entity_id: "excreq_01",
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
        action: payload.action as AdminActionFact["action"],
        audit_stage: "intent",
        result: "requested",
      })
    }),
    appendOutcome: jest.fn(async (payload) => {
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
        action: payload.action as AdminActionFact["action"],
        audit_stage: "outcome",
        result: payload.result,
      })
    }),
  }

  return { audit, calls }
}

function createInMemoryAdminExchangeHarness(options?: {
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

  const exchangeRequests: ExchangeRequestRecord[] = []
  let nextId = 1
  const logger = {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  }
  const { audit, calls } = createAuditDouble()

  const req = {
    body: {},
    params: {},
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

        if (key === "exchange_request") {
          return {
            createExchangeRequests: async (records: ExchangeRequestRecord[]) => {
              for (const record of records) {
                exchangeRequests.push(record)
              }

              return records
            },
            listExchangeRequests: async (filters?: { id?: string }) =>
              exchangeRequests.filter((request) => {
                if (filters?.id && request.id !== filters.id) {
                  return false
                }

                return true
              }),
            updateExchangeRequests: async (
              data: ExchangeRequestRecord | ExchangeRequestRecord[]
            ) => {
              const records = Array.isArray(data) ? data : [data]

              for (const record of records) {
                const index = exchangeRequests.findIndex(
                  (entry) => entry.id === record.id
                )

                if (index >= 0) {
                  exchangeRequests[index] = record
                }
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
    exchangeRequests,
    orders,
    audit,
    auditCalls: calls,
    logger,
    nextIdRef: () => `excreq_http_${nextId++}`,
  }
}

function createDeps(
  harness: ReturnType<typeof createInMemoryAdminExchangeHarness>,
  overrides?: {
    audit?: AdminActionLogAppendService
    createExchangeRequests?: (
      records: ExchangeRequestRecord[]
    ) => Promise<ExchangeRequestRecord[]>
    updateExchangeRequests?: (
      data: ExchangeRequestRecord | ExchangeRequestRecord[]
    ) => Promise<ExchangeRequestRecord[] | ExchangeRequestRecord>
    generateId?: () => string
    generateActionAttemptId?: () => string
    generateCorrelationId?: () => string
    isEnabled?: () => boolean
  }
) {
  return {
    resolveOrderModule: () => ({
      retrieveOrder: async (id: string) => harness.orders.get(id) ?? null,
    }),
    resolveExchangeRequestModule: () => ({
      createExchangeRequests:
        overrides?.createExchangeRequests ??
        (async (records: ExchangeRequestRecord[]) => {
          harness.exchangeRequests.push(...records)
          return records
        }),
      listExchangeRequests: async (filters?: { id?: string }) =>
        harness.exchangeRequests.filter((request) => {
          if (filters?.id && request.id !== filters.id) {
            return false
          }
          return true
        }),
      updateExchangeRequests:
        overrides?.updateExchangeRequests ??
        (async (data: ExchangeRequestRecord | ExchangeRequestRecord[]) => {
          const records = Array.isArray(data) ? data : [data]
          for (const record of records) {
            const index = harness.exchangeRequests.findIndex(
              (entry) => entry.id === record.id
            )
            if (index >= 0) {
              harness.exchangeRequests[index] = record
            }
          }
          return records
        }),
    }),
    resolveAdminActionLogModule: () => overrides?.audit ?? harness.audit,
    resolveLogger: () => harness.logger,
    generateId: overrides?.generateId ?? harness.nextIdRef,
    generateActionAttemptId: overrides?.generateActionAttemptId,
    generateCorrelationId: overrides?.generateCorrelationId,
    isEnabled: overrides?.isEnabled,
  }
}

function expectNoCanaries(value: unknown) {
  const serialized = JSON.stringify(value)

  for (const canary of Object.values(SENSITIVE_CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

describe("admin exchanges routes", () => {
  const originalAdminExchangeEnabled =
    process.env.ADMIN_EXCHANGE_REQUEST_ENABLED

  beforeEach(() => {
    process.env.ADMIN_EXCHANGE_REQUEST_ENABLED = "true"
  })

  afterAll(() => {
    if (originalAdminExchangeEnabled === undefined) {
      delete process.env.ADMIN_EXCHANGE_REQUEST_ENABLED
    } else {
      process.env.ADMIN_EXCHANGE_REQUEST_ENABLED = originalAdminExchangeEnabled
    }
  })

  it("creates defect exchange without refund or financial mutation", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const res = createResponse()
    const fixedId = "excreq_pregenerated_01"
    const initialPaymentStatus =
      harness.orders.get(ORDER_ID)?.metadata.payment_status

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [
        {
          line_item_id: "li_defect_01",
          product_title: "Camiseta Defeito",
          quantity: 1,
        },
      ],
      operator_note: "Defeito na estampa",
    }

    await handleAdminCreateExchangeRequest(
      harness.req,
      res,
      createDeps(harness, {
        generateId: () => fixedId,
        generateActionAttemptId: () => "attempt_create_01",
        generateCorrelationId: () => "corr_create_01",
      })
    )

    expect(res.statusCode).toBe(201)
    expect(harness.exchangeRequests).toHaveLength(1)
    expect(harness.exchangeRequests[0]?.id).toBe(fixedId)
    expect(harness.exchangeRequests[0]?.reason).toBe("defect")
    expect(harness.exchangeRequests[0]?.status).toBe("opened")
    expect(harness.exchangeRequests[0]?.created_by_operator_id).toBe(
      ADMIN_ACTOR_ID
    )
    expect(harness.orders.get(ORDER_ID)?.metadata.payment_status).toBe(
      initialPaymentStatus
    )

    expect(harness.auditCalls).toHaveLength(2)
    expect(harness.auditCalls[0]?.payload).toMatchObject({
      action: "update_exchange",
      entity_type: "exchange_request",
      entity_id: fixedId,
      action_attempt_id: "attempt_create_01",
      correlation_id: "corr_create_01",
      admin_id: ADMIN_ACTOR_ID,
      metadata: expect.objectContaining({
        exchange_operation: "create",
      }),
    })
    expect(harness.auditCalls[1]?.payload).toMatchObject({
      result: "succeeded",
      new_state: expect.objectContaining({ status: "opened" }),
      metadata: expect.objectContaining({
        exchange_operation: "create",
      }),
    })
    expect(JSON.stringify(harness.auditCalls)).not.toContain("approve_exchange")
    expectNoCanaries(res.json.mock.calls[0]?.[0])
    expectNoCanaries(harness.auditCalls)
  })

  it("rejects missing actor and api-key before intent or domain", async () => {
    for (const auth of [
      { omitAuth: true as const },
      { auth_context: { actor_type: "api-key", actor_id: "apk_01" } },
    ]) {
      const harness = createInMemoryAdminExchangeHarness(auth)
      const createSpy = jest.fn(async () => [])

      harness.req.body = {
        order_id: ORDER_ID,
        reason: EXCHANGE_REQUEST_REASON.DEFECT,
        affected_items: [{ product_title: "Camiseta", quantity: 1 }],
      }

      await expect(
        handleAdminCreateExchangeRequest(
          harness.req,
          createResponse(),
          createDeps(harness, { createExchangeRequests: createSpy })
        )
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /ADMIN_ACTOR_REQUIRED|ADMIN_ACTOR_TYPE_FORBIDDEN/
        ),
      })

      expect(harness.audit.appendIntent).not.toHaveBeenCalled()
      expect(createSpy).not.toHaveBeenCalled()
    }
  })

  it("rejects created_by_operator_id body spoof", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const createSpy = jest.fn(async () => [])

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
      created_by_operator_id: "spoof_operator",
    }

    await expect(
      handleAdminCreateExchangeRequest(
        harness.req,
        createResponse(),
        createDeps(harness, { createExchangeRequests: createSpy })
      )
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "EXCHANGE_REQUEST_BODY_INVALID",
    })

    expect(harness.audit.appendIntent).not.toHaveBeenCalled()
    expect(createSpy).not.toHaveBeenCalled()
  })

  it("blocks domain when create intent append fails", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const failing = createAuditDouble({
      intentError: new Error("intent unavailable"),
    })
    const createSpy = jest.fn(async () => [])

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await expect(
      handleAdminCreateExchangeRequest(
        harness.req,
        createResponse(),
        createDeps(harness, {
          audit: failing.audit,
          createExchangeRequests: createSpy,
        })
      )
    ).rejects.toMatchObject({
      message: "ADMIN_ACTION_LOG_INTENT_FAILED",
    })

    expect(createSpy).not.toHaveBeenCalled()
  })

  it("records blocked/failed terminal on create domain failure and preserves original error", async () => {
    const harness = createInMemoryAdminExchangeHarness()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }
    harness.orders.set(ORDER_ID, {
      id: ORDER_ID,
      metadata: {
        order_status: "pending",
        payment_status: "captured",
      },
    })

    await expect(
      handleAdminCreateExchangeRequest(
        harness.req,
        createResponse(),
        createDeps(harness)
      )
    ).rejects.toMatchObject({
      message: "EXCHANGE_REQUEST_ORDER_STATUS_NOT_ELIGIBLE",
    })

    expect(harness.auditCalls[1]?.payload.result).toBe("blocked")
  })

  it("preserves HTTP success when create domain succeeds and outcome fails", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const failing = createAuditDouble({
      outcomeError: new Error("outcome unavailable"),
    })
    const createSpy = jest.fn(async (records: ExchangeRequestRecord[]) => {
      harness.exchangeRequests.push(...records)
      return records
    })
    const res = createResponse()
    const fixedId = "excreq_orphan_create_01"

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await handleAdminCreateExchangeRequest(
      harness.req,
      res,
      createDeps(harness, {
        audit: failing.audit,
        createExchangeRequests: createSpy,
        generateId: () => fixedId,
      })
    )

    expect(res.statusCode).toBe(201)
    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(harness.exchangeRequests[0]?.id).toBe(fixedId)
    expect(failing.calls).toHaveLength(1)
    expect(harness.logger.error).toHaveBeenCalledWith(
      "ADMIN_ACTION_LOG_OUTCOME_FAILED",
      expect.objectContaining({
        orphan: true,
        domain_succeeded: true,
      })
    )
  })

  it("creates wrong_product exchange with manual Correios fields", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const res = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.WRONG_PRODUCT,
      affected_items: [{ product_title: "Camiseta P", quantity: 1 }],
      reverse_logistics_provider: REVERSE_LOGISTICS_PROVIDER.CORREIOS_MANUAL,
      reverse_tracking_code: "BR123456789BR",
      reverse_authorization_code: "AUTH123456",
      reverse_label_reference: "label-001",
    }

    await handleAdminCreateExchangeRequest(
      harness.req,
      res,
      createDeps(harness)
    )

    expect(res.statusCode).toBe(201)
    expect(harness.exchangeRequests[0]?.reverse_tracking_code).toBe(
      "BR123456789BR"
    )
    expect(harness.exchangeRequests[0]?.reverse_logistics_provider).toBe(
      "correios_manual"
    )
    expect(harness.auditCalls[1]?.payload.new_state).toEqual({
      status: "opened",
      reverse_logistics_provider: "correios_manual",
      reverse_tracking_code: "BR123456789BR",
      reverse_authorization_code: "AUTH123456",
      reverse_label_reference: "label-001",
    })
  })

  it("updates exchange status and reverse logistics through admin update route", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const createRes = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await handleAdminCreateExchangeRequest(
      harness.req,
      createRes,
      createDeps(harness)
    )

    const exchangeId = harness.exchangeRequests[0]?.id ?? ""
    const updateRes = createResponse()
    let attempt = 0

    harness.req.params = { id: exchangeId }
    harness.req.body = {
      status: EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
      reverse_logistics_provider: REVERSE_LOGISTICS_PROVIDER.CORREIOS_MANUAL,
      reverse_tracking_code: "BR555666777BR",
    }

    await handleAdminUpdateExchangeRequest(
      harness.req,
      updateRes,
      createDeps(harness, {
        generateActionAttemptId: () => `attempt_update_${++attempt}`,
        generateCorrelationId: () => "corr_update_shared",
      })
    )

    expect(updateRes.statusCode).toBe(200)
    expect(harness.exchangeRequests[0]?.status).toBe("awaiting_customer_return")
    expect(harness.exchangeRequests[0]?.reverse_tracking_code).toBe(
      "BR555666777BR"
    )

    const updateOutcome = harness.auditCalls.filter(
      (call) =>
        call.stage === "outcome" &&
        call.payload.entity_id === exchangeId &&
        call.payload.action === "update_exchange" &&
        (call.payload.new_state as { status?: string } | null)?.status ===
          "awaiting_customer_return"
    )
    const updateIntent = harness.auditCalls.find(
      (call) =>
        call.stage === "intent" &&
        call.payload.entity_id === exchangeId &&
        call.payload.action === "update_exchange" &&
        String(call.payload.action_attempt_id).startsWith("attempt_update_")
    )
    expect(updateIntent?.payload).toMatchObject({
      metadata: expect.objectContaining({
        exchange_operation: "update",
      }),
      new_state: expect.objectContaining({
        status: "awaiting_customer_return",
        reverse_tracking_code: "BR555666777BR",
      }),
    })
    expect(updateOutcome[0]?.payload).toMatchObject({
      result: "succeeded",
      previous_state: expect.objectContaining({ status: "opened" }),
      new_state: expect.objectContaining({
        status: "awaiting_customer_return",
        reverse_tracking_code: "BR555666777BR",
      }),
      metadata: expect.objectContaining({
        exchange_operation: "update",
      }),
    })
    expect(JSON.stringify(updateOutcome[0]?.payload)).not.toContain(
      "operator_note"
    )
    expect(JSON.stringify(updateOutcome[0]?.payload)).not.toContain(
      "affected_items"
    )
  })

  it("emits reject_exchange and cancel_exchange for factual status deltas", async () => {
    for (const [status, action] of [
      [EXCHANGE_REQUEST_STATUS.REJECTED, "reject_exchange"],
      [EXCHANGE_REQUEST_STATUS.CANCELED, "cancel_exchange"],
    ] as const) {
      const local = createInMemoryAdminExchangeHarness()
      local.req.body = {
        order_id: ORDER_ID,
        reason: EXCHANGE_REQUEST_REASON.DEFECT,
        affected_items: [{ product_title: "Camiseta", quantity: 1 }],
      }
      await handleAdminCreateExchangeRequest(
        local.req,
        createResponse(),
        createDeps(local, { generateId: () => `excreq_${status}` })
      )

      local.req.params = { id: `excreq_${status}` }
      local.req.body = { status }

      await handleAdminUpdateExchangeRequest(
        local.req,
        createResponse(),
        createDeps(local)
      )

      const outcome = local.auditCalls.find(
        (call) => call.stage === "outcome" && call.payload.action === action
      )
      const intent = local.auditCalls.find(
        (call) => call.stage === "intent" && call.payload.action === action
      )
      expect(intent?.payload).toMatchObject({
        action,
        new_state: expect.objectContaining({ status }),
      })
      expect(outcome?.payload).toMatchObject({
        action,
        result: "succeeded",
        new_state: expect.objectContaining({ status }),
      })
      expect(JSON.stringify(local.auditCalls)).not.toContain("approve_exchange")
      expect(JSON.stringify(local.auditCalls)).not.toContain(
        "reprocess_fulfillment"
      )
    }
  })

  it("uses a new action_attempt_id on update retry without overwriting prior facts", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }
    await handleAdminCreateExchangeRequest(
      harness.req,
      createResponse(),
      createDeps(harness, { generateId: () => "excreq_retry_01" })
    )

    let attempt = 0
    harness.req.params = { id: "excreq_retry_01" }
    harness.req.body = {
      operator_note: "first note",
    }

    await handleAdminUpdateExchangeRequest(
      harness.req,
      createResponse(),
      createDeps(harness, {
        generateActionAttemptId: () => `attempt_retry_${++attempt}`,
        generateCorrelationId: () => "corr_retry_shared",
      })
    )

    harness.req.body = {
      operator_note: "second note",
    }

    await handleAdminUpdateExchangeRequest(
      harness.req,
      createResponse(),
      createDeps(harness, {
        generateActionAttemptId: () => `attempt_retry_${++attempt}`,
        generateCorrelationId: () => "corr_retry_shared",
      })
    )

    const updateIntents = harness.auditCalls.filter(
      (call) =>
        call.stage === "intent" &&
        call.payload.entity_id === "excreq_retry_01" &&
        call.payload.action === "update_exchange" &&
        String(call.payload.action_attempt_id).startsWith("attempt_retry_")
    )
    expect(updateIntents).toHaveLength(2)
    expect(updateIntents[0]?.payload.action_attempt_id).toBe("attempt_retry_1")
    expect(updateIntents[1]?.payload.action_attempt_id).toBe("attempt_retry_2")
    expect(updateIntents[0]?.payload.correlation_id).toBe("corr_retry_shared")
    expect(updateIntents[1]?.payload.correlation_id).toBe("corr_retry_shared")
  })

  it("preserves HTTP success when update domain succeeds and outcome fails", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }
    await handleAdminCreateExchangeRequest(
      harness.req,
      createResponse(),
      createDeps(harness, { generateId: () => "excreq_update_orphan_01" })
    )

    const failing = createAuditDouble({
      outcomeError: new Error("outcome unavailable"),
    })
    const updateSpy = jest.fn(
      async (data: ExchangeRequestRecord | ExchangeRequestRecord[]) => {
        const records = Array.isArray(data) ? data : [data]
        for (const record of records) {
          const index = harness.exchangeRequests.findIndex(
            (entry) => entry.id === record.id
          )
          if (index >= 0) {
            harness.exchangeRequests[index] = record
          }
        }
        return records
      }
    )
    const res = createResponse()

    harness.req.params = { id: "excreq_update_orphan_01" }
    harness.req.body = {
      status: EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
    }

    await handleAdminUpdateExchangeRequest(
      harness.req,
      res,
      createDeps(harness, {
        audit: failing.audit,
        updateExchangeRequests: updateSpy,
      })
    )

    expect(res.statusCode).toBe(200)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(harness.exchangeRequests[0]?.status).toBe("awaiting_customer_return")
    expect(failing.calls).toHaveLength(1)
  })

  it("rejects invalid status transition via admin update route", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const createRes = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await handleAdminCreateExchangeRequest(
      harness.req,
      createRes,
      createDeps(harness)
    )

    const exchangeId = harness.exchangeRequests[0]?.id ?? ""
    const updateRes = createResponse()

    harness.req.params = { id: exchangeId }
    harness.req.body = {
      status: EXCHANGE_REQUEST_STATUS.RESOLVED,
    }

    await expect(
      handleAdminUpdateExchangeRequest(
        harness.req,
        updateRes,
        createDeps(harness)
      )
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "EXCHANGE_REQUEST_STATUS_TRANSITION_INVALID",
    })

    const blocked = harness.auditCalls.find(
      (call) =>
        call.stage === "outcome" &&
        call.payload.entity_id === exchangeId &&
        call.payload.result === "blocked"
    )
    expect(blocked).toBeDefined()
  })

  it.each([
    ["metadata", { source: "admin" }],
    ["payload", { raw: true }],
    ["headers", { authorization: "Bearer x" }],
    ["payment_status", "refunded"],
    ["refund", { amount: 100 }],
  ])(
    "rejects create body with top-level forbidden %s",
    async (_label, forbiddenValue) => {
      const harness = createInMemoryAdminExchangeHarness()
      const res = createResponse()

      harness.req.body = {
        order_id: ORDER_ID,
        reason: EXCHANGE_REQUEST_REASON.DEFECT,
        affected_items: [{ product_title: "Camiseta", quantity: 1 }],
        [_label]: forbiddenValue,
      }

      await expect(
        handleAdminCreateExchangeRequest(
          harness.req,
          res,
          createDeps(harness)
        )
      ).rejects.toMatchObject({
        type: MedusaError.Types.INVALID_DATA,
        message: "EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD",
      })

      expect(harness.exchangeRequests).toHaveLength(0)
      expect(harness.audit.appendIntent).not.toHaveBeenCalled()
    }
  )

  it("rejects update body with forbidden payload even when status is valid", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const createRes = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await handleAdminCreateExchangeRequest(
      harness.req,
      createRes,
      createDeps(harness)
    )

    const exchangeId = harness.exchangeRequests[0]?.id ?? ""
    const updateRes = createResponse()

    harness.req.params = { id: exchangeId }
    harness.req.body = {
      status: EXCHANGE_REQUEST_STATUS.AWAITING_CUSTOMER_RETURN,
      gelato_payload: { order_id: "gel_123" },
    }

    await expect(
      handleAdminUpdateExchangeRequest(
        harness.req,
        updateRes,
        createDeps(harness)
      )
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD",
    })

    expect(harness.exchangeRequests[0]?.status).toBe("opened")
  })

  it("rejects forbidden payload in operator_note", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const res = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
      operator_note: `contato ${SENSITIVE_CANARIES.email}`,
    }

    await expect(
      handleAdminCreateExchangeRequest(harness.req, res, createDeps(harness))
    ).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
      message: "EXCHANGE_REQUEST_FORBIDDEN_PAYLOAD",
    })
  })

  it("does not create RefundRequest side effects in harness", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const res = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.WRONG_PRODUCT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await handleAdminCreateExchangeRequest(
      harness.req,
      res,
      createDeps(harness)
    )

    expect(harness.exchangeRequests).toHaveLength(1)
    expect(JSON.stringify(harness.exchangeRequests)).not.toContain("refund_request")
    expect(JSON.stringify(harness.exchangeRequests)).not.toContain("stripe_refund")
  })

  it("returns NOT_ALLOWED when admin exchange route is disabled", async () => {
    const harness = createInMemoryAdminExchangeHarness()
    const res = createResponse()

    harness.req.body = {
      order_id: ORDER_ID,
      reason: EXCHANGE_REQUEST_REASON.DEFECT,
      affected_items: [{ product_title: "Camiseta", quantity: 1 }],
    }

    await expect(
      handleAdminCreateExchangeRequest(
        harness.req,
        res,
        createDeps(harness, { isEnabled: () => false })
      )
    ).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
      message: "ADMIN_EXCHANGE_REQUEST_DISABLED",
    })

    expect(harness.audit.appendIntent).not.toHaveBeenCalled()
  })
})
