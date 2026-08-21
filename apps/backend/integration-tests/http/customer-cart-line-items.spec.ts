import { POST as addLineItem } from "../../src/api/store/carts/[id]/line-items/route"
import { POST as updateLineItem } from "../../src/api/store/carts/[id]/line-items/[line_id]/route"
import {
  addToCartWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { GUEST_CART_CAPABILITY_MODULE } from "../../src/modules/guest-cart-capability/types"
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
    id: "cart_customer_line_items_01",
    customer: { id: "cus_line_items_01", email: "customer@example.test" },
    items: [
      {
        id: "li_customer_line_items_01",
        variant_id: "variant_customer_existing_01",
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
  const attempts = [{ id: "pat_customer_line_items_01", cart_id: cart.id, status: "created" }]
  let lineSequence = 1
  let workflowCalls = 0

  const idempotency = {
    async claim(input: any) {
      const existing = records.get(input.rawIdempotencyKey)
      if (existing) {
        if (existing.state === "completed" || existing.state === "failed_terminal") {
          return { type: "replay", record: existing }
        }
        return { type: "in_progress", record: existing }
      }
      const record = {
        id: `idem_customer_${records.size + 1}`,
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
      throw new Error("CUSTOMER_MUST_NOT_LOOKUP_GUEST_CAPABILITY")
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
      workflowCalls += 1
      const result = await input.mutate(input.sharedContext)
      versions.set(input.resourceId, current + 1)
      return { type: "updated", version: current + 1, previousVersion: current, mutationResult: result }
    },
  }
  const pg = {
    async transaction(callback: (trx: unknown) => Promise<unknown>) {
      return callback({ raw: async () => ({ rows: [] }) })
    },
  }
  const addWorkflow = addToCartWorkflow as unknown as jest.Mock
  const updateWorkflow = updateLineItemInCartWorkflow as unknown as jest.Mock
  const updateRun = jest.fn()
  addWorkflow.mockReset()
  updateWorkflow.mockReset()
  addWorkflow.mockReturnValue({
    run: async ({ input }: any) => {
      cart.items.push({
        id: `li_customer_added_${lineSequence++}`,
        variant_id: input.items[0].variant_id,
        quantity: input.items[0].quantity,
        title: "Camiseta adicionada",
        unit_price: 3990,
      })
      return { result: { cart_id: cart.id } }
    },
  })
  updateWorkflow.mockReturnValue({
    run: updateRun.mockImplementation(async ({ input }: any) => {
      const item = cart.items.find((entry) => entry.id === input.item_id)
      if (input.update.quantity === 0) {
        cart.items = cart.items.filter((entry) => entry.id !== input.item_id)
      } else {
        item.quantity = input.update.quantity
      }
      return { result: { cart_id: cart.id } }
    }),
  })

  const request = (
    kind: "add" | "update",
    key: string,
    quantity: number,
    ifMatch = '"1"'
  ) => ({
    method: "POST",
    params: {
      id: cart.id,
      ...(kind === "update" ? { line_id: "li_customer_line_items_01" } : {}),
    },
    body:
      kind === "add"
        ? { variant_id: "variant_customer_add_01", quantity }
        : { quantity },
    headers: {
      "idempotency-key": key,
      "if-match": ifMatch,
    },
    customerAuth: { customerId: "cus_line_items_01" },
    scope: {
      resolve(key: unknown) {
        if (key === GUEST_CART_CAPABILITY_MODULE) return guestCapability
        if (key === PAYMENT_ATTEMPT_MODULE) return paymentAttempt
        if (key === STORE_IDEMPOTENCY_MODULE) return idempotency
        if (key === STORE_RESOURCE_VERSION_MODULE) return versionService
        if (key === ContainerRegistrationKeys.REMOTE_QUERY) return jest.fn(async () => [cart])
        if (key === ContainerRegistrationKeys.PG_CONNECTION) return pg
        throw new Error(`unrecognized scope key ${String(key)}`)
      },
    },
  })

  return {
    cart,
    attempts,
    records,
    request,
    response,
    addWorkflow,
    updateWorkflow,
    updateRun,
    get workflowCalls() {
      return workflowCalls
    },
  }
}

describe("Customer cart line-items M1", () => {
  it.each([1, 99])("adiciona quantity %s com Customer auth e sem capability guest", async (quantity) => {
    const harness = createHarness()
    const res = harness.response()

    await addLineItem(harness.request("add", `customer-add-${quantity}`, quantity) as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe('"2"')
    expect((res.body as any).cart.customer.id).toBe("cus_line_items_01")
    expect(harness.cart.items.at(-1)?.quantity).toBe(quantity)
    expect(harness.attempts[0].status).toBe("invalidated_by_cart_change")
    expect(harness.addWorkflow).toHaveBeenCalledTimes(1)
  })

  it("atualiza e remove quantity 0 no cart do Customer, usando o workflow nativo", async () => {
    const harness = createHarness()
    const res = harness.response()

    await updateLineItem(harness.request("update", "customer-update-remove", 0) as never, res as never)

    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe('"2"')
    expect(harness.cart.items).toHaveLength(0)
    expect(harness.updateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          cart_id: harness.cart.id,
          item_id: "li_customer_line_items_01",
          update: { quantity: 0 },
        }),
      })
    )
    expect(harness.workflowCalls).toBe(1)
  })

  it("não permite corpo de update com campo de autoridade e não cria claim", async () => {
    const harness = createHarness()
    const req = harness.request("update", "customer-authority-field", 2) as any
    req.body = { quantity: 2, cart_id: "cart_other" }

    await expect(updateLineItem(req, harness.response() as never)).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
    expect(harness.records.size).toBe(0)
    expect(harness.workflowCalls).toBe(0)
  })
})
