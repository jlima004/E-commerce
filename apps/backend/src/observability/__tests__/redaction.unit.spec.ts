import {
  ALLOWLISTED_CONTEXT_KEYS,
  REDACTED,
  maskIpAddress,
  sanitizeContext,
  sanitizeError,
  sanitizeString,
  summarizeUserAgent,
} from "../sanitize"

const CANARIES = {
  stripeSecret: ["sk", "live", "canaryvalue"].join("_"),
  webhookSecret: "whsec_test_canary_value_12345",
  bearer: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  postgresUrl: "postgresql://dbuser:dbpass@db.example.com:5432/postgres",
  redisUrl: "redis://:redispass@redis.example.com:6379/0",
  stripeSignature: "t=1710000000,v1=abcdef0123456789abcdef0123456789abcdef01",
  pan: "4111111111111111",
  cookie: "session=s3cr3ts3ss10n; Path=/; HttpOnly",
  apiKey: "api_key=super_secret_value",
  sentryDsn:
    "https://abc123def456@o123456.ingest.sentry.io/789012",
  pixCode: "pix_BR1234567890abcdef",
  paymentIntent: "pi_3AbCdEfGhIjKlMnOpQrStUv",
} as const

function expectNoCanaries(value: unknown) {
  const serialized = JSON.stringify(value)

  for (const canary of Object.values(CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

describe("sanitizeString", () => {
  it.each(Object.entries(CANARIES))(
    "redacts D-17 canary %s from strings",
    (_label, canary) => {
      const input = `prefix ${canary} suffix`
      const output = sanitizeString(input)

      expect(output).not.toContain(canary)
      expect(output).toContain(REDACTED)
    }
  )

  it("does not mutate the original string", () => {
    const input = `token ${CANARIES.bearer}`
    const snapshot = input

    sanitizeString(input)

    expect(input).toBe(snapshot)
  })
})

describe("sanitizeContext", () => {
  it("keeps only allowlisted operational fields", () => {
    const input = {
      correlation_id: "corr-123",
      method: "GET",
      route: "/store/orders/:id",
      status: 200,
      duration_ms: 12,
      body: { card: CANARIES.pan },
      headers: { authorization: CANARIES.bearer },
      cookies: CANARIES.cookie,
      email: "customer@example.com",
      unknown_field: "drop-me",
    }

    const output = sanitizeContext(input)

    expect(output).toEqual({
      correlation_id: "corr-123",
      method: "GET",
      route: "/store/orders/:id",
      status: 200,
      duration_ms: 12,
    })
    expectNoCanaries(output)
    expect(input.body).toEqual({ card: CANARIES.pan })
  })

  it("sanitizes secrets embedded in allowlisted string values", () => {
    const output = sanitizeContext({
      message: `failed with ${CANARIES.stripeSecret}`,
      operation: "checkout.complete",
    })

    expectNoCanaries(output)
    expect(output.message).toContain(REDACTED)
  })

  it("documents the fixed operational allowlist", () => {
    expect(ALLOWLISTED_CONTEXT_KEYS.has("correlation_id")).toBe(true)
    expect(ALLOWLISTED_CONTEXT_KEYS.has("grouping_key")).toBe(true)
  })
})

describe("sanitizeError", () => {
  it("sanitizes secrets embedded in message and stack", () => {
    const error = new Error(`payment failed: ${CANARIES.webhookSecret}`)
    error.stack = `Error: payment failed\n    at handler (${CANARIES.postgresUrl})`

    const output = sanitizeError(error)

    expectNoCanaries(output)
    expect(output.name).toBe("Error")
    expect(output.message).toContain(REDACTED)
    expect(output.stack).toContain(REDACTED)
  })

  it("preserves cause chains up to five levels", () => {
    const root = new Error(`root ${CANARIES.jwt}`)
    const level4 = new Error(`level4 ${CANARIES.redisUrl}`)
    const level3 = new Error("level3")
    const level2 = new Error("level2")
    const level1 = new Error("level1")

    ;(level4 as Error & { cause?: Error }).cause = root
    ;(level3 as Error & { cause?: Error }).cause = level4
    ;(level2 as Error & { cause?: Error }).cause = level3
    ;(level1 as Error & { cause?: Error }).cause = level2

    const top = new Error(`top ${CANARIES.stripeSignature}`)
    ;(top as Error & { cause?: Error }).cause = level1

    const output = sanitizeError(top)

    expect(output.cause?.cause?.cause?.cause?.message).toBe("level4 [REDACTED]")
    expect(output.cause?.cause?.cause?.cause?.cause?.message).toBe(
      "root [REDACTED]"
    )
    expect(output.cause?.cause?.cause?.cause?.cause?.cause).toBeUndefined()
    expectNoCanaries(output)
  })

  it("handles circular causes without mutating the input error", () => {
    const error = new Error("loop")
    ;(error as Error & { cause?: Error }).cause = error

    const snapshot = error.message
    const output = sanitizeError(error)

    expect(output.cause?.message).toBe("[CIRCULAR]")
    expect(error.message).toBe(snapshot)
  })
})

describe("explicit telemetry helpers", () => {
  it("masks IPv4 without exposing the full address", () => {
    expect(maskIpAddress("203.0.113.45")).toBe("203.0.xxx.xxx")
    expect(maskIpAddress("203.0.113.45")).not.toContain("45")
  })

  it("summarizes user agent instead of copying it verbatim", () => {
    const full =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"

    const summary = summarizeUserAgent(full)

    expect(summary).toBe("chrome/windows")
    expect(summary.length).toBeLessThan(full.length)
    expect(summary).not.toContain("AppleWebKit")
  })
})
