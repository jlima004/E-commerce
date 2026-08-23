import { MedusaError } from "@medusajs/framework/utils"
import {
  StoreIdempotencyModuleService,
  sanitizeStoreIdempotencySafeMetadata,
  type StoreIdempotencyRecordRow,
} from "../service"

type MockKnex = {
  raw: jest.Mock
  transaction: jest.Mock
}

function baseRow(
  overrides: Partial<StoreIdempotencyRecordRow> = {}
): StoreIdempotencyRecordRow {
  return {
    id: "stidem_failure_code_01",
    operation: "store.carts.line-items.add",
    actor_scope_hash: "a".repeat(64),
    resource_scope_hash: "b".repeat(64),
    idempotency_key_hash: "c".repeat(64),
    hash_version: "hmac-sha256-v1",
    pepper_version: 1,
    request_fingerprint: "d".repeat(64),
    state: "processing",
    state_version: 1,
    result_type: null,
    result_id: null,
    response_status: null,
    result_safe_metadata: null,
    locked_at: null,
    state_deadline_at: "2026-08-21T12:05:00.000Z",
    next_retry_at: null,
    retry_attempt_count: 0,
    retry_started_at: null,
    terminalized_at: null,
    completed_at: null,
    failure_code: null,
    expires_at: null,
    created_at: "2026-08-21T12:00:00.000Z",
    updated_at: "2026-08-21T12:00:00.000Z",
    ...overrides,
  }
}

function createServiceHarness() {
  const rows = [baseRow()]
  const mockKnex: MockKnex = {
    raw: jest.fn(async (sql: string, bindings: unknown[] = []) => {
      const normalizedSql = sql.replace(/\s+/g, " ").trim()

      if (
        normalizedSql.startsWith("update store_idempotency_record") &&
        normalizedSql.includes("and state = ? and state_version = ?")
      ) {
        const current = rows[0]
        const expectedState = bindings[16]
        const expectedVersion = bindings[17]
        if (
          current.state !== expectedState ||
          current.state_version !== expectedVersion
        ) {
          return { rows: [] }
        }

        const metadata = bindings[9]
          ? JSON.parse(String(bindings[9]))
          : null
        const updated: StoreIdempotencyRecordRow = {
          ...current,
          state: bindings[0] as StoreIdempotencyRecordRow["state"],
          state_version: current.state_version + 1,
          state_deadline_at: null,
          next_retry_at: null,
          locked_at: null,
          result_type: (bindings[6] as string | null) ?? null,
          result_id: (bindings[7] as string | null) ?? null,
          response_status:
            bindings[8] == null ? null : Number(bindings[8]),
          result_safe_metadata: metadata,
          failure_code: (bindings[10] as string | null) ?? null,
          completed_at: null,
          terminalized_at: String(bindings[12]),
          expires_at: String(bindings[13]),
          updated_at: String(bindings[14]),
        }
        rows[0] = updated
        return { rows: [{ ...updated }] }
      }

      if (
        normalizedSql.startsWith(
          "select * from store_idempotency_record where id = ?"
        )
      ) {
        return { rows: [{ ...rows[0] }] }
      }

      throw new Error(`Unhandled mock SQL: ${sql}`)
    }),
    transaction: jest.fn(async (fn: (trx: MockKnex) => Promise<unknown>) =>
      fn(mockKnex)
    ),
  }

  const service = Object.create(StoreIdempotencyModuleService.prototype)
  Object.defineProperty(service, "baseRepository_", {
    value: {
      getActiveManager: () => ({
        getKnex: () => mockKnex,
      }),
    },
  })

  return { service, rows }
}

describe("StoreIdempotency failure_code contract", () => {
  const accepted = [
    "CART_VERSION_MISMATCH",
    "VALIDATION_ERROR",
    "CART_MUTATION_FAILED",
    "CART_INVALIDATION_FAILED",
    "MARK_COMPLETED_FAILED",
    "cart_version_mismatch",
  ]

  const rejected = [
    " CART_VERSION_MISMATCH",
    "CART VERSION MISMATCH",
    "CART/VERSION/MISMATCH",
    "CART:VERSION:MISMATCH",
    "",
    "A".repeat(129),
    "CART_VERSION_MISMATCH\n",
    "CART_VERSION_MISMATCH\t",
    "sk_live_fake_secret",
  ]

  it.each(accepted)(
    "aceita %s como failure_code top-level e em result_safe_metadata",
    async (failureCode) => {
      const { service, rows } = createServiceHarness()
      const result = await service.markFailedTerminal({
        id: rows[0].id,
        expectedState: "processing",
        expectedStateVersion: 1,
        failure_code: failureCode,
        at: new Date("2026-08-21T12:01:00.000Z"),
      })

      expect(result.type).toBe("claimed")
      expect(rows[0].failure_code).toBe(failureCode)
      expect(
        sanitizeStoreIdempotencySafeMetadata({
          failure_code: failureCode,
        })
      ).toEqual({ failure_code: failureCode })
    }
  )

  it.each(rejected)(
    "rejeita %j tanto no top-level quanto em result_safe_metadata",
    async (failureCode) => {
      const { service, rows } = createServiceHarness()

      await expect(
        service.markFailedTerminal({
          id: rows[0].id,
          expectedState: "processing",
          expectedStateVersion: 1,
          failure_code: failureCode,
        })
      ).rejects.toThrow(MedusaError)

      expect(() =>
        sanitizeStoreIdempotencySafeMetadata({ failure_code: failureCode })
      ).toThrow(MedusaError)
    }
  )

  it("mantém operation com contrato lowercase e rejeita operation uppercase", async () => {
    const { service } = createServiceHarness()

    await expect(
      service.claim({
        operation: "CART_MUTATION",
        actorScope: { customer_id: "cus_test" },
        resourceScope: { cart_id: "cart_test" },
        rawIdempotencyKey: "Retry-Key-ABC",
        canonicalSemanticObject: { quantity: 1 },
      })
    ).rejects.toThrow(/STORE_IDEMPOTENCY_OPERATION_INVALID/)
  })
})
