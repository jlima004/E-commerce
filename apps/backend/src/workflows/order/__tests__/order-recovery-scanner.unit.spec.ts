import {
  scanOrdersForRecovery,
  type ScanOrdersForRecoveryInput,
} from "../order-recovery-scanner"
import { ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY } from "../order-birth-marker"

describe("Order Recovery Scanner (Subagent D — D1 to D8 Matrix)", () => {
  const baseInput: ScanOrdersForRecoveryInput = {
    cclId: "chkcpl_scan_test_01",
    expectedCartId: "cart_01",
    expectedPaymentAttemptId: "payatt_01",
    expectedPaymentIntentId: "pi_01",
    expectedAmountMinor: 9900,
    cclCreatedAt: new Date("2026-08-01T12:00:00Z"),
    cclExecutionStartedAt: null,
    pageSize: 2,
  }

  function createMockOrderModule(pages: Array<{ rows: any[]; count: number }>) {
    let callIndex = 0
    return {
      listAndCountOrders: jest.fn().mockImplementation((filters, config) => {
        const page = pages[callIndex++] ?? { rows: [], count: pages[0]?.count ?? 0 }
        expect(config.withDeleted).toBe(true)
        expect(config.order).toEqual({ created_at: "ASC", id: "ASC" })
        expect(config.skip).toEqual(expect.any(Number))
        expect(config.take).toEqual(expect.any(Number))
        expect(filters.created_at.$gte).toEqual(expect.any(String))
        expect(filters.created_at).not.toHaveProperty("$lte")
        return Promise.resolve([page.rows, page.count])
      }),
    }
  }

  it("D1: 0 rows, complete scan returns ZERO with executionStarted=false", async () => {
    const mockOrderModule = createMockOrderModule([{ rows: [], count: 0 }])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, baseInput)

    expect(result.status).toBe("ZERO")
    if (result.status === "ZERO") {
      expect(result.totalScanned).toBe(0)
      expect(result.executionStarted).toBe(false)
    }
  })

  it("D1-started: 0 rows, complete scan returns ZERO with executionStarted=true when execution_started_at set", async () => {
    const mockOrderModule = createMockOrderModule([{ rows: [], count: 0 }])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, {
      ...baseInput,
      cclExecutionStartedAt: new Date(),
    })

    expect(result.status).toBe("ZERO")
    if (result.status === "ZERO") {
      expect(result.totalScanned).toBe(0)
      expect(result.executionStarted).toBe(true)
    }
  })

  it("D2: 1 exact marker match returns EXACT_ONE with validated Order X", async () => {
    const mockOrder = {
      id: "order_exact_01",
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: baseInput.cclId },
    }
    const mockOrderModule = createMockOrderModule([{ rows: [mockOrder], count: 1 }])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, baseInput)

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_exact_01")
      expect(result.totalScanned).toBe(1)
    }
  })

  it("D3: 1 row with wrong marker returns ZERO exact matches", async () => {
    const mockOrder = {
      id: "order_other_01",
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: "chkcpl_DIFFERENT" },
    }
    const mockOrderModule = createMockOrderModule([{ rows: [mockOrder], count: 1 }])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, baseInput)

    expect(result.status).toBe("ZERO")
    if (result.status === "ZERO") {
      expect(result.totalScanned).toBe(1)
    }
  })

  it("D4: 2 exact marker matches fails closed and returns MULTIPLE", async () => {
    const orderA = {
      id: "order_match_a",
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: baseInput.cclId },
    }
    const orderB = {
      id: "order_match_b",
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: baseInput.cclId },
    }
    const mockOrderModule = createMockOrderModule([{ rows: [orderA, orderB], count: 2 }])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, baseInput)

    expect(result.status).toBe("MULTIPLE")
    if (result.status === "MULTIPLE") {
      expect(result.matchingOrders).toHaveLength(2)
      expect(result.totalScanned).toBe(2)
    }
  })

  it("D5: pagination: exact candidate located on later page after evaluating earlier page", async () => {
    const unmatchingOrder1 = {
      id: "order_unrelated_1",
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: "chkcpl_other_1" },
    }
    const unmatchingOrder2 = {
      id: "order_unrelated_2",
      currency_code: "BRL",
      total: 99,
      metadata: {},
    }
    const targetOrder = {
      id: "order_page2_target",
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: baseInput.cclId },
    }

    const mockOrderModule = createMockOrderModule([
      { rows: [unmatchingOrder1, unmatchingOrder2], count: 3 },
      { rows: [targetOrder], count: 3 },
    ])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, {
      ...baseInput,
      pageSize: 2,
    })

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_page2_target")
      expect(result.totalScanned).toBe(3)
    }
    expect(mockOrderModule.listAndCountOrders).toHaveBeenCalledTimes(2)
  })

  it("D6: deleted Order with exact marker is still found via withDeleted", async () => {
    const deletedOrder = {
      id: "order_soft_deleted_match",
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: baseInput.cclId },
      deleted_at: new Date().toISOString(),
    }
    const mockOrderModule = createMockOrderModule([{ rows: [deletedOrder], count: 1 }])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, baseInput)

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_soft_deleted_match")
    }
  })

  it("D7: scan error midway returns SCAN_INCOMPLETE without calling completeCart", async () => {
    let callCount = 0
    const mockOrderModule = {
      listAndCountOrders: jest.fn().mockImplementation(() => {
        callCount++
        if (callCount === 2) {
          throw new Error("DATABASE_CONNECTION_RESET")
        }
        return Promise.resolve([[{ id: "order_1", metadata: {} }], 2])
      }),
    }
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, {
      ...baseInput,
      pageSize: 1,
    })

    expect(result.status).toBe("SCAN_INCOMPLETE")
    if (result.status === "SCAN_INCOMPLETE") {
      expect(result.reason).toContain("DATABASE_CONNECTION_RESET")
      expect(result.totalScanned).toBe(1)
    }
  })

  it("D8: count/pagination inconsistency returns SCAN_INCOMPLETE", async () => {
    const mockOrderModule = createMockOrderModule([
      { rows: [{ id: "order_1", metadata: {} }], count: 3 },
      { rows: [{ id: "order_2", metadata: {} }], count: 5 }, // count jumped from 3 to 5
    ])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, {
      ...baseInput,
      pageSize: 1,
    })

    expect(result.status).toBe("SCAN_INCOMPLETE")
    if (result.status === "SCAN_INCOMPLETE") {
      expect(result.reason).toContain("COUNT_INCONSISTENCY")
    }
  })

  it("D9: candidate with currency mismatch returns AUTHORITY_CONFLICT", async () => {
    const usdOrder = {
      id: "order_usd_match",
      currency_code: "USD",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: baseInput.cclId },
    }
    const mockOrderModule = createMockOrderModule([{ rows: [usdOrder], count: 1 }])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, baseInput)

    expect(result.status).toBe("AUTHORITY_CONFLICT")
    if (result.status === "AUTHORITY_CONFLICT") {
      expect(result.reason).toContain("RECOVERED_ORDER_CURRENCY_MISMATCH")
    }
  })

  it("D10: candidate with amount mismatch returns AUTHORITY_CONFLICT", async () => {
    const wrongAmountOrder = {
      id: "order_wrong_amount",
      currency_code: "BRL",
      total: 50, // 5000 minor vs expected 9900 minor
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: baseInput.cclId },
    }
    const mockOrderModule = createMockOrderModule([{ rows: [wrongAmountOrder], count: 1 }])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, baseInput)

    expect(result.status).toBe("AUTHORITY_CONFLICT")
    if (result.status === "AUTHORITY_CONFLICT") {
      expect(result.reason).toContain("RECOVERED_ORDER_TOTAL_MISMATCH")
    }
  })

  it("D11: local CCL or PA order_id conflict returns AUTHORITY_CONFLICT", async () => {
    const candidateOrder = {
      id: "order_candidate_x",
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: baseInput.cclId },
    }
    const mockOrderModule = createMockOrderModule([{ rows: [candidateOrder], count: 1 }])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, {
      ...baseInput,
      existingCclOrderId: "order_different_y",
    })

    expect(result.status).toBe("AUTHORITY_CONFLICT")
    if (result.status === "AUTHORITY_CONFLICT") {
      expect(result.reason).toContain("CCL_ORDER_ID_CONFLICT")
    }
  })

  it("invalid execution_started_at fails closed with SCAN_INCOMPLETE", async () => {
    const mockOrderModule = createMockOrderModule([{ rows: [], count: 0 }])
    const container = { resolve: () => mockOrderModule }

    const result = await scanOrdersForRecovery(container as any, {
      ...baseInput,
      cclExecutionStartedAt: "not-a-timestamp",
    })

    expect(result.status).toBe("SCAN_INCOMPLETE")
    if (result.status === "SCAN_INCOMPLETE") {
      expect(result.reason).toBe("INVALID_EXECUTION_STARTED_AT_TIMESTAMP")
    }
  })
})
