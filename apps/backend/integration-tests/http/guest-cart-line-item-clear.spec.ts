import { DELETE as clearLineItems } from "../../src/api/store/carts/[id]/line-items/route"
import { deleteLineItemsWorkflow } from "@medusajs/core-flows"
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
    id: "cart_guest_clear_01",
    customer: null,
    items: [
      { id: "li_guest_clear_01", variant_id: "variant_01", quantity: 1, title: "Camiseta", unit_price: 3990 },
      { id: "li_guest_clear_02", variant_id: "variant_02", quantity: 2, title: "Camiseta", unit_price: 4990 },
    ],
    currency_code: "brl",
    region_id: "reg_br",
    metadata: { active_for_checkout: true },
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const carts = new Map([[cart.id, cart]])
  const versions = new Map([[cart.id, 1]])
  const records = new Map<string, any>()
  const attempts = [{ id: "pat_guest_clear_01", cart_id: cart.id, status: "created" }]
  let claimCount = 0
  let casCount = 0

  const idempotency = {
    async claim(input: any) {
      claimCount += 1
      const existing = records.get(input.rawIdempotencyKey)
      if (existing) {
        if (existing.state === "completed" || existing.state === "failed_terminal") {
          return { type: "replay", record: existing }
        }
        return { type: "in_progress", record: existing }
      }
      const record = {
        id: `idem_${records.size + 1}`,
        state: "processing",
        state_version: 1,
        retry_attempt_count: 0,
        failure_code: null,
        result_id: null,
      }
      records.set(input.rawIdempotencyKey, record)
      return { type: "claimed", record }
    },
    async recordProcessingResult(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state_version += 1
      record.result_id = input.result_id
      return { type: "claimed", record }
    },
    async markCompleted(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "completed"
      record.state_version += 1
      record.result_id = input.result_id
      return { type: "claimed", record }
    },
    async markFailedRetryable(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "failed_retryable"
      record.state_version += 1
      record.failure_code = input.failure_code
      return { type: "claimed", record }
    },
    async markFailedTerminal(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "failed_terminal"
      record.state_version += 1
      record.failure_code = input.failure_code
      return { type: "claimed", record }
    },
    async markReconciliationRequired(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "reconciliation_required"
      record.state_version += 1
      record.failure_code = input.failure_code
      return { type: "claimed", record }
    },
  }
  const guestCapability = {
    async lookupGuestCartCapabilityByPresentedToken() {
      return {
        id: "gccap_guest_clear_01",
        cart_id: cart.id,
        token_hash: "hash_guest_clear_01",
        status: "active",
        expires_at: new Date(Date.now() + 60_000),
        consumed_at: null,
        revoked_at: null,
        last_used_at: null,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      }
    },
    async authorizeGuestCartCapabilityForMutation() {
      return this.lookupGuestCartCapabilityByPresentedToken()
    },
  }
  const paymentAttempt = {
    async listPaymentAttempts() {
      return attempts
    },
    async updatePaymentAttempts(next: any) {
      Object.assign(attempts[0], next)
    },
  }
  const versionService = {
    async initialize(_type: string, id: string) {
      return { id: `strver_${id}`, resource_type: "cart", resource_id: id, version: versions.get(id) ?? 1 }
    },
    async compareAndSwapWithMutation(input: any) {
      const current = versions.get(input.resourceId) ?? 1
      if (current !== input.expectedVersion) {
        return { type: "stale", actualVersion: current, expectedVersion: input.expectedVersion }
      }
      casCount += 1
      const result = await input.mutate({})
      versions.set(input.resourceId, current + 1)
      return { type: "updated", version: current + 1, previousVersion: current, mutationResult: result }
    },
  }
  const pg = {
    async raw(sql: string) {
      if (sql.includes("from payment_attempt")) {
        return { rows: attempts.map((attempt) => ({ id: attempt.id, status: attempt.status, order_id: null })) }
      }
      if (sql.includes("update payment_attempt")) {
        attempts[0].status = "invalidated_by_cart_change"
        return { rows: [{ id: attempts[0].id }] }
      }
      return { rows: [] }
    },
    async transaction(callback: (trx: unknown) => Promise<unknown>) {
      return callback({ getTransactionContext: () => ({ raw: pg.raw }) })
    },
  }
  const deleteWorkflow = deleteLineItemsWorkflow as unknown as jest.Mock
  const deleteRun = jest.fn()
  deleteWorkflow.mockReset()
  deleteRun.mockImplementation(async ({ input }: any) => {
      cart.items = cart.items.filter((item) => !input.ids.includes(item.id))
      return { result: { cart_id: cart.id } }
  })
  deleteWorkflow.mockReturnValue({ run: deleteRun })

  const request = (key: string, ifMatch = '"1"') => ({
    method: "DELETE",
    params: { id: cart.id },
    body: undefined,
    headers: {
      [GUEST_CART_CAPABILITY_HEADER]: "guest-token-not-persisted",
      "idempotency-key": key,
      "if-match": ifMatch,
    },
    scope: {
      resolve(key: unknown) {
        if (key === GUEST_CART_CAPABILITY_MODULE) return guestCapability
        if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttempt
        if (key === STORE_IDEMPOTENCY_MODULE) return idempotency
        if (key === STORE_RESOURCE_VERSION_MODULE) return versionService
        if (key === ContainerRegistrationKeys.REMOTE_QUERY) return jest.fn(async () => [carts.get(cart.id)])
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return pg
        if (key === Modules.CART) {
          return {
            retrieveCart: async (id: string) =>
              JSON.parse(JSON.stringify(carts.get(id))),
            baseRepository_: {
              transaction: async (callback: (manager: unknown) => Promise<unknown>) =>
                callback({
                  getTransactionContext: () => ({ raw: pg.raw }),
                }),
            },
          }
        }
        throw new Error(`unrecognized scope key ${String(key)}`)
      },
    },
  })

  return { cart, attempts, records, request, response, deleteWorkflow, deleteRun, versions, get claimCount() { return claimCount }, get casCount() { return casCount } }
}

