import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { AUTH_HTTP_CONTRACT } from "../../src/api/auth-surface/contracts"
import { toAuthErrorResponse } from "../../src/api/auth-surface/errors"
import {
  createAuthSurfaceGuardMiddleware,
  decideAuthSurfaceAccess,
} from "../../src/api/auth-surface/guard"
import { createStoreSurfaceGuardMiddleware } from "../../src/api/store-surface/guard"
import {
  AUTH_CANARIES,
  AUTH_LEAKAGE_SINKS,
  AUTH_SAFE_SINK_KEYS,
  assertAuthSinksHaveNoCanaries,
} from "../helpers/auth-leakage"
import { AUTH_RATE_LIMIT_POLICIES } from "../../src/modules/customer-auth/security/rate-limit"

jest.setTimeout(180_000)

const OWNER_SPECS = [
  resolve(__dirname, "auth-rate-limit.spec.ts"),
  resolve(__dirname, "auth-reset.spec.ts"),
  resolve(__dirname, "auth-multiprocess.spec.ts"),
  resolve(__dirname, "auth-password-change.spec.ts"),
  resolve(
    __dirname,
    "../../src/modules/customer-auth/__tests__/rate-limit.unit.spec.ts"
  ),
] as const

const GENERATED_ARTIFACTS = [
  resolve(__dirname, "../../src/api-docs/generated/store.openapi.json"),
  resolve(__dirname, "../../src/api-docs/generated/admin.openapi.json"),
  resolve(__dirname, "../../src/api-docs/generated/webhooks.openapi.json"),
] as const

const AUTH_ROUTE_FILES = [
  resolve(__dirname, "../../src/api/auth/customer/emailpass/register/route.ts"),
  resolve(__dirname, "../../src/api/auth/customer/emailpass/route.ts"),
  resolve(__dirname, "../../src/api/auth/token/refresh/route.ts"),
  resolve(
    __dirname,
    "../../src/api/auth/customer/emailpass/revoke-current-lineage/route.ts"
  ),
  resolve(
    __dirname,
    "../../src/api/auth/customer/emailpass/reset-password/route.ts"
  ),
  resolve(__dirname, "../../src/api/auth/customer/emailpass/update/route.ts"),
  resolve(__dirname, "../../src/api/store/customers/me/route.ts"),
  resolve(__dirname, "../../src/api/store/customers/me/verify/route.ts"),
  resolve(__dirname, "../../src/api/store/customers/me/verify/status/route.ts"),
  resolve(__dirname, "../../src/api/store/customers/verify/resend/route.ts"),
  resolve(__dirname, "../../src/api/store/customers/verify/route.ts"),
  resolve(__dirname, "../../src/api/store/customers/me/password/route.ts"),
] as const

function responseRecorder() {
  const state = {
    statusCode: 200,
    body: undefined as unknown,
    headersSent: false,
  }
  const response = {
    get statusCode() {
      return state.statusCode
    },
    status(code: number) {
      state.statusCode = code
      return response
    },
    json(body: unknown) {
      state.body = body
      state.headersSent = true
      return response
    },
    end() {
      state.headersSent = true
      return response
    },
  }
  return { response, state }
}

describe("Phase 14 final HTTP security / leakage / limiter aggregation", () => {
  it("keeps V14-LIM and V14-RST owner specs as the reset-confirm limiter evidence", () => {
    for (const spec of OWNER_SPECS) {
      expect(existsSync(spec)).toBe(true)
    }
    expect(AUTH_RATE_LIMIT_POLICIES["reset-confirm"]).toEqual({
      pre: { ip: [30, 900], "ip-token": [10, 900] },
      post: { intent: [10, 900] },
    })
    expect(readFileSync(OWNER_SPECS[0], "utf8")).toContain("reset-confirm")
    expect(readFileSync(OWNER_SPECS[1], "utf8")).toContain("newPassword")
    expect(readFileSync(OWNER_SPECS[2], "utf8")).toContain("revoke")
  })

  it("keeps newPassword only as a contract-sensitive field, never a persistable sink key", () => {
    const resetConfirm = AUTH_HTTP_CONTRACT.find(
      (entry) => entry.operation === "reset_confirm"
    )
    const passwordChange = AUTH_HTTP_CONTRACT.find(
      (entry) => entry.operation === "password_change"
    )
    expect(resetConfirm?.sensitive).toContain("newPassword")
    expect(passwordChange?.sensitive).toContain("newPassword")
    expect([...AUTH_SAFE_SINK_KEYS]).not.toContain("newPassword")
    expect([...AUTH_SAFE_SINK_KEYS]).toEqual(["hash", "nonce", "key_version"])
  })

  it("distinguishes Redis outage 503 from correlated recovery 503", () => {
    const unavailable = toAuthErrorResponse(
      { code: "AUTH_TEMPORARILY_UNAVAILABLE", stage: "pre_lookup" },
      { correlationId: "http-sec-unavailable", resetConfirm: true }
    )
    const recovery = toAuthErrorResponse(
      { code: "AUTH_RECOVERY_PENDING", stage: "correlated_recovery" },
      { correlationId: "http-sec-recovery", resetConfirm: true }
    )
    expect(unavailable.statusCode).toBe(503)
    expect(recovery.statusCode).toBe(503)
    expect(unavailable.body.code).not.toBe(recovery.body.code)
    expect(unavailable.retryAfterSeconds).toBe(60)
  })

  it("returns 404 for unknown auth/store routes before container resolution", () => {
    const authGuard = createAuthSurfaceGuardMiddleware()
    const storeGuard = createStoreSurfaceGuardMiddleware()
    const next = jest.fn()

    for (const [createGuard, method, originalUrl, baseUrl, path] of [
      [authGuard, "POST", "/auth/not-a-route", "/auth", "/not-a-route"],
      [authGuard, "POST", "/auth/session", "/auth", "/session"],
      [
        storeGuard,
        "POST",
        "/store/customers/unknown",
        "/store",
        "/customers/unknown",
      ],
    ] as const) {
      const { response, state } = responseRecorder()
      const req = {
        method,
        originalUrl,
        url: originalUrl,
        baseUrl,
        path,
        headers: {},
        get scope() {
          throw new Error("container must not be resolved")
        },
      }
      createGuard(req as never, response as never, next)
      expect(next).not.toHaveBeenCalled()
      expect(state.statusCode).toBe(404)
    }

    expect(decideAuthSurfaceAccess("POST", "/auth/session").action).toBe("deny")
  })

  it("keeps canaries out of OpenAPI, route sources and leakage sinks", () => {
    expect(AUTH_LEAKAGE_SINKS).toHaveLength(8)
    const snapshots: Record<string, string> = {}

    for (const artifact of GENERATED_ARTIFACTS) {
      const contents = readFileSync(artifact, "utf8")
      snapshots[artifact] = contents
      for (const canary of Object.values(AUTH_CANARIES)) {
        expect(contents).not.toContain(canary)
      }
    }

    for (const routeFile of AUTH_ROUTE_FILES) {
      const source = readFileSync(routeFile, "utf8")
      snapshots[routeFile] = source
      expect(source).not.toMatch(/completeCartWorkflow|Modules\.ORDER/)
      for (const canary of Object.values(AUTH_CANARIES)) {
        expect(source).not.toContain(canary)
      }
    }

    assertAuthSinksHaveNoCanaries({
      openapi: snapshots[GENERATED_ARTIFACTS[0]],
      logs: snapshots[AUTH_ROUTE_FILES[0]],
      fixtures_snapshots: snapshots[GENERATED_ARTIFACTS[1]],
    })
  })
})
