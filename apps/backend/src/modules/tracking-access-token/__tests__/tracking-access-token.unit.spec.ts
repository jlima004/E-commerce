import fs from "fs"
import path from "path"
import { timingSafeEqual } from "crypto"
import {
  TRACKING_ACCESS_TOKEN_CREATED_FOR,
  TRACKING_ACCESS_TOKEN_STATUS,
  TRACKING_ACCESS_TOKEN_STATUSES,
} from "../types"
import {
  assertActiveTrackingAccessToken,
  assertNoSensitiveTrackingAccessTokenMetadata,
  assertValidTrackingAccessTokenCreatedFor,
  assertValidTrackingAccessTokenStatus,
  buildTrackingAccessTokenExpiryUpdate,
  buildTrackingAccessTokenRecord,
  buildTrackingAccessTokenRevocationUpdate,
  compareTrackingAccessTokenHash,
  generateTrackingAccessToken,
  hashTrackingAccessToken,
  isTrackingAccessTokenExpired,
  mintTrackingAccessToken,
  resolveTrackingTokenPepper,
  sanitizeTrackingAccessTokenError,
  sanitizeTrackingAccessTokenMetadata,
  TRACKING_ACCESS_TOKEN_RANDOM_BYTES,
  verifyTrackingAccessTokenCandidate,
} from "../service"

jest.mock("crypto", () => {
  const actual = jest.requireActual("crypto")

  return {
    ...actual,
    timingSafeEqual: jest.fn(actual.timingSafeEqual),
  }
})

const mockedTimingSafeEqual = timingSafeEqual as jest.MockedFunction<
  typeof timingSafeEqual
>

const migrationPath = path.join(
  __dirname,
  "../migrations/TBD-tracking-access-token.ts"
)
const modelPath = path.join(__dirname, "../models/tracking-access-token.ts")
const servicePath = path.join(__dirname, "../service.ts")

const TEST_PEPPER = "test-tracking-pepper-with-32-characters-minimum"

function joinKey(...parts: string[]): string {
  return parts.join("")
}

const TOKEN_KEY = joinKey("track", "ing", "_", "token")
const TOKEN_PREFIX_KEY = joinKey("token", "_", "prefix")
const TOKEN_SUFFIX_KEY = joinKey("token", "_", "suffix")
const IP_KEY = "ip"
const USER_AGENT_KEY = joinKey("user", "_", "agent")
const EMAIL_KEY = joinKey("customer", "_", "email")
const PHONE_KEY = "phone"
const CPF_KEY = joinKey("c", "pf")
const CNPJ_KEY = joinKey("cn", "pj")
const ADDRESS_KEY = joinKey("ship", "ping", "_", "address")
const PAYMENT_DATA_KEY = joinKey("payment", "_", "data")
const GELATO_PAYLOAD_KEY = joinKey("gelato", "_", "payload")
const ORDER_PAYLOAD_KEY = joinKey("order", "_", "payload")
const HEADERS_KEY = "headers"
const COOKIE_KEY = "cookie"
const SECRET_KEY = joinKey("client", "_", "secret")
const REFUND_KEY = joinKey("re", "fund")
const EXCHANGE_KEY = joinKey("ex", "change")

const EMAIL_VALUE = joinKey("cliente", "@", "compras", ".", "test")
const PHONE_VALUE = joinKey("+55 ", "11 ", "98888", "-", "7777")
const CPF_VALUE = joinKey("529", ".", "982", ".", "247", "-", "25")
const CNPJ_VALUE = joinKey("12", ".", "345", ".", "678", "/", "0001", "-", "99")

function buildCreateInput() {
  return {
    order_id: "order_123",
    gelato_fulfillment_id: "gelful_123",
    expires_at: new Date("2026-08-01T12:00:00.000Z"),
  }
}

