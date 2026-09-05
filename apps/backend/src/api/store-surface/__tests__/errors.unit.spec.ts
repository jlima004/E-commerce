import { MedusaError } from "@medusajs/utils"
import {
  STORE_ERROR_CODES,
  STORE_PUBLIC_FIELD_ALLOWLIST,
  STORE_PUBLIC_FIELD_ERROR_MESSAGE,
  attachStoreErrorEnvelope,
  isStoreErrorCode,
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
    ]).toContain(key)
  }
  expect(isStoreErrorCode(body.code)).toBe(true)
  expect(typeof body.message).toBe("string")
  expect(typeof body.retryable).toBe("boolean")
  expect(body.message.length).toBeGreaterThan(0)
  expect(body).not.toHaveProperty("cart")
}

describe("Store error contract (FND-03 / 13-03 / R1)", () => {
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
      expect(isStoreErrorCode("ANY_INTERNAL_CODE")).toBe(false)
    })

    it("maps validation to 400 with allowlisted fieldErrors and closed values", () => {
      const error = new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `invalid body ${CANARIES.cpf}`
      )
      const result = toStoreErrorResponse(error, {
        correlationId: "corr_validation_01",
        fieldErrors: {
          email: `Invalid value: ${CANARIES.cpf}`,
          password: `Rejected: ${CANARIES.clientSecret}`,
          internal_db_column: "leak",
          authorization: CANARIES.authorization,
        },
      })

      expect(result.statusCode).toBe(400)
      expect(result.body.code).toBe(STORE_ERROR_CODES.VALIDATION_ERROR)
      expect(result.body.retryable).toBe(false)
      expect(result.body.fieldErrors).toEqual({
        email: STORE_PUBLIC_FIELD_ERROR_MESSAGE,
        password: STORE_PUBLIC_FIELD_ERROR_MESSAGE,
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

    it("maps internal payment replay conflicts to public CONFLICT", () => {
      const result = toStoreErrorResponse(
        new MedusaError(
          MedusaError.Types.CONFLICT,
          "same-operation replay ineligible"
        ),
        { correlationId: "corr_payment_replay_01" }
      )
      expect(result.body.code).toBe(STORE_ERROR_CODES.CONFLICT)
    })

    it("maps internal cart review conflicts to public CONFLICT without leaking codes", () => {
      const reviewRequired = Object.assign(
        new MedusaError(
          MedusaError.Types.CONFLICT,
          "Cart review must be acknowledged before this operation"
        ),
        { code: "REVIEW_REQUIRED", statusCode: 409, status: 409 }
      )
      const reviewStateConflict = Object.assign(
        new MedusaError(MedusaError.Types.CONFLICT, "Cart review state conflict"),
        { code: "CART_REVIEW_STATE_CONFLICT", statusCode: 409, status: 409 }
      )

      for (const error of [reviewRequired, reviewStateConflict]) {
        const result = toStoreErrorResponse(error, {
          correlationId: "corr_review_conflict_01",
        })

        expect(result.statusCode).toBe(409)
        expect(result.body.code).toBe(STORE_ERROR_CODES.CONFLICT)
        expect(result.body.retryable).toBe(false)
        expectClosedEnvelope(result.body)
        expect(JSON.stringify(result.body)).not.toContain("REVIEW_REQUIRED")
        expect(JSON.stringify(result.body)).not.toContain(
          "CART_REVIEW_STATE_CONFLICT"
        )
      }
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

    it("maps rate limit 429 with retryable true when known-safe", () => {
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

  describe("B13-03-R1-01 pre-shaped envelope bypass", () => {
    it("rebuilds malicious pre-shaped envelopes instead of passing them through", () => {
      const malicious = {
        code: "ANY_INTERNAL_CODE",
        message: `client_secret=${CANARIES.clientSecret} jwt=${CANARIES.jwt} cpf=${CANARIES.cpf} auth=${CANARIES.authorization} pix=${CANARIES.pixPayload} cap=${CANARIES.capability}`,
        retryable: true,
        leaked: "extra_field",
        cart: {
          client_secret: CANARIES.clientSecret,
        },
      }

      const result = toStoreErrorResponse(malicious, {
        correlationId: "corr_preshape_01",
        statusCode: 500,
      })

      expect(isStoreErrorCode(result.body.code)).toBe(true)
      expect(result.body.code).not.toBe("ANY_INTERNAL_CODE")
      expect(result.body.code).toBe(STORE_ERROR_CODES.INTERNAL_ERROR)
      expect(result.body.message).toBe("Internal Server Error")
      expect(result.body.retryable).toBe(false)
      expect(result.body).not.toHaveProperty("leaked")
      expect(result.body).not.toHaveProperty("cart")
      expectClosedEnvelope(result.body)
      expectNoCanaries(result.body)
    })

    it("envelope middleware never trusts pre-shaped StoreErrorResponse-looking bodies", () => {
      const req = { correlationId: "corr_env_rebuild_01" }
      const json = jest.fn()
      const res = {
        statusCode: 500,
        status: jest.fn().mockReturnThis(),
        json,
        setHeader: jest.fn(),
      }
      attachStoreErrorEnvelope(req, res as never)

      res.json({
        code: "ANY_INTERNAL_CODE",
        message: `client_secret=${CANARIES.clientSecret}`,
        retryable: true,
        unexpected: true,
      })

      expect(json).toHaveBeenCalledTimes(1)
      const body = json.mock.calls[0]?.[0] as StoreErrorResponse
      expect(isStoreErrorResponse(body)).toBe(true)
      expect(body.code).toBe(STORE_ERROR_CODES.INTERNAL_ERROR)
      expect(body.message).toBe("Internal Server Error")
      expect(body.retryable).toBe(false)
      expect(body.correlationId).toBe("corr_env_rebuild_01")
      expect(body).not.toHaveProperty("unexpected")
      expectNoCanaries(body)
    })
  })

  describe("B13-03-R1-02 fieldErrors value sanitization", () => {
    it("replaces allowlisted field values containing canaries with closed public text", () => {
      const result = toStoreErrorResponse(
        new MedusaError(MedusaError.Types.INVALID_DATA, "bad"),
        {
          correlationId: "corr_fields_01",
          fieldErrors: {
            email: `Invalid value: ${CANARIES.cpf}`,
            password: `Rejected: ${CANARIES.clientSecret}`,
            postal_code: `JWT ${CANARIES.jwt}`,
            shipping_address: `${CANARIES.authorization} ${CANARIES.pixPayload}`,
          },
        }
      )

      expect(result.body.fieldErrors).toEqual({
        email: STORE_PUBLIC_FIELD_ERROR_MESSAGE,
        password: STORE_PUBLIC_FIELD_ERROR_MESSAGE,
        postal_code: STORE_PUBLIC_FIELD_ERROR_MESSAGE,
        shipping_address: STORE_PUBLIC_FIELD_ERROR_MESSAGE,
      })
      expectNoCanaries(result.body)
    })
  })

  describe("B13-03-R1-03 unsafe cart omission", () => {
    it("omits arbitrary cart snapshots containing secrets", () => {
      const result = toStoreErrorResponse(
        new MedusaError(MedusaError.Types.CONFLICT, "x"),
        {
          correlationId: "corr_cart_unsafe_01",
          cart: {
            client_secret: CANARIES.clientSecret,
            federal_tax_id: CANARIES.cpf,
            authorization: CANARIES.authorization,
            provider_payload: { raw: CANARIES.providerPayload },
            capability: CANARIES.capability,
            token: CANARIES.confirmationToken,
          },
        }
      )

      expect(result.body).not.toHaveProperty("cart")
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
    it("detects only catalog-closed StoreErrorResponse shapes", () => {
      expect(
        isStoreErrorResponse({
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          retryable: false,
        })
      ).toBe(true)
      expect(
        isStoreErrorResponse({
          code: "ANY_INTERNAL_CODE",
          message: "Invalid request",
          retryable: false,
        })
      ).toBe(false)
      expect(
        isStoreErrorResponse({
          type: "not_found",
          message: "Not Found",
        })
      ).toBe(false)
      expect(
        isStoreErrorResponse({
          code: "VALIDATION_ERROR",
          message: "Invalid request",
          retryable: false,
          cart: { id: "cart_1" },
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

  describe("B13-03-R1-04 retryable certainty", () => {
    it("sets retryable true only for known safe categories without uncertain side effects", () => {
      expect(
        toStoreErrorResponse(
          { type: "rate_limit", statusCode: 429, message: "rl" },
          { correlationId: "r1" }
        ).body.retryable
      ).toBe(true)

      expect(
        toStoreErrorResponse(
          {
            type: "rate_limit",
            statusCode: 429,
            message: "rl",
            uncertainSideEffect: true,
          },
          { correlationId: "r1b" }
        ).body.retryable
      ).toBe(false)

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
            type: "provider_unavailable",
            providerUnavailable: true,
            message: "down",
            uncertainSideEffect: true,
          },
          { correlationId: "r2b" }
        ).body.retryable
      ).toBe(false)

      expect(
        toStoreErrorResponse(
          {
            message: "generic unavailable",
            statusCode: 503,
          },
          { correlationId: "r2c" }
        ).body.retryable
      ).toBe(false)

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

      expect(
        toStoreErrorResponse(new Error("boom"), {
          correlationId: "r5",
          statusCode: 500,
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
