import { MedusaError } from "@medusajs/utils"
import {
  STORE_ERROR_CODES,
  STORE_PUBLIC_FIELD_ALLOWLIST,
  isStoreErrorResponse,
  sanitizeStoreCorrelationId,
  toStoreErrorResponse,
  type StoreErrorResponse,
} from "../errors"

const CANARIES = {
  idempotencyKey: "idem_synth_raw_key_do_not_leak",
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
  authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig",
  cookie: "connect.sid=s%3Asynth.session",
  capability: "cap_guest_synth_do_not_leak",
  confirmationToken: "conf_tok_synth_do_not_leak",
  cpf: "529.982.247-25",
  clientSecret: "pi_synth_secret_do_not_leak",
  pixPayload: "00020126synth_pix_payload_qr",
  providerId: "pi_synth_provider_01",
  providerPayload: '{"provider":"stripe","raw":"secret_blob"}',
  stackFrame: "at Object.<anonymous> (/app/secret/handler.ts:99:7)",
  dbDetail: 'duplicate key value violates unique constraint "order_pkey"',
} as const

function expectNoCanaries(value: unknown) {
  const serialized = JSON.stringify(value)
  for (const canary of Object.values(CANARIES)) {
    expect(serialized).not.toContain(canary)
  }
}

function expectClosedEnvelope(body: StoreErrorResponse) {
  expect(Object.keys(body).sort()).toEqual(
    expect.arrayContaining(["code", "message", "retryable"].sort())
  )
  for (const key of Object.keys(body)) {
    expect([
      "code",
      "message",
      "retryable",
      "correlationId",
      "fieldErrors",
      "cart",
    ]).toContain(key)
  }
  expect(typeof body.code).toBe("string")
  expect(typeof body.message).toBe("string")
  expect(typeof body.retryable).toBe("boolean")
  expect(body.message.length).toBeGreaterThan(0)
}