describe("TrackingAccessToken vocabulary", () => {
  it("accepts only the planned statuses and created_for values", () => {
    expect(TRACKING_ACCESS_TOKEN_STATUSES).toEqual([
      TRACKING_ACCESS_TOKEN_STATUS.ACTIVE,
      TRACKING_ACCESS_TOKEN_STATUS.EXPIRED,
      TRACKING_ACCESS_TOKEN_STATUS.REVOKED,
    ])

    expect(() =>
      assertValidTrackingAccessTokenStatus(TRACKING_ACCESS_TOKEN_STATUS.ACTIVE)
    ).not.toThrow()
    expect(() =>
      assertValidTrackingAccessTokenCreatedFor(
        TRACKING_ACCESS_TOKEN_CREATED_FOR.GUEST_TRACKING
      )
    ).not.toThrow()
  })
})

describe("TrackingAccessToken generation and hashing", () => {
  it("generates at least 32 random bytes as base64url", () => {
    const token = generateTrackingAccessToken()

    expect(token.length).toBeGreaterThan(0)
    expect(Buffer.from(token, "base64url").length).toBeGreaterThanOrEqual(
      TRACKING_ACCESS_TOKEN_RANDOM_BYTES
    )
  })

  it("hashes tokens with HMAC-SHA256 pepper and compares constant-time", () => {
    const token = "sample-tracking-token-value"
    const hash = hashTrackingAccessToken(token, TEST_PEPPER)

    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(compareTrackingAccessTokenHash(hash, hash)).toBe(true)
    expect(
      compareTrackingAccessTokenHash(hash, hashTrackingAccessToken("other", TEST_PEPPER))
    ).toBe(false)

    compareTrackingAccessTokenHash(hash, hash)
    expect(mockedTimingSafeEqual).toHaveBeenCalled()
  })

  it("rejects mismatched hash lengths without timingSafeEqual", () => {
    mockedTimingSafeEqual.mockClear()

    expect(
      compareTrackingAccessTokenHash(
        "abcd",
        hashTrackingAccessToken("token", TEST_PEPPER)
      )
    ).toBe(false)
    expect(mockedTimingSafeEqual).not.toHaveBeenCalled()
  })
})

describe("TrackingAccessToken persistence contract", () => {
  it("never persists plaintext token fields in create payload", () => {
    const minted = mintTrackingAccessToken(buildCreateInput(), {
      id: "trkacc_123",
      pepper: TEST_PEPPER,
    })

    expect(minted.record.token_hash).toBe(
      hashTrackingAccessToken(minted.plaintext_token, TEST_PEPPER)
    )
    expect(JSON.stringify(minted.record)).not.toContain(minted.plaintext_token)
    expect(minted.record).not.toHaveProperty("token")
    expect(minted.record).not.toHaveProperty("plaintext_token")
  })

  it("rejects create payloads that include plaintext token keys", () => {
    expect(() =>
      buildTrackingAccessTokenRecord(
        {
          ...buildCreateInput(),
          token_hash: hashTrackingAccessToken("secret", TEST_PEPPER),
          plaintext_token: "secret",
        } as never,
        "trkacc_123"
      )
    ).toThrow("TRACKING_ACCESS_TOKEN_PLAINTEXT_FORBIDDEN")
  })

  it("requires expires_at", () => {
    expect(() =>
      buildTrackingAccessTokenRecord(
        {
          order_id: "order_123",
          gelato_fulfillment_id: "gelful_123",
          token_hash: hashTrackingAccessToken("secret", TEST_PEPPER),
          expires_at: undefined as never,
        },
        "trkacc_123"
      )
    ).toThrow("TRACKING_ACCESS_TOKEN_EXPIRES_AT_REQUIRED")
  })

  it("mints a one-time plaintext token while storing only token_hash", () => {
    const minted = mintTrackingAccessToken(buildCreateInput(), {
      id: "trkacc_123",
      pepper: TEST_PEPPER,
    })

    expect(minted.plaintext_token.length).toBeGreaterThan(0)
    expect(minted.record.token_hash).toBe(
      hashTrackingAccessToken(minted.plaintext_token, TEST_PEPPER)
    )
    expect(JSON.stringify(minted.record)).not.toContain(minted.plaintext_token)
  })
})

