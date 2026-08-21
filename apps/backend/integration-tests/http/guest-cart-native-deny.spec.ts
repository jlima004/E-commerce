import {
  createStoreSurfaceGuardMiddleware,
  decideStoreSurfaceAccess,
} from "../../src/api/store-surface/guard"

function response() {
  const json = jest.fn().mockReturnThis()
  const status = jest.fn().mockReturnThis()
  return {
    statusCode: 200,
    headersSent: false,
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
    statusMock: status,
    jsonMock: json,
  }
}

function request(method: string, originalUrl: string) {
  return {
    method,
    originalUrl,
    url: originalUrl,
    baseUrl: "/store",
    path: originalUrl.replace(/^\/store/, ""),
    headers: {},
    scope: { resolve: jest.fn() },
  }
}

describe("Guest cart native bypass denial (D15-08)", () => {
  const nativeDenyOperations = [
    ["POST", "/store/carts"],
    ["GET", "/store/carts/cart_native_deny_01"],
    ["POST", "/store/carts/cart_native_deny_01/complete"],
    ["POST", "/store/customers/me/cart/attach"],
    ["POST", "/store/carts/cart_native_deny_01/shipping-methods"],
  ] as const

  it.each(nativeDenyOperations)("mantém %s %s em DENY", (method, path) => {
    expect(
      decideStoreSurfaceAccess(method, path).action
    ).toBe("deny")
    const middleware = createStoreSurfaceGuardMiddleware()
    const next = jest.fn()
    const req = request(method, path)
    const res = response()

    middleware(req as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(req.scope.resolve).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(404)
    expect(res.jsonMock).toHaveBeenCalledWith({
      type: "not_found",
      message: "Not Found",
    })
  })

  it("não confunde as quatro rotas cart M1 com identidade nativa duplicada", () => {
    for (const [method, path] of [
      ["POST", "/store/carts/cart_01/line-items"],
      ["POST", "/store/carts/cart_01/line-items/line_01"],
      ["DELETE", "/store/carts/cart_01/line-items/line_01"],
      ["DELETE", "/store/carts/cart_01/line-items"],
    ] as const) {
      expect(decideStoreSurfaceAccess(method, path).action).toBe("allow")
    }
  })
})
