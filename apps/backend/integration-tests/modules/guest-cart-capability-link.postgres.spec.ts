import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import {
  createRegionsWorkflow,
  deleteRegionsWorkflow,
} from "@medusajs/core-flows"
import { POST as postActiveCart } from "../../src/api/store/carts/active/route"
import {
  GUEST_CART_CAPABILITY_HEADER,
  GUEST_CART_CAPABILITY_MODULE,
} from "../../src/modules/guest-cart-capability/types"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"

jest.mock(
  "pg-god",
  () => {
    const { Client: PgClient } = jest.requireActual("pg") as typeof import("pg")

    const safeDatabaseName = (value: unknown): string => {
      if (
        typeof value !== "string" ||
        !/^p12_disposable_[a-z0-9_]+$/.test(value)
      ) {
        throw new Error("P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN")
      }
      return value
    }

    const maintenanceClient = () =>
      new PgClient({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: "postgres",
      })

    return {
      createDatabase: async ({ databaseName }: { databaseName: string }) => {
        const safeName = safeDatabaseName(databaseName)
        const client = maintenanceClient()
        await client.connect()
        try {
          const found = await client.query(
            "select 1 from pg_database where datname = $1",
            [safeName]
          )
          if (found.rowCount === 0) {
            await client.query(`create database "${safeName}"`)
          }
        } finally {
          await client.end()
        }
      },
      dropDatabase: async ({ databaseName }: { databaseName: string }) => {
        const safeName = safeDatabaseName(databaseName)
        const client = maintenanceClient()
        await client.connect()
        try {
          await client.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
            [safeName]
          )
          await client.query(`drop database if exists "${safeName}"`)
        } finally {
          await client.end()
        }
      },
    }
  },
  { virtual: true }
)

const requestedDatabaseName = process.env.DB_TEMP_NAME

function createResponse() {
  return {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
      return this
    },
    json(body: unknown) {
      this.body = body
      this.headersSent = true
      return this
    },
    end() {
      this.headersSent = true
      return this
    },
  }
}

function requestFor(
  scope: MedusaContainer,
  idempotencyKey: string
): MedusaRequest {
  return {
    method: "POST",
    url: "/store/carts/active",
    originalUrl: "/store/carts/active",
    body: {},
    params: {},
    headers: {
      "idempotency-key": idempotencyKey,
      "x-indicio-bff-auth": "hr04-synthetic-bff-secret",
    },
    scope,
  } as unknown as MedusaRequest
}

