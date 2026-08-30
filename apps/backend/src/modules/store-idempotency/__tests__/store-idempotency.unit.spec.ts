import {
  buildStoreIdempotencyRequestFingerprint,
  hashStoreIdempotencyKey,
  hashStoreIdempotencyScope,
  StoreIdempotencyModuleService,
  STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS,
  type StoreIdempotencyRecordRow,
} from "../service"
import {
  GuestCartCapabilityModuleService,
} from "../../guest-cart-capability/service"
import { hashGuestCartCapability } from "../../guest-cart-capability/hash"
import {
  GUEST_CART_CAPABILITY_STATUS,
  type GuestCartCapabilityRecord,
} from "../../guest-cart-capability/types"

const at = new Date("2026-08-24T12:00:00.000Z")
const rawIdempotencyKey = "cart-merge-key-canary"
const presentedCapability = "guest-capability-canary"
const customerId = "cus_phase16_01"
const guestCartId = "cart_guest_phase16"
const resultId = "cmres_phase16_result"
const idempotencyRecordId = "stidem_phase16_record"
const operation = "cart_merge"

const semanticObject = {
  operation: "CART_MERGE",
  customerId,
  guestCartId,
  customerCartId: null,
  guestVersion: 7,
  customerVersion: null,
  normalizedGuestIntent: [
    { variantId: "variant_a", quantity: 2 },
    { variantId: "variant_b", quantity: 1 },
  ],
}

function row(overrides: Partial<StoreIdempotencyRecordRow> = {}): StoreIdempotencyRecordRow {
  return {
    id: idempotencyRecordId,
    operation,
    actor_scope_hash: hashStoreIdempotencyScope({
      actor_type: "customer",
      customer_id: customerId,
    }),
    resource_scope_hash: hashStoreIdempotencyScope({
      resource_type: "cart_merge",
      guest_cart_id: guestCartId,
      customer_cart_id: null,
      capability_id: "gccap_phase16",
    }),
    idempotency_key_hash: hashStoreIdempotencyKey(
      rawIdempotencyKey,
      Buffer.alloc(32).toString("base64url")
    ),
    hash_version: "hmac-sha256-v1",
    pepper_version: 1,
    request_fingerprint: buildStoreIdempotencyRequestFingerprint(semanticObject),
    state: "processing",
    state_version: 1,
    result_type: null,
    result_id: null,
    response_status: null,
    result_safe_metadata: null,
    locked_at: null,
    state_deadline_at: new Date(at.getTime() + 5 * 60 * 1000).toISOString(),
    next_retry_at: null,
    retry_attempt_count: 0,
    retry_started_at: null,
    terminalized_at: null,
    completed_at: null,
    failure_code: null,
    expires_at: null,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
    ...overrides,
  }
}

function sharedContext(raw: jest.Mock): any {
  const transactionManager = {
    getTransactionContext: () => ({ raw }),
  }
  return {
    __type: "MedusaContext" as const,
    transactionManager,
  }
}

function serviceWithRaw(raw: jest.Mock): StoreIdempotencyModuleService {
  const service = Object.create(StoreIdempotencyModuleService.prototype)
  Object.defineProperty(service, "baseRepository_", {
    value: {
      getActiveManager: () => ({ getKnex: () => ({ raw }) }),
      transaction: jest.fn(() => {
        throw new Error("PARALLEL_TRANSACTION_FORBIDDEN")
      }),
    },
  })
  return service
}

