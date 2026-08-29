import {
  DELETE as clearLineItems,
  POST as addLineItem,
} from "../../src/api/store/carts/[id]/line-items/route"
import {
  DELETE as deleteLineItem,
  POST as updateLineItem,
} from "../../src/api/store/carts/[id]/line-items/[line_id]/route"
import {
  addToCartWorkflow,
  deleteLineItemsWorkflow,
  updateLineItemInCartWorkflow,
} from "@medusajs/core-flows"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { GUEST_CART_CAPABILITY_MODULE } from "../../src/modules/guest-cart-capability/types"
import { PAYMENT_ATTEMPT_MODULE } from "../../src/modules/payment-attempt"
import { STORE_IDEMPOTENCY_MODULE } from "../../src/modules/store-idempotency"
import { STORE_RESOURCE_VERSION_MODULE } from "../../src/modules/store-resource-version"
import { issueCustomerAuthAccessToken } from "../../src/modules/customer-auth/jwt"
import { env } from "../../src/config/env"

jest.mock("@medusajs/core-flows", () => ({
  addToCartWorkflow: jest.fn(),
  deleteLineItemsWorkflow: jest.fn(),
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

type SyntheticLineageRow = {
  lineage_id: string
  sid: string
  auth_identity_id: string
  customer_id: string
  credential_version_snapshot: number
  lineage_status: "active" | "revoked" | "expired"
  original_authenticated_at: Date
  absolute_expires_at: Date
  deleted_at: Date | null
}

type SyntheticCredentialRow = {
  auth_identity_id: string
  customer_id: string
  credential_version: number
  operation_status: "stable" | "pending_password_change"
  deleted_at: Date | null
}

function createHarness() {
  const cart = {
    id: "cart_customer_line_items_01",
    customer: { id: "cus_line_items_01", email: "customer@example.test" },
    customer_id: "cus_line_items_01",
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
  const carts = new Map<string, any>([[cart.id, cart]])
  const versions = new Map([[cart.id, 1]])
  const records = new Map<string, any>()
  const attempts = [{ id: "pat_customer_line_items_01", cart_id: cart.id, status: "created" }]
  let lineSequence = 1
  let workflowCalls = 0
  let nativeWorkflowCalls = 0
  let claimCount = 0
  let cart09Calls = 0
  let sessionSequence = 1
  let isDbUnavailable = false
  let authorityQueryCount = 0
  const lineages = new Map<string, SyntheticLineageRow>()
  const credentials = new Map<string, SyntheticCredentialRow>()
  const authorities = new Map<
    string,
    { id: string; customer_id: string; cart_id: string }
  >()

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
      cart09Calls += 1
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
      return callback({ raw: (sql: string, bindings?: unknown[]) => pg.raw(sql, bindings) })
    },
    async raw(sql: string, bindings: unknown[] = []) {
      if (isDbUnavailable) {
        throw new Error("PG_CONNECTION_UNAVAILABLE")
      }

      if (sql.includes("pg_advisory_xact_lock")) {
        return { rows: [] }
      }

      if (sql.includes("customer_cart_authority")) {
        if (sql.trimStart().startsWith("insert into")) {
          const [id, customerId, cartId] = bindings
          authorities.set(String(customerId), {
            id: String(id),
            customer_id: String(customerId),
            cart_id: String(cartId),
          })
          return { rows: [] }
        }
        const customerId = String(bindings[0])
        const authority = authorities.get(customerId)
        return {
          rows: authority
            ? [{ ...authority, state: "active" }]
            : [],
        }
      }

      if (sql.includes("from cart") && sql.includes("customer_id")) {
        const customerId = String(bindings[0])
        return {
          rows: Array.from(carts.values())
            .filter((candidate) => {
              const cartCustomerId =
                candidate.customer_id ?? candidate.customer?.id
              return (
                cartCustomerId === customerId &&
                !candidate.completed_at &&
                candidate.deleted_at == null &&
                candidate.metadata?.active_for_checkout !== false
              )
            })
            .map((candidate) => ({
              id: candidate.id,
              customer_id: candidate.customer_id ?? candidate.customer?.id,
              completed_at: candidate.completed_at ?? null,
              deleted_at: candidate.deleted_at ?? null,
              metadata: candidate.metadata ?? null,
            })),
        }
      }

      if (!sql.includes("auth_session_lineage")) {
        return { rows: [] }
      }

      authorityQueryCount += 1
      const sid = bindings[0]
      const lineage = Array.from(lineages.values()).find(
        (entry) => entry.sid === sid && !entry.deleted_at
      )
      if (!lineage) {
        return { rows: [] }
      }

      const credential = Array.from(credentials.values()).find(
        (entry) =>
          entry.auth_identity_id === lineage.auth_identity_id &&
          !entry.deleted_at
      )
      if (!credential) {
        return { rows: [] }
      }

      return {
        rows: [
          {
            lineage_id: lineage.lineage_id,
            sid: lineage.sid,
            lineage_auth_identity_id: lineage.auth_identity_id,
            lineage_customer_id: lineage.customer_id,
            credential_version_snapshot: lineage.credential_version_snapshot,
            lineage_status: lineage.lineage_status,
            original_authenticated_at: lineage.original_authenticated_at,
            absolute_expires_at: lineage.absolute_expires_at,
            credential_auth_identity_id: credential.auth_identity_id,
            credential_customer_id: credential.customer_id,
            credential_version: credential.credential_version,
            operation_status: credential.operation_status,
          },
        ],
      }
    },
  }
  const cartModule = {
    baseRepository_: {
      async transaction(callback: (transactionManager: unknown) => Promise<unknown>) {
        const transactionContext = {
          async raw(sql: string, bindings: unknown[] = []) {
            if (sql.includes("pg_advisory_xact_lock")) {
              return { rows: [] }
            }

            if (
              sql.includes("select id, status, order_id") &&
              sql.includes("from payment_attempt")
            ) {
              await paymentAttempt.listPaymentAttempts({
                cart_id: String(bindings[0]),
              })
              return {
                rows: attempts.map((attempt) => ({
                  id: attempt.id,
                  status: attempt.status,
                  order_id: null,
                })),
              }
            }

            if (sql.includes("update payment_attempt")) {
              attempts[0].status = "invalidated_by_cart_change"
              return { rows: [{ id: attempts[0].id }] }
            }

            return pg.raw(sql, bindings)
          },
        }

        return callback({
          getTransactionContext: () => transactionContext,
        })
      },
    },
    async retrieveCart(id: string) {
      return carts.get(id) ?? null
    },
    async addLineItems() {},
    async updateLineItems() {},
    async softDeleteLineItems() {},
    async deleteLineItems() {},
    async listLineItems() {
      return []
    },
  }
  const addWorkflow = addToCartWorkflow as unknown as jest.Mock
  const deleteWorkflow = deleteLineItemsWorkflow as unknown as jest.Mock
  const deleteRun = jest.fn()
  const updateWorkflow = updateLineItemInCartWorkflow as unknown as jest.Mock
  const updateRun = jest.fn()
  addWorkflow.mockReset()
  deleteWorkflow.mockReset()
  updateWorkflow.mockReset()
  addWorkflow.mockReturnValue({
    run: async ({ input }: any) => {
      nativeWorkflowCalls += 1
      const targetCart = carts.get(input.cart_id)
      targetCart.items.push({
        id: `li_customer_added_${lineSequence++}`,
        variant_id: input.items[0].variant_id,
        quantity: input.items[0].quantity,
        title: "Camiseta adicionada",
        unit_price: 3990,
      })
      return { result: { cart_id: targetCart.id } }
    },
  })
  updateWorkflow.mockReturnValue({
    run: updateRun.mockImplementation(async ({ input }: any) => {
      nativeWorkflowCalls += 1
      const targetCart = carts.get(input.cart_id)
      const item = targetCart.items.find((entry) => entry.id === input.item_id)
      if (input.update.quantity === 0) {
        targetCart.items = targetCart.items.filter((entry) => entry.id !== input.item_id)
      } else {
        item.quantity = input.update.quantity
      }
      return { result: { cart_id: targetCart.id } }
    }),
  })
  deleteRun.mockImplementation(async ({ input }: any) => {
      nativeWorkflowCalls += 1
      const targetCart = carts.get(input.cart_id)
      targetCart.items = targetCart.items.filter((item: any) => !input.ids.includes(item.id))
      return { result: { cart_id: targetCart.id } }
  })
  deleteWorkflow.mockReturnValue({ run: deleteRun })

  const remoteQuery = jest.fn(async (queryObj: any) => {
    const queryEntry = queryObj?.__value
      ? Object.values(queryObj.__value)[0] as any
      : undefined
    const filters =
      queryEntry?.__args?.filters ??
      queryObj?.variables?.filters ??
      queryObj?.filters ??
      {}

    if (filters.id) {
      const target = carts.get(filters.id)
      return target ? [target] : []
    }

    if (filters.customer_id) {
      return Array.from(carts.values()).filter(
        (candidate) =>
          !candidate.completed_at &&
          (candidate.customer?.id ?? candidate.customer_id) === filters.customer_id
      )
    }

    return [cart]
  })

  function createCustomerSession(customerId: string) {
    const sequence = sessionSequence++
    const sid = `sid_${customerId}_${sequence}`
    const authIdentityId = `ident_${customerId}_${sequence}`
    const credentialVersion = 1
    const originalAuthenticatedAt = new Date(
      Math.floor((Date.now() - 60_000) / 1000) * 1000
    )
    const absoluteExpiresAt = new Date(
      originalAuthenticatedAt.getTime() + 30 * 24 * 60 * 60 * 1000
    )

    lineages.set(sid, {
      lineage_id: `lin_${sequence}`,
      sid,
      auth_identity_id: authIdentityId,
      customer_id: customerId,
      credential_version_snapshot: credentialVersion,
      lineage_status: "active",
      original_authenticated_at: originalAuthenticatedAt,
      absolute_expires_at: absoluteExpiresAt,
      deleted_at: null,
    })
    credentials.set(authIdentityId, {
      auth_identity_id: authIdentityId,
      customer_id: customerId,
      credential_version: credentialVersion,
      operation_status: "stable",
      deleted_at: null,
    })

    const { token } = issueCustomerAuthAccessToken({
      secret: env.JWT_SECRET,
      authIdentityId,
      customerId,
      sid,
      credentialVersion,
      originalAuthenticatedAt,
      absoluteExpiresAt,
      now: new Date(),
    })

    return { token, customerId }
  }

  const request = (
    kind: "add" | "update" | "delete" | "clear",
    key: string,
    quantity = 0,
    ifMatch = '"1"',
    options: {
      authorization?: string
      omitIdempotencyKey?: boolean
      body?: unknown
      lineId?: string
      cartId?: string
    } = {}
  ) => {
    const targetCart = carts.get(options.cartId ?? cart.id) ?? cart

    return {
    method: kind === "add" || kind === "update" ? "POST" : "DELETE",
    params: {
      id: targetCart.id,
      ...(kind === "update" || kind === "delete"
        ? { line_id: options.lineId ?? targetCart.items[0]?.id }
        : {}),
    },
    body:
      options.body ??
      (kind === "add"
        ? { variant_id: "variant_customer_add_01", quantity }
        : kind === "update"
          ? { quantity }
          : undefined),
    headers: {
      ...(options.authorization
        ? { authorization: options.authorization }
        : {}),
      ...(!options.omitIdempotencyKey ? { "idempotency-key": key } : {}),
      "if-match": ifMatch,
    },
    scope: (() => {
      const parentResolve = (keyToResolve: unknown) => {
        if (keyToResolve === GUEST_CART_CAPABILITY_MODULE) return guestCapability
        if (keyToResolve === PAYMENT_ATTEMPT_MODULE) return paymentAttempt
        if (keyToResolve === STORE_IDEMPOTENCY_MODULE) return idempotency
        if (keyToResolve === STORE_RESOURCE_VERSION_MODULE) return versionService
        if (keyToResolve === ContainerRegistrationKeys.REMOTE_QUERY) return remoteQuery
        if (keyToResolve === ContainerRegistrationKeys.PG_CONNECTION) return pg
        if (keyToResolve === Modules.CART) return cartModule
        throw new Error(`unrecognized scope key ${String(keyToResolve)}`)
      }
      return {
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
    })(),
    }
  }

  function addCustomerCart(input: {
    id: string
    updatedAt: string
    lineId?: string
  }) {
    const customerId = cart.customer_id ?? cart.customer?.id
    const customerCart = {
      id: input.id,
      customer: { id: customerId, email: cart.customer?.email },
      customer_id: customerId,
      items: [
        {
          id: input.lineId ?? `${input.id}_line_01`,
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
      created_at: input.updatedAt,
      updated_at: input.updatedAt,
    }
    carts.set(customerCart.id, customerCart)
    versions.set(customerCart.id, 1)
    authorities.set(customerId, {
      id: `ccauth_${input.id}`,
      customer_id: customerId,
      cart_id: input.id,
    })
    return customerCart
  }

  return {
    cart,
    carts,
    addCustomerCart,
    attempts,
    records,
    request,
    response,
    addWorkflow,
    deleteWorkflow,
    deleteRun,
    updateWorkflow,
    updateRun,
    get workflowCalls() {
      return workflowCalls
    },
    get nativeWorkflowCalls() {
      return nativeWorkflowCalls
    },
    get claimCount() {
      return claimCount
    },
    get casCalls() {
      return workflowCalls
    },
    get cart09Calls() {
      return cart09Calls
    },
    get authorityQueryCount() {
      return authorityQueryCount
    },
    createCustomerSession,
    setDbUnavailable(value: boolean) {
      isDbUnavailable = value
    },
    setCartCustomer(customerId: string | null) {
      cart.customer = customerId ? { id: customerId } : null
      cart.customer_id = customerId
    },
    setCartUpdatedAt(updatedAt: string) {
      cart.updated_at = updatedAt
    },
  }
}

describe("Customer cart line-items M1", () => {
  it("nega ADD no cart A antigo quando o mesmo Customer tem cart B canônico mais novo", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    harness.setCartUpdatedAt("2026-08-20T00:00:00.000Z")
    const canonicalCart = harness.addCustomerCart({
      id: "cart_customer_canonical_b",
      updatedAt: "2026-08-21T00:00:00.000Z",
    })

    await expect(
      addLineItem(
        harness.request("add", "customer-noncanonical-add", 1, '"1"', {
          authorization: `Bearer ${session.token}`,
          cartId: harness.cart.id,
        }) as never,
        harness.response() as never
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })

    expect(canonicalCart.id).not.toBe(harness.cart.id)
    expect(harness.claimCount).toBe(0)
    expect(harness.casCalls).toBe(0)
    expect(harness.nativeWorkflowCalls).toBe(0)
    expect(harness.cart09Calls).toBe(0)
    expect(harness.cart.items).toHaveLength(1)
  })

  it("permite ADD no cart B canônico mais novo e executa claim, CAS, workflow e CART-09", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    harness.setCartUpdatedAt("2026-08-20T00:00:00.000Z")
    const canonicalCart = harness.addCustomerCart({
      id: "cart_customer_canonical_b",
      updatedAt: "2026-08-21T00:00:00.000Z",
    })

    const res = harness.response()
    await addLineItem(
      harness.request("add", "customer-canonical-add", 1, '"1"', {
        authorization: `Bearer ${session.token}`,
        cartId: canonicalCart.id,
      }) as never,
      res as never
    )

    expect(res.statusCode).toBe(200)
    expect(canonicalCart.items.at(-1)?.quantity).toBe(1)
    expect(harness.claimCount).toBe(1)
    expect(harness.casCalls).toBe(1)
    expect(harness.nativeWorkflowCalls).toBe(1)
    expect(harness.cart09Calls).toBe(1)
  })

  it("nega UPDATE no cart A antigo quando o mesmo Customer tem cart B canônico mais novo", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    harness.setCartUpdatedAt("2026-08-20T00:00:00.000Z")
    const canonicalCart = harness.addCustomerCart({
      id: "cart_customer_canonical_b",
      updatedAt: "2026-08-21T00:00:00.000Z",
    })

    await expect(
      updateLineItem(
        harness.request("update", "customer-noncanonical-update", 2, '"1"', {
          authorization: `Bearer ${session.token}`,
          cartId: harness.cart.id,
          lineId: harness.cart.items[0].id,
        }) as never,
        harness.response() as never
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })

    expect(canonicalCart.id).not.toBe(harness.cart.id)
    expect(harness.claimCount).toBe(0)
    expect(harness.casCalls).toBe(0)
    expect(harness.nativeWorkflowCalls).toBe(0)
    expect(harness.cart09Calls).toBe(0)
    expect(harness.cart.items[0].quantity).toBe(1)
  })

  it("permite UPDATE no cart B canônico mais novo e executa workflow nativo, CAS e CART-09", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    harness.setCartUpdatedAt("2026-08-20T00:00:00.000Z")
    const canonicalCart = harness.addCustomerCart({
      id: "cart_customer_canonical_b",
      updatedAt: "2026-08-21T00:00:00.000Z",
    })

    const res = harness.response()
    await updateLineItem(
      harness.request("update", "customer-canonical-update", 2, '"1"', {
        authorization: `Bearer ${session.token}`,
        cartId: canonicalCart.id,
        lineId: canonicalCart.items[0].id,
      }) as never,
      res as never
    )

    expect(res.statusCode).toBe(200)
    expect(canonicalCart.items[0].quantity).toBe(2)
    expect(harness.claimCount).toBe(1)
    expect(harness.casCalls).toBe(1)
    expect(harness.nativeWorkflowCalls).toBe(1)
    expect(harness.cart09Calls).toBe(1)
  })

  it.each([1, 99])("adiciona quantity %s com Customer auth e sem capability guest", async (quantity) => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    const res = harness.response()

    await addLineItem(
      harness.request("add", `customer-add-${quantity}`, quantity, '"1"', {
        authorization: `Bearer ${session.token}`,
      }) as never,
      res as never
    )

    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe('"2"')
    expect((res.body as any).cart.customer.id).toBe("cus_line_items_01")
    expect(harness.cart.items.at(-1)?.quantity).toBe(quantity)
    expect(harness.attempts[0].status).toBe("invalidated_by_cart_change")
    expect(harness.addWorkflow).toHaveBeenCalledTimes(1)
    expect(harness.authorityQueryCount).toBeGreaterThan(0)
  })

  it("atualiza e remove quantity 0 no cart do Customer, usando o workflow nativo", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    const res = harness.response()

    await updateLineItem(
      harness.request("update", "customer-update-remove", 0, '"1"', {
        authorization: `Bearer ${session.token}`,
      }) as never,
      res as never
    )

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
    expect(harness.authorityQueryCount).toBeGreaterThan(0)
  })

  it("permite DELETE by line_id no cart canônico do Customer", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    const res = harness.response()

    await deleteLineItem(
      harness.request("delete", "customer-delete-line", 0, '"1"', {
        authorization: `Bearer ${session.token}`,
      }) as never,
      res as never
    )

    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe('"2"')
    expect(harness.cart.items).toHaveLength(0)
    expect(harness.deleteRun).toHaveBeenCalledWith(expect.objectContaining({
      input: {
        cart_id: harness.cart.id,
        ids: ["li_customer_line_items_01"],
      },
    }))
    expect(harness.nativeWorkflowCalls).toBe(1)
    expect(harness.authorityQueryCount).toBeGreaterThan(0)
  })

  it("permite clear-all no cart do Customer com uma única chamada nativa", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    const res = harness.response()

    await clearLineItems(
      harness.request("clear", "customer-clear-all", 0, '"1"', {
        authorization: `Bearer ${session.token}`,
      }) as never,
      res as never
    )

    expect(res.statusCode).toBe(200)
    expect(res.headers.etag).toBe('"2"')
    expect(harness.cart.items).toHaveLength(0)
    expect(harness.deleteWorkflow).toHaveBeenCalledTimes(1)
    expect(harness.nativeWorkflowCalls).toBe(1)
    expect(harness.authorityQueryCount).toBeGreaterThan(0)
  })

  it("não permite corpo de update com campo de autoridade e não cria claim", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    const req = harness.request("update", "customer-authority-field", 2, '"1"', {
      authorization: `Bearer ${session.token}`,
      body: { quantity: 2, cart_id: "cart_other" },
    }) as any

    await expect(updateLineItem(req, harness.response() as never)).rejects.toMatchObject({
      type: MedusaError.Types.INVALID_DATA,
    })
    expect(harness.records.size).toBe(0)
    expect(harness.claimCount).toBe(0)
    expect(harness.workflowCalls).toBe(0)
  })

  it("rejeita Authorization inválida antes de claim e workflow", async () => {
    const harness = createHarness()
    const invalidAuthRequest = harness.request("add", "add-invalid-auth", 1, '"1"', {
      authorization: "Bearer invalid.jwt.garbage",
    })

    await expect(
      addLineItem(
        invalidAuthRequest as never,
        harness.response() as never
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.UNAUTHORIZED })

    expect(harness.claimCount).toBe(0)
    expect(harness.workflowCalls).toBe(0)
    expect(harness.authorityQueryCount).toBe(0)
  })

  it("preserva 503 quando a autoridade PostgreSQL está indisponível", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    harness.setDbUnavailable(true)

    const error = await addLineItem(
      harness.request("add", "add-authority-unavailable", 1, '"1"', {
        authorization: `Bearer ${session.token}`,
      }) as never,
      harness.response() as never
    ).catch((caught) => caught)

    expect(error).toMatchObject({ statusCode: 503 })
    expect(harness.claimCount).toBe(0)
    expect(harness.workflowCalls).toBe(0)
    expect(harness.authorityQueryCount).toBe(0)
  })

  it("não permite Customer mutar cart de outro Customer", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_other")
    harness.setCartCustomer("cus_line_items_01")

    await expect(
      addLineItem(
        harness.request("add", "add-wrong-customer", 1, '"1"', {
          authorization: `Bearer ${session.token}`,
          body: { variant_id: "variant_customer_add_01", quantity: 1.5 },
        }) as never,
        harness.response() as never
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })

    expect(harness.claimCount).toBe(0)
    expect(harness.workflowCalls).toBe(0)
  })

  it("não permite Customer mutar Guest cart e ownership precede line_id inválido", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_line_items_01")
    harness.setCartCustomer(null)

    await expect(
      updateLineItem(
        harness.request("update", "update-guest-cart", 1, '"1"', {
          authorization: `Bearer ${session.token}`,
          lineId: "",
        }) as never,
        harness.response() as never
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })

    expect(harness.claimCount).toBe(0)
    expect(harness.workflowCalls).toBe(0)
  })

  it("não concede acesso somente com Idempotency-Key", async () => {
    const harness = createHarness()

    await expect(
      addLineItem(
        harness.request("add", "idempotency-only", 1) as never,
        harness.response() as never
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })

    expect(harness.claimCount).toBe(0)
    expect(harness.workflowCalls).toBe(0)
  })

  it("prioriza ownership sobre body inválido e Idempotency-Key ausente", async () => {
    const harness = createHarness()
    const session = harness.createCustomerSession("cus_other")
    harness.setCartCustomer("cus_line_items_01")

    await expect(
      addLineItem(
        harness.request("add", "wrong-owner-no-key", 1, '"1"', {
          authorization: `Bearer ${session.token}`,
          body: { variant_id: "variant_customer_add_01", quantity: 1.5 },
          omitIdempotencyKey: true,
        }) as never,
        harness.response() as never
      )
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })

    expect(harness.claimCount).toBe(0)
    expect(harness.workflowCalls).toBe(0)
  })
})
