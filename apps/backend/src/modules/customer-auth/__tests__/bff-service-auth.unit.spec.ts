import fs from "node:fs"
import path from "node:path"
import {
  authenticateBffServiceRequest,
  CUSTOMER_AUTH_BFF_AUTH_HEADER,
  CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS,
  CUSTOMER_AUTH_BFF_SERVICE_SECRET_MIN_LENGTH,
  isCustomerAuthBffServiceSecretConfigured,
  parseCustomerAuthBffServiceSecret,
} from "../bff-service-auth"

const SYNTHETIC_SECRET = "synthetic-bff-service-secret-32b-min"
const OTHER_SECRET = "alternate-bff-service-secret-32b-min"

const SOURCE_PATH = path.resolve(__dirname, "../bff-service-auth.ts")

function leakCandidates(secret: string): string[] {
  return [secret, SYNTHETIC_SECRET, OTHER_SECRET, "digest", "sha256"]
}

function expectNoSecretLeak(value: unknown, secrets: string[] = [SYNTHETIC_SECRET, OTHER_SECRET]) {
  const serialized = JSON.stringify(value)
  expect(serialized).not.toContain("digest")
  for (const secret of secrets) {
    if (secret.trim().length === 0) {
      continue
    }
    expect(serialized).not.toContain(secret)
  }
}