describe("Guest cart line-item clear-all M1", () => {
  it("remove todos os itens em uma chamada nativa, com CAS, invalidation e ETag bump", async () => {
    const harness = createHarness()
    const res = harness.response()

    await clearLineItems(harness.request("guest-clear-01") as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe('"2"')
    expect((res.body as any).cart.items).toHaveLength(0)
    expect(harness.cart.items).toHaveLength(0)
    expect(harness.deleteWorkflow).toHaveBeenCalledTimes(1)
    expect(harness.deleteRun).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        cart_id: harness.cart.id,
        ids: ["li_guest_clear_01", "li_guest_clear_02"],
      },
    }))
    expect(harness.attempts[0].status).toBe("invalidated_by_cart_change")
    expect(harness.records.get("guest-clear-01").state).toBe("completed")
    expect(harness.casCount).toBe(1)
  })

  it("clear vazio é idempotente, não chama workflow nem incrementa a versão", async () => {
    const harness = createHarness()
    harness.cart.items = []
    const res = harness.response()

    await clearLineItems(harness.request("guest-clear-empty") as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe('"1"')
    expect((res.body as any).cart.items).toHaveLength(0)
    expect(harness.deleteWorkflow).not.toHaveBeenCalled()
    expect(harness.casCount).toBe(0)
    expect(harness.records.get("guest-clear-empty").state).toBe("completed")
    expect(harness.attempts[0].status).toBe("created")
  })

  it("replay retorna DTO canônico sem segunda chamada do workflow", async () => {
    const harness = createHarness()
    await clearLineItems(harness.request("guest-clear-replay") as never, harness.response() as never)
    const replay = harness.response()

    await clearLineItems(harness.request("guest-clear-replay", '"2"') as never, replay as never)

    expect(harness.deleteWorkflow).toHaveBeenCalledTimes(1)
    expect(replay.statusCode).toBe(200)
    expect(replay.headers.etag).toBe('"2"')
    expect((replay.body as any).cart.items).toHaveLength(0)
  })

  it("stale If-Match termina a claim e não executa clear", async () => {
    const harness = createHarness()
    harness.versions.set(harness.cart.id, 2)

    await expect(
      clearLineItems(harness.request("guest-clear-stale", '"1"') as never, harness.response() as never)
    ).rejects.toMatchObject({ statusCode: 412, code: "CART_VERSION_MISMATCH" })

    expect(harness.deleteWorkflow).not.toHaveBeenCalled()
    expect(harness.records.get("guest-clear-stale")).toMatchObject({
      state: "failed_terminal",
      failure_code: "CART_VERSION_MISMATCH",
    })
  })
})
