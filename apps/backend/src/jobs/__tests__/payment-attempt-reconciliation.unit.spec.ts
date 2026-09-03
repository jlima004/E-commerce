import paymentAttemptReconciliationJob, {
  isWorkerMode,
  runPaymentAttemptReconciliationJob,
  config,
} from "../payment-attempt-reconciliation"
import type { MedusaContainer } from "@medusajs/framework/types"
import { env } from "../../config/env"
import { createStripePaymentIntentsClient } from "../../modules/payment-attempt/stripe-real"

describe("payment attempt reconciliation job (R4-HR03 worker / runtime seam)", () => {
  const originalEnv = process.env
  const originalStripeSecretKey = env.STRIPE_SECRET_KEY

  beforeEach(() => {
    process.env = { ...originalEnv }
    ;(env as any).STRIPE_SECRET_KEY = originalStripeSecretKey
  })

  afterAll(() => {
    process.env = originalEnv
    ;(env as any).STRIPE_SECRET_KEY = originalStripeSecretKey
  })

  it("config defines correct name and schedule", () => {
    expect(config.name).toBe("payment-attempt-reconciliation")
    expect(config.schedule).toBe("*/5 * * * *")
  })

  it("isWorkerMode detects worker mode correctly across env variables", () => {
    expect(isWorkerMode({})).toBe(false)
    expect(isWorkerMode({ WORKER_MODE: "server" })).toBe(false)
    expect(isWorkerMode({ WORKER_MODE: "worker" })).toBe(true)
    expect(isWorkerMode({ MEDUSA_WORKER_MODE: "worker" })).toBe(true)
  })

  // J1: non-worker → SKIP
  it("J1: non-worker skips reconciliation job", async () => {
    process.env.WORKER_MODE = "server"
    delete process.env.MEDUSA_WORKER_MODE

    const mockContainer = {
      resolve: jest.fn(),
    } as unknown as MedusaContainer

    await paymentAttemptReconciliationJob(mockContainer)
    expect(mockContainer.resolve).not.toHaveBeenCalled()
  })

  // J2: WORKER_MODE=worker → RUN
  it("J2: WORKER_MODE=worker runs reconciliation job", async () => {
    process.env.WORKER_MODE = "worker"
    delete process.env.MEDUSA_WORKER_MODE
    delete process.env.DTC_RELEASE_MIGRATION_MODE

    const fakeTrx = {
      raw: jest.fn(async () => ({ rows: [] })),
    }
    const fakeConnection = {
      transaction: jest.fn(async (cb: any) => cb(fakeTrx)),
    }
    const fakeLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    const mockContainer = {
      resolve: jest.fn((key: string) => {
        if (key === "__pg_connection__") return fakeConnection
        if (key === "logger") return fakeLogger
        return undefined
      }),
    } as unknown as MedusaContainer

    await paymentAttemptReconciliationJob(mockContainer)
    expect(mockContainer.resolve).toHaveBeenCalledWith("__pg_connection__")
  })

  // J3: WORKER_MODE=worker + release migration mode=true → SKIP BECAUSE RELEASE GUARD
  it("J3: WORKER_MODE=worker + release migration mode skips because of release guard", async () => {
    process.env.WORKER_MODE = "worker"
    delete process.env.MEDUSA_WORKER_MODE
    process.env.DTC_RELEASE_MIGRATION_MODE = "true"
    process.env.DTC_RELEASE_MIGRATION_CHILD_PROCESS = "true"

    const mockContainer = {
      resolve: jest.fn(),
    } as unknown as MedusaContainer

    await paymentAttemptReconciliationJob(mockContainer)
    expect(mockContainer.resolve).not.toHaveBeenCalled()
  })

  // J4: canonical STRIPE_SECRET_KEY → factory initialized
  it("J4: canonical env.STRIPE_SECRET_KEY initializes StripePaymentIntentsClient factory", async () => {
    ;(env as any).STRIPE_SECRET_KEY = "sk_test_1234567890abcdef"

    const fakeTrx = {
      raw: jest.fn(async () => ({ rows: [] })),
    }
    const fakeConnection = {
      transaction: jest.fn(async (cb: any) => cb(fakeTrx)),
    }
    const fakeLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    const mockContainer = {
      resolve: jest.fn((key: string) => {
        if (key === "__pg_connection__") return fakeConnection
        if (key === "logger") return fakeLogger
        return undefined
      }),
    } as unknown as MedusaContainer

    const result = await runPaymentAttemptReconciliationJob(mockContainer)
    expect(result).toEqual({
      scanned: 0,
      thawed: 0,
      reconciled: 0,
      skipped: 0,
      errors: 0,
    })
    expect(fakeLogger.warn).not.toHaveBeenCalled()
    expect(fakeTrx.raw).toHaveBeenCalled()

    // Verify factory itself generates valid client from this key
    const client = createStripePaymentIntentsClient(env.STRIPE_SECRET_KEY!)
    expect(typeof client.create).toBe("function")
    expect(typeof client.search).toBe("function")
    expect(typeof client.retrieve).toBe("function")
  })

  // J5: STRIPE_API_KEY only → NOT USED
  it("J5: STRIPE_API_KEY only is NOT used by reconciliation job", async () => {
    ;(env as any).STRIPE_SECRET_KEY = undefined
    // If STRIPE_API_KEY was inspected, an invalid key format would trigger warn
    process.env.STRIPE_API_KEY = "invalid_key_that_would_warn_if_used"

    const fakeTrx = {
      raw: jest.fn(async () => ({ rows: [] })),
    }
    const fakeConnection = {
      transaction: jest.fn(async (cb: any) => cb(fakeTrx)),
    }
    const fakeLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    const mockContainer = {
      resolve: jest.fn((key: string) => {
        if (key === "__pg_connection__") return fakeConnection
        if (key === "logger") return fakeLogger
        return undefined
      }),
    } as unknown as MedusaContainer

    const result = await runPaymentAttemptReconciliationJob(mockContainer)
    expect(result.scanned).toBe(0)
    // No warn triggered because STRIPE_API_KEY was ignored
    expect(fakeLogger.warn).not.toHaveBeenCalled()
  })

  // J6: invalid/non-test STRIPE_SECRET_KEY → safety behavior preserved
  it("J6: invalid/non-test STRIPE_SECRET_KEY warns safely without crashing", async () => {
    ;(env as any).STRIPE_SECRET_KEY = "live_secret_key_not_allowed_here"
    const fakeTrx = {
      raw: jest.fn(async () => ({ rows: [] })),
    }
    const fakeConnection = {
      transaction: jest.fn(async (cb: any) => cb(fakeTrx)),
    }
    const fakeLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    const mockContainer = {
      resolve: jest.fn((key: string) => {
        if (key === "__pg_connection__") return fakeConnection
        if (key === "logger") return fakeLogger
        return undefined
      }),
    } as unknown as MedusaContainer

    const result = await runPaymentAttemptReconciliationJob(mockContainer)

    expect(fakeLogger.warn).toHaveBeenCalledWith(
      "Failed to initialize StripePaymentIntentsClient for reconciliation",
      expect.objectContaining({
        error: expect.stringContaining(
          "STRIPE_REAL_SECRET_KEY_MUST_BE_TEST_MODE"
        ),
      })
    )
    expect(result.scanned).toBe(0)
  })

  // J7: no Stripe config → safe no-network behavior
  it("J7: no Stripe config provides safe no-network behavior", async () => {
    ;(env as any).STRIPE_SECRET_KEY = undefined
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_API_KEY

    const fakeTrx = {
      raw: jest.fn(async () => ({ rows: [] })),
    }
    const fakeConnection = {
      transaction: jest.fn(async (cb: any) => cb(fakeTrx)),
    }
    const fakeLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }

    const mockContainer = {
      resolve: jest.fn((key: string) => {
        if (key === "__pg_connection__") return fakeConnection
        if (key === "logger") return fakeLogger
        return undefined
      }),
    } as unknown as MedusaContainer

    const result = await runPaymentAttemptReconciliationJob(mockContainer)
    expect(result).toEqual({
      scanned: 0,
      thawed: 0,
      reconciled: 0,
      skipped: 0,
      errors: 0,
    })
    expect(fakeLogger.warn).not.toHaveBeenCalled()
  })

  // J8: no TypeScript type instantiated as runtime class
  it("J8: StripePaymentIntentsClient is a TypeScript type, not a runtime class", () => {
    const client = createStripePaymentIntentsClient("sk_test_mock_factory_check")
    expect(typeof client).toBe("object")
    expect(typeof client.retrieve).toBe("function")
    expect(typeof client.search).toBe("function")
    expect(typeof client.create).toBe("function")
  })
})