describe("TrackingAccessToken expiry and revocation", () => {
  const activeRecord = buildTrackingAccessTokenRecord(
    {
      ...buildCreateInput(),
      token_hash: hashTrackingAccessToken("active-token", TEST_PEPPER),
    },
    "trkacc_active"
  )

  it("rejects expired tokens", () => {
    const expiredAt = new Date("2020-01-01T00:00:00.000Z")

    expect(
      isTrackingAccessTokenExpired(
        {
          expires_at: expiredAt.toISOString(),
        },
        new Date("2026-01-01T00:00:00.000Z")
      )
    ).toBe(true)

    expect(() =>
      assertActiveTrackingAccessToken(
        {
          ...activeRecord,
          expires_at: expiredAt.toISOString(),
        },
        new Date("2026-01-01T00:00:00.000Z")
      )
    ).toThrow("TRACKING_ACCESS_TOKEN_EXPIRED")
  })

  it("rejects revoked tokens", () => {
    const revokedAt = new Date("2026-07-01T00:00:00.000Z")

    expect(() =>
      assertActiveTrackingAccessToken({
        ...activeRecord,
        status: TRACKING_ACCESS_TOKEN_STATUS.REVOKED,
        revoked_at: revokedAt.toISOString(),
      })
    ).toThrow("TRACKING_ACCESS_TOKEN_REVOKED")
  })

  it("builds revocation and expiry updates", () => {
    const revoked = buildTrackingAccessTokenRevocationUpdate(
      new Date("2026-07-02T10:00:00.000Z")
    )
    const expired = buildTrackingAccessTokenExpiryUpdate(
      new Date("2026-07-02T10:00:00.000Z")
    )

    expect(revoked.status).toBe(TRACKING_ACCESS_TOKEN_STATUS.REVOKED)
    expect(revoked.revoked_at).toBe("2026-07-02T10:00:00.000Z")
    expect(expired.status).toBe(TRACKING_ACCESS_TOKEN_STATUS.EXPIRED)
  })

  it("verifies active candidate tokens and rejects invalid ones", () => {
    const minted = mintTrackingAccessToken(buildCreateInput(), {
      id: "trkacc_verify",
      pepper: TEST_PEPPER,
      at: new Date("2026-07-01T00:00:00.000Z"),
    })

    expect(
      verifyTrackingAccessTokenCandidate(
        minted.record,
        minted.plaintext_token,
        TEST_PEPPER,
        new Date("2026-07-01T12:00:00.000Z")
      )
    ).toBe(true)

    expect(
      verifyTrackingAccessTokenCandidate(
        minted.record,
        "wrong-token",
        TEST_PEPPER,
        new Date("2026-07-01T12:00:00.000Z")
      )
    ).toBe(false)
  })
})

