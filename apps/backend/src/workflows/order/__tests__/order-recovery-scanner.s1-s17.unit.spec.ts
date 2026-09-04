import fs from "fs"
import path from "path"
import {
  DEFAULT_WINDOW_SAFETY_MARGIN_MS,
  resolveOrderRecoveryScanWindow,
  scanOrdersForRecovery,
  type ScanOrdersForRecoveryInput,
} from "../order-recovery-scanner"
import { ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY } from "../order-birth-marker"

describe("Order Recovery Scanner (Subagent E — S1 to S17 Adversarial Matrix)", () => {
  const cclCreatedAt = new Date("2026-08-01T12:00:00.000Z")

  const baseInput: ScanOrdersForRecoveryInput = {
    cclId: "chkcpl_scan_s1s17",
    expectedCartId: "cart_s1s17",
    expectedPaymentAttemptId: "payatt_s1s17",
    expectedPaymentIntentId: "pi_s1s17",
    expectedAmountMinor: 9900,
    cclCreatedAt,
    cclExecutionStartedAt: null,
    pageSize: 2,
  }

  const windowResult = resolveOrderRecoveryScanWindow({
    cclCreatedAt: baseInput.cclCreatedAt,
  })
  if (!windowResult.ok) {
    throw new Error(`unexpected window failure: ${windowResult.reason}`)
  }
  const { windowStart } = windowResult

  /** Timestamp safely inside the scan window (not on boundary). */
  const inWindowCreatedAt = "2026-08-01T12:00:30.000Z"

  type MockOrderRow = {
    id: string
    created_at: string
    currency_code?: string
    total?: number
    metadata?: Record<string, unknown>
    deleted_at?: string | null
  }

  function exactMarkerOrder(
    id: string,
    overrides: Partial<MockOrderRow> = {}
  ): MockOrderRow {
    return {
      id,
      created_at: inWindowCreatedAt,
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: baseInput.cclId },
      ...overrides,
    }
  }

  function wrongMarkerOrder(
    id: string,
    markerCclId: string,
    overrides: Partial<MockOrderRow> = {}
  ): MockOrderRow {
    return {
      id,
      created_at: inWindowCreatedAt,
      currency_code: "BRL",
      total: 99,
      metadata: { [ORDER_BIRTH_CHECKOUT_COMPLETION_LOG_ID_KEY]: markerCclId },
      ...overrides,
    }
  }

  function unmarkedOrder(id: string, overrides: Partial<MockOrderRow> = {}): MockOrderRow {
    return {
      id,
      created_at: inWindowCreatedAt,
      currency_code: "BRL",
      total: 99,
      metadata: {},
      ...overrides,
    }
  }

  function compareCreatedAtThenId(
    a: MockOrderRow,
    b: MockOrderRow
  ): number {
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

  /**
   * Scripted adversarial mock for cases an honest dataset cannot produce
   * (API lying: empty page, invalid count, mid-throw, count drift).
   */
  function createScriptedOrderModule(
    pages: Array<{ rows: MockOrderRow[]; count: number } | Error>
  ) {
    let callIndex = 0
    return {
      listAndCountOrders: jest.fn().mockImplementation((_filters, config) => {
        expect(config.withDeleted).toBe(true)
        expect(config.order).toEqual({ created_at: "ASC", id: "ASC" })

        const scripted = pages[callIndex++]
        if (scripted instanceof Error) {
          return Promise.reject(scripted)
        }
        if (!scripted) {
          return Promise.resolve([[], pages[0] && !(pages[0] instanceof Error) ? pages[0].count : 0])
        }
        return Promise.resolve([scripted.rows, scripted.count])
      }),
    }
  }

  const containerFrom = (mockOrderModule: { listAndCountOrders: jest.Mock }) => ({
    resolve: () => mockOrderModule,
  })

  it("S1: count 0 → ZERO", async () => {
    const mock = createHonestPaginatingOrderModule([])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, baseInput)

    expect(result.status).toBe("ZERO")
    if (result.status === "ZERO") {
      expect(result.totalScanned).toBe(0)
      expect(result.executionStarted).toBe(false)
    }
  })

  it("S2: one exact candidate → EXACT_ONE", async () => {
    const mock = createHonestPaginatingOrderModule([exactMarkerOrder("order_s2_exact")])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, baseInput)

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_s2_exact")
      expect(result.totalScanned).toBe(1)
    }
  })

  it("S3: two exact candidates → MULTIPLE", async () => {
    const mock = createHonestPaginatingOrderModule([
      exactMarkerOrder("order_s3_a"),
      exactMarkerOrder("order_s3_b"),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, baseInput)

    expect(result.status).toBe("MULTIPLE")
    if (result.status === "MULTIPLE") {
      expect(result.matchingOrders).toHaveLength(2)
      expect(result.totalScanned).toBe(2)
    }
  })

  it("S4: candidate only on second/later page → EXACT_ONE (honest pagination)", async () => {
    const mock = createHonestPaginatingOrderModule([
      unmarkedOrder("order_s4_noise_a"),
      unmarkedOrder("order_s4_noise_b"),
      exactMarkerOrder("order_s4_target"),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      pageSize: 2,
    })

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_s4_target")
      expect(result.totalScanned).toBe(3)
    }
    expect(mock.listAndCountOrders).toHaveBeenCalledTimes(2)
  })

  it("S5: second exact-marker Order hidden on later page → MULTIPLE (never EXACT_ONE)", async () => {
    const mock = createHonestPaginatingOrderModule([
      exactMarkerOrder("order_s5_match_page1"),
      unmarkedOrder("order_s5_noise"),
      exactMarkerOrder("order_s5_match_page2"),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      pageSize: 2,
    })

    expect(result.status).toBe("MULTIPLE")
    expect(result.status).not.toBe("EXACT_ONE")
    if (result.status === "MULTIPLE") {
      expect(result.matchingOrders.map((o) => o.id)).toEqual([
        "order_s5_match_page1",
        "order_s5_match_page2",
      ])
      expect(result.totalScanned).toBe(3)
    }
    expect(mock.listAndCountOrders).toHaveBeenCalledTimes(2)
  })

  it("S6: early empty page while scanned < expected count → SCAN_INCOMPLETE (never ZERO/EXACT_ONE)", async () => {
    const mock = createScriptedOrderModule([
      { rows: [unmarkedOrder("order_s6_first")], count: 3 },
      { rows: [], count: 3 }, // adversarial: empty page while count still 3
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      pageSize: 1,
    })

    expect(result.status).toBe("SCAN_INCOMPLETE")
    expect(result.status).not.toBe("ZERO")
    expect(result.status).not.toBe("EXACT_ONE")
    if (result.status === "SCAN_INCOMPLETE") {
      expect(result.reason).toBe("PAGINATION_EMPTY_PAGE")
      expect(result.totalScanned).toBe(1)
    }
  })

  it("S7: short page before expected count exhausted, next page available → continue then complete", async () => {
    const mock = createHonestPaginatingOrderModule([
      unmarkedOrder("order_s7_a"),
      unmarkedOrder("order_s7_b"),
      exactMarkerOrder("order_s7_target"),
      unmarkedOrder("order_s7_c"),
      unmarkedOrder("order_s7_d"),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      pageSize: 3,
    })

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_s7_target")
      expect(result.totalScanned).toBe(5)
    }
    // page 1: 3 rows; page 2: 2 rows (short page) — scanner must continue
    expect(mock.listAndCountOrders).toHaveBeenCalledTimes(2)
  })

  it("S8: short page and subsequent empty before expected count exhausted → SCAN_INCOMPLETE", async () => {
    const mock = createScriptedOrderModule([
      { rows: [unmarkedOrder("order_s8_first")], count: 3 }, // short page (take=2, got 1)
      { rows: [], count: 3 }, // adversarial empty before count exhausted
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      pageSize: 2,
    })

    expect(result.status).toBe("SCAN_INCOMPLETE")
    expect(result.status).not.toBe("ZERO")
    expect(result.status).not.toBe("EXACT_ONE")
    if (result.status === "SCAN_INCOMPLETE") {
      expect(result.reason).toBe("PAGINATION_EMPTY_PAGE")
    }
  })

  it("S9: mid-pagination exception → SCAN_INCOMPLETE", async () => {
    let callCount = 0
    const mock = {
      listAndCountOrders: jest.fn().mockImplementation((_filters, config) => {
        expect(config.withDeleted).toBe(true)
        expect(config.order).toEqual({ created_at: "ASC", id: "ASC" })
        callCount++
        if (callCount === 2) {
          throw new Error("MID_PAGINATION_FAILURE")
        }
        return Promise.resolve([[unmarkedOrder("order_s9_first")], 2])
      }),
    }
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      pageSize: 1,
    })

    expect(result.status).toBe("SCAN_INCOMPLETE")
    expect(result.status).not.toBe("ZERO")
    expect(result.status).not.toBe("EXACT_ONE")
    if (result.status === "SCAN_INCOMPLETE") {
      expect(result.reason).toContain("MID_PAGINATION_FAILURE")
      expect(result.totalScanned).toBe(1)
    }
  })

  it("S10: initial/final count mismatch → SCAN_INCOMPLETE", async () => {
    const mock = createScriptedOrderModule([
      { rows: [unmarkedOrder("order_s10_a")], count: 3 },
      { rows: [unmarkedOrder("order_s10_b")], count: 5 }, // adversarial count drift
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      pageSize: 1,
    })

    expect(result.status).toBe("SCAN_INCOMPLETE")
    expect(result.status).not.toBe("ZERO")
    expect(result.status).not.toBe("EXACT_ONE")
    if (result.status === "SCAN_INCOMPLETE") {
      expect(result.reason).toContain("COUNT_INCONSISTENCY")
    }
  })

  it.each([
    ["negative", -1],
    ["fractional 1.5", 1.5],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["string '3'", "3" as unknown as number],
  ])("S11/S12: invalid count (%s) → SCAN_INCOMPLETE", async (_label, invalidCount) => {
    const mock = createScriptedOrderModule([
      { rows: [unmarkedOrder("order_s11_row")], count: invalidCount },
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, baseInput)

    expect(result.status).toBe("SCAN_INCOMPLETE")
    expect(result.status).not.toBe("ZERO")
    expect(result.status).not.toBe("EXACT_ONE")
    if (result.status === "SCAN_INCOMPLETE") {
      expect(result.reason).toBe("INVALID_COUNT")
    }
  })

  it("S13: same created_at across multiple Orders → stable id tie-break, no skip/dup", async () => {
    const sharedCreatedAt = "2026-08-01T12:00:10.000Z"
    const orders = [
      unmarkedOrder("order_s13_c", { created_at: sharedCreatedAt }),
      unmarkedOrder("order_s13_a", { created_at: sharedCreatedAt }),
      exactMarkerOrder("order_s13_b", { created_at: sharedCreatedAt }),
      unmarkedOrder("order_s13_d", { created_at: sharedCreatedAt }),
    ]

    const mock = createHonestPaginatingOrderModule(orders)
    const scannedIds: string[] = []

    mock.listAndCountOrders.mockImplementation((filters, config) => {
      expect(config.withDeleted).toBe(true)
      expect(config.order).toEqual({ created_at: "ASC", id: "ASC" })

      const gte = filters.created_at.$gte as string
      const lte = filters.created_at.$lte as string | undefined
      let filtered = orders.filter((order) => orderInWindow(order, gte, lte))
      filtered = [...filtered].sort(compareCreatedAtThenId)

      const skip = config.skip ?? 0
      const take = config.take ?? filtered.length
      const pageRows = filtered.slice(skip, skip + take)
      scannedIds.push(...pageRows.map((row) => row.id))

      return Promise.resolve([pageRows, filtered.length])
    })

    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      pageSize: 2,
    })

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_s13_b")
      expect(result.totalScanned).toBe(4)
    }

    // Stable sort: a, b, c, d — all four scanned exactly once across pages
    expect(scannedIds).toEqual([
      "order_s13_a",
      "order_s13_b",
      "order_s13_c",
      "order_s13_d",
    ])
    expect(new Set(scannedIds).size).toBe(4)
  })

  it("S14: soft-deleted exact Order → included (withDeleted)", async () => {
    const mock = createHonestPaginatingOrderModule([
      exactMarkerOrder("order_s14_deleted", {
        deleted_at: "2026-08-01T12:01:00.000Z",
      }),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, baseInput)

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_s14_deleted")
    }
    expect(mock.listAndCountOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        created_at: {
          $gte: windowStart.toISOString(),
        },
      }),
      expect.objectContaining({ withDeleted: true })
    )
    const s14Filters = mock.listAndCountOrders.mock.calls[0][0]
    expect(s14Filters.created_at).not.toHaveProperty("$lte")
  })

  it("S15: wrong marker rows do not count as exact matches", async () => {
    const mock = createHonestPaginatingOrderModule([
      wrongMarkerOrder("order_s15_wrong", "chkcpl_OTHER"),
      exactMarkerOrder("order_s15_true"),
      unmarkedOrder("order_s15_unmarked"),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, baseInput)

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_s15_true")
      expect(result.totalScanned).toBe(3)
    }
  })

  it("S15-zero: only wrong markers → ZERO", async () => {
    const mock = createHonestPaginatingOrderModule([
      wrongMarkerOrder("order_s15z_a", "chkcpl_OTHER_A"),
      unmarkedOrder("order_s15z_b"),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, baseInput)

    expect(result.status).toBe("ZERO")
    if (result.status === "ZERO") {
      expect(result.totalScanned).toBe(2)
    }
  })

  it("S16: incomplete scan can NEVER return ZERO", async () => {
    const incompleteCases: Array<{
      label: string
      run: () => Promise<{ status: string }>
    }> = [
      {
        label: "S6",
        run: async () => {
          const mock = createScriptedOrderModule([
            { rows: [unmarkedOrder("s16_s6")], count: 3 },
            { rows: [], count: 3 },
          ])
          return scanOrdersForRecovery(containerFrom(mock) as any, {
            ...baseInput,
            pageSize: 1,
          })
        },
      },
      {
        label: "S8",
        run: async () => {
          const mock = createScriptedOrderModule([
            { rows: [unmarkedOrder("s16_s8")], count: 3 },
            { rows: [], count: 3 },
          ])
          return scanOrdersForRecovery(containerFrom(mock) as any, {
            ...baseInput,
            pageSize: 2,
          })
        },
      },
      {
        label: "S9",
        run: async () => {
          let calls = 0
          const mock = {
            listAndCountOrders: jest.fn().mockImplementation(() => {
              calls++
              if (calls === 2) throw new Error("S16_S9_THROW")
              return Promise.resolve([[unmarkedOrder("s16_s9")], 2])
            }),
          }
          return scanOrdersForRecovery(containerFrom(mock) as any, {
            ...baseInput,
            pageSize: 1,
          })
        },
      },
      {
        label: "S10",
        run: async () => {
          const mock = createScriptedOrderModule([
            { rows: [unmarkedOrder("s16_s10")], count: 3 },
            { rows: [unmarkedOrder("s16_s10_b")], count: 5 },
          ])
          return scanOrdersForRecovery(containerFrom(mock) as any, {
            ...baseInput,
            pageSize: 1,
          })
        },
      },
      {
        label: "S11",
        run: async () => {
          const mock = createScriptedOrderModule([
            { rows: [unmarkedOrder("s16_s11")], count: -1 },
          ])
          return scanOrdersForRecovery(containerFrom(mock) as any, baseInput)
        },
      },
      {
        label: "S12",
        run: async () => {
          const mock = createScriptedOrderModule([
            { rows: [unmarkedOrder("s16_s12")], count: NaN },
          ])
          return scanOrdersForRecovery(containerFrom(mock) as any, baseInput)
        },
      },
    ]

    for (const { label, run } of incompleteCases) {
      const result = await run()
      expect(result.status).toBe("SCAN_INCOMPLETE")
      expect(result.status).not.toBe("ZERO")
      expect(["S6", "S8", "S9", "S10", "S11", "S12"]).toContain(label)
    }
  })

  it("S17: incomplete scan can NEVER return EXACT_ONE", async () => {
    const incompleteCases = [
      {
        label: "S6-empty-page",
        run: async () => {
          const mock = createScriptedOrderModule([
            { rows: [exactMarkerOrder("s17_s6_decoy")], count: 3 },
            { rows: [], count: 3 },
          ])
          return scanOrdersForRecovery(containerFrom(mock) as any, {
            ...baseInput,
            pageSize: 1,
          })
        },
      },
      {
        label: "S8-short-then-empty",
        run: async () => {
          const mock = createScriptedOrderModule([
            { rows: [exactMarkerOrder("s17_s8_decoy")], count: 3 },
            { rows: [], count: 3 },
          ])
          return scanOrdersForRecovery(containerFrom(mock) as any, {
            ...baseInput,
            pageSize: 2,
          })
        },
      },
      {
        label: "S9-mid-throw-after-match",
        run: async () => {
          let calls = 0
          const mock = {
            listAndCountOrders: jest.fn().mockImplementation(() => {
              calls++
              if (calls === 2) throw new Error("S17_S9_THROW")
              return Promise.resolve([[exactMarkerOrder("s17_s9_decoy")], 2])
            }),
          }
          return scanOrdersForRecovery(containerFrom(mock) as any, {
            ...baseInput,
            pageSize: 1,
          })
        },
      },
      {
        label: "S10-count-drift",
        run: async () => {
          const mock = createScriptedOrderModule([
            { rows: [exactMarkerOrder("s17_s10_decoy")], count: 3 },
            { rows: [unmarkedOrder("s17_s10_b")], count: 5 },
          ])
          return scanOrdersForRecovery(containerFrom(mock) as any, {
            ...baseInput,
            pageSize: 1,
          })
        },
      },
      {
        label: "S11-negative-count",
        run: async () => {
          const mock = createScriptedOrderModule([
            { rows: [exactMarkerOrder("s17_s11_decoy")], count: -1 },
          ])
          return scanOrdersForRecovery(containerFrom(mock) as any, baseInput)
        },
      },
      {
        label: "S12-NaN-count",
        run: async () => {
          const mock = createScriptedOrderModule([
            { rows: [exactMarkerOrder("s17_s12_decoy")], count: NaN },
          ])
          return scanOrdersForRecovery(containerFrom(mock) as any, baseInput)
        },
      },
    ]

    for (const { run } of incompleteCases) {
      const result = await run()
      expect(result.status).toBe("SCAN_INCOMPLETE")
      expect(result.status).not.toBe("EXACT_ONE")
    }
  })

  it("window proof: retry same CCL timestamps → identical windowStart ISO and no windowEnd", () => {
    const input = {
      cclCreatedAt: baseInput.cclCreatedAt,
      windowSafetyMarginMs: DEFAULT_WINDOW_SAFETY_MARGIN_MS,
    }

    const first = resolveOrderRecoveryScanWindow(input)
    const second = resolveOrderRecoveryScanWindow(input)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (first.ok && second.ok) {
      expect(first.windowStart.toISOString()).toBe(second.windowStart.toISOString())
      expect(first.windowStart.toISOString()).toBe("2026-08-01T11:45:00.000Z")
      expect(first).not.toHaveProperty("windowEnd")
      expect(second).not.toHaveProperty("windowEnd")
    }
  })

  it("window proof: resolveOrderRecoveryScanWindow does not use Date.now(); no windowEnd / no $lte", async () => {
    const realNow = Date.now
    const frozenNow = new Date("2099-12-31T23:59:59.999Z").getTime()
    Date.now = jest.fn(() => frozenNow)

    try {
      const result = resolveOrderRecoveryScanWindow({
        cclCreatedAt: "2026-08-01T12:00:00.000Z",
      })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.windowStart.toISOString()).toBe("2026-08-01T11:45:00.000Z")
        expect(result).not.toHaveProperty("windowEnd")
      }

      const mock = createHonestPaginatingOrderModule([])
      await scanOrdersForRecovery(containerFrom(mock) as any, baseInput)
      const scanFilters = mock.listAndCountOrders.mock.calls[0][0]
      expect(scanFilters.created_at.$gte).toBe("2026-08-01T11:45:00.000Z")
      expect(scanFilters.created_at).not.toHaveProperty("$lte")
    } finally {
      Date.now = realNow
    }
  })

  it("late exact-marker Order (execution_started_at + 7 minutes) remains discoverable → EXACT_ONE", async () => {
    const executionStartedAt = new Date("2026-08-01T12:00:00.000Z")
    const lateCreatedAt = new Date(executionStartedAt.getTime() + 7 * 60 * 1000).toISOString()

    const mock = createHonestPaginatingOrderModule([
      exactMarkerOrder("order_late_plus_7m", { created_at: lateCreatedAt }),
    ])
    const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
      ...baseInput,
      cclExecutionStartedAt: executionStartedAt,
    })

    expect(result.status).toBe("EXACT_ONE")
    if (result.status === "EXACT_ONE") {
      expect(result.orderId).toBe("order_late_plus_7m")
      expect(result.totalScanned).toBe(1)
    }

    const lateFilters = mock.listAndCountOrders.mock.calls[0][0]
    expect(lateFilters.created_at).not.toHaveProperty("$lte")
    expect(lateFilters.created_at.$gte).toBe(windowStart.toISOString())
  })

  it("honest mock: withDeleted=false omits deleted rows (scanner always passes withDeleted=true)", async () => {
    const deleted = exactMarkerOrder("order_withdeleted_proof", {
      deleted_at: "2026-08-01T12:01:00.000Z",
    })
    const mock = createHonestPaginatingOrderModule([deleted])

    mock.listAndCountOrders.mockImplementationOnce((filters, config) => {
      expect(config.withDeleted).toBe(true)
      const gte = filters.created_at.$gte as string
      const lte = filters.created_at.$lte as string | undefined
      const filtered = [deleted].filter((order) => orderInWindow(order, gte, lte))
      return Promise.resolve([filtered, filtered.length])
    })

    const withoutDeletedModule = {
      listAndCountOrders: jest.fn().mockImplementation((filters, config) => {
        const gte = filters.created_at.$gte as string
        const lte = filters.created_at.$lte as string | undefined
        let filtered = [deleted].filter((order) => orderInWindow(order, gte, lte))
        if (config.withDeleted !== true) {
          filtered = filtered.filter((order) => order.deleted_at == null)
        }
        return Promise.resolve([filtered, filtered.length])
      }),
    }

    const withDeletedResult = await withoutDeletedModule.listAndCountOrders(
      {
        created_at: {
          $gte: windowStart.toISOString(),
        },
      },
      { withDeleted: true, skip: 0, take: 10, order: { created_at: "ASC", id: "ASC" } }
    )
    const withoutDeletedResult = await withoutDeletedModule.listAndCountOrders(
      {
        created_at: {
          $gte: windowStart.toISOString(),
        },
      },
      { withDeleted: false, skip: 0, take: 10, order: { created_at: "ASC", id: "ASC" } }
    )

    expect(withDeletedResult[1]).toBe(1)
    expect(withoutDeletedResult[1]).toBe(0)

    const scanResult = await scanOrdersForRecovery(containerFrom(mock) as any, baseInput)
    expect(scanResult.status).toBe("EXACT_ONE")
  })

  describe("L1–L9: Late-Order Scanner Proof Matrix (FIN-04 / R5-HR10)", () => {
    const T0 = new Date("2026-08-01T12:00:00.000Z")

    const lateInputBase: ScanOrdersForRecoveryInput = {
      ...baseInput,
      cclExecutionStartedAt: T0,
    }

    function t0PlusMinutes(minutes: number): string {
      return new Date(T0.getTime() + minutes * 60 * 1000).toISOString()
    }

    it("L1: T0+5m exact marker (old hard cutoff boundary) → EXACT_ONE", async () => {
      const mock = createHonestPaginatingOrderModule([
        exactMarkerOrder("order_l1_plus_5m", { created_at: t0PlusMinutes(5) }),
      ])
      const result = await scanOrdersForRecovery(containerFrom(mock) as any, lateInputBase)

      expect(result.status).toBe("EXACT_ONE")
      if (result.status === "EXACT_ONE") {
        expect(result.orderId).toBe("order_l1_plus_5m")
        expect(result.totalScanned).toBe(1)
      }
    })

    it("L2: T0+7m exact marker → EXACT_ONE", async () => {
      const mock = createHonestPaginatingOrderModule([
        exactMarkerOrder("order_l2_plus_7m", { created_at: t0PlusMinutes(7) }),
      ])
      const result = await scanOrdersForRecovery(containerFrom(mock) as any, lateInputBase)

      expect(result.status).toBe("EXACT_ONE")
      if (result.status === "EXACT_ONE") {
        expect(result.orderId).toBe("order_l2_plus_7m")
        expect(result.totalScanned).toBe(1)
      }
    })

    it("L3: T0+30m exact marker → EXACT_ONE", async () => {
      const mock = createHonestPaginatingOrderModule([
        exactMarkerOrder("order_l3_plus_30m", { created_at: t0PlusMinutes(30) }),
      ])
      const result = await scanOrdersForRecovery(containerFrom(mock) as any, lateInputBase)

      expect(result.status).toBe("EXACT_ONE")
      if (result.status === "EXACT_ONE") {
        expect(result.orderId).toBe("order_l3_plus_30m")
        expect(result.totalScanned).toBe(1)
      }
    })

    it("L4: late exact candidate on later page → EXACT_ONE", async () => {
      const mock = createHonestPaginatingOrderModule([
        unmarkedOrder("order_l4_noise_a", { created_at: t0PlusMinutes(1) }),
        wrongMarkerOrder("order_l4_wrong", "chkcpl_OTHER", { created_at: t0PlusMinutes(2) }),
        exactMarkerOrder("order_l4_late_target", { created_at: t0PlusMinutes(30) }),
      ])
      const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
        ...lateInputBase,
        pageSize: 2,
      })

      expect(result.status).toBe("EXACT_ONE")
      if (result.status === "EXACT_ONE") {
        expect(result.orderId).toBe("order_l4_late_target")
        expect(result.totalScanned).toBe(3)
      }
      expect(mock.listAndCountOrders).toHaveBeenCalledTimes(2)
    })

    it("L5: two late exact-marker Orders (+7m and +30m) → MULTIPLE", async () => {
      const mock = createHonestPaginatingOrderModule([
        exactMarkerOrder("order_l5_late_a", { created_at: t0PlusMinutes(7) }),
        exactMarkerOrder("order_l5_late_b", { created_at: t0PlusMinutes(30) }),
      ])
      const result = await scanOrdersForRecovery(containerFrom(mock) as any, lateInputBase)

      expect(result.status).toBe("MULTIPLE")
      expect(result.status).not.toBe("EXACT_ONE")
      if (result.status === "MULTIPLE") {
        expect(result.matchingOrders).toHaveLength(2)
        expect(result.matchingOrders.map((o) => o.id)).toEqual([
          "order_l5_late_a",
          "order_l5_late_b",
        ])
        expect(result.totalScanned).toBe(2)
      }
    })

    it("L6: only wrong-marker late Order (T0+30m) → ZERO", async () => {
      const mock = createHonestPaginatingOrderModule([
        wrongMarkerOrder("order_l6_wrong_late", "chkcpl_OTHER_L6", {
          created_at: t0PlusMinutes(30),
        }),
      ])
      const result = await scanOrdersForRecovery(containerFrom(mock) as any, lateInputBase)

      expect(result.status).toBe("ZERO")
      if (result.status === "ZERO") {
        expect(result.totalScanned).toBe(1)
        expect(result.executionStarted).toBe(true)
      }
    })

    it("L7: full pagination across >1 page with late exact → EXACT_ONE and totalScanned === count", async () => {
      const orders = [
        unmarkedOrder("order_l7_a", { created_at: t0PlusMinutes(0) }),
        unmarkedOrder("order_l7_b", { created_at: t0PlusMinutes(1) }),
        unmarkedOrder("order_l7_c", { created_at: t0PlusMinutes(2) }),
        exactMarkerOrder("order_l7_late_target", { created_at: t0PlusMinutes(30) }),
        unmarkedOrder("order_l7_d", { created_at: t0PlusMinutes(31) }),
      ]
      const mock = createHonestPaginatingOrderModule(orders)
      const result = await scanOrdersForRecovery(containerFrom(mock) as any, {
        ...lateInputBase,
        pageSize: 2,
      })

      expect(result.status).toBe("EXACT_ONE")
      if (result.status === "EXACT_ONE") {
        expect(result.orderId).toBe("order_l7_late_target")
        expect(result.totalScanned).toBe(5)
      }
      expect(mock.listAndCountOrders).toHaveBeenCalledTimes(3)
    })

    it("L8: no Date.now upper authority — frozen 2099 still finds T0+30m; filters have $gte only", async () => {
      const realNow = Date.now
      const frozenNow = new Date("2099-12-31T23:59:59.999Z").getTime()
      Date.now = jest.fn(() => frozenNow)

      try {
        const mock = createHonestPaginatingOrderModule([
          exactMarkerOrder("order_l8_plus_30m", { created_at: t0PlusMinutes(30) }),
        ])
        const result = await scanOrdersForRecovery(containerFrom(mock) as any, lateInputBase)

        expect(result.status).toBe("EXACT_ONE")
        if (result.status === "EXACT_ONE") {
          expect(result.orderId).toBe("order_l8_plus_30m")
        }

        const scanFilters = mock.listAndCountOrders.mock.calls[0][0]
        expect(scanFilters.created_at.$gte).toBe(windowStart.toISOString())
        expect(scanFilters.created_at).toHaveProperty("$gte")
        expect(scanFilters.created_at).not.toHaveProperty("$lte")

        const scannerSource = fs.readFileSync(
          path.join(__dirname, "../order-recovery-scanner.ts"),
          "utf-8"
        )
        expect(scannerSource).not.toContain("$lte")
        expect(scannerSource).not.toContain("windowEnd")
        expect(scannerSource).not.toContain("DEFAULT_WINDOW_FORWARD")
      } finally {
        Date.now = realNow
      }
    })

    it("L9: same CCL retry uses identical query universe (window + scan filters)", async () => {
      const windowInput = {
        cclCreatedAt: baseInput.cclCreatedAt,
        windowSafetyMarginMs: DEFAULT_WINDOW_SAFETY_MARGIN_MS,
      }

      const firstWindow = resolveOrderRecoveryScanWindow(windowInput)
      const secondWindow = resolveOrderRecoveryScanWindow(windowInput)

      expect(firstWindow.ok).toBe(true)
      expect(secondWindow.ok).toBe(true)
      if (firstWindow.ok && secondWindow.ok) {
        expect(firstWindow.windowStart.toISOString()).toBe(
          secondWindow.windowStart.toISOString()
        )
        expect(firstWindow.windowStart.toISOString()).toBe("2026-08-01T11:45:00.000Z")
      }

      const mock = createHonestPaginatingOrderModule([])
      const container = containerFrom(mock)

      await scanOrdersForRecovery(container as any, lateInputBase)
      await scanOrdersForRecovery(container as any, lateInputBase)

      expect(mock.listAndCountOrders).toHaveBeenCalledTimes(2)

      const firstFilters = mock.listAndCountOrders.mock.calls[0][0]
      const secondFilters = mock.listAndCountOrders.mock.calls[1][0]

      expect(firstFilters.created_at.$gte).toBe(secondFilters.created_at.$gte)
      expect(firstFilters.created_at.$gte).toBe("2026-08-01T11:45:00.000Z")
      expect(firstFilters.created_at).not.toHaveProperty("$lte")
      expect(secondFilters.created_at).not.toHaveProperty("$lte")
    })
  })
})
