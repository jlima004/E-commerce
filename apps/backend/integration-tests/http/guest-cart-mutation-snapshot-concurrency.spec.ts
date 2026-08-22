import { POST as addLineItem } from "../../src/api/store/carts/[id]/line-items/route"
import { addToCartWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../src/modules/guest-cart-capability/types"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import { STORE_IDEMPOTENCY_MODULE } from "../../src/modules/store-idempotency"
import { STORE_RESOURCE_VERSION_MODULE } from "../../src/modules/store-resource-version"

jest.mock("@medusajs/core-flows", () => ({
  addToCartWorkflow: jest.fn(),
  updateLineItemInCartWorkflow: jest.fn(),
  deleteLineItemsWorkflow: jest.fn(),
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function response() {
  return {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    body: null as unknown,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
    },
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      this.headersSent = true
      return this
    },
  }
}

function createHarness() {
  const cart = {
    id: "cart_snapshot_concurrency_01",
    customer: null,
    items: [] as Array<Record<string, unknown>>,
    currency_code: "brl",
    region_id: "reg_br",
    metadata: { active_for_checkout: true },
    completed_at: null,
    created_at: "2026-08-22T18:00:00.000Z",
    updated_at: "2026-08-22T18:00:00.000Z",
  }
  const versions = new Map([[cart.id, 1]])
  const idempotencyRecords = new Map<string, any>()
  let itemSequence = 1
  let transactionSequence = 1
  let lockOwner: object | null = null
  let releaseLock = deferred<void>()
  const bWaitingForLock = deferred<void>()
  const aSnapshotCaptured = deferred<void>()
  const allowASnapshotToReturn = deferred<void>()
  let snapshotCount = 0

  const pgRaw = async (transaction: object, sql: string) => {
    if (sql.includes("pg_advisory_xact_lock")) {
      if (lockOwner && lockOwner !== transaction) {
        bWaitingForLock.resolve()
        await releaseLock.promise
      }
      lockOwner = transaction
    }
    return { rows: [] }
  }

  const cartModule = {
    retrieveCart: async (id: string) => {
      const snapshot = clone(id === cart.id ? cart : null)
      snapshotCount += 1
      if (snapshotCount === 1) {
        aSnapshotCaptured.resolve()
        await allowASnapshotToReturn.promise
      }
      return snapshot
    },
    baseRepository_: {
      transaction: async (callback: (manager: unknown) => Promise<unknown>) => {
        const transaction = {}
        const context = { raw: (sql: string, bindings?: unknown[]) => pgRaw(transaction, sql) }
        try {
          return await callback({
            getTransactionContext: () => context,
          })
        } finally {
          if (lockOwner === transaction) {
            lockOwner = null
            const previousRelease = releaseLock
            releaseLock = deferred<void>()
            previousRelease.resolve()
          }
        }
      },
    },
  }

  const guestCapability = {
    async lookupGuestCartCapabilityByPresentedToken() {
      return {
        id: "gccap_snapshot_concurrency_01",
        cart_id: cart.id,
        token_hash: "hash_snapshot_concurrency_01",
        status: "active",
        expires_at: "2026-08-29T18:00:00.000Z",
        consumed_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: "2026-08-22T18:00:00.000Z",
        updated_at: "2026-08-22T18:00:00.000Z",
        deleted_at: null,
      }
    },
    async authorizeGuestCartCapabilityForMutation() {
      return this.lookupGuestCartCapabilityByPresentedToken()
    },
  }

  const idempotency = {
    async claim(input: any) {
      const existing = idempotencyRecords.get(input.rawIdempotencyKey)
      if (existing) {
        return { type: "replay", record: existing }
      }
      const record = {
        id: `idem_${idempotencyRecords.size + 1}`,
        state: "processing",
        state_version: 1,
        retry_attempt_count: 0,
        failure_code: null,
        result_id: null,
      }
      idempotencyRecords.set(input.rawIdempotencyKey, record)
      return { type: "claimed", record }
    },
    async markCompleted(input: any) {
      const record = [...idempotencyRecords.values()].find((candidate) => candidate.id === input.id)
      record.state = "completed"
      record.state_version += 1
      record.result_id = input.result_id
      return { type: "claimed", record }
    },
    async recordProcessingResult(input: any) {
      const record = [...idempotencyRecords.values()].find((candidate) => candidate.id === input.id)
      record.state_version += 1
      record.result_id = input.result_id
      return { type: "claimed", record }
    },
    async markFailedRetryable() {
      return { type: "claimed" }
    },
    async markFailedTerminal() {
      return { type: "claimed" }
    },
    async markReconciliationRequired() {
      return { type: "claimed" }
    },
  }

  const versionService = {
    async initialize(_type: string, id: string) {
      return {
        id: `strver_${id}`,
        resource_type: "cart",
        resource_id: id,
        version: versions.get(id) ?? 1,
      }
    },
    async compareAndSwapWithMutation(input: any) {
      const current = versions.get(input.resourceId) ?? 1
      if (current !== input.expectedVersion) {
        return {
          type: "stale",
          actualVersion: current,
          expectedVersion: input.expectedVersion,
        }
      }
      const mutationResult = await input.mutate(input.sharedContext)
      versions.set(input.resourceId, current + 1)
      return {
        type: "updated",
        previousVersion: current,
        version: current + 1,
        mutationResult,
      }
    },
  }

  ;(addToCartWorkflow as unknown as jest.Mock).mockReset()
  ;(addToCartWorkflow as unknown as jest.Mock).mockImplementation(() => ({
    run: async ({ input }: any) => {
      cart.items.push({
        id: `li_snapshot_${itemSequence++}`,
        variant_id: input.items[0].variant_id,
        quantity: input.items[0].quantity,
        title: "Camiseta",
      })
      return { result: { cart_id: cart.id } }
    },
  }))

  const remoteQuery = async () => [clone(cart)]
  const paymentAttempt = {
    async listPaymentAttempts() {
      return []
    },
    async updatePaymentAttempts() {},
  }

  function request(key: string, variantId: string) {
    return {
      method: "POST",
      params: { id: cart.id },
      body: { variant_id: variantId, quantity: 1 },
      headers: {
        [GUEST_CART_CAPABILITY_HEADER]: "guest-token-not-persisted",
        "idempotency-key": key,
        "if-match": `"${versions.get(cart.id)}"`,
      },
      scope: {
        resolve(keyToResolve: unknown) {
          if (keyToResolve === GUEST_CART_CAPABILITY_MODULE) return guestCapability
          if (keyToResolve === PAYMENT_ATTEMPT_MODULE) return paymentAttempt
          if (keyToResolve === STORE_IDEMPOTENCY_MODULE) return idempotency
          if (keyToResolve === STORE_RESOURCE_VERSION_MODULE) return versionService
          if (keyToResolve === ContainerRegistrationKeys.REMOTE_QUERY) return remoteQuery
          if (keyToResolve === ContainerRegistrationKeys.PG_CONNECTION) {
            return { raw: async (sql: string, bindings?: unknown[]) => pgRaw({}, sql) }
          }
          if (keyToResolve === Modules.CART) return cartModule
          throw new Error(`unrecognized scope key ${String(keyToResolve)}`)
        },
      },
    }
  }

  return {
    cart,
    request,
    response,
    aSnapshotCaptured,
    allowASnapshotToReturn,
    bWaitingForLock,
    get snapshotCount() {
      return snapshotCount
    },
  }
}

describe("HR-03 Cart mutation snapshot/ETag concurrency", () => {
  it("serializa A/B e nunca devolve body de uma versão com ETag de outra", async () => {
    const harness = createHarness()
    const responseA = harness.response()
    const responseB = harness.response()

    const promiseA = addLineItem(
      harness.request("snapshot-a", "variant_a") as never,
      responseA as never
    )
    await harness.aSnapshotCaptured.promise

    let bCompleted = false
    const promiseB = addLineItem(
      harness.request("snapshot-b", "variant_b") as never,
      responseB as never
    ).then(() => {
      bCompleted = true
    })
    await harness.bWaitingForLock.promise
    expect(bCompleted).toBe(false)

    harness.allowASnapshotToReturn.resolve()
    await Promise.all([promiseA, promiseB])

    expect(responseA.headers.etag).toBe('"2"')
    expect((responseA.body as any).cart.items.map((item: any) => item.variant_id)).toEqual([
      "variant_a",
    ])
    expect(responseB.headers.etag).toBe('"3"')
    expect((responseB.body as any).cart.items.map((item: any) => item.variant_id)).toEqual([
      "variant_a",
      "variant_b",
    ])
    expect(harness.snapshotCount).toBe(2)
  })
})