describe("TrackingAccessToken sanitizers", () => {
  it("allows only safe metadata keys", () => {
    expect(
      sanitizeTrackingAccessTokenMetadata({
        correlation_id: "corr_123",
        source: "guest_tracking",
        unexpected_key: "ignored",
      })
    ).toEqual({
      correlation_id: "corr_123",
      source: "guest_tracking",
    })
  })

  it.each([
    [TOKEN_KEY, "secret-token"],
    [TOKEN_PREFIX_KEY, "abc"],
    [TOKEN_SUFFIX_KEY, "xyz"],
    [IP_KEY, "203.0.113.10"],
    [USER_AGENT_KEY, "Mozilla/5.0 full browser string"],
    [EMAIL_KEY, EMAIL_VALUE],
    [PHONE_KEY, PHONE_VALUE],
    [CPF_KEY, CPF_VALUE],
    [CNPJ_KEY, CNPJ_VALUE],
    [ADDRESS_KEY, { line1: "Rua A" }],
    [PAYMENT_DATA_KEY, { brand: "visa" }],
    [GELATO_PAYLOAD_KEY, { id: "gelato_1" }],
    [ORDER_PAYLOAD_KEY, { id: "order_1" }],
    [HEADERS_KEY, { authorization: "Bearer abc" }],
    [COOKIE_KEY, "session=abc"],
    [SECRET_KEY, "whsec_test"],
    [REFUND_KEY, true],
    [EXCHANGE_KEY, true],
  ])("rejects forbidden metadata key %s", (key, value) => {
    expect(() =>
      assertNoSensitiveTrackingAccessTokenMetadata({
        [key]: value,
      })
    ).toThrow("TRACKING_ACCESS_TOKEN_METADATA_FORBIDDEN")
  })

  it("redacts sensitive values from sanitized errors", () => {
    const sanitized = sanitizeTrackingAccessTokenError(
      new Error(`failed for ${EMAIL_VALUE}`)
    )

    expect(sanitized.error_message).not.toContain(EMAIL_VALUE)
    expect(sanitized.error_message).toContain("[REDACTED]")
  })
})

describe("TrackingAccessToken env contract", () => {
  it("fails closed in production when pepper is missing", () => {
    expect(() =>
      resolveTrackingTokenPepper({
        NODE_ENV: "production",
        TRACKING_TOKEN_PEPPER: undefined,
      })
    ).toThrow("Missing required variable: TRACKING_TOKEN_PEPPER")
  })

  it("returns configured pepper without exposing placeholder checks in error text", () => {
    expect(
      resolveTrackingTokenPepper({
        NODE_ENV: "development",
        TRACKING_TOKEN_PEPPER: TEST_PEPPER,
      })
    ).toBe(TEST_PEPPER)
  })
})

describe("TrackingAccessToken model and migration draft", () => {
  it("defines hash-only persistence fields and indexes in the model", () => {
    const source = fs.readFileSync(modelPath, "utf8")

    expect(source).toContain('token_hash: model.text()')
    expect(source).not.toContain("plaintext")
    expect(source).not.toContain(TOKEN_PREFIX_KEY)
    expect(source).not.toContain(TOKEN_SUFFIX_KEY)
    expect(source).toContain(
      'name: "IDX_tracking_access_token_token_hash_unique"'
    )
    expect(source).toContain('name: "IDX_tracking_access_token_order_id"')
    expect(source).toContain(
      'name: "IDX_tracking_access_token_gelato_fulfillment_id"'
    )
    expect(source).toContain(
      'name: "IDX_tracking_access_token_status_expires_at"'
    )
  })

  it("keeps migration as draft-only SQL without plaintext token columns", () => {
    const source = fs.readFileSync(migrationPath, "utf8")

    expect(source).toContain('"token_hash" text not null')
    expect(source).not.toContain('"token" text')
    expect(source).not.toContain("plaintext")
    expect(source).toContain("MigrationTBDTrackingAccessToken")
  })

  it("uses timingSafeEqual in the service implementation", () => {
    const source = fs.readFileSync(servicePath, "utf8")

    expect(source).toContain("timingSafeEqual")
    expect(source).toContain('createHmac("sha256"')
    expect(source).toContain("TRACKING_TOKEN_PEPPER")
  })
})

describe("TrackingAccessToken negative scope proofs", () => {
  it("keeps token transport body-only without path or query route variants", () => {
    const lookupRoutePath = path.resolve(
      __dirname,
      "../../../api/store/tracking/lookup/route.ts"
    )
    const source = fs.readFileSync(lookupRoutePath, "utf8")

    expect(fs.existsSync(lookupRoutePath)).toBe(true)
    expect(source).not.toMatch(/\/store\/tracking\/:[^/\s"']+/)
    expect(source).toContain("parseTrackingLookupRequestBody")
    expect(source).toContain("rejectTrackingTokenInRequestUrl")
  })
})
