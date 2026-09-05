import {
  CUSTOMER_AUTH_BFF_AUTH_HEADER,
} from "../../src/modules/customer-auth/bff-service-auth"
import {
  STORE_CART_BFF_PROTECTED_OPERATIONS,
} from "../../src/api/store/carts/bff-protected-operations"
import defaultMiddlewares, {
  createCustomerAuthBffServiceGuardMiddleware,
  customerAuthAccessGuardMiddleware,
  customerAuthBffServiceGuardMiddleware,
} from "../../src/api/middlewares"
import { GUEST_CART_CAPABILITY_HEADER } from "../../src/modules/guest-cart-capability/types"

const VALID_TEST_BFF_SECRET = "test_secret_must_be_at_least_32_characters_long_for_bff_auth"

function createMockResponse() {
  const json = jest.fn().mockReturnThis()
  const status = jest.fn().mockReturnThis()
  const setHeader = jest.fn()
  return {
    statusCode: 200,
    headersSent: false,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code
      status(code)
      return this
    },
    json(body: unknown) {
      json(body)
      this.headersSent = true
      return this
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
      setHeader(name, value)
    },
    statusMock: status,
    jsonMock: json,
    setHeaderMock: setHeader,
  }
}

function createMockRequest(input: {
  method: string
  url: string
  headers?: Record<string, string>
}) {
  return {
    method: input.method,
    originalUrl: input.url,
    url: input.url,
    headers: input.headers ?? {},
    params: {},
    customerAuthBff: undefined as { authorized: true } | undefined,
    customerAuth: undefined,
  }
}

describe("Guest Cart BFF Guard Matrix (Task 15-03-03)", () => {
  const bffMiddleware = createCustomerAuthBffServiceGuardMiddleware({
    expectedSecret: VALID_TEST_BFF_SECRET,
  })

  it("registra exatamente as 8 operacoes de cart no middleware BFF", () => {
    expect(STORE_CART_BFF_PROTECTED_OPERATIONS).toHaveLength(8)
    const routes = (defaultMiddlewares.routes ?? []) as Array<{
      matcher: unknown
      method?: unknown
      middlewares?: unknown[]
    }>

    for (const operation of STORE_CART_BFF_PROTECTED_OPERATIONS) {
      const [method, path] = operation.split(" ")
      const matchingRoute = routes.find((r) => {
        const matchesPath = String(r.matcher) === path
        const matchesMethod =
          r.method === undefined ||
          (Array.isArray(r.method) && r.method.includes(method as "GET" | "POST" | "DELETE")) ||
          r.method === method
        const hasBffMiddleware = (r.middlewares ?? []).includes(customerAuthBffServiceGuardMiddleware)
        return matchesMethod && matchesPath && hasBffMiddleware
      })
      expect(matchingRoute).toBeDefined()
      // Garante que o customerAuthAccessGuardMiddleware NAO esta montado incondicionalmente nestas rotas
      const middlewares = matchingRoute?.middlewares ?? []
      expect(middlewares).not.toContain(customerAuthAccessGuardMiddleware)
    }
  })

  it("nega com 404 uniforme quando x-indicio-bff-auth esta ausente em todas as 8 operacoes", () => {
    for (const operation of STORE_CART_BFF_PROTECTED_OPERATIONS) {
      const [method, path] = operation.split(" ")
      const req = createMockRequest({
        method,
        url: path.replace(/:id/g, "cart_01").replace(/:line_id/g, "item_01"),
        headers: {},
      })
      const res = createMockResponse()
      const next = jest.fn()

      bffMiddleware(req as never, res as never, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(404)
      expect(res.jsonMock).toHaveBeenCalledWith({
        type: "not_found",
        message: "Not Found",
      })
      // Nunca emite o header de capability em resposta de negacao BFF
      expect(res.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
    }
  })

  it("nega com 404 uniforme quando x-indicio-bff-auth apresenta secret incorreto", () => {
    for (const operation of STORE_CART_BFF_PROTECTED_OPERATIONS) {
      const [method, path] = operation.split(" ")
      const req = createMockRequest({
        method,
        url: path.replace(/:id/g, "cart_01").replace(/:line_id/g, "item_01"),
        headers: {
          [CUSTOMER_AUTH_BFF_AUTH_HEADER]: "wrong_bff_secret_that_does_not_match_at_all",
        },
      })
      const res = createMockResponse()
      const next = jest.fn()

      bffMiddleware(req as never, res as never, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(404)
      expect(res.headers[GUEST_CART_CAPABILITY_HEADER]).toBeUndefined()
    }
  })

  it("retorna 503 AUTH_TEMPORARILY_UNAVAILABLE se o secret BFF nao estiver configurado", () => {
    const unconfiguredMiddleware = createCustomerAuthBffServiceGuardMiddleware({
      expectedSecret: undefined,
    })

    const req = createMockRequest({
      method: "POST",
      url: "/store/carts/active",
      headers: {
        [CUSTOMER_AUTH_BFF_AUTH_HEADER]: "some_secret",
      },
    })
    const res = createMockResponse()
    const next = jest.fn()

    unconfiguredMiddleware(req as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(503)
    expect(res.jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
      })
    )
  })

  it("autoriza e adiciona flag customerAuthBff quando secret BFF e valido", () => {
    for (const operation of STORE_CART_BFF_PROTECTED_OPERATIONS) {
      const [method, path] = operation.split(" ")
      const req = createMockRequest({
        method,
        url: path.replace(/:id/g, "cart_01").replace(/:line_id/g, "item_01"),
        headers: {
          [CUSTOMER_AUTH_BFF_AUTH_HEADER]: VALID_TEST_BFF_SECRET,
        },
      })
      const res = createMockResponse()
      const next = jest.fn()

      bffMiddleware(req as never, res as never, next)

      expect(next).toHaveBeenCalled()
      expect(req.customerAuthBff).toEqual({ authorized: true })
      expect(res.headersSent).toBe(false)
    }
  })
})
