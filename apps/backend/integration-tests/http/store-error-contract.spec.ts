import { MedusaError } from "@medusajs/utils"
import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import defaultMiddlewares, {
  createCorrelationAndAccessLogMiddleware,
  createSentryErrorHandler,
  createStoreErrorEnvelopeMiddleware,
  isCanonicalStoreRequestPath,
  isStoreApiRequest,
  storeErrorEnvelopeMiddleware,
} from "../../src/api/middlewares"
import { CartVersionMismatchError } from "../../src/api/store/carts/concurrency"
import type { StoreCartPreOrderRecord } from "../../src/api/store/carts/serializers"
import {
  createStoreSurfaceGuardMiddleware,
  storeSurfaceGuardMiddleware,
} from "../../src/api/store-surface/guard"
import {
  STORE_ERROR_CODES,
  STORE_PUBLIC_FIELD_ERROR_MESSAGE,
  isStoreErrorResponse,
  toStoreErrorResponse,
  type StoreErrorResponse,
} from "../../src/api/store-surface/errors"
import { buildSentryCaptureContext } from "../../src/observability/sentry-scrub"

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

function createMockResponse() {
  const headers = new Map<string, string>()
  const json = jest.fn().mockImplementation(function (this: {
    body?: unknown
    headersSent: boolean
  }, body: unknown) {
    this.body = body
    this.headersSent = true
    return this
  })
  const status = jest.fn().mockImplementation(function (this: {
    statusCode: number
  }, code: number) {
    this.statusCode = code
    return this
  })

  return {
    statusCode: 200,
    headersSent: false,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value)
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase())
    },
    status,
    json,
    on: jest.fn(),
  }
}

function createMockRequest(input: {
  method?: string
  originalUrl: string
  headers?: Record<string, string>
  correlationId?: string
  routePath?: string
}) {
  const url = new URL(input.originalUrl, "http://store.local")
  const pathname = url.pathname
  const log = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  return {
    method: input.method ?? "GET",
    originalUrl: input.originalUrl,
    url: `${pathname}${url.search}`,
    baseUrl: isCanonicalStoreRequestPath(pathname)
      ? "/store"
      : pathname.startsWith("/admin")
        ? "/admin"
        : pathname.startsWith("/hooks")
          ? "/hooks"
          : "",
    path: pathname
      .replace(/^\/store(?=\/|$)/, "")
      .replace(/^\/admin/, "")
      .replace(/^\/hooks/, "") || "/",
    headers: input.headers ?? {},
    correlationId: input.correlationId,
    route: input.routePath ? { path: input.routePath } : undefined,
    log,
    scope: {
      resolve: jest.fn(() => {
        throw new Error("FORBIDDEN_SCOPE_RESOLVE")
      }),
    },
  }
}

function runStoreStack(input: {
  method?: string
  originalUrl: string
  headers?: Record<string, string>
}) {
  const correlation = createCorrelationAndAccessLogMiddleware()
  const envelope = createStoreErrorEnvelopeMiddleware()
  const guard = createStoreSurfaceGuardMiddleware()
  const req = createMockRequest(input)
  const res = createMockResponse()
  const next = jest.fn()

  correlation(req as never, res as never, () => {
    envelope(req as never, res as never, () => {
      guard(req as never, res as never, next)
    })
  })

  return { req, res, next }
}