if (!requestedDatabaseName) {
  describe("GuestCartCapability Cart module-link PostgreSQL", () => {
    it("requires a disposable PostgreSQL runner", () => {
      expect(() => requireDisposableDatabaseName(requestedDatabaseName)).toThrow(
        "P12_DISPOSABLE_DATABASE_NAME_REQUIRED"
      )
    })
  })
} else {
  const disposableEnvironment = buildDisposableMedusaEnvironment(process.env)
  assertDisposableMedusaEnvironment(disposableEnvironment)

  for (const [name, value] of Object.entries(disposableEnvironment)) {
    if (typeof value === "string") {
      process.env[name] = value
    }
  }

  const { medusaIntegrationTestRunner } = jest.requireActual(
    "@medusajs/test-utils"
  ) as typeof import("@medusajs/test-utils")
  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  jest.setTimeout(180_000)

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      const createdLinkInputs: Array<Record<string, unknown>> = []
      const createdCartIds: string[] = []
      const createdCapabilityIds: string[] = []
      const createdRegionIds: string[] = []

      function scopedContainer(
        link: { create(input: Record<string, unknown>): Promise<unknown> }
      ): MedusaContainer {
        const container = getContainer()
        const scope = Object.create(container) as MedusaContainer
        const resolve = container.resolve.bind(container)
        scope.resolve = ((key: string) => {
          if (key === ContainerRegistrationKeys.LINK) {
            return link
          }
          return resolve(key)
        }) as MedusaContainer["resolve"]
        return scope
      }

      function observingLink(realLink: {
        create(input: Record<string, unknown>): Promise<unknown>
        dismiss(input: Record<string, unknown>): Promise<unknown>
      }) {
        const link = {
          create: async (input: Record<string, unknown>) => {
            createdLinkInputs.push(input)
            return realLink.create(input)
          },
          dismiss: realLink.dismiss.bind(realLink),
        }
        return link
      }

      beforeEach(async () => {
        createdLinkInputs.length = 0
        createdCartIds.length = 0
        createdCapabilityIds.length = 0
        createdRegionIds.length = 0
        await dbConnection.raw("delete from guest_cart_capability")

        const { result } = await createRegionsWorkflow(getContainer()).run({
          input: {
            regions: [
              {
                name: "HR-04 Brazil",
                currency_code: "brl",
                countries: ["br"],
                payment_providers: ["pp_system_default"],
              },
            ],
          },
        })
        createdRegionIds.push(result[0].id)
      })

      afterEach(async () => {
        const container = getContainer()
        const realLink = container.resolve(ContainerRegistrationKeys.LINK) as {
          dismiss(input: Record<string, unknown>): Promise<unknown>
        }

        for (const input of createdLinkInputs) {
          try {
            await realLink.dismiss(input)
          } catch {}
        }

        if (createdCapabilityIds.length > 0) {
          await dbConnection.raw(
            "delete from guest_cart_capability where id in (?)",
            [createdCapabilityIds]
          )
        }

        if (createdCartIds.length > 0) {
          const cartModule = container.resolve(Modules.CART) as {
            deleteCarts(ids: string[]): Promise<void>
          }
          await cartModule.deleteCarts(createdCartIds)
        }

        if (createdRegionIds.length > 0) {
          await deleteRegionsWorkflow(container).run({
            input: { ids: createdRegionIds },
          })
        }

        // The disposable runner owns the final database drop. The link rows and
        // capability rows above are still explicitly cleaned up before teardown.
        createdLinkInputs.length = 0
        createdCartIds.length = 0
        createdCapabilityIds.length = 0
        createdRegionIds.length = 0
      })

      it("mints one capability, persists one link, traverses it, replays idempotently, and compensates link failure", async () => {
        const container = getContainer()
        const realLink = container.resolve(ContainerRegistrationKeys.LINK) as {
          create(input: Record<string, unknown>): Promise<unknown>
          dismiss(input: Record<string, unknown>): Promise<unknown>
        }
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as {
          graph(input: {
            entity: string
            fields: string[]
            filters: Record<string, unknown>
          }): Promise<{ data: Array<Record<string, any>> }>
        }

        const link = observingLink(realLink)
        const firstResponse = createResponse()
        const firstRequest = requestFor(
          scopedContainer(link),
          "hr04-link-success-idempotency-key"
        )

        await postActiveCart(firstRequest, firstResponse as unknown as MedusaResponse)

        expect(firstResponse.statusCode).toBe(201)
        const firstBody = firstResponse.body as { cart: { id: string } }
        const cartId = firstBody.cart.id
        const plaintextToken = firstResponse.headers[GUEST_CART_CAPABILITY_HEADER]
        expect(cartId).toEqual(expect.any(String))
        expect(plaintextToken).toEqual(expect.any(String))
        createdCartIds.push(cartId)

        expect(createdLinkInputs).toHaveLength(1)
        const linkInput = createdLinkInputs[0]
        expect(linkInput).toEqual({
          [Modules.CART]: { cart_id: cartId },
          [GUEST_CART_CAPABILITY_MODULE]: {
            guest_cart_capability_id: expect.any(String),
          },
        })
        expect(JSON.stringify(linkInput)).not.toContain(plaintextToken)
        createdCapabilityIds.push(
          String(
            (linkInput[GUEST_CART_CAPABILITY_MODULE] as Record<string, unknown>)
              .guest_cart_capability_id
          )
        )

        const graphResult = await query.graph({
          entity: "cart",
          fields: [
            "id",
            "guest_cart_capability_link.*",
            "guest_cart_capabilities.*",
          ],
          filters: { id: cartId },
        })
        const graphCart = graphResult.data[0]
        expect(graphCart.id).toBe(cartId)
        expect(graphCart.guest_cart_capabilities).toHaveLength(1)
        expect(graphCart.guest_cart_capabilities[0].id).toBe(
          createdCapabilityIds[0]
        )
        expect(graphCart.guest_cart_capability_link).toHaveLength(1)
        expect(JSON.stringify(graphCart)).not.toContain(plaintextToken)

        const persistedCapability = await dbConnection.raw(
          "select id, cart_id, token_hash, status from guest_cart_capability where id = ?",
          [createdCapabilityIds[0]]
        )
        expect(persistedCapability.rows).toHaveLength(1)
        expect(persistedCapability.rows?.[0]).toEqual(
          expect.objectContaining({
            id: createdCapabilityIds[0],
            cart_id: cartId,
            status: "active",
          })
        )
        expect(JSON.stringify(persistedCapability.rows)).not.toContain(
          plaintextToken
        )

        const replayResponse = createResponse()
        await postActiveCart(
          requestFor(
            scopedContainer(link),
            "hr04-link-success-idempotency-key"
          ),
          replayResponse as unknown as MedusaResponse
        )
        expect(replayResponse.statusCode).toBe(200)
        expect((replayResponse.body as { cart: { id: string } }).cart.id).toBe(
          cartId
        )
        expect(replayResponse.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
        expect(createdLinkInputs).toHaveLength(1)

        const failingLinkCalls: Array<Record<string, unknown>> = []
        const failingLinkDismissCalls: Array<Record<string, unknown>> = []
        const failingLinkState = new Map<string, Record<string, unknown>>()
        const failingLink = {
          create: async (input: Record<string, unknown>) => {
            failingLinkCalls.push(input)
            failingLinkState.set(JSON.stringify(input), input)
            throw new Error("HR04_SIMULATED_LINK_FAILURE")
          },
          dismiss: async (input: Record<string, unknown>) => {
            failingLinkDismissCalls.push(input)
            failingLinkState.delete(JSON.stringify(input))
          },
        }
        const failedResponse = createResponse()

        await expect(
          postActiveCart(
            requestFor(
              scopedContainer(failingLink),
              "hr04-link-failure-idempotency-key"
            ),
            failedResponse as unknown as MedusaResponse
          )
        ).rejects.toThrow("HR04_SIMULATED_LINK_FAILURE")

        expect(failingLinkCalls).toHaveLength(1)
        expect(failingLinkDismissCalls).toHaveLength(1)
        expect(failingLinkState.size).toBe(0)
        expect(JSON.stringify(failingLinkCalls[0])).not.toContain(
          "plaintext_token"
        )
        const failedCartId = String(
          (failingLinkCalls[0][Modules.CART] as Record<string, unknown>).cart_id
        )
        const failedCapabilityId = String(
          (
            failingLinkCalls[0][GUEST_CART_CAPABILITY_MODULE] as Record<
              string,
              unknown
            >
          ).guest_cart_capability_id
        )
        createdCartIds.push(failedCartId)
        createdCapabilityIds.push(failedCapabilityId)

        const failedRows = await dbConnection.raw(
          "select id, cart_id, status from guest_cart_capability where id = ?",
          [failedCapabilityId]
        )
        expect(failedRows.rows).toEqual([
          expect.objectContaining({
            id: failedCapabilityId,
            cart_id: failedCartId,
            status: "revoked",
          }),
        ])

        const activeRows = await dbConnection.raw(
          "select id from guest_cart_capability where cart_id = ? and status = 'active' and deleted_at is null",
          [failedCartId]
        )
        expect(activeRows.rows).toHaveLength(0)

        const failedGraphResult = await query.graph({
          entity: "cart",
          fields: ["id", "guest_cart_capability_link.*", "guest_cart_capabilities.*"],
          filters: { id: failedCartId },
        })
        expect(failedGraphResult.data).toHaveLength(0)

        const deletedCartRows = await dbConnection.raw(
          "select id from cart where id = ?",
          [failedCartId]
        )
        expect(deletedCartRows.rows).toHaveLength(0)
      })
    },
  })
}
