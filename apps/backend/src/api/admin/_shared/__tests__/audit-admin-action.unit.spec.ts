import { MedusaError } from "@medusajs/framework/utils"
import {
  auditAdminAction,
  type AdminActionLogAppendService,
} from "../audit-admin-action"
import { requireAdminActor } from "../require-admin-actor"
import type { AdminActionFact } from "../../../../modules/admin-action-log"

function buildFact(
  overrides: Partial<AdminActionFact> = {}
): AdminActionFact {
  return {
    id: "admact_01",
    action_attempt_id: "attempt_01",
    correlation_id: "corr_01",
    audit_stage: "intent",
    admin_id: "user_01",
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
    idempotency_key: "idem_01",
    created_at: "2026-07-20T12:00:00.000Z",
    updated_at: "2026-07-20T12:00:00.000Z",
    ...overrides,
  }
}

describe("requireAdminActor", () => {
  it("accepts a valid user actor from auth_context", () => {
    const actor = requireAdminActor({
      auth_context: { actor_type: "user", actor_id: " user_admin_01 " },
    })
    expect(actor).toEqual({ actor_type: "user", actor_id: "user_admin_01" })
  })

  it("rejects missing auth_context", () => {
    expect(() => requireAdminActor({} as never)).toThrow("ADMIN_ACTOR_REQUIRED")
  })

  it("rejects api-key actors", () => {
    expect(() =>
      requireAdminActor({
        auth_context: { actor_type: "api-key", actor_id: "apk_01" },
      })
    ).toThrow("ADMIN_ACTOR_TYPE_FORBIDDEN")
  })

  it.each([undefined, "", "   "])(
    "rejects missing or empty actor_id (%j)",
    (actorId) => {
      expect(() =>
        requireAdminActor({
          auth_context: {
            actor_type: "user",
            actor_id: actorId as never,
          },
        })
      ).toThrow("ADMIN_ACTOR_REQUIRED")
    }
  )

  it("never derives actor from body spoof fields", () => {
    const operatorFrom = (...parts: string[]) => parts.join("")
    const req = {
      auth_context: undefined,
      body: {
        [operatorFrom("requested_by_", "operator_id")]: "spoof_user",
        [operatorFrom("created_by_", "operator_id")]: "spoof_user",
        admin_id: "spoof_user",
      },
    } as never

    expect(() => requireAdminActor(req)).toThrow("ADMIN_ACTOR_REQUIRED")
  })
})