describe("BFF service authentication boundary", () => {
  it("exposes the approved header name and closed Phase 14 operation set", () => {
    expect(CUSTOMER_AUTH_BFF_AUTH_HEADER).toBe("x-indicio-bff-auth")
    expect(CUSTOMER_AUTH_BFF_SERVICE_SECRET_MIN_LENGTH).toBe(32)
    expect([...CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS]).toEqual([
      "POST /auth/customer/emailpass/register",
      "POST /auth/customer/emailpass",
      "POST /auth/token/refresh",
      "POST /auth/customer/emailpass/revoke-current-lineage",
      "GET /store/customers/me",
      "POST /store/customers/me/verify",
      "POST /store/customers/verify/resend",
      "POST /store/customers/verify",
      "GET /store/customers/me/verify/status",
    ])
    expect(CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS).not.toEqual(
      expect.arrayContaining([
        "POST /auth/customer/emailpass/reset-password",
        "POST /auth/customer/emailpass/update",
      ])
    )
  })

  it("authorizes a valid configured secret and matching header", () => {
    const decision = authenticateBffServiceRequest({
      expectedSecret: SYNTHETIC_SECRET,
      headerValue: SYNTHETIC_SECRET,
    })
    expect(decision).toEqual({ outcome: "authorized" })
    expectNoSecretLeak(decision)
  })

  it("denies a missing header without executing a secret equality check result of authorized", () => {
    const decision = authenticateBffServiceRequest({
      expectedSecret: SYNTHETIC_SECRET,
      headerValue: undefined,
    })
    expect(decision).toEqual({ outcome: "denied" })
    expectNoSecretLeak(decision)
  })

  it("denies a wrong secret with the same public denied outcome", () => {
    const missing = authenticateBffServiceRequest({
      expectedSecret: SYNTHETIC_SECRET,
      headerValue: undefined,
    })
    const invalid = authenticateBffServiceRequest({
      expectedSecret: SYNTHETIC_SECRET,
      headerValue: OTHER_SECRET,
    })
    expect(missing).toEqual({ outcome: "denied" })
    expect(invalid).toEqual({ outcome: "denied" })
    expect(missing).toEqual(invalid)
    expectNoSecretLeak(invalid)
  })

  it("fails closed on malformed or multiple header representations", () => {
    const cases: unknown[] = [
      [SYNTHETIC_SECRET, SYNTHETIC_SECRET],
      [SYNTHETIC_SECRET, OTHER_SECRET],
      `${SYNTHETIC_SECRET},${OTHER_SECRET}`,
      `${SYNTHETIC_SECRET}, ${OTHER_SECRET}`,
      { value: SYNTHETIC_SECRET },
      1,
      true,
      Buffer.from(SYNTHETIC_SECRET),
    ]

    for (const headerValue of cases) {
      const decision = authenticateBffServiceRequest({
        expectedSecret: SYNTHETIC_SECRET,
        headerValue,
      })
      expect(decision).toEqual({ outcome: "denied" })
      expectNoSecretLeak(decision, leakCandidates(SYNTHETIC_SECRET))
    }
  })

  it("returns unavailable when the backend secret is missing", () => {
    for (const expectedSecret of [undefined, null]) {
      const decision = authenticateBffServiceRequest({
        expectedSecret,
        headerValue: SYNTHETIC_SECRET,
      })
      expect(decision).toEqual({ outcome: "unavailable" })
      expectNoSecretLeak(decision)
    }
  })

  it("returns unavailable for empty or invalid backend secrets", () => {
    for (const expectedSecret of [
      "",
      "   ",
      "short",
      "supersecret",
      "secret",
      "password",
    ]) {
      expect(isCustomerAuthBffServiceSecretConfigured(expectedSecret)).toBe(
        false
      )
      const decision = authenticateBffServiceRequest({
        expectedSecret,
        headerValue: expectedSecret,
      })
      expect(decision).toEqual({ outcome: "unavailable" })
      expectNoSecretLeak(decision, [String(expectedSecret), SYNTHETIC_SECRET])
    }
  })

  it("compares secrets through sha256 digests and timingSafeEqual, not direct equality", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf8")
    expect(source).toContain('createHash("sha256")')
    expect(source).toContain("timingSafeEqual")
    expect(source).not.toMatch(/expectedSecret\s*===\s*/)
    expect(source).not.toMatch(/receivedSecret\s*===\s*/)
    expect(source).not.toMatch(
      /timingSafeEqual\(\s*expectedSecret\s*,\s*receivedSecret\s*\)/
    )
  })

  it("never returns the provided secret, expected secret, or digest material", () => {
    const decisions = [
      authenticateBffServiceRequest({
        expectedSecret: SYNTHETIC_SECRET,
        headerValue: SYNTHETIC_SECRET,
      }),
      authenticateBffServiceRequest({
        expectedSecret: SYNTHETIC_SECRET,
        headerValue: OTHER_SECRET,
      }),
      authenticateBffServiceRequest({
        expectedSecret: SYNTHETIC_SECRET,
        headerValue: undefined,
      }),
      authenticateBffServiceRequest({
        expectedSecret: undefined,
        headerValue: SYNTHETIC_SECRET,
      }),
      authenticateBffServiceRequest({
        expectedSecret: "",
        headerValue: SYNTHETIC_SECRET,
      }),
    ]

    for (const decision of decisions) {
      expect(Object.keys(decision)).toEqual(["outcome"])
      expectNoSecretLeak(decision)
      const serialized = JSON.stringify(decision)
      expect(serialized).not.toMatch(/[a-f0-9]{64}/)
    }
  })

  it("parses env values without leaking the secret in error messages", () => {
    expect(
      parseCustomerAuthBffServiceSecret(undefined, { required: false })
    ).toBeUndefined()
    expect(
      parseCustomerAuthBffServiceSecret(SYNTHETIC_SECRET, { required: false })
    ).toBe(SYNTHETIC_SECRET)

    const leaked = "this-must-never-appear-in-error-text-32b"
    try {
      parseCustomerAuthBffServiceSecret(undefined, { required: true })
      throw new Error("expected parse to throw")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain("CUSTOMER_AUTH_BFF_SERVICE_SECRET")
      expect(message).not.toContain(leaked)
      expect(message).not.toContain(SYNTHETIC_SECRET)
    }

    try {
      parseCustomerAuthBffServiceSecret(leaked.slice(0, 8), { required: true })
      throw new Error("expected parse to throw")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain("CUSTOMER_AUTH_BFF_SERVICE_SECRET")
      expect(message).not.toContain(leaked)
      expect(message).not.toContain(leaked.slice(0, 8))
    }
  })
})
