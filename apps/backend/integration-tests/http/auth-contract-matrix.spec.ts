import { AUTH_HTTP_CONTRACT } from "../../src/api/auth-surface/contracts"
import {
  decideAuthSurfaceAccess,
} from "../../src/api/auth-surface/guard"
import {
  AUTH_SURFACE_LOCAL_OPERATIONS,
  AUTH_SURFACE_NATIVE_OPERATIONS,
} from "../../src/api/auth-surface/manifest"
import {
  CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS,
} from "../../src/modules/customer-auth/bff-service-auth"
import {
  decideStoreSurfaceAccess,
} from "../../src/api/store-surface/guard"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
  storeSurfaceOperationKey,
  validateStoreSurfaceManifest,
} from "../../src/api/store-surface/manifest"

jest.setTimeout(180_000)

const ENABLED_AUTH = AUTH_SURFACE_LOCAL_OPERATIONS.filter(
  (entry) => entry.runtimePolicy === "PHASE14_ENABLED"
).map((entry) => `${entry.method} ${entry.pathTemplate}`)

const ENABLED_STORE = STORE_SURFACE_MANIFEST.filter(
  (entry) => entry.runtime_policy === "M1_ENABLED"
).map((entry) => storeSurfaceOperationKey(entry.method, entry.pathTemplate))

const CONTRACT_KEYS = AUTH_HTTP_CONTRACT.map(
  (entry) => `${entry.method} ${entry.path}`
)

describe("Phase 14 final HTTP/BFF/surface/anti-enum matrix", () => {
  it("freezes exactly twelve BFF-to-backend HTTP contracts", () => {
    expect(AUTH_HTTP_CONTRACT).toHaveLength(12)
    expect(CONTRACT_KEYS).toEqual([
      "POST /auth/customer/emailpass/register",
      "POST /auth/customer/emailpass",
      "POST /auth/token/refresh",
      "POST /auth/customer/emailpass/revoke-current-lineage",
      "POST /store/customers/me/verify",
      "POST /store/customers/verify/resend",
      "POST /store/customers/verify",
      "GET /store/customers/me/verify/status",
      "POST /auth/customer/emailpass/reset-password",
      "POST /auth/customer/emailpass/update",
      "POST /store/customers/me/password",
      "GET /store/customers/me",
    ])
    expect([...CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS].sort()).toEqual(
      [...CONTRACT_KEYS].sort()
    )
  })

  it("allows exactly six Auth and six Store Phase 14 operations", () => {
    expect(ENABLED_AUTH).toEqual([
      "POST /auth/customer/emailpass/register",
      "POST /auth/customer/emailpass",
      "POST /auth/token/refresh",
      "POST /auth/customer/emailpass/revoke-current-lineage",
      "POST /auth/customer/emailpass/reset-password",
      "POST /auth/customer/emailpass/update",
    ])
    expect(ENABLED_STORE).toEqual([
      ...STORE_SURFACE_PHASE14_ENABLED_OPERATIONS,
    ])
    expect(ENABLED_STORE).toEqual([
      "GET /store/customers/me",
      "POST /store/customers/me/verify",
      "POST /store/customers/verify/resend",
      "POST /store/customers/verify",
      "GET /store/customers/me/verify/status",
      "POST /store/customers/me/password",
    ])
    expect(validateStoreSurfaceManifest()).toEqual([])
  })

  it("allows each of the twelve contracts at the exact method+path", () => {
    for (const entry of AUTH_HTTP_CONTRACT) {
      const decision = entry.path.startsWith("/auth/")
        ? decideAuthSurfaceAccess(entry.method, entry.path)
        : decideStoreSurfaceAccess(entry.method, entry.path)
      expect(decision.action).toBe("allow")
    }
  })

  it("denies native session, MFA, callbacks, aliases and raw Customer", () => {
    expect(
      AUTH_SURFACE_NATIVE_OPERATIONS.every(
        (entry) => entry.runtimePolicy === "DENY"
      )
    ).toBe(true)

    for (const [method, path] of [
      ["POST", "/auth/session"],
      ["DELETE", "/auth/session"],
      ["GET", "/auth/customer/emailpass/callback"],
      ["POST", "/auth/customer/emailpass/callback"],
      ["POST", "/auth/mfa/challenges/synthetic-id/verify"],
      ["GET", "/auth/mfa/factors"],
      ["POST", "/auth/verification/request"],
      ["POST", "/auth/verification/confirm"],
      ["POST", "/auth/customer/emailpass/"],
      ["POST", "/Auth/customer/emailpass"],
      ["GET", "/auth/customer/emailpass"],
      ["POST", "/auth/customer/emailpass/register/"],
      ["GET", "/auth/customer/emailpass/register"],
      ["OPTIONS", "/auth/customer/emailpass"],
    ] as const) {
      expect(decideAuthSurfaceAccess(method, path).action).toBe("deny")
    }

    for (const [method, path] of [
      ["POST", "/store/customers"],
      ["POST", "/store/customers/me"],
      ["GET", "/store/customers/me/"],
      ["POST", "/store/customers/Me"],
      ["POST", "/store/carts/{id}/complete"],
    ] as const) {
      expect(decideStoreSurfaceAccess(method, path).action).toBe("deny")
    }
  })

  it("keeps D14-11/D14-12 verification confirm and resend public without session JWT", () => {
    const confirm = AUTH_HTTP_CONTRACT.find(
      (entry) => entry.operation === "verification_confirm"
    )
    const resend = AUTH_HTTP_CONTRACT.find(
      (entry) => entry.operation === "verification_resend"
    )
    const resetRequest = AUTH_HTTP_CONTRACT.find(
      (entry) => entry.operation === "reset_request"
    )

    expect(confirm?.auth).toBe("public_bff_no_session")
    expect(resend?.auth).toBe("public_bff")
    expect(resend?.success).toEqual({
      status: 202,
      code: "REQUEST_ACCEPTED",
      body: "request_accepted",
    })
    expect(resetRequest?.success).toEqual(resend?.success)
  })

  it("keeps reset-confirm two 503 classes and D14-13 no-session reset confirm", () => {
    const resetConfirm = AUTH_HTTP_CONTRACT.find(
      (entry) => entry.operation === "reset_confirm"
    )
    expect(resetConfirm?.auth).toBe("capability_and_idempotency_key")
    expect(resetConfirm?.failures).toEqual(
      expect.arrayContaining([
        [
          503,
          "AUTH_TEMPORARILY_UNAVAILABLE",
          { retryAfterSeconds: 60, stage: "pre_lookup" },
        ],
        [503, "AUTH_RECOVERY_PENDING", { stage: "correlated_recovery" }],
      ])
    )
  })

  it("minimizes session and current-customer envelopes", () => {
    const sessionOps = AUTH_HTTP_CONTRACT.filter(
      (entry) => entry.success.body === "auth_session"
    )
    expect(sessionOps.map((entry) => entry.operation).sort()).toEqual([
      "login",
      "refresh",
      "signup",
    ])
    for (const entry of sessionOps) {
      expect(entry.sensitive).toEqual(
        expect.arrayContaining(["accessToken", "refreshToken"])
      )
    }

    const me = AUTH_HTTP_CONTRACT.find(
      (entry) => entry.operation === "current_auth_customer"
    )
    expect(me?.success.body).toBe("current_auth_customer")
    expect(me?.sensitive).toEqual([])
  })
})
