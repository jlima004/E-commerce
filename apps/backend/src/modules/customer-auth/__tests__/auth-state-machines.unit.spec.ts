import { AUTH_HTTP_CONTRACT } from "../../../api/auth-surface/contracts"
import {
  AUTH_SURFACE_LOCAL_OPERATIONS,
  AUTH_SURFACE_NATIVE_OPERATIONS,
} from "../../../api/auth-surface/manifest"
import { STORE_SURFACE_PHASE14_ENABLED_OPERATIONS } from "../../../api/store-surface/manifest"
import { AUTH_ACCESS_TOKEN_TTL_SECONDS } from "../jwt"
import { AUTH_RESET_STATUSES, AUTH_RESET_TTL_MS } from "../reset"
import {
  AUTH_REFRESH_RECOVERY_MS,
  AUTH_SESSION_ABSOLUTE_MS,
} from "../session"
import {
  AUTH_CREDENTIAL_OPERATION_STATUSES,
  AUTH_REFRESH_CREDENTIAL_STATUSES,
  AUTH_REFRESH_INACTIVITY_TTL_SECONDS,
  AUTH_REFRESH_RECOVERY_SECONDS,
  AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
  AUTH_SESSION_LINEAGE_STATUSES,
  AUTH_SESSION_REVOCATION_REASONS,
  CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS,
  REGISTRATION_INTENT_STATUSES,
} from "../types"
import {
  AUTH_VERIFICATION_STATUSES,
  AUTH_VERIFICATION_TTL_MS,
} from "../verification"

const PHASE14_AUTH_OPERATIONS = AUTH_SURFACE_LOCAL_OPERATIONS.filter(
  (entry) => entry.runtimePolicy === "PHASE14_ENABLED"
).map((entry) => `${entry.method} ${entry.pathTemplate}`)

const CONTRACT_OPERATIONS = AUTH_HTTP_CONTRACT.map(
  (entry) => `${entry.method} ${entry.path}`
)

