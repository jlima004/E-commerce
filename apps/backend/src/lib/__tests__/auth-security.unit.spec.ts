import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { AUTH_HTTP_CONTRACT } from "../../api/auth-surface/contracts"
import { toAuthErrorResponse } from "../../api/auth-surface/errors"
import {
  AUTH_CANARIES,
  AUTH_LEAKAGE_SINKS,
  AUTH_SAFE_SINK_KEYS,
  assertAuthSinksHaveNoCanaries,
  buildSafeAuthSink,
} from "../../../integration-tests/helpers/auth-leakage"
import {
  deriveCustomerAuthCapability,
  generateCustomerAuthCapabilityNonce,
  hashCustomerAuthCapability,
} from "../../modules/customer-auth/security/capabilities"
import {
  CustomerAuthEmailNormalizationError,
  normalizeCustomerAuthEmail,
} from "../../modules/customer-auth/security/email-normalization"
import { AUTH_RATE_LIMIT_POLICIES } from "../../modules/customer-auth/security/rate-limit"

const KEYRING = {
  active: {
    version: 7,
    secret: "lib-auth-security-aggregation-secret-32b",
  },
  previous: [],
}

const MODULE_SECURITY_SPEC = resolve(
  __dirname,
  "../../modules/customer-auth/__tests__/auth-security.unit.spec.ts"
)
const RATE_LIMIT_SPEC = resolve(
  __dirname,
  "../../modules/customer-auth/__tests__/rate-limit.unit.spec.ts"
)
const GENERATED_STORE = resolve(
  __dirname,
  "../../api-docs/generated/store.openapi.json"
)

describe("Phase 14 final auth security aggregation", () => {
  it("does not replace the modules owner security spec", () => {
    expect(MODULE_SECURITY_SPEC).not.toBe(__filename)
    expect(readFileSync(MODULE_SECURITY_SPEC, "utf8")).toContain("P14-D12")
    expect(readFileSync(RATE_LIMIT_SPEC, "utf8")).toContain("reset-confirm")
  })

  it("re-asserts P14-D12/D14-03 normalization without provider rewriting", () => {
    expect(normalizeCustomerAuthEmail("  Alice+tag.Doe@Example.COM  ")).toBe(
      "alice+tag.doe@example.com"
    )
    expect(normalizeCustomerAuthEmail("First.Last+tag@example.com")).toBe(
      "first.last+tag@example.com"
    )
    expect(() => normalizeCustomerAuthEmail("user@@example.com")).toThrow(
      CustomerAuthEmailNormalizationError
    )
  })

  it("re-asserts reset-confirm limiter thresholds owned by V14-LIM", () => {
    expect(AUTH_RATE_LIMIT_POLICIES["reset-confirm"]).toEqual({
      pre: { ip: [30, 900], "ip-token": [10, 900] },
      post: { intent: [10, 900] },
    })
  })

  it("keeps AUTH_TEMPORARILY_UNAVAILABLE and AUTH_RECOVERY_PENDING as distinct 503s", () => {
    const unavailable = toAuthErrorResponse(
      { code: "AUTH_TEMPORARILY_UNAVAILABLE", stage: "pre_lookup" },
      { correlationId: "corr-unavailable", resetConfirm: true }
    )
    const recovery = toAuthErrorResponse(
      { code: "AUTH_RECOVERY_PENDING", stage: "correlated_recovery" },
      { correlationId: "corr-recovery", resetConfirm: true }
    )

    expect(unavailable.statusCode).toBe(503)
    expect(recovery.statusCode).toBe(503)
    expect(unavailable.body.code).toBe("AUTH_TEMPORARILY_UNAVAILABLE")
    expect(recovery.body.code).toBe("AUTH_RECOVERY_PENDING")
    expect(unavailable.body.code).not.toBe(recovery.body.code)
    expect(unavailable.retryAfterSeconds).toBe(60)
    expect(recovery.retryAfterSeconds).toBeUndefined()
  })

  it("keeps reset-confirm contract failures at 400/429 plus the two 503 stages", () => {
    const resetConfirm = AUTH_HTTP_CONTRACT.find(
      (entry) => entry.operation === "reset_confirm"
    )
    expect(resetConfirm?.failures).toEqual([
      [400, "RESET_INVALID_OR_EXPIRED"],
      [429, "RATE_LIMITED"],
      [
        503,
        "AUTH_TEMPORARILY_UNAVAILABLE",
        { retryAfterSeconds: 60, stage: "pre_lookup" },
      ],
      [503, "AUTH_RECOVERY_PENDING", { stage: "correlated_recovery" }],
    ])
    expect(resetConfirm?.sensitive).toEqual(["token", "newPassword"])
  })

  it("persists hash-only capability material and never the presented capability", () => {
    const nonce = generateCustomerAuthCapabilityNonce(() => Buffer.alloc(32, 3))
    const derived = deriveCustomerAuthCapability({
      keyring: KEYRING,
      purpose: "reset",
      intentId: "intent_lib_agg_01",
      lineageId: "lineage_lib_agg_01",
      generation: 1,
      nonce,
    })
    const sink = buildSafeAuthSink(derived.material)

    expect(sink).toEqual({
      hash: hashCustomerAuthCapability(derived.capability),
      nonce: nonce.toString("base64url"),
      key_version: 7,
    })
    expect(Object.keys(sink).sort()).toEqual([...AUTH_SAFE_SINK_KEYS].sort())
    expect(JSON.stringify(sink)).not.toContain(derived.capability)
    assertAuthSinksHaveNoCanaries({ db_plaintext: sink })
  })

  it("enumerates every leakage sink and keeps canaries out of generated Store OpenAPI", () => {
    expect([...AUTH_LEAKAGE_SINKS]).toEqual([
      "db_plaintext",
      "redis_keys_jobs",
      "logs",
      "sentry",
      "openapi",
      "fixtures_snapshots",
      "analytics",
      "persisted_provider_payload",
    ])

    const storeArtifact = readFileSync(GENERATED_STORE, "utf8")
    for (const canary of Object.values(AUTH_CANARIES)) {
      expect(storeArtifact).not.toContain(canary)
    }
    assertAuthSinksHaveNoCanaries({ openapi: storeArtifact })
  })
})