describe("Store error contract HTTP (FND-03 / 13-03 / R1)", () => {
  it("wires storeErrorEnvelopeMiddleware before storeSurfaceGuardMiddleware on /store*", () => {
    const storeRoute = defaultMiddlewares.routes.find(
      (route) => String(route.matcher) === "/store*"
    )
    expect(storeRoute).toBeDefined()
    expect(storeRoute?.middlewares).toHaveLength(2)
    expect(storeRoute?.middlewares?.[0]).toBe(storeErrorEnvelopeMiddleware)
    expect(storeRoute?.middlewares?.[1]).toBe(storeSurfaceGuardMiddleware)
    expect(storeRoute?.middlewares?.[0]).not.toBe(
      storeRoute?.middlewares?.[1]
    )
    expect(typeof defaultMiddlewares.errorHandler).toBe("function")
  })

  describe("W13-03-R1-02 Store prefix boundary", () => {
    it("treats only /store and /store/... as Store API requests", () => {
      expect(isCanonicalStoreRequestPath("/store")).toBe(true)
      expect(isCanonicalStoreRequestPath("/store/carts")).toBe(true)
      expect(isCanonicalStoreRequestPath("/store/carts?x=1")).toBe(true)
      expect(isCanonicalStoreRequestPath("/storefront")).toBe(false)
      expect(isCanonicalStoreRequestPath("/store-admin")).toBe(false)
      expect(isCanonicalStoreRequestPath("/storeXYZ")).toBe(false)
      expect(isCanonicalStoreRequestPath("/admin/store")).toBe(false)
      expect(isCanonicalStoreRequestPath("/hooks/store")).toBe(false)

      expect(
        isStoreApiRequest(
          createMockRequest({ originalUrl: "/store/products" }) as never
        )
      ).toBe(true)
      expect(
        isStoreApiRequest(
          createMockRequest({ originalUrl: "/storefront" }) as never
        )
      ).toBe(false)
      expect(
        isStoreApiRequest(
          createMockRequest({ originalUrl: "/store-admin" }) as never
        )
      ).toBe(false)
      expect(
        isStoreApiRequest(
          createMockRequest({ originalUrl: "/admin/products" }) as never
        )
      ).toBe(false)
      expect(
        isStoreApiRequest(
          createMockRequest({ originalUrl: "/hooks/stripe" }) as never
        )
      ).toBe(false)
    })
  })

  describe("early Store guard DENY → StoreErrorResponse", () => {
    it("rewrites DENY body without editing guard classification", () => {
      const { req, res, next } = runStoreStack({
        method: "POST",
        originalUrl: "/store/carts/synth_id_01/complete",
        headers: {
          "x-correlation-id": "corr_deny_complete_01",
          authorization: CANARIES.authorization,
          cookie: CANARIES.cookie,
          "idempotency-key": CANARIES.idempotencyKey,
        },
      })

      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(404)
      const body = res.body as StoreErrorResponse
      expect(isStoreErrorResponse(body)).toBe(true)
      expect(body.code).toBe(STORE_ERROR_CODES.NOT_FOUND)
      expect(body.retryable).toBe(false)
      expect(body.correlationId).toBe("corr_deny_complete_01")
      expect(res.getHeader("x-correlation-id")).toBe(body.correlationId)
      expect(body).not.toHaveProperty("type")
      expectNoCanaries(body)
      expectNoCanaries({
        correlationId: req.correlationId,
        header: res.getHeader("x-correlation-id"),
        body,
      })
    })

    it("denies /store/custom with the same non-enumerating envelope", () => {
      const { res, next } = runStoreStack({
        method: "GET",
        originalUrl: "/store/custom",
        headers: { "x-correlation-id": "corr_custom_01" },
      })
      expect(next).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(404)
      expect((res.body as StoreErrorResponse).code).toBe(
        STORE_ERROR_CODES.NOT_FOUND
      )
    })
  })

  describe("error handler Store branch", () => {
    function invokeStoreError(error: unknown, headers: Record<string, string> = {}) {
      const captureException = jest.fn(() => "event-id")
      const medusaErrorHandler = jest.fn()
      const handler = createSentryErrorHandler({
        captureException,
        medusaErrorHandler,
        processRole: "server",
      })
      const req = createMockRequest({
        method: "POST",
        originalUrl: "/store/carts/active",
        headers,
        routePath: "/store/carts/active",
      })
      const res = createMockResponse()
      const next = jest.fn()
      // correlation middleware behavior
      const correlation = createCorrelationAndAccessLogMiddleware()
      correlation(req as never, res as never, () => undefined)
      handler(error, req as never, res as never, next)
      return { req, res, next, captureException, medusaErrorHandler }
    }

    /**
     * Real composed Store error path:
     * correlation → storeErrorEnvelopeMiddleware → sentryErrorHandler → wrapped res.json
     * (second normalization must remain fail-closed for retryable=false).
     */
    function invokeComposedStoreErrorStack(
      error: unknown,
      headers: Record<string, string> = {}
    ) {
      const captureException = jest.fn(() => "event-id")
      const medusaErrorHandler = jest.fn()
      const handler = createSentryErrorHandler({
        captureException,
        medusaErrorHandler,
        processRole: "server",
      })
      const correlation = createCorrelationAndAccessLogMiddleware()
      const envelope = createStoreErrorEnvelopeMiddleware()
      const req = createMockRequest({
        method: "POST",
        originalUrl: "/store/carts/active",
        headers,
        routePath: "/store/carts/active",
      })
      const res = createMockResponse()
      const next = jest.fn()

      correlation(req as never, res as never, () => {
        envelope(req as never, res as never, () => undefined)
      })
      handler(error, req as never, res as never, next)
      return { req, res, next, captureException, medusaErrorHandler }
    }

    it("normalizes validation errors with sanitized fieldErrors values", () => {
      const { res, medusaErrorHandler } = invokeStoreError(
        Object.assign(
          new MedusaError(
            MedusaError.Types.INVALID_DATA,
            `bad ${CANARIES.cpf}`
          ),
          {
            fieldErrors: {
              email: `Invalid value: ${CANARIES.cpf}`,
              password: `Rejected: ${CANARIES.clientSecret}`,
              postal_code: CANARIES.jwt,
              shipping_address: `${CANARIES.authorization} ${CANARIES.pixPayload}`,
              authorization: CANARIES.authorization,
            },
          }
        ),
        { "x-correlation-id": "corr_val_01" }
      )
      expect(medusaErrorHandler).not.toHaveBeenCalled()
      expect(res.statusCode).toBe(400)
      const body = res.body as StoreErrorResponse
      expect(body.code).toBe(STORE_ERROR_CODES.VALIDATION_ERROR)
      expect(body.retryable).toBe(false)
      expect(body.fieldErrors).toEqual({
        email: STORE_PUBLIC_FIELD_ERROR_MESSAGE,
        password: STORE_PUBLIC_FIELD_ERROR_MESSAGE,
        postal_code: STORE_PUBLIC_FIELD_ERROR_MESSAGE,
        shipping_address: STORE_PUBLIC_FIELD_ERROR_MESSAGE,
      })
      expect(body.correlationId).toBe(res.getHeader("x-correlation-id"))
      expectNoCanaries(body)
    })

    it("keeps auth and ownership non-enumerable", () => {
      const missing = invokeStoreError(
        new MedusaError(MedusaError.Types.UNAUTHORIZED, "missing"),
        { "x-correlation-id": "corr_auth_a" }
      )
      const invalid = invokeStoreError(
        new MedusaError(
          MedusaError.Types.UNAUTHORIZED,
          `bad ${CANARIES.jwt}`
        ),
        { "x-correlation-id": "corr_auth_b" }
      )
      const unknown = invokeStoreError(
        new MedusaError(MedusaError.Types.NOT_FOUND, "no cart"),
        { "x-correlation-id": "corr_own_a" }
      )
      const other = invokeStoreError(
        new MedusaError(
          MedusaError.Types.FORBIDDEN,
          `owned by ${CANARIES.capability}`
        ),
        { "x-correlation-id": "corr_own_b" }
      )

      expect(missing.res.statusCode).toBe(401)
      expect(invalid.res.statusCode).toBe(401)
      expect((missing.res.body as StoreErrorResponse).message).toBe(
        (invalid.res.body as StoreErrorResponse).message
      )
      expect(unknown.res.statusCode).toBe(404)
      expect(other.res.statusCode).toBe(404)
      expect((unknown.res.body as StoreErrorResponse).code).toBe(
        (other.res.body as StoreErrorResponse).code
      )
      expect((unknown.res.body as StoreErrorResponse).message).toBe(
        (other.res.body as StoreErrorResponse).message
      )
      expectNoCanaries(invalid.res.body)
      expectNoCanaries(other.res.body)
    })

    it("normalizes domain, native-shaped, provider-shaped, unknown, rate-limit, and 503 families", () => {
      const domain = invokeStoreError(
        new MedusaError(
          MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR,
          `pay ${CANARIES.providerId}`
        ),
        { "x-correlation-id": "corr_domain" }
      )
      const nativeConflict = invokeStoreError(
        new MedusaError(MedusaError.Types.CONFLICT, "conflict"),
        { "x-correlation-id": "corr_conflict" }
      )
      const provider = invokeStoreError(
        Object.assign(new Error(`stripe ${CANARIES.providerPayload}`), {
          name: "StripeError",
          type: "provider_error",
          integration: "stripe",
          uncertainSideEffect: true,
        }),
        { "x-correlation-id": "corr_provider" }
      )
      const unknown = invokeStoreError(
        Object.assign(new Error(`mystery ${CANARIES.stackFrame}`), {
          stack: CANARIES.stackFrame,
        }),
        { "x-correlation-id": "corr_unknown" }
      )
      const rate = invokeStoreError(
        {
          type: "rate_limit",
          statusCode: 429,
          message: "slow down",
          retryAfterSeconds: 12,
        },
        { "x-correlation-id": "corr_rate" }
      )
      const rateUncertain = invokeStoreError(
        {
          type: "rate_limit",
          statusCode: 429,
          message: "slow down",
          uncertainSideEffect: true,
        },
        { "x-correlation-id": "corr_rate_uncertain" }
      )
      const knownUnavailable = invokeStoreError(
        {
          type: "provider_unavailable",
          providerUnavailable: true,
          message: "down",
        },
        { "x-correlation-id": "corr_503_known" }
      )
      const knownUnavailableUncertain = invokeStoreError(
        {
          type: "provider_unavailable",
          providerUnavailable: true,
          message: "down",
          uncertainSideEffect: true,
        },
        { "x-correlation-id": "corr_503_uncertain" }
      )
      const generic503 = invokeStoreError(
        {
          message: "mystery unavailable",
          statusCode: 503,
        },
        { "x-correlation-id": "corr_503_generic" }
      )

      expect(domain.res.statusCode).toBe(422)
      expect((domain.res.body as StoreErrorResponse).code).toBe(
        STORE_ERROR_CODES.DOMAIN_ERROR
      )
      expect(nativeConflict.res.statusCode).toBe(409)
      expect(provider.res.statusCode).toBe(500)
      expect((provider.res.body as StoreErrorResponse).retryable).toBe(false)
      expect(unknown.res.statusCode).toBe(500)
      expect(rate.res.statusCode).toBe(429)
      expect((rate.res.body as StoreErrorResponse).retryable).toBe(true)
      expect(rate.res.getHeader("retry-after")).toBe("12")
      expect((rateUncertain.res.body as StoreErrorResponse).retryable).toBe(
        false
      )
      expect(knownUnavailable.res.statusCode).toBe(503)
      expect(
        (knownUnavailable.res.body as StoreErrorResponse).retryable
      ).toBe(true)
      expect(
        (knownUnavailableUncertain.res.body as StoreErrorResponse).retryable
      ).toBe(false)
      expect(generic503.res.statusCode).toBe(503)
      expect((generic503.res.body as StoreErrorResponse).code).toBe(
        STORE_ERROR_CODES.SERVICE_UNAVAILABLE
      )
      expect((generic503.res.body as StoreErrorResponse).retryable).toBe(false)
      expectNoCanaries(domain.res.body)
      expectNoCanaries(provider.res.body)
      expectNoCanaries(unknown.res.body)
    })

    it("preserves valid correlation and replaces invalid with one shared sanitized value", () => {
      const valid = invokeStoreError(
        new MedusaError(MedusaError.Types.INVALID_DATA, "x"),
        { "x-correlation-id": "corr.valid_01" }
      )
      expect((valid.res.body as StoreErrorResponse).correlationId).toBe(
        "corr.valid_01"
      )
      expect(valid.res.getHeader("x-correlation-id")).toBe("corr.valid_01")

      const invalid = invokeStoreError(
        new MedusaError(MedusaError.Types.INVALID_DATA, "x"),
        { "x-correlation-id": "bad\nvalue with spaces" }
      )
      const bodyId = (invalid.res.body as StoreErrorResponse).correlationId
      const headerId = invalid.res.getHeader("x-correlation-id")
      expect(bodyId).toMatch(/^[A-Za-z0-9._-]{1,128}$/)
      expect(headerId).toBe(bodyId)
      expect(bodyId).not.toContain("\n")
      expect(bodyId).not.toContain(" ")
    })

    it("captures Sentry with scrubbed context only and identical correlation", () => {
      const { captureException, req, res } = invokeStoreError(
        Object.assign(new Error(`boom ${CANARIES.authorization}`), {
          name: "UnexpectedStoreError",
          operation: "store.test",
        }),
        {
          "x-correlation-id": "corr_sentry_01",
          authorization: CANARIES.authorization,
          cookie: CANARIES.cookie,
        }
      )

      expect(captureException).toHaveBeenCalledTimes(1)
      const [, context] = captureException.mock.calls[0] ?? []
      expect(context.extra).toEqual({ correlation_id: "corr_sentry_01" })
      expectNoCanaries(context)
      expect((res.body as StoreErrorResponse).correlationId).toBe(
        "corr_sentry_01"
      )
      expect(req.correlationId).toBe("corr_sentry_01")

      const rebuilt = buildSentryCaptureContext({
        errorClass: "UnexpectedStoreError",
        operation: "store.test",
        routeOrJob: "/store/carts/active",
        correlationId: req.correlationId,
        processRole: "server",
      })
      expect(rebuilt.extra).toEqual({ correlation_id: "corr_sentry_01" })
      expectNoCanaries(rebuilt)
    })

    describe("composed stack double normalization (fail-closed retryable)", () => {
      it("Case A — uncertain RATE_LIMITED stays retryable=false after envelope re-normalize", () => {
        const { res, medusaErrorHandler } = invokeComposedStoreErrorStack(
          {
            type: "rate_limit",
            statusCode: 429,
            message: `rl ${CANARIES.clientSecret} ${CANARIES.cpf}`,
            uncertainSideEffect: true,
            stack: CANARIES.stackFrame,
            providerPayload: CANARIES.providerPayload,
          },
          {
            "x-correlation-id": "corr_composed_rate_uncertain",
            authorization: CANARIES.authorization,
            "idempotency-key": CANARIES.idempotencyKey,
          }
        )

        expect(medusaErrorHandler).not.toHaveBeenCalled()
        expect(res.statusCode).toBe(429)
        const body = res.body as StoreErrorResponse
        expect(isStoreErrorResponse(body)).toBe(true)
        expect(body.code).toBe(STORE_ERROR_CODES.RATE_LIMITED)
        expect(body.retryable).toBe(false)
        expect(body.message).toBe("Too Many Requests")
        expectNoCanaries(body)
      })

      it("Case B — uncertain known SERVICE_UNAVAILABLE stays retryable=false after envelope re-normalize", () => {
        const { res } = invokeComposedStoreErrorStack(
          {
            type: "provider_unavailable",
            providerUnavailable: true,
            message: `down ${CANARIES.jwt} ${CANARIES.capability}`,
            uncertainSideEffect: true,
            stack: CANARIES.stackFrame,
          },
          { "x-correlation-id": "corr_composed_503_uncertain" }
        )

        expect(res.statusCode).toBe(503)
        const body = res.body as StoreErrorResponse
        expect(isStoreErrorResponse(body)).toBe(true)
        expect(body.code).toBe(STORE_ERROR_CODES.SERVICE_UNAVAILABLE)
        expect(body.retryable).toBe(false)
        expectNoCanaries(body)
      })

      it("Case C — generic 503 stays retryable=false after envelope re-normalize", () => {
        const { res } = invokeComposedStoreErrorStack(
          {
            message: `mystery unavailable ${CANARIES.pixPayload}`,
            statusCode: 503,
            stack: CANARIES.stackFrame,
          },
          { "x-correlation-id": "corr_composed_503_generic" }
        )

        expect(res.statusCode).toBe(503)
        const body = res.body as StoreErrorResponse
        expect(isStoreErrorResponse(body)).toBe(true)
        expect(body.code).toBe(STORE_ERROR_CODES.SERVICE_UNAVAILABLE)
        expect(body.retryable).toBe(false)
        expectNoCanaries(body)
      })

      it("Case D — known-safe RATE_LIMITED remains retryable=true after envelope re-normalize", () => {
        const { res } = invokeComposedStoreErrorStack(
          {
            type: "rate_limit",
            statusCode: 429,
            message: "slow down",
            retryAfterSeconds: 9,
          },
          { "x-correlation-id": "corr_composed_rate_safe" }
        )

        expect(res.statusCode).toBe(429)
        const body = res.body as StoreErrorResponse
        expect(isStoreErrorResponse(body)).toBe(true)
        expect(body.code).toBe(STORE_ERROR_CODES.RATE_LIMITED)
        expect(body.retryable).toBe(true)
        expect(res.getHeader("retry-after")).toBe("9")
        expectNoCanaries(body)
      })

      it("preserves the current cart ETag through the composed Sentry path", () => {
        const currentCart = {
          id: "cart_hr06_synthetic",
          currency_code: "brl",
          email: "synthetic@example.invalid",
          created_at: "2026-08-22T00:00:00.000Z",
          updated_at: "2026-08-22T00:00:00.000Z",
          total: 100,
          subtotal: 100,
          item_total: 100,
          shipping_total: 0,
          tax_total: 0,
          discount_total: 0,
          items: [],
          shipping_address: null,
        } as StoreCartPreOrderRecord
        const { res, medusaErrorHandler } = invokeComposedStoreErrorStack(
          new CartVersionMismatchError(currentCart, 7),
          { "x-correlation-id": "corr_composed_412" }
        )

        expect(medusaErrorHandler).not.toHaveBeenCalled()
        expect(res.statusCode).toBe(412)
        const body = res.body as StoreErrorResponse
        expect(isStoreErrorResponse(body)).toBe(true)
        expect(body.code).toBe(STORE_ERROR_CODES.CART_VERSION_MISMATCH)
        expect(body.retryable).toBe(false)
        expect(body.correlationId).toBe("corr_composed_412")
        expect(body.cart?.id).toBe("cart_hr06_synthetic")
        expect(res.getHeader("x-correlation-id")).toBe("corr_composed_412")
        expect(res.getHeader("ETag")).toBe('"7"')
        expectNoCanaries(body)
      })

      it("does not emit ETag for a non-cart error with an unrelated currentEtag", () => {
        const { res } = invokeComposedStoreErrorStack(
          Object.assign(new MedusaError(MedusaError.Types.INVALID_DATA, "bad"), {
            currentEtag: '"999"',
          }),
          { "x-correlation-id": "corr_composed_non_cart" }
        )

        expect(res.statusCode).toBe(400)
        expect(res.getHeader("ETag")).toBeUndefined()
      })

      it("direct normalizer: second pass of public body preserves retryable=false", () => {
        const first = toStoreErrorResponse(
          {
            type: "rate_limit",
            statusCode: 429,
            message: `rl ${CANARIES.clientSecret}`,
            uncertainSideEffect: true,
          },
          { correlationId: "corr_double_norm_01" }
        )
        expect(first.body.retryable).toBe(false)

        const second = toStoreErrorResponse(first.body, {
          correlationId: first.body.correlationId,
          statusCode: first.statusCode,
        })
        expect(second.statusCode).toBe(429)
        expect(second.body.code).toBe(STORE_ERROR_CODES.RATE_LIMITED)
        expect(second.body.retryable).toBe(false)
        expect(isStoreErrorResponse(second.body)).toBe(true)
        expectNoCanaries(second.body)
      })
    })
  })

  describe("Admin / Webhooks isolation", () => {
    it("does not apply StoreErrorResponse outside /store", () => {
      const captureException = jest.fn(() => "event-id")
      const medusaErrorHandler = jest.fn(
        (_error: unknown, _req: MedusaRequest, res: MedusaResponse) => {
          res.status(500)
          res.json({ type: "server_error", message: "Admin preserved" })
        }
      )
      const handler = createSentryErrorHandler({
        captureException,
        medusaErrorHandler,
        processRole: "server",
      })

      const adminReq = createMockRequest({
        method: "GET",
        originalUrl: "/admin/products",
        routePath: "/admin/products",
        headers: { "x-correlation-id": "corr_admin_01" },
      })
      const adminRes = createMockResponse()
      createCorrelationAndAccessLogMiddleware()(
        adminReq as never,
        adminRes as never,
        () => undefined
      )
      handler(
        new Error("admin boom"),
        adminReq as never,
        adminRes as never,
        jest.fn() as MedusaNextFunction
      )

      expect(isStoreApiRequest(adminReq as never)).toBe(false)
      expect(medusaErrorHandler).toHaveBeenCalledTimes(1)
      expect(adminRes.body).toEqual({
        type: "server_error",
        message: "Admin preserved",
      })
      expect(isStoreErrorResponse(adminRes.body)).toBe(false)

      const webhookReq = createMockRequest({
        method: "POST",
        originalUrl: "/hooks/stripe",
        routePath: "/hooks/stripe",
        headers: { "x-correlation-id": "corr_hooks_01" },
      })
      const webhookRes = createMockResponse()
      const webhookMedusa = jest.fn(
        (_error: unknown, _req: MedusaRequest, res: MedusaResponse) => {
          res.status(400)
          res.json({ ok: false, code: "WEBHOOK_INVALID" })
        }
      )
      const webhookHandler = createSentryErrorHandler({
        captureException,
        medusaErrorHandler: webhookMedusa,
        processRole: "server",
      })
      createCorrelationAndAccessLogMiddleware()(
        webhookReq as never,
        webhookRes as never,
        () => undefined
      )
      webhookHandler(
        new MedusaError(MedusaError.Types.INVALID_DATA, "bad signature"),
        webhookReq as never,
        webhookRes as never,
        jest.fn() as MedusaNextFunction
      )

      expect(isStoreApiRequest(webhookReq as never)).toBe(false)
      expect(webhookMedusa).toHaveBeenCalledTimes(1)
      expect(webhookRes.body).toEqual({ ok: false, code: "WEBHOOK_INVALID" })
      expect(isStoreErrorResponse(webhookRes.body)).toBe(false)
    })
  })
})