describe("Store error contract (FND-03 / 13-03)", () => {
  describe("catalog and status families", () => {
    it("exposes stable public codes for required status families", () => {
      expect(STORE_ERROR_CODES.VALIDATION_ERROR).toBe("VALIDATION_ERROR")
      expect(STORE_ERROR_CODES.UNAUTHORIZED).toBe("UNAUTHORIZED")
      expect(STORE_ERROR_CODES.NOT_FOUND).toBe("NOT_FOUND")
      expect(STORE_ERROR_CODES.CONFLICT).toBe("CONFLICT")
      expect(STORE_ERROR_CODES.PRECONDITION_FAILED).toBe("PRECONDITION_FAILED")
      expect(STORE_ERROR_CODES.DOMAIN_ERROR).toBe("DOMAIN_ERROR")
      expect(STORE_ERROR_CODES.RATE_LIMITED).toBe("RATE_LIMITED")
      expect(STORE_ERROR_CODES.INTERNAL_ERROR).toBe("INTERNAL_ERROR")
      expect(STORE_ERROR_CODES.SERVICE_UNAVAILABLE).toBe("SERVICE_UNAVAILABLE")
    })

    it("maps validation to 400 with allowlisted fieldErrors only", () => {
      const error = new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `invalid body ${CANARIES.cpf}`
      )
      const result = toStoreErrorResponse(error, {
        correlationId: "corr_validation_01",
        fieldErrors: {
          email: "invalid",
          password: "invalid",
          internal_db_column: "leak",
          authorization: CANARIES.authorization,
        },
      })

      expect(result.statusCode).toBe(400)
      expect(result.body.code).toBe(STORE_ERROR_CODES.VALIDATION_ERROR)
      expect(result.body.retryable).toBe(false)
      expect(result.body.fieldErrors).toEqual({
        email: "invalid",
        password: "invalid",
      })
      expect(result.body.fieldErrors).not.toHaveProperty("internal_db_column")
      expect(result.body.fieldErrors).not.toHaveProperty("authorization")
      expect(result.body.message).not.toContain(CANARIES.cpf)
      expectClosedEnvelope(result.body)
      expectNoCanaries(result.body)
    })

    it("maps auth missing/invalid to non-enumerating 401", () => {
      const missing = toStoreErrorResponse(
        new MedusaError(MedusaError.Types.UNAUTHORIZED, "Missing auth"),
        { correlationId: "corr_auth_01" }
      )
      const invalid = toStoreErrorResponse(
        new MedusaError(
          MedusaError.Types.UNAUTHORIZED,
          `Invalid JWT ${CANARIES.jwt}`
        ),
        { correlationId: "corr_auth_02" }
      )

      expect(missing.statusCode).toBe(401)
      expect(invalid.statusCode).toBe(401)
      expect(missing.body.code).toBe(STORE_ERROR_CODES.UNAUTHORIZED)
      expect(invalid.body.code).toBe(STORE_ERROR_CODES.UNAUTHORIZED)
      expect(missing.body.message).toBe(invalid.body.message)
      expect(invalid.body.message).not.toContain(CANARIES.jwt)
      expect(missing.body.retryable).toBe(false)
      expectNoCanaries(missing.body)
      expectNoCanaries(invalid.body)
    })

    it("maps ownership and unknown resource to identical non-enumerating 404", () => {
      const unknown = toStoreErrorResponse(
        new MedusaError(MedusaError.Types.NOT_FOUND, "Cart not found"),
        { correlationId: "corr_own_01" }
      )
      const otherOwner = toStoreErrorResponse(
        new MedusaError(
          MedusaError.Types.FORBIDDEN,
          `Cart owned by other actor ${CANARIES.capability}`
        ),
        { correlationId: "corr_own_02" }
      )

      expect(unknown.statusCode).toBe(404)
      expect(otherOwner.statusCode).toBe(404)
      expect(unknown.body.code).toBe(STORE_ERROR_CODES.NOT_FOUND)
      expect(otherOwner.body.code).toBe(STORE_ERROR_CODES.NOT_FOUND)
      expect(unknown.body.message).toBe(otherOwner.body.message)
      expect(otherOwner.body.message).not.toContain(CANARIES.capability)
      expect(unknown.body.retryable).toBe(false)
      expectNoCanaries(unknown.body)
      expectNoCanaries(otherOwner.body)
    })

    it("maps conflict 409 with stable public code", () => {
      const result = toStoreErrorResponse(
        new MedusaError(MedusaError.Types.CONFLICT, "idempotency conflict"),
        { correlationId: "corr_conflict_01" }
      )
      expect(result.statusCode).toBe(409)
      expect(result.body.code).toBe(STORE_ERROR_CODES.CONFLICT)
      expect(result.body.retryable).toBe(false)
      expectClosedEnvelope(result.body)
    })

    it("maps generic precondition failed 412 without Cart contract", () => {
      const result = toStoreErrorResponse(
        {
          name: "PreconditionFailedError",
          type: "precondition_failed",
          message: "stale version",
          statusCode: 412,
        },
        { correlationId: "corr_412_01" }
      )
      expect(result.statusCode).toBe(412)
      expect(result.body.code).toBe(STORE_ERROR_CODES.PRECONDITION_FAILED)
      expect(result.body.retryable).toBe(false)
      expect(result.body).not.toHaveProperty("cart")
      expect(JSON.stringify(result.body)).not.toContain("CART_VERSION_MISMATCH")
    })

    it("maps domain errors to 422 with stable public code", () => {
      const result = toStoreErrorResponse(
        new MedusaError(
          MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
          `payment module ${CANARIES.providerId} failed`
        ),
        { correlationId: "corr_domain_01" }
      )
      expect(result.statusCode).toBe(422)
      expect(result.body.code).toBe(STORE_ERROR_CODES.DOMAIN_ERROR)
      expect(result.body.retryable).toBe(false)
      expect(result.body.message).not.toContain(CANARIES.providerId)
      expectNoCanaries(result.body)
    })

    it("maps rate limit 429 with retryable true when factual", () => {
      const result = toStoreErrorResponse(
        {
          name: "RateLimitError",
          type: "rate_limit",
          message: "Too many requests",
          statusCode: 429,
          retryAfterSeconds: 30,
        },
        { correlationId: "corr_429_01" }
      )
      expect(result.statusCode).toBe(429)
      expect(result.body.code).toBe(STORE_ERROR_CODES.RATE_LIMITED)
      expect(result.body.retryable).toBe(true)
      expect(result.retryAfterSeconds).toBe(30)
    })

    it("does not invent Retry-After when absent", () => {
      const result = toStoreErrorResponse(
        {
          name: "RateLimitError",
          type: "rate_limit",
          message: "Too many requests",
          statusCode: 429,
        },
        { correlationId: "corr_429_02" }
      )
      expect(result.retryAfterSeconds).toBeUndefined()
      expect(result.body.retryable).toBe(true)
    })

    it("maps internal errors to sanitized 500 with retryable false", () => {
      const error = Object.assign(
        new Error(`boom ${CANARIES.stackFrame} ${CANARIES.dbDetail}`),
        { stack: `Error: boom\n${CANARIES.stackFrame}` }
      )
      const result = toStoreErrorResponse(error, {
        correlationId: "corr_500_01",
      })
      expect(result.statusCode).toBe(500)
      expect(result.body.code).toBe(STORE_ERROR_CODES.INTERNAL_ERROR)
      expect(result.body.retryable).toBe(false)
      expect(result.body.message).not.toContain("boom")
      expect(result.body.message).not.toContain(CANARIES.dbDetail)
      expectNoCanaries(result.body)
    })

    it("maps known unavailable provider category to sanitized 503", () => {
      const result = toStoreErrorResponse(
        {
          name: "ProviderUnavailableError",
          type: "provider_unavailable",
          message: `Stripe down ${CANARIES.providerPayload}`,
          integration: "stripe",
          providerUnavailable: true,
        },
        { correlationId: "corr_503_01" }
      )
      expect(result.statusCode).toBe(503)
      expect(result.body.code).toBe(STORE_ERROR_CODES.SERVICE_UNAVAILABLE)
      expect(result.body.retryable).toBe(true)
      expectNoCanaries(result.body)
    })

    it("maps provider-shaped errors with uncertain side effects to sanitized 500 retryable false", () => {
      const result = toStoreErrorResponse(
        {
          name: "StripeError",
          type: "provider_error",
          message: `charge failed ${CANARIES.clientSecret} ${CANARIES.pixPayload}`,
          integration: "stripe",
          uncertainSideEffect: true,
        },
        { correlationId: "corr_provider_01" }
      )
      expect(result.statusCode).toBe(500)
      expect(result.body.code).toBe(STORE_ERROR_CODES.INTERNAL_ERROR)
      expect(result.body.retryable).toBe(false)
      expect(result.body.message).not.toContain(CANARIES.clientSecret)
      expect(result.body.message).not.toContain(CANARIES.pixPayload)
      expectNoCanaries(result.body)
    })

    it("maps unknown errors to generic sanitized internal error", () => {
      const result = toStoreErrorResponse(
        {
          weird: true,
          message: `unknown ${CANARIES.confirmationToken}`,
        },
        { correlationId: "corr_unknown_01" }
      )
      expect(result.statusCode).toBe(500)
      expect(result.body.code).toBe(STORE_ERROR_CODES.INTERNAL_ERROR)
      expect(result.body.retryable).toBe(false)
      expectNoCanaries(result.body)
    })
  })

  describe("correlation sanitization", () => {
    it("preserves valid correlation ids", () => {
      const valid = "corr.ABC_01-xyz"
      expect(sanitizeStoreCorrelationId(valid)).toBe(valid)
      const result = toStoreErrorResponse(
        new MedusaError(MedusaError.Types.INVALID_DATA, "x"),
        { correlationId: valid }
      )
      expect(result.body.correlationId).toBe(valid)
    })

    it("replaces invalid correlation input with a safe generated value", () => {
      const invalids = [
        "has spaces",
        "newline\ninjection",
        "unicode-áéí",
        "x".repeat(129),
        "Bearer secret",
        "",
        null,
        undefined,
      ]

      for (const invalid of invalids) {
        const sanitized = sanitizeStoreCorrelationId(invalid)
        expect(sanitized).toMatch(/^[A-Za-z0-9._-]{1,128}$/)
        expect(sanitized).not.toBe(invalid)
      }
    })
  })

  describe("envelope allowlist and cart absence", () => {
    it("detects StoreErrorResponse shapes", () => {
      expect(
        isStoreErrorResponse({
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          retryable: false,
        })
      ).toBe(true)
      expect(
        isStoreErrorResponse({
          type: "not_found",
          message: "Not Found",
        })
      ).toBe(false)
    })

    it("never materializes cart snapshot by default", () => {
      const result = toStoreErrorResponse(
        new MedusaError(MedusaError.Types.CONFLICT, "x"),
        { correlationId: "corr_cart_01" }
      )
      expect(result.body).not.toHaveProperty("cart")
    })

    it("keeps public field allowlist closed", () => {
      expect(STORE_PUBLIC_FIELD_ALLOWLIST.has("email")).toBe(true)
      expect(STORE_PUBLIC_FIELD_ALLOWLIST.has("authorization")).toBe(false)
      expect(STORE_PUBLIC_FIELD_ALLOWLIST.has("client_secret")).toBe(false)
    })

    it("message is presentation only and not a business discriminator across ownership cases", () => {
      const a = toStoreErrorResponse(
        new MedusaError(MedusaError.Types.NOT_FOUND, "missing cart"),
        { correlationId: "corr_msg_01" }
      )
      const b = toStoreErrorResponse(
        new MedusaError(MedusaError.Types.FORBIDDEN, "other customer cart"),
        { correlationId: "corr_msg_02" }
      )
      expect(a.body.code).toBe(b.body.code)
      expect(a.body.message).toBe(b.body.message)
      expect(a.statusCode).toBe(b.statusCode)
    })
  })

  describe("retryable certainty", () => {
    it("sets retryable true only for known safe categories", () => {
      expect(
        toStoreErrorResponse(
          { type: "rate_limit", statusCode: 429, message: "rl" },
          { correlationId: "r1" }
        ).body.retryable
      ).toBe(true)
      expect(
        toStoreErrorResponse(
          {
            type: "provider_unavailable",
            providerUnavailable: true,
            message: "down",
          },
          { correlationId: "r2" }
        ).body.retryable
      ).toBe(true)
      expect(
        toStoreErrorResponse(
          {
            type: "provider_error",
            uncertainSideEffect: true,
            integration: "stripe",
            message: "maybe charged",
          },
          { correlationId: "r3" }
        ).body.retryable
      ).toBe(false)
      expect(
        toStoreErrorResponse(new Error("mystery"), {
          correlationId: "r4",
        }).body.retryable
      ).toBe(false)
    })
  })

  describe("legacy deny body mapping", () => {
    it("normalizes early guard-shaped not_found bodies to StoreErrorResponse", () => {
      const result = toStoreErrorResponse(
        {
          type: "not_found",
          message: "Not Found",
          statusCode: 404,
        },
        { correlationId: "corr_deny_01" }
      )
      expect(result.statusCode).toBe(404)
      expect(result.body.code).toBe(STORE_ERROR_CODES.NOT_FOUND)
      expect(result.body.retryable).toBe(false)
      expect(result.body.correlationId).toBe("corr_deny_01")
      expectClosedEnvelope(result.body)
    })
  })
})