describe("auditAdminAction Strategy B", () => {
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
          audit_stage: "outcome",
          result: payload.result,
          action_attempt_id: String(payload.action_attempt_id),
          correlation_id: String(payload.correlation_id),
        })
      }),
    }
    return { audit, calls, getOutcomeCalls: () => outcomeCalls }
  }

  const baseDescriptor = {
    action_attempt_id: "attempt_01",
    correlation_id: "corr_01",
    idempotency_key: "idem_01",
    actor: { actor_type: "user" as const, actor_id: "user_01" },
    action: "refund_order" as const,
    entity_type: "refund_request" as const,
    entity_id: "refreq_01",
    intent_metadata: { order_id: "order_01" },
    classifySuccess: () => ({
      result: "requested" as const,
      previous_state: {},
      new_state: { status: "requested", amount: 1000, currency_code: "brl" },
      metadata: { reused_idempotency: false },
    }),
    classifyDomainError: () => "failed" as const,
  }

  it("persists intent before executing the domain callback", async () => {
    const order: string[] = []
    const { audit } = createAuditDouble()
    ;(audit.appendIntent as jest.Mock).mockImplementation(async (payload) => {
      order.push("intent")
      return buildFact({
        action_attempt_id: String(payload.action_attempt_id),
        correlation_id: String(payload.correlation_id),
      })
    })

    const result = await auditAdminAction({
      audit,
      descriptor: baseDescriptor,
      executeDomain: async () => {
        order.push("domain")
        return { id: "refreq_01" }
      },
    })

    expect(result).toEqual({ id: "refreq_01" })
    expect(order).toEqual(["intent", "domain"])
    expect(audit.appendIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        action_attempt_id: "attempt_01",
        correlation_id: "corr_01",
        admin_id: "user_01",
        metadata: { order_id: "order_01" },
      })
    )
  })

  it("does not execute domain when intent append fails", async () => {
    const domain = jest.fn(async () => ({ id: "refreq_01" }))
    const { audit } = createAuditDouble({
      intentError: new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "ADMIN_ACTION_LOG_INTENT_FAILED"
      ),
    })

    await expect(
      auditAdminAction({
        audit,
        descriptor: baseDescriptor,
        executeDomain: domain,
      })
    ).rejects.toThrow("ADMIN_ACTION_LOG_INTENT_FAILED")

    expect(domain).not.toHaveBeenCalled()
    expect(audit.appendOutcome).not.toHaveBeenCalled()
  })

  it("executes the domain callback at most once", async () => {
    const domain = jest.fn(async () => ({ id: "refreq_01" }))
    const { audit } = createAuditDouble()

    await auditAdminAction({
      audit,
      descriptor: baseDescriptor,
      executeDomain: domain,
    })

    expect(domain).toHaveBeenCalledTimes(1)
  })

  it("appends failed outcome and preserves the original domain error", async () => {
    const domainError = new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "REFUND_REQUEST_NOT_AVAILABLE"
    )
    const { audit, calls } = createAuditDouble()

    await expect(
      auditAdminAction({
        audit,
        descriptor: {
          ...baseDescriptor,
          classifyDomainError: () => "blocked",
        },
        executeDomain: async () => {
          throw domainError
        },
      })
    ).rejects.toThrow("REFUND_REQUEST_NOT_AVAILABLE")

    expect(calls.map((entry) => entry.stage)).toEqual(["intent", "outcome"])
    expect(calls[1].payload).toMatchObject({
      result: "blocked",
      audit_stage: "outcome",
    })
  })

  it("leaves an orphan when terminal append fails after domain error", async () => {
    const logs: Array<{ code: string; meta?: Record<string, unknown> }> = []
    const { audit } = createAuditDouble({
      outcomeError: new Error("terminal write failed"),
    })

    await expect(
      auditAdminAction({
        audit,
        logger: {
          error: (code, meta) => {
            logs.push({ code, meta })
          },
        },
        descriptor: baseDescriptor,
        executeDomain: async () => {
          throw new MedusaError(
            MedusaError.Types.UNEXPECTED_STATE,
            "REFUND_REQUEST_CREATE_FAILED"
          )
        },
      })
    ).rejects.toThrow("REFUND_REQUEST_CREATE_FAILED")

    expect(logs).toEqual([
      expect.objectContaining({
        code: "ADMIN_ACTION_LOG_OUTCOME_FAILED",
        meta: expect.objectContaining({
          action_attempt_id: "attempt_01",
          correlation_id: "corr_01",
          orphan: true,
        }),
      }),
    ])
    expect(JSON.stringify(logs)).not.toMatch(/authorization|cookie|secret|pix_/i)
  })

  it("returns domain success when outcome succeeds", async () => {
    const { audit, calls } = createAuditDouble()
    const result = await auditAdminAction({
      audit,
      descriptor: baseDescriptor,
      executeDomain: async () => ({ id: "refreq_01", status: "requested" }),
    })

    expect(result).toEqual({ id: "refreq_01", status: "requested" })
    expect(calls[1].payload).toMatchObject({
      result: "requested",
      new_state: {
        status: "requested",
        amount: 1000,
        currency_code: "brl",
      },
      metadata: { reused_idempotency: false },
    })
  })

  it("preserves domain success when outcome append fails and does not retry domain", async () => {
    const domain = jest.fn(async () => ({ id: "refreq_01", ok: true }))
    const logs: Array<Record<string, unknown>> = []
    const { audit, getOutcomeCalls } = createAuditDouble({
      outcomeError: new Error("outcome unavailable"),
    })

    const result = await auditAdminAction({
      audit,
      logger: {
        error: (code, meta) => {
          logs.push({ code, ...(meta ?? {}) })
        },
      },
      descriptor: baseDescriptor,
      executeDomain: domain,
    })

    expect(result).toEqual({ id: "refreq_01", ok: true })
    expect(domain).toHaveBeenCalledTimes(1)
    expect(getOutcomeCalls()).toBe(1)
    expect(logs[0]).toMatchObject({
      code: "ADMIN_ACTION_LOG_OUTCOME_FAILED",
      domain_succeeded: true,
      orphan: true,
      action_attempt_id: "attempt_01",
      correlation_id: "corr_01",
    })
  })

  it("preserves action_attempt_id and correlation_id across intent and outcome", async () => {
    const { audit, calls } = createAuditDouble()
    await auditAdminAction({
      audit,
      descriptor: {
        ...baseDescriptor,
        action_attempt_id: "attempt_preserve",
        correlation_id: "corr_preserve",
      },
      executeDomain: async () => ({ id: "refreq_01" }),
    })

    expect(calls).toHaveLength(2)
    expect(calls[0].payload).toMatchObject({
      action_attempt_id: "attempt_preserve",
      correlation_id: "corr_preserve",
    })
    expect(calls[1].payload).toMatchObject({
      action_attempt_id: "attempt_preserve",
      correlation_id: "corr_preserve",
    })
  })
})
