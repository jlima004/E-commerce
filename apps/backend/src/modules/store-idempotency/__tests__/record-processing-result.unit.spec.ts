import { MedusaError } from "@medusajs/framework/utils"
import {
  StoreIdempotencyModuleService,
  type StoreIdempotencyRecordRow,
} from "../service"

type MockKnex = {
  raw: jest.Mock
  transaction: jest.Mock
}

function createMockService(initialRows: StoreIdempotencyRecordRow[] = []) {
  const rows = initialRows.map((r) => ({ ...r }))
  const mockKnex: MockKnex = {
    raw: jest.fn(async (sql: string, bindings: unknown[] = []) => {
      const normalizedSql = sql.replace(/\s+/g, " ").trim()

      if (normalizedSql.startsWith("update store_idempotency_record")) {
        const [
          resultType,
          resultId,
          resultSafeMetadataJson,
          updatedAt,
          id,
          expectedVersion,
        ] = bindings

        const idx = rows.findIndex(
          (r) =>
            r.id === id &&
            r.state === "processing" &&
            r.state_version === expectedVersion
        )

        if (idx < 0) {
          return { rows: [] }
        }

        const current = rows[idx]
        const updated: StoreIdempotencyRecordRow = {
          ...current,
          state_version: current.state_version + 1,
          result_type: (resultType as string) ?? null,
          result_id: (resultId as string) ?? null,
          result_safe_metadata: resultSafeMetadataJson
            ? JSON.parse(resultSafeMetadataJson as string)
            : null,
          updated_at: updatedAt as string,
        }
        rows[idx] = updated
        return { rows: [{ ...updated }] }
      }

      if (normalizedSql.startsWith("select * from store_idempotency_record where id = ?")) {
        const [id] = bindings
        const found = rows.find((r) => r.id === id)
        return { rows: found ? [{ ...found }] : [] }
      }

      throw new Error(`Unhandled mock SQL: ${sql}`)
    }),
    transaction: jest.fn(async (fn: any) => fn(mockKnex)),
  }

  const service = Object.create(StoreIdempotencyModuleService.prototype)
  Object.defineProperty(service, "baseRepository_", {
    value: {
      getActiveManager: () => ({
        getKnex: () => mockKnex,
      }),
    },
  })

  return { service, rows, mockKnex }
}

function baseRow(overrides: Partial<StoreIdempotencyRecordRow> = {}): StoreIdempotencyRecordRow {
  return {
    id: "stidem_test_01",
    operation: "store.carts.active.create",
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
    state_deadline_at: "2026-08-20T12:05:00.000Z",
    next_retry_at: null,
    retry_attempt_count: 0,
    retry_started_at: null,
    terminalized_at: null,
    completed_at: null,
    failure_code: null,
    expires_at: null,
    created_at: "2026-08-20T12:00:00.000Z",
    updated_at: "2026-08-20T12:00:00.000Z",
    ...overrides,
  }
}

describe("StoreIdempotencyModuleService.recordProcessingResult (Unit)", () => {
  it("1. updates processing record with result_type, result_id and advances state_version while remaining in processing", async () => {
    const row = baseRow({ state_version: 1, state: "processing" })
    const { service, rows } = createMockService([row])

    const at = new Date("2026-08-20T12:01:00.000Z")
    const result = await service.recordProcessingResult({
      id: "stidem_test_01",
      expectedStateVersion: 1,
      result_type: "cart",
      result_id: "cart_01JTESTRECORD01",
      result_safe_metadata: {
        operation: "store.carts.active.create",
        result_type: "cart",
        result_id: "cart_01JTESTRECORD01",
      },
      at,
    })

    expect(result.type).toBe("claimed")
    if (result.type === "claimed") {
      expect(result.record.state).toBe("processing")
      expect(result.record.state_version).toBe(2)
      expect(result.record.result_type).toBe("cart")
      expect(result.record.result_id).toBe("cart_01JTESTRECORD01")
      expect(result.record.result_safe_metadata).toEqual({
        operation: "store.carts.active.create",
        result_type: "cart",
        result_id: "cart_01JTESTRECORD01",
      })
      expect(result.record.updated_at).toBe(at.toISOString())
    }

    expect(rows[0].state).toBe("processing")
    expect(rows[0].state_version).toBe(2)
    expect(rows[0].result_id).toBe("cart_01JTESTRECORD01")
  })

  it("2. returns lost when expectedStateVersion is stale", async () => {
    const row = baseRow({ state_version: 2, state: "processing" })
    const { service } = createMockService([row])

    const result = await service.recordProcessingResult({
      id: "stidem_test_01",
      expectedStateVersion: 1, // Stale! Current is 2
      result_type: "cart",
      result_id: "cart_01JTESTRECORD01",
    })

    expect(result.type).toBe("lost")
    if (result.type === "lost") {
      expect(result.record).toBeDefined()
      expect(result.record?.state_version).toBe(2)
    }
  })

  it("3. returns lost when current state is not processing", async () => {
    const row = baseRow({ state_version: 1, state: "completed" })
    const { service } = createMockService([row])

    const result = await service.recordProcessingResult({
      id: "stidem_test_01",
      expectedStateVersion: 1,
      result_type: "cart",
      result_id: "cart_01JTESTRECORD01",
    })

    expect(result.type).toBe("lost")
    if (result.type === "lost") {
      expect(result.record).toBeDefined()
      expect(result.record?.state).toBe("completed")
    }
  })

  it("4. rejects unsafe result_id using assertSafeTransitionResultFields", async () => {
    const row = baseRow()
    const { service } = createMockService([row])

    await expect(
      service.recordProcessingResult({
        id: "stidem_test_01",
        expectedStateVersion: 1,
        result_type: "cart",
        result_id: "invalid result id with spaces",
      })
    ).rejects.toThrow(MedusaError)
  })

  it("5. rejects unsafe result_type", async () => {
    const row = baseRow()
    const { service } = createMockService([row])

    await expect(
      service.recordProcessingResult({
        id: "stidem_test_01",
        expectedStateVersion: 1,
        result_type: "INVALID TYPE!",
        result_id: "cart_01JTESTRECORD01",
      })
    ).rejects.toThrow(MedusaError)
  })

  it("6. rejects forbidden or sensitive metadata (e.g. guest_cart_token / JWT / secrets)", async () => {
    const row = baseRow()
    const { service } = createMockService([row])

    await expect(
      service.recordProcessingResult({
        id: "stidem_test_01",
        expectedStateVersion: 1,
        result_type: "cart",
        result_id: "cart_01JTESTRECORD01",
        result_safe_metadata: {
          guest_cart_token: "secret_token_123",
        } as any,
      })
    ).rejects.toThrow(MedusaError)

    await expect(
      service.recordProcessingResult({
        id: "stidem_test_01",
        expectedStateVersion: 1,
        result_type: "cart",
        result_id: "cart_01JTESTRECORD01",
        result_safe_metadata: {
          correlation_ref: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M",
        } as any,
      })
    ).rejects.toThrow(MedusaError)
  })
})