describe("Phase 14 final auth state-machine aggregation", () => {
  it("freezes AUTH-01 registration TTL, statuses and one-Customer intent states", () => {
    expect(CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS).toBe(24 * 60 * 60)
    expect(REGISTRATION_INTENT_STATUSES).toEqual([
      "pending_identity",
      "pending_customer",
      "completed",
      "expired",
      "failed_reconcilable",
    ])
  })

  it("freezes AUTH-02/D14-05 absolute lineage deadline at 30 days", () => {
    expect(AUTH_SESSION_ABSOLUTE_TTL_SECONDS).toBe(30 * 24 * 60 * 60)
    expect(AUTH_SESSION_ABSOLUTE_MS).toBe(30 * 24 * 60 * 60 * 1000)
    expect(AUTH_SESSION_LINEAGE_STATUSES).toEqual([
      "active",
      "revoked",
      "expired",
    ])
  })

  it("freezes AUTH-06/D14-06/D14-07 access 10m, inactivity 7d and 45s recovery", () => {
    expect(AUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(10 * 60)
    expect(AUTH_REFRESH_INACTIVITY_TTL_SECONDS).toBe(7 * 24 * 60 * 60)
    expect(AUTH_REFRESH_RECOVERY_SECONDS).toBe(45)
    expect(AUTH_REFRESH_RECOVERY_MS).toBe(45_000)
    expect(AUTH_REFRESH_CREDENTIAL_STATUSES).toEqual([
      "active",
      "consumed",
      "replayed",
      "revoked",
    ])
  })

  it("keeps native refresh DENY while the custom refresh override is PHASE14_ENABLED", () => {
    const nativeRefresh = AUTH_SURFACE_NATIVE_OPERATIONS.find(
      (entry) => entry.pathTemplate === "/auth/token/refresh"
    )
    expect(nativeRefresh?.runtimePolicy).toBe("DENY")
    expect(PHASE14_AUTH_OPERATIONS).toContain("POST /auth/token/refresh")
  })

  it("freezes AUTH-07/D14-10 verification latest-wins statuses and 30m TTL", () => {
    expect(AUTH_VERIFICATION_TTL_MS).toBe(30 * 60 * 1000)
    expect(AUTH_VERIFICATION_STATUSES).toEqual([
      "pending",
      "claimed",
      "confirmed",
      "superseded",
      "expired",
      "dead_letter",
    ])
  })

  it("freezes AUTH-04/D14-14 reset latest-wins statuses and 15m TTL", () => {
    expect(AUTH_RESET_TTL_MS).toBe(15 * 60 * 1000)
    expect(AUTH_RESET_STATUSES).toEqual([
      "pending",
      "claimed",
      "credential_updated",
      "revocation_committed",
      "completed",
      "superseded",
      "expired",
      "failed_reconcilable",
    ])
  })

  it("freezes D14-16 credential operation statuses and revocation reasons", () => {
    expect(AUTH_CREDENTIAL_OPERATION_STATUSES).toEqual([
      "stable",
      "claimed",
      "provider_outcome_ambiguous",
      "credential_proved",
      "credential_updated",
      "revocation_pending",
      "revocation_committed",
      "completed",
    ])
    expect(AUTH_SESSION_REVOCATION_REASONS).toEqual([
      "logout",
      "refresh_replay",
      "password_reset",
      "password_change",
      "security_revocation",
    ])
  })

  it("aggregates AUTH-01..AUTH-09 onto the exact 12 HTTP contracts", () => {
    expect(AUTH_HTTP_CONTRACT).toHaveLength(12)
    expect(CONTRACT_OPERATIONS).toEqual([
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
    expect(PHASE14_AUTH_OPERATIONS).toEqual([
      "POST /auth/customer/emailpass/register",
      "POST /auth/customer/emailpass",
      "POST /auth/token/refresh",
      "POST /auth/customer/emailpass/revoke-current-lineage",
      "POST /auth/customer/emailpass/reset-password",
      "POST /auth/customer/emailpass/update",
    ])
    expect([...STORE_SURFACE_PHASE14_ENABLED_OPERATIONS]).toEqual([
      "GET /store/customers/me",
      "POST /store/customers/me/verify",
      "POST /store/customers/verify/resend",
      "POST /store/customers/verify",
      "GET /store/customers/me/verify/status",
      "POST /store/customers/me/password",
    ])
  })

  it("records D14-01..D14-16 as covered by frozen source constants plus owner gates", () => {
    const d14Coverage = {
      "D14-01": "registration partial recovery / V14-REG",
      "D14-02": "one Customer / V14-REG",
      "D14-03": "mismatch zero-write + scrypt / V14-REG",
      "D14-04": CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS,
      "D14-05": AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
      "D14-06": AUTH_ACCESS_TOKEN_TTL_SECONDS,
      "D14-07": AUTH_REFRESH_RECOVERY_SECONDS,
      "D14-08": "checkout/webhook preserved / V14-NEG postgres",
      "D14-09": "auto outbox provider-independent / V14-VER",
      "D14-10": AUTH_VERIFICATION_STATUSES,
      "D14-11": "no-session/no-JWT confirm / V14-VER",
      "D14-12": "uniform resend / V14-VER",
      "D14-13": "unverified/no session reset / V14-RST",
      "D14-14": AUTH_RESET_STATUSES,
      "D14-15": "composed fail-closed reset / V14-RST+V14-LIM",
      "D14-16": AUTH_CREDENTIAL_OPERATION_STATUSES,
    }

    expect(Object.keys(d14Coverage)).toHaveLength(16)
    expect(d14Coverage["D14-04"]).toBe(24 * 60 * 60)
    expect(d14Coverage["D14-05"]).toBe(30 * 24 * 60 * 60)
    expect(d14Coverage["D14-06"]).toBe(10 * 60)
    expect(d14Coverage["D14-07"]).toBe(45)
  })
})