function capabilityRecord(overrides: Partial<GuestCartCapabilityRecord> = {}): GuestCartCapabilityRecord {
  return {
    id: "gccap_phase16",
    cart_id: guestCartId,
    token_hash: hashGuestCartCapability(presentedCapability),
    status: GUEST_CART_CAPABILITY_STATUS.CONSUMED,
    expires_at: new Date(at.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    consumed_at: at.toISOString(),
    revoked_at: null,
    last_used_at: new Date(at.getTime() - 1000).toISOString(),
    created_at: new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    updated_at: at.toISOString(),
    deleted_at: null,
    ...overrides,
  }
}

describe("Task 16-05-02: idempotency e replay terminal", () => {
  it("distingue first claim, in-progress, replay e conflito sem escrever no conflito", async () => {
    const firstRaw = jest.fn().mockResolvedValueOnce({ rows: [row()] })
    const service = serviceWithRaw(firstRaw)
    const context = sharedContext(firstRaw)
    const input = {
      operation,
      actorScope: { actor_type: "customer", customer_id: customerId },
      resourceScope: {
        resource_type: "cart_merge",
        guest_cart_id: guestCartId,
        customer_cart_id: null,
        capability_id: "gccap_phase16",
      },
      rawIdempotencyKey,
      canonicalSemanticObject: semanticObject,
      sharedContext: context,
      at,
    }

    const first = await service.claimStoreIdempotency(input)
    expect(first.type).toBe("claimed")
    expect(firstRaw).toHaveBeenCalledTimes(1)

    const inProgressRow = row({ state: "processing", state_version: 1 })
    const inProgressRaw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [inProgressRow] })
    const inProgress = await serviceWithRaw(inProgressRaw).claimStoreIdempotency({
      ...input,
      sharedContext: sharedContext(inProgressRaw),
    })
    expect(inProgress.type).toBe("in_progress")

    const committed = row({
      state: "completed",
      state_version: 2,
      result_type: "cart_merge",
      result_id: resultId,
      response_status: 200,
      result_safe_metadata: {
        operation,
        result_type: "cart_merge",
        result_id: resultId,
        response_status: 200,
      },
      completed_at: at.toISOString(),
      terminalized_at: at.toISOString(),
      expires_at: new Date(
        at.getTime() + STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS
      ).toISOString(),
    })
    const replayRaw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [committed] })
    const replay = await serviceWithRaw(replayRaw).claimStoreIdempotency({
      ...input,
      sharedContext: sharedContext(replayRaw),
    })
    expect(replay.type).toBe("replay")
    expect(replay.record.id).toBe(idempotencyRecordId)

    const conflictRaw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [committed] })
    const conflict = await serviceWithRaw(conflictRaw).claimStoreIdempotency({
      ...input,
      canonicalSemanticObject: {
        ...semanticObject,
        guestVersion: 8,
      },
      sharedContext: sharedContext(conflictRaw),
    })
    expect(conflict.type).toBe("conflict")
    if (conflict.type !== "conflict") {
      throw new Error("expected idempotency conflict")
    }
    expect(conflict.publicCode).toBe("IDEMPOTENCY_KEY_REUSE_CONFLICT")
    expect(conflict.record.state_version).toBe(2)
    expect(conflictRaw).toHaveBeenCalledTimes(2)
    expect(conflictRaw.mock.calls.flat().join(" ")).not.toContain(rawIdempotencyKey)
    expect(conflictRaw.mock.calls.flat().join(" ")).not.toContain(presentedCapability)
  })

  it("completa, carrega replay committed e falha usando o mesmo sharedContext sem transação paralela", async () => {
    const committed = row({
      state: "completed",
      state_version: 2,
      result_type: "cart_merge",
      result_id: resultId,
      response_status: 200,
      result_safe_metadata: {
        operation,
        result_type: "cart_merge",
        result_id: resultId,
        response_status: 200,
      },
      completed_at: at.toISOString(),
      terminalized_at: at.toISOString(),
      expires_at: new Date(
        at.getTime() + STORE_IDEMPOTENCY_DEFAULT_TERMINAL_RETENTION_MS
      ).toISOString(),
    })
    const raw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [committed] })
      .mockResolvedValueOnce({ rows: [committed] })
      .mockResolvedValueOnce({ rows: [committed] })
    const service = serviceWithRaw(raw)
    const context = sharedContext(raw)
    const binding = {
      idempotencyRecordId,
      resultId,
      resultType: "cart_merge",
      expiresAt: committed.expires_at as string,
    }

    const completed = await service.completeStoreIdempotency({
      id: idempotencyRecordId,
      expectedState: "processing",
      expectedStateVersion: 1,
      resultBinding: binding,
      responseStatus: 200,
      resultSafeMetadata: {
        operation,
        result_type: "cart_merge",
        result_id: resultId,
        response_status: 200,
      },
      sharedContext: context,
      at,
    })
    expect(completed.type).toBe("claimed")

    const loaded = await service.loadCommittedStoreIdempotencyResult({
      idempotencyRecordId,
      operation,
      actorScope: { actor_type: "customer", customer_id: customerId },
      resourceScope: {
        resource_type: "cart_merge",
        guest_cart_id: guestCartId,
        customer_cart_id: null,
        capability_id: "gccap_phase16",
      },
      rawIdempotencyKey,
      canonicalSemanticObject: semanticObject,
      resultBinding: binding,
      sharedContext: context,
      at,
    })
    expect(loaded?.record.result_id).toBe(resultId)
    expect(loaded?.record.expires_at).toBe(committed.expires_at)

    const failed = await service.failStoreIdempotency({
      id: idempotencyRecordId,
      expectedState: "processing",
      expectedStateVersion: 1,
      failureCode: "CART_MERGE_RETRYABLE",
      terminal: true,
      sharedContext: context,
      at,
    })
    expect(failed.type).toBe("claimed")
    expect(raw).toHaveBeenCalledTimes(3)
    expect((service as any).baseRepository_.transaction).not.toHaveBeenCalled()
  })

  it("mantém fingerprint CART_MERGE fechado e rejeita raw capability/key/JWT", async () => {
    const raw = jest.fn()
    const service = serviceWithRaw(raw)

    await expect(
      service.claimStoreIdempotency({
        operation,
        actorScope: { actor_type: "customer", customer_id: customerId },
        resourceScope: { guest_cart_id: guestCartId },
        rawIdempotencyKey,
        canonicalSemanticObject: {
          ...semanticObject,
          capability: presentedCapability,
        },
        sharedContext: sharedContext(raw),
        at,
      })
    ).rejects.toThrow()
    expect(raw).not.toHaveBeenCalled()
  })
})

