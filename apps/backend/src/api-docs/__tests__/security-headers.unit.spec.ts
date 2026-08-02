import type { MedusaResponse } from "@medusajs/framework/http"
import {
  API_DOCS_CONTENT_SECURITY_POLICY,
  applyApiDocsSecurityHeaders,
  sendApiDocsNotFound,
} from "../runtime/security-headers"

function createResponse() {
  const headers: Record<string, string> = {}

  return {
    statusCode: 200,
    headers,
    status: jest.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code
      return this
    }),
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value
    }),
    end: jest.fn(),
  } as unknown as MedusaResponse & {
    statusCode: number
    headers: Record<string, string>
  }
}

describe("applyApiDocsSecurityHeaders", () => {
  it("sets the exact CSP string from security-headers.ts", () => {
    const res = createResponse()

    applyApiDocsSecurityHeaders(res, "application/json; charset=utf-8")

    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      API_DOCS_CONTENT_SECURITY_POLICY
    )
    expect(API_DOCS_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")
  })

  it("sets nosniff, no-referrer, and no-store headers", () => {
    const res = createResponse()

    applyApiDocsSecurityHeaders(res, "text/html; charset=utf-8")

    expect(res.headers["Content-Type"]).toBe("text/html; charset=utf-8")
    expect(res.headers["X-Content-Type-Options"]).toBe("nosniff")
    expect(res.headers["Referrer-Policy"]).toBe("no-referrer")
    expect(res.headers["Cache-Control"]).toBe("no-store")
  })

  it("does not set Access-Control-* headers", () => {
    const res = createResponse()

    applyApiDocsSecurityHeaders(res, "text/css; charset=utf-8")

    for (const name of Object.keys(res.headers)) {
      expect(name.toLowerCase()).not.toMatch(/^access-control-/)
    }
  })
})

describe("sendApiDocsNotFound", () => {
  it("responds with opaque 404 and no body", () => {
    const res = createResponse()

    sendApiDocsNotFound(res)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.end).toHaveBeenCalledTimes(1)
  })
})
