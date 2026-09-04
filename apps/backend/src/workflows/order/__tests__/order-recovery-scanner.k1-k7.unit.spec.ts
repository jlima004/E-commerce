import {
  resolveOrderRecoveryScanWindow,
  scanOrdersForRecovery,
  type ScanOrdersForRecoveryInput,
} from "../order-recovery-scanner"
import { ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY } from "../order-birth-marker"

describe("Order Recovery Scanner (Subagent C — K1 to K7 Clock-Skew Lower-Bound Authority)", () => {
  /** Frozen DB clock — scan authority anchor, not Date.now(). */
  const DB = new Date("2026-08-01T12:00:00.000Z")

  const EXECUTED_LOWER_BOUND_ISO = "2026-08-01T11:45:00.000Z" // DB - 15m
  const PRE_EXECUTION_LOWER_BOUND_ISO = "2026-08-01T11:45:00.000Z" // cclCreatedAt=DB - 15m

  const cclId = "chkcpl_k1k7_clock_skew"
  const executionStartedAt = DB

  const baseInput: ScanOrdersForRecoveryInput = {
    cclId,
    expectedCartId: "cart_k1k7",
    expectedPaymentAttemptId: "payatt_k1k7",
    expectedPaymentIntentId: "pi_k1k7",
    expectedAmountMinor: 9900,
    cclCreatedAt: new Date(DB.getTime() + 2 * 60 * 60 * 1000), // DB +2h (skewed)
    cclExecutionStartedAt: executionStartedAt,
    pageSize: 2,
  }

  type MockOrderRow = {
    id: string
    created_at: string
    currency_code?: string
    total?: number
    metadata?: Record<string, unknown>
    deleted_at?: string | null
  }

  function dbPlusMinutes(minutes: number): string {
    return new Date(DB.getTime() + minutes * 60 * 1000).toISOString()
  }

  function exactMarkerOrder(
    id: string,
    overrides: Partial<MockOrderRow> = {}
  ): MockOrderRow {
    return {
      id,
      created_at: dbPlusMinutes(1),
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: cclId },
      ...overrides,
    }
  }

  function compareCreatedAtThenId(a: MockOrderRow, b: MockOrderRow): number {
    const aTime = new Date(a.created_at).getTime()
    const bTime = new Date(b.created_at).getTime()
    if (aTime !== bTime) {
      return aTime - bTime
    }
    return a.id.localeCompare(b.id)
  }

  function orderInWindow(order: MockOrderRow, gte: string, lte?: string): boolean {
    const t = new Date(order.created_at).getTime()
    if (t < new Date(gte).getTime()) {
      return false
    }
    if (lte == null || lte === "") {
      return true
    }
    return t <= new Date(lte).getTime()
  }

  /**
   * Honest paginating mock: full dataset, real skip/take/order/withDeleted/window filters.
   * MUST apply $gte (and ignore missing $lte) — scripted mocks cannot prove K1–K4.
   */
  function createHonestPaginatingOrderModule(allOrders: MockOrderRow[]) {
    return {
      listAndCountOrders: jest.fn().mockImplementation((filters, config) => {
        expect(config.withDeleted).toBe(true)
        expect(config.order).toEqual({ created_at: "ASC", id: "ASC" })

        const gte = filters.created_at.$gte as string
        const lte = filters.created_at.$lte as string | undefined

        let filtered = allOrders.filter((order) => orderInWindow(order, gte, lte))

        if (config.withDeleted !== true) {
          filtered = filtered.filter((order) => order.deleted_at == null)
        }

        filtered = [...filtered].sort(compareCreatedAtThenId)

        const count = filtered.length
        const skip = config.skip ?? 0
        const take = config.take ?? filtered.length
        const pageRows = filtered.slice(skip, skip + take)

        return Promise.resolve([pageRows, count])
      }),
    }
  }

  const containerFrom = (mockOrderModule: { listAndCountOrders: jest.Mock }) => ({
    resolve: () => mockOrderModule,
  })

  function assertExecutedStateLowerBound(filters: { created_at: Record<string, string> }) {
    expect(filters.created_at.$gte).toBe(EXECUTED_LOWER_BOUND_ISO)
    expect(filters.created_at).not.toHaveProperty("$lte")
    // Old bug would derive from CCL.created_at +2h → 13:45, excluding DB+1m Order at 12:01
    expect(filters.created_at.$gte).not.toBe("2026-08-01T13:45:00.000Z")
  }

  it("K1: CCL +2h skew, execution=DB, Order DB+1m exact marker → EXACT_ONE with $gte from execution_started_at (R5-HR12 hide scenario)", async () => {
    const cclCreatedAt = new Date(DB.getTime() + 2 * 60 * 60 * 1000) // 14:00
    const orderCreatedAt = dbPlusMinutes(1) // 12:01 — hidden under old CCL-derived bound (13:45)

    const mock = createHonestPaginatingOrderModule([
      exactMarkerOrder("order_k1_exact", { created_at: orderCreatedAt }),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      cclCreatedAt,
      cclExecutionStartedAt: executionStartedAt,
    })

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_k1_exact")
      expect(result.totalScanned).toBe(1)
    }

    const filters = mock.listAndCountOrders.mock.calls[0][0]
    assertExecutedStateLowerBound(filters)
    expect(filters.created_at.$gte).toBe(EXECUTED_LOWER_BOUND_ISO)
  })

  it("K2: CCL +2h skew, execution=DB, Order DB+30m exact marker → EXACT_ONE with $gte from execution_started_at", async () => {
    const cclCreatedAt = new Date(DB.getTime() + 2 * 60 * 60 * 1000)
    const orderCreatedAt = dbPlusMinutes(30) // 12:30

    const mock = createHonestPaginatingOrderModule([
      exactMarkerOrder("order_k2_exact", { created_at: orderCreatedAt }),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      cclCreatedAt,
      cclExecutionStartedAt: executionStartedAt,
    })

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_k2_exact")
      expect(result.totalScanned).toBe(1)
    }

    const filters = mock.listAndCountOrders.mock.calls[0][0]
    assertExecutedStateLowerBound(filters)
  })

  it("K3: CCL -2h skew, execution=DB, Order DB+1m → EXACT_ONE with $gte from execution_started_at (negative skew)", async () => {
    const cclCreatedAt = new Date(DB.getTime() - 2 * 60 * 60 * 1000) // 10:00
    const orderCreatedAt = dbPlusMinutes(1) // 12:01

    const mock = createHonestPaginatingOrderModule([
      exactMarkerOrder("order_k3_exact", { created_at: orderCreatedAt }),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      cclCreatedAt,
      cclExecutionStartedAt: executionStartedAt,
    })

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_k3_exact")
      expect(result.totalScanned).toBe(1)
    }

    const filters = mock.listAndCountOrders.mock.calls[0][0]
    assertExecutedStateLowerBound(filters)
    expect(filters.created_at.$gte).toBe("2026-08-01T11:45:00.000Z")
  })

  it("K4: CCL +24h skew, execution=DB, Order DB+1m exact marker → EXACT_ONE with $gte from execution_started_at", async () => {
    const cclCreatedAt = new Date(DB.getTime() + 24 * 60 * 60 * 1000) // next day 12:00
    const orderCreatedAt = dbPlusMinutes(1) // 12:01

    const mock = createHonestPaginatingOrderModule([
      exactMarkerOrder("order_k4_exact", { created_at: orderCreatedAt }),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      cclCreatedAt,
      cclExecutionStartedAt: executionStartedAt,
    })

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_k4_exact")
      expect(result.totalScanned).toBe(1)
    }

    const filters = mock.listAndCountOrders.mock.calls[0][0]
    assertExecutedStateLowerBound(filters)
    // Old bug would use cclCreatedAt+24h-15m = 2026-08-02T11:45 — Order at 12:01 would be excluded
    expect(filters.created_at.$gte).not.toBe("2026-08-02T11:45:00.000Z")
  })

  describe("K5: same execution_started_at, wildly different CCL.created_at → identical executed-state lower bound", () => {
  // Changing CCL.created_at by +2h does NOT change executed-state recovery coverage.

    const skewVariants = [
      { label: "DB-2h", cclCreatedAt: new Date(DB.getTime() - 2 * 60 * 60 * 1000) },
      { label: "DB+2h", cclCreatedAt: new Date(DB.getTime() + 2 * 60 * 60 * 1000) },
      { label: "DB+24h", cclCreatedAt: new Date(DB.getTime() + 24 * 60 * 60 * 1000) },
    ]

    it("resolveOrderRecoveryScanWindow: identical windowStart ISO regardless of cclCreatedAt skew", () => {
      const windowStarts = skewVariants.map(({ cclCreatedAt }) => {
        const result = resolveOrderRecoveryScanWindow({
          cclCreatedAt,
          cclExecutionStartedAt: executionStartedAt,
        })
        expect(result.ok).toBe(true)
        if (!result.ok) {
          throw new Error(`unexpected window failure: ${result.reason}`)
        }
        return result.windowStart.toISOString()
      })

      expect(new Set(windowStarts).size).toBe(1)
      expect(windowStarts[0]).toBe(EXECUTED_LOWER_BOUND_ISO)
    })

    it("same execution_started_at → same lower bound regardless of cclCreatedAt (window helper)", () => {
      const bounds = skewVariants.map(({ cclCreatedAt }) => {
        const result = resolveOrderRecoveryScanWindow({
          cclCreatedAt,
          cclExecutionStartedAt: executionStartedAt,
        })
        expect(result.ok).toBe(true)
        if (!result.ok) {
          throw new Error(`unexpected window failure: ${result.reason}`)
        }
        return result.windowStart.toISOString()
      })

      expect(bounds.every((b) => b === EXECUTED_LOWER_BOUND_ISO)).toBe(true)
    })

    it("Changing CCL.created_at by +2h does NOT change executed-state recovery coverage.", async () => {
      const orderCreatedAt = dbPlusMinutes(1)
      const targetOrder = exactMarkerOrder("order_k5_shared", { created_at: orderCreatedAt })

      const cclCreatedAtBase = new Date(DB.getTime() - 2 * 60 * 60 * 1000) // DB-2h
      const cclCreatedAtPlus2h = new Date(DB.getTime() + 2 * 60 * 60 * 1000) // DB+2h

      const mockBase = createHonestPaginatingOrderModule([targetOrder])
      const resultBase = await scanOrdersForRecovery(containerFrom(mockBase) as any, {
        ...baseInput,
        cclCreatedAt: cclCreatedAtBase,
        cclExecutionStartedAt: executionStartedAt,
      })

      const mockPlus2h = createHonestPaginatingOrderModule([targetOrder])
      const resultPlus2h = await scanOrdersForRecovery(containerFrom(mockPlus2h) as any, {
        ...baseInput,
        cclCreatedAt: cclCreatedAtPlus2h,
        cclExecutionStartedAt: executionStartedAt,
      })

      expect(resultBase.status).toBe("EXACT_ONE")
      expect(resultPlus2h.status).toBe("EXACT_ONE")

      const gteBase = mockBase.listAndCountOrders.mock.calls[0][0].created_at.$gte
      const gtePlus2h = mockPlus2h.listAndCountOrders.mock.calls[0][0].created_at.$gte

      expect(gteBase).toBe(gtePlus2h)
      expect(gteBase).toBe(EXECUTED_LOWER_BOUND_ISO)

      if (resultBase.status === "EXACT_ONE" && resultPlus2h.status === "EXACT_ONE") {
        expect(resultBase.orderId).toBe("order_k5_shared")
        expect(resultPlus2h.orderId).toBe("order_k5_shared")
      }
    })
  })

  describe("K6: invalid execution_started_at in executed-state recovery → SCAN_INCOMPLETE (fail closed)", () => {
    it.each([
      ["not-a-timestamp string", "not-a-timestamp"],
      ["Invalid Date object", new Date(NaN)],
      ["whitespace-only string", "   "],
    ])("K6 (%s) → SCAN_INCOMPLETE INVALID_EXECUTION_STARTED_AT_TIMESTAMP; listAndCountOrders not called", async (_label, invalidExecution) => {
      const mock = createHonestPaginatingOrderModule([
        exactMarkerOrder("order_k6_decoy"),
      ])

      const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
        ...baseInput,
        cclExecutionStartedAt: invalidExecution as Date | string,
      })

      expect(result.status).toBe("SCAN_INCOMPLETE")
      expect(result.status).not.toBe("ZERO")
      expect(result.status).not.toBe("EXACT_ONE")
      if (result.status === "SCAN_INCOMPLETE") {
        expect(result.reason).toBe("INVALID_EXECUTION_STARTED_AT_TIMESTAMP")
        expect(result.totalScanned).toBe(0)
      }
      expect(mock.listAndCountOrders).not.toHaveBeenCalled()
    })
  })

  it("K7: no execution_started_at (null) → pre-execution windowStart = cclCreatedAt - 15m; Order DB+1m still found", async () => {
    const cclCreatedAt = DB // 12:00 → lower bound 11:45
    const orderCreatedAt = dbPlusMinutes(1) // 12:01

    const windowResult = resolveOrderRecoveryScanWindow({
      cclCreatedAt,
      cclExecutionStartedAt: null,
    })
    expect(windowResult.ok).toBe(true)
    if (windowResult.ok) {
      expect(windowResult.windowStart.toISOString()).toBe(PRE_EXECUTION_LOWER_BOUND_ISO)
    }

    const mock = createHonestPaginatingOrderModule([
      exactMarkerOrder("order_k7_pre_exec", { created_at: orderCreatedAt }),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      cclCreatedAt,
      cclExecutionStartedAt: null,
    })

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_k7_pre_exec")
      expect(result.totalScanned).toBe(1)
    }

    const filters = mock.listAndCountOrders.mock.calls[0][0]
    expect(filters.created_at.$gte).toBe(PRE_EXECUTION_LOWER_BOUND_ISO)
    expect(filters.created_at).not.toHaveProperty("$lte")
  })
})
