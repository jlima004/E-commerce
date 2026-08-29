import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { CART_MERGE_MODULE } from "../../../modules/cart-merge/module-id"
import { reconcileTerminalCustomerCartAuthority } from "../customer-cart-authority"

type Authority = {
  id: string
  customer_id: string
  cart_id: string
  state: "active" | "superseded"
}

function buildHarness(overrides: {
  cart?: Record<string, unknown> | null
  authorities?: Authority[]
} = {}) {
  const authorities: Authority[] = overrides.authorities ?? [
    {
      id: "ccauth_01",
      customer_id: "cus_01",
      cart_id: "cart_01",
      state: "active",
    },
  ]
  const cart =
    "cart" in overrides
      ? overrides.cart
      : {
          id: "cart_01",
          customer_id: "cus_01",
          completed_at: new Date("2026-08-29T12:00:00.000Z"),
          deleted_at: null,
        }
  const raw = jest.fn(async () => ({ rows: [] }))
  const listCustomerCartAuthorities = jest.fn(
    async (filters?: Record<string, unknown>) =>
      authorities.filter((authority) =>
        Object.entries(filters ?? {}).every(
          ([key, value]) => authority[key as keyof Authority] === value
        )
      )
  )
  const supersedeCustomerCartAuthority = jest.fn(
    async (input: {
      authority_id: string
      customer_id: string
      cart_id: string
    }) => {
      const authority = authorities.find(
        (candidate) => candidate.id === input.authority_id
      )
      if (authority) {
        authority.state = "superseded"
      }
      return { type: "superseded" as const }
    }
  )
  const container = {
    resolve: jest.fn((key: string) => {
      if (key === CART_MERGE_MODULE) {
        return {
          listCustomerCartAuthorities,
          supersedeCustomerCartAuthority,
        }
      }
      if (key === Modules.CART) {
        return {
          retrieveCart: jest.fn(async () => cart),
        }
      }
      if (key === ContainerRegistrationKeys.PG_CONNECTION) {
        return {
          transaction: jest.fn(async (callback) =>
            callback({ raw })
          ),
        }
      }
      throw new Error(`Could not resolve '${key}'`)
    }),
  }

  return {
    container,
    authorities,
    raw,
    listCustomerCartAuthorities,
    supersedeCustomerCartAuthority,
  }
}

describe("reconcileTerminalCustomerCartAuthority", () => {
  it("supersede a autoridade ativa somente após confirmar Cart terminal do mesmo Customer", async () => {
    const harness = buildHarness()

    await expect(
      reconcileTerminalCustomerCartAuthority(
        harness.container as never,
        "cus_01"
      )
    ).resolves.toBe(true)

    expect(harness.raw).toHaveBeenCalledWith(
      expect.stringContaining("pg_advisory_xact_lock"),
      ["cus_01"]
    )
    expect(harness.supersedeCustomerCartAuthority).toHaveBeenCalledWith({
      authority_id: "ccauth_01",
      customer_id: "cus_01",
      cart_id: "cart_01",
    })
    expect(harness.authorities[0].state).toBe("superseded")

    await expect(
      reconcileTerminalCustomerCartAuthority(
        harness.container as never,
        "cus_01"
      )
    ).resolves.toBe(false)
  })

  it("não aposenta autoridade quando o Cart ainda não é terminal", async () => {
    const harness = buildHarness({
      cart: {
        id: "cart_01",
        customer_id: "cus_01",
        completed_at: null,
        deleted_at: null,
      },
    })

    await expect(
      reconcileTerminalCustomerCartAuthority(
        harness.container as never,
        "cus_01"
      )
    ).resolves.toBe(false)
    expect(harness.supersedeCustomerCartAuthority).not.toHaveBeenCalled()
  })

  it.each([
    ["Cart ausente", null],
    [
      "Cart de outro Customer",
      {
        id: "cart_01",
        customer_id: "cus_foreign",
        completed_at: new Date(),
        deleted_at: null,
      },
    ],
    [
      "Cart apagado",
      {
        id: "cart_01",
        customer_id: "cus_01",
        completed_at: new Date(),
        deleted_at: new Date(),
      },
    ],
  ])("falha fechado para %s", async (_label, cart) => {
    const harness = buildHarness({ cart })

    await expect(
      reconcileTerminalCustomerCartAuthority(
        harness.container as never,
        "cus_01"
      )
    ).rejects.toMatchObject({
      code: "CUSTOMER_CART_AUTHORITY_CONFLICT",
      statusCode: 409,
      status: 409,
    })
    expect(harness.supersedeCustomerCartAuthority).not.toHaveBeenCalled()
  })
})
