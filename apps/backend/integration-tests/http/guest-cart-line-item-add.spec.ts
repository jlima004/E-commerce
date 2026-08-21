import { POST as addLineItem } from "../../src/api/store/carts/[id]/line-items/route"
import { addToCartWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../src/modules/guest-cart-capability/types"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import { STORE_IDEMPOTENCY_MODULE } from "../../src/modules/store-idempotency"
import { STORE_RESOURCE_VERSION_MODULE } from "../../src/modules/store-resource-version"
import { toStoreErrorResponse } from "../../src/api/store-surface/errors"

jest.mock("@medusajs/core-flows", () => ({
  addToCartWorkflow: jest.fn(),
  updateLineItemInCartWorkflow: jest.fn(),
}))

type Cart = {
  id: string
  customer?: { id: string; email?: string } | null
  items: Array<Record<string, unknown>>
  currency_code: string
  region_id: string
  metadata: Record<string, unknown>
  completed_at: null
  created_at: string
  updated_at: string
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
  const cart: Cart = {
    id: "cart_guest_add_01",
    customer: null,
    items: [],
    currency_code: "brl",
    region_id: "reg_br",
    metadata: { active_for_checkout: true },
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const versions = new Map([[cart.id, 1]])
  const records = new Map<string, any>()
  const attempts = [
    {
      id: "pat_guest_add_01",
      cart_id: cart.id,
      status: "created",
    },
  ]
  let lineSequence = 1
  let mutationCount = 0
  let claimCount = 0

  const idempotency = {
    async claim(input: any) {
      claimCount += 1
      const existing = records.get(input.rawIdempotencyKey)
      if (existing) {
        if (existing.state === "completed" || existing.state === "failed_terminal") {
          return { type: "replay", record: existing }
        }
        if (existing.state === "processing") {
          return { type: "in_progress", record: existing }
        }
        return { type: "conflict", record: existing, publicCode: "IDEMPOTENCY_KEY_REUSE_CONFLICT" }
      }
      const record = {
        id: `idem_${records.size + 1}`,
        state: "processing",
        state_version: 1,
        retry_attempt_count: 0,
        failure_code: null,
        result_id: null,
        result_type: null,
      }
      records.set(input.rawIdempotencyKey, record)
      return { type: "claimed", record }
    },
    async markCompleted(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "completed"
      record.state_version += 1
      record.result_id = input.result_id
      record.result_type = input.result_type
      return { type: "claimed", record }
    },
    async recordProcessingResult(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state_version += 1
      record.result_id = input.result_id
      record.result_type = input.result_type
      return { type: "claimed", record }
    },
    async markFailedTerminal(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "failed_terminal"
      record.state_version += 1
      record.failure_code = input.failure_code
      record.result_id = input.result_id ?? record.result_id
      return { type: "claimed", record }
    },
    async markFailedRetryable(input: any) {
      const record = [...records.values()].find((item) => item.id === input.id)
      record.state = "failed_retryable"
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
        id: "gccap_guest_add_01",
        cart_id: cart.id,
        token_hash: "hash_guest_add_01",
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
  }

  const paymentAttempt = {
    async listPaymentAttempts() {
      return attempts
    },
    async updatePaymentAttempts(next: any) {
      const current = attempts.find((item) => item.id === next.id)
      Object.assign(current, next)
    },
  }

  const remoteQuery = jest.fn(async () => [cart])
  const versionService = {
    async initialize(_type: string, id: string) {
      return { id: `strver_${id}`, resource_type: "cart", resource_id: id, version: versions.get(id) ?? 1 }
    },
    async compareAndSwapWithMutation(input: any) {
      const current = versions.get(input.resourceId) ?? 1
      if (current !== input.expectedVersion) {
        return { type: "stale", actualVersion: current, expectedVersion: input.expectedVersion }
      }
      mutationCount += 1
      const mutationResult = await input.mutate(input.sharedContext)
      versions.set(input.resourceId, current + 1)
      return { type: "updated", version: current + 1, previousVersion: current, mutationResult }
    },
  }
  const pg = {
    async transaction(callback: (trx: unknown) => Promise<unknown>) {
      return callback({ raw: async () => ({ rows: [] }) })
    },
  }

  const addWorkflow = addToCartWorkflow as unknown as jest.Mock
  addWorkflow.mockReset()
  addWorkflow.mockReturnValue({
    run: async ({ input }: any) => {
      cart.items.push({
        id: `li_guest_add_${lineSequence++}`,
        variant_id: input.items[0].variant_id,
        quantity: input.items[0].quantity,
        title: "Camiseta",
        unit_price: 3990,
      })
      cart.updated_at = new Date(Date.now() + mutationCount).toISOString()
      return { result: { cart_id: cart.id } }
    },
  })

  const request = (key: string, quantity: unknown, ifMatch = '"1"') => ({
    method: "POST",
    params: { id: cart.id },
    body: { variant_id: "variant_guest_add_01", quantity },
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
        if (key === ContainerRegistrationKeys.REMOTE_QUERY) return remoteQuery
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return pg
        throw new Error(`unrecognized scope key ${String(key)}`)
      },
    },
  })

  return {
    cart,
    attempts,
    records,
    versions,
    request,
    response,
    addWorkflow,
    remoteQuery,
    get claimCount() {
      return claimCount
    },
    get mutationCount() {
      return mutationCount
    },
    setVersion(version: number) {
      versions.set(cart.id, version)
    },
  }
}

describe("Guest cart line-item add M1", () => {
  it("valida quantity antes do claim e não cria processing para entrada inválida", async () => {
    const harness = createHarness()
    const res = response()

    await expect(addLineItem(harness.request("guest-add-invalid", 1.5) as never, res as never)).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })

    expect(harness.claimCount).toBe(0)
    expect(harness.records.size).toBe(0)
    expect(harness.cart.items).toHaveLength(0)
  })

  it.each([1, 99])("aceita quantity %s, invalida PaymentAttempt e responde com ETag atual", async (quantity) => {
    const harness = createHarness()
    const res = response()

    await addLineItem(harness.request(`guest-add-${quantity}`, quantity) as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe('"2"')
    expect((res.body as any).cart.id).toBe(harness.cart.id)
    expect(harness.cart.items[0].quantity).toBe(quantity)
    expect(harness.attempts[0].status).toBe("invalidated_by_cart_change")
    expect(harness.records.get(`guest-add-${quantity}`).state).toBe("completed")
    expect(harness.records.get(`guest-add-${quantity}`).result_id).toBe(harness.cart.id)
  })

  it("replay de sucesso refaz refetch canônico, devolve ETag atual e não chama workflow", async () => {
    const harness = createHarness()
    const first = response()
    await addLineItem(harness.request("guest-add-replay", 1) as never, first as never)
    harness.cart.updated_at = new Date(Date.now() + 120_000).toISOString()
    harness.setVersion(3)
    const before = harness.mutationCount
    const replay = response()

    await addLineItem(harness.request("guest-add-replay", 1, '"3"') as never, replay as never)

    expect(replay.statusCode).toBe(200)
    expect(replay.headers.etag).toBe('"3"')
    expect((replay.body as any).cart.updated_at).toBe(harness.cart.updated_at)
    expect(harness.mutationCount).toBe(before)
    expect(harness.addWorkflow).toHaveBeenCalledTimes(1)
  })

  it("stale If-Match terminaliza como CART_VERSION_MISMATCH e o replay da mesma chave segue 412 sem mutação", async () => {
    const harness = createHarness()
    harness.setVersion(2)
    const staleRequest = harness.request("guest-add-stale", 1, '"1"')
    const staleResponse = response()

    const staleError = await addLineItem(staleRequest as never, staleResponse as never).catch((error) => error)
    expect(staleError).toMatchObject({ code: "CART_VERSION_MISMATCH", statusCode: 412 })
    expect(harness.records.get("guest-add-stale")).toMatchObject({
      state: "failed_terminal",
      failure_code: "CART_VERSION_MISMATCH",
    })
    expect(harness.cart.items).toHaveLength(0)
    expect(toStoreErrorResponse(staleError).statusCode).toBe(412)

    const before = harness.mutationCount
    const replayError = await addLineItem(
      harness.request("guest-add-stale", 1, '"1"') as never,
      response() as never
    ).catch((error) => error)
    expect(replayError).toMatchObject({ code: "CART_VERSION_MISMATCH", statusCode: 412 })
    expect(harness.mutationCount).toBe(before)
    expect(harness.addWorkflow).not.toHaveBeenCalled()
  })
})