describe("Task 16-05-02: capability owner replay read", () => {
  function capabilityServiceWithRaw(raw: jest.Mock): GuestCartCapabilityModuleService {
    const service = Object.create(GuestCartCapabilityModuleService.prototype)
    Object.defineProperty(service, "baseRepository_", {
      value: {
        transaction: jest.fn(() => {
          throw new Error("PARALLEL_TRANSACTION_FORBIDDEN")
        }),
      },
    })
    return service
  }

  it("lê somente a capability própria sem consultar tabelas de outros módulos", async () => {
    const originalExpiresAt = capabilityRecord().expires_at
    const capability = capabilityRecord()
    const raw = jest
      .fn()
      .mockResolvedValueOnce({ rows: [capability] })
    const service = capabilityServiceWithRaw(raw)
    const context = sharedContext(raw)

    const replay = await service.retrieveGuestCartCapabilityForReplay(
      capability.id,
      context
    )

    expect(replay?.id).toBe(capability.id)
    expect(replay?.status).toBe(GUEST_CART_CAPABILITY_STATUS.CONSUMED)
    expect(replay?.expires_at).toBe(originalExpiresAt)
    expect(raw).toHaveBeenCalledTimes(1)
    expect(
      raw.mock.calls
        .map(([sql]) => String(sql).toLowerCase())
        .join(" ")
    ).not.toMatch(/\b(update|join)\s+/)
    expect(
      raw.mock.calls
        .map(([sql]) => String(sql).toLowerCase())
        .join(" ")
    ).toContain("from guest_cart_capability")
    expect((service as any).baseRepository_.transaction).not.toHaveBeenCalled()
  })

  it("retorna null para registro ausente e mantém a transação obrigatória", async () => {
    const raw = jest.fn().mockResolvedValueOnce({ rows: [] })
    const service = capabilityServiceWithRaw(raw)

    await expect(
      service.retrieveGuestCartCapabilityForReplay("missing", sharedContext(raw))
    ).resolves.toBeNull()
    await expect(
      service.retrieveGuestCartCapabilityForReplay("missing", undefined as never)
    ).rejects.toThrow()
  })
})
