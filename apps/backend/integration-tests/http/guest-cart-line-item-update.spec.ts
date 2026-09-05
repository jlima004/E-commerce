import { POST as updateLineItem } from "../../src/api/store/carts/[id]/line-items/[line_id]/route"
import { updateLineItemInCartWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
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
    id: "cart_guest_update_01",
    customer: null,
    items: [
      {
        id: "li_guest_update_01",
        variant_id: "variant_guest_update_01",
        quantity: 1,
        title: "Camiseta",
        unit_price: 3990,
      },
    ],
    currency_code: "brl",
    region_id: "reg_br",
    metadata: { active_for_checkout: true },
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const versions = new Map([[cart.id, 1]])
  const records = new Map<string, any>()
  const attempts = [{ id: "pat_guest_update_01", cart_id: cart.id, status: "created" }]
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
        id: "gccap_guest_update_01",
        cart_id: cart.id,
        token_hash: "hash_guest_update_01",
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
  const carts = new Map([[cart.id, cart]])
  let requestedCartId = cart.id
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
      const result = await input.mutate(input.sharedContext)
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
  const updateWorkflow = updateLineItemInCartWorkflow as unknown as jest.Mock
  updateWorkflow.mockReset()
  updateWorkflow.mockReturnValue({
    run: async ({ input }: any) => {
      const item = cart.items.find((entry) => entry.id === input.item_id)
      if (input.update.quantity === 0) {
        cart.items = cart.items.filter((entry) => entry.id !== input.item_id)
      } else {
        item.quantity = input.update.quantity
      }
      return { result: { cart_id: cart.id } }
    },
  })
  const request = (
    key: string,
    quantity: unknown,
    ifMatch = '"1"',
    options: { cartId?: string } = {}
  ) => {
    requestedCartId = options.cartId ?? cart.id
    const parentResolve = (keyToResolve: unknown) => {
      if (keyToResolve === GUEST_CART_CAPABILITY_MODULE) return guestCapability
      if (keyToResolve === PAYMENT_ATTEMPT_MODULE) return paymentAttempt
      if (keyToResolve === STORE_IDEMPOTENCY_MODULE) return idempotency
      if (keyToResolve === STORE_RESOURCE_VERSION_MODULE) return versionService
      if (keyToResolve === ContainerRegistrationKeys.REMOTE_QUERY) {
        return jest.fn(async () =>
          carts.has(requestedCartId) ? [carts.get(requestedCartId)] : []
        )
      }
      if (keyToResolve === ContainerRegistrationKeys.PG_CONNECTION) return pg
      if (keyToResolve === Modules.CART) {
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
      throw new Error(`unrecognized scope key ${String(keyToResolve)}`)
    }
    const scope = {
      createScope() {
        const overrides = new Map<unknown, { resolve(): unknown }>()
        const child = {
          register(keyToRegister: unknown, override: { resolve(): unknown }) {
            overrides.set(keyToRegister, override)
            return child
          },
          resolve(keyToResolve: unknown) {
            const override = overrides.get(keyToResolve)
            return override ? override.resolve() : parentResolve(keyToResolve)
          },
        }
        return child
      },
      resolve: parentResolve,
    }
    return ({
    method: "POST",
    params: { id: options.cartId ?? cart.id, line_id: "li_guest_update_01" },
    body: { quantity },
    headers: {
      [GUEST_CART_CAPABILITY_HEADER]: "guest-token-not-persisted",
      "idempotency-key": key,
      "if-match": ifMatch,
    },
    scope,
    })
  }
  return {
    cart,
    attempts,
    records,
    request,
    response,
    updateWorkflow,
    get mutationCount() { return mutationCount },
    get claimCount() { return claimCount },
    addGuestCart(cartId: string) {
      carts.set(cartId, {
        ...cart,
        id: cartId,
        customer: null,
        items: cart.items.map((item) => ({ ...item })),
      })
      versions.set(cartId, 1)
    },
  }
}

describe("Guest cart line-item update M1", () => {
  it("capability do Guest cart A não autoriza POST de line-item no Guest cart B", async () => {
    const harness = createHarness()
    const cartA = harness.cart.id
    const cartB = "cart_guest_update_02"
    harness.addGuestCart(cartB)

    await expect(
      updateLineItem(
        harness.request("guest-update-cross-cart", 2, '"1"', { cartId: cartB }) as never,
        harness.response() as never
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })

    expect(cartA).not.toBe(cartB)
    expect(harness.claimCount).toBe(0)
    expect(harness.mutationCount).toBe(0)
    expect(harness.updateWorkflow).not.toHaveBeenCalled()
    expect(harness.cart.items[0].quantity).toBe(1)
  })

  it("capability do Guest cart A permite update no próprio cart A", async () => {
    const harness = createHarness()

    await updateLineItem(
      harness.request("guest-update-same-cart", 2) as never,
      harness.response() as never
    )

    expect(harness.claimCount).toBe(1)
    expect(harness.mutationCount).toBe(1)
    expect(harness.updateWorkflow).toHaveBeenCalledTimes(1)
  })

  it.each([1.1, 98.9])("rejeita decimal genuíno %s antes do claim", async (quantity) => {
    const harness = createHarness()
    await expect(updateLineItem(harness.request(`guest-update-invalid-${quantity}`, quantity) as never, harness.response() as never)).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
    expect(harness.records.size).toBe(0)
    expect(harness.cart.items[0].quantity).toBe(1)
  })

  it("atualiza quantity 2, bumpa ETag e invalida PaymentAttempt", async () => {
    const harness = createHarness()
    const res = harness.response()
    await updateLineItem(harness.request("guest-update-2", 2) as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe('"2"')
    expect((res.body as any).cart.items[0].quantity).toBe(2)
    expect(harness.cart.items[0].quantity).toBe(2)
    expect(harness.attempts[0].status).toBe("invalidated_by_cart_change")
    expect(harness.records.get("guest-update-2").state).toBe("completed")
  })

  it("trata quantity 0 como remoção pela updateLineItemInCartWorkflow", async () => {
    const harness = createHarness()
    const res = harness.response()
    await updateLineItem(harness.request("guest-update-remove", 0) as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe('"2"')
    expect((res.body as any).cart.items).toHaveLength(0)
    expect(harness.cart.items).toHaveLength(0)
    expect(harness.updateWorkflow).toHaveBeenCalledTimes(1)
    expect(harness.records.get("guest-update-remove").state).toBe("completed")
  })
})
