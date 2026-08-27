import { randomUUID } from "crypto"
import {
  defineMiddlewares,
  errorHandler,
  formatException,
  authenticate,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import * as Sentry from "@sentry/node"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/utils"
import type { Logger as PinoLogger } from "pino"
import {
  sellableGateProductCreateMiddleware,
  sellableGateProductUpdateMiddleware,
  sellableGateVariantCreateMiddleware,
  sellableGateVariantUpdateMiddleware,
} from "./admin/products/sellable-gate-middleware"
import {
  storeCatalogQueryConfigMiddleware,
} from "./store/products/query-config"
import {
  storeCatalogResponseMiddleware,
} from "./store/products/serializers"
import {
  storeCartPreOrderQueryConfigMiddleware,
} from "./store/carts/query-config"
import {
  storeCartPreOrderResponseMiddleware,
} from "./store/carts/serializers"
import { env } from "../config/env"
import {
  childLogger,
  normalizeRouteOrJob,
} from "../observability/logger"
import { buildSentryCaptureContext, shouldCaptureError } from "../observability/sentry-scrub"
import { createStoreTrackingLookupGuardMiddleware } from "../modules/tracking-access-token/lookup"
import { storeSurfaceGuardMiddleware } from "./store-surface/guard"
import {
  authSurfaceGuardMiddleware,
  normalizeAuthRequestPath,
} from "./auth-surface/guard"
import { toAuthErrorResponse } from "./auth-surface/errors"
import {
  attachStoreErrorEnvelope,
  sanitizeStoreCorrelationId,
  toStoreErrorResponse,
} from "./store-surface/errors"
import {
  authorizeCustomerAuthAccess,
  createKnexCustomerAuthAccessDatabase,
  type CustomerAuthAccessContext,
} from "../modules/customer-auth/access-guard"
import {
  CUSTOMER_AUTH_BFF_AUTH_HEADER,
  CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS,
  authenticateBffServiceRequest,
} from "../modules/customer-auth/bff-service-auth"
import {
  STORE_CART_BFF_PROTECTED_OPERATIONS,
} from "./store/carts/bff-protected-operations"

const CORRELATION_HEADER = "x-correlation-id"
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const QUERY_RUNNER_RELEASED = "QueryRunnerAlreadyReleasedError"
const TRANSACTION_STARTED = "TransactionAlreadyStartedError"
const TRANSACTION_NOT_STARTED = "TransactionNotStartedError"

type RequestWithLogging = MedusaRequest & {
  correlationId?: string
  log?: PinoLogger
  customerAuth?: CustomerAuthAccessContext
  customerAuthBff?: { authorized: true }
}

type AccessLogMiddlewareDeps = {
  createChildLogger: typeof childLogger
}

type CaptureExceptionInput = Parameters<typeof Sentry.captureException>[1]

type SentryErrorHandlerDeps = {
  captureException?: (error: unknown, context?: CaptureExceptionInput) => string
  medusaErrorHandler?: (
    error: unknown,
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) => void
  processRole?: string
}

function resolveCorrelationId(headerValue: unknown): string {
  if (typeof headerValue === "string" && CORRELATION_ID_PATTERN.test(headerValue)) {
    return headerValue
  }

  if (Array.isArray(headerValue)) {
    const candidate = headerValue.find(
      (value) => typeof value === "string" && CORRELATION_ID_PATTERN.test(value)
    )

    if (typeof candidate === "string") {
      return candidate
    }
  }

  return randomUUID()
}

function getRouteTemplate(req: MedusaRequest): string {
  const route = (req as MedusaRequest & { route?: { path?: string } }).route

  if (route?.path) {
    return route.path
  }

  if (req.baseUrl && req.path) {
    return `${req.baseUrl}${req.path}`
  }

  return req.originalUrl || req.url || "/unknown"
}

const CUSTOMER_AUTH_REVOKE_PATH =
  "/auth/customer/emailpass/revoke-current-lineage"
const CUSTOMER_AUTH_VERIFICATION_CONTRACTS = new Set([
  "POST /store/customers/me/verify",
  "POST /store/customers/verify/resend",
  "POST /store/customers/verify",
  "GET /store/customers/me/verify/status",
  "GET /store/customers/me",
])

function resolveAuthRequestPath(req: MedusaRequest): string {
  const originalUrl = typeof req.originalUrl === "string" ? req.originalUrl : ""
  if (originalUrl === "/auth" || originalUrl.startsWith("/auth/")) {
    return originalUrl
  }

  const baseUrl = typeof req.baseUrl === "string" ? req.baseUrl : ""
  const path = typeof req.path === "string" ? req.path : ""
  const joined = `${baseUrl}${path}`
  if (joined === "/auth" || joined.startsWith("/auth/")) {
    return joined
  }

  return typeof req.url === "string" ? req.url : joined
}

function isExactCustomerAuthRevokeRequest(req: MedusaRequest): boolean {
  return (
    req.method?.toUpperCase() === "POST" &&
    normalizeAuthRequestPath(resolveAuthRequestPath(req)) ===
      CUSTOMER_AUTH_REVOKE_PATH
  )
}

function resolveStoreRequestPath(req: MedusaRequest): string {
  const candidates = [
    typeof req.originalUrl === "string" ? req.originalUrl : "",
    `${typeof req.baseUrl === "string" ? req.baseUrl : ""}${
      typeof req.path === "string" ? req.path : ""
    }`,
    typeof req.url === "string" ? req.url : "",
    (req as MedusaRequest & { route?: { path?: string } }).route?.path ?? "",
  ]

  for (const candidate of candidates) {
    const path = candidate.split(/[?#]/, 1)[0] ?? ""
    if (path === "/store" || path.startsWith("/store/")) {
      return path
    }
  }

  return ""
}

export function isExactCustomerAuthVerificationRequest(
  req: MedusaRequest
): boolean {
  return CUSTOMER_AUTH_VERIFICATION_CONTRACTS.has(
    `${req.method?.toUpperCase() ?? "GET"} ${resolveStoreRequestPath(req)}`
  )
}

export function resolveRequestRouteOrJob(req: MedusaRequest): string {
  return normalizeRouteOrJob(getRouteTemplate(req))
}

function shouldSkipSuccessfulHealthLog(route: string, statusCode: number): boolean {
  if (statusCode >= 400) {
    return false
  }

  return route === "/health/live" || route === "/health/ready"
}

function extractStringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function resolveErrorStatusCode(error: unknown): number {
  const formattedError = formatException(error as Error & { code?: string })
  const errorType = formattedError.type || formattedError.name

  switch (errorType) {
    case QUERY_RUNNER_RELEASED:
    case TRANSACTION_STARTED:
    case TRANSACTION_NOT_STARTED:
    case MedusaError.Types.CONFLICT:
      return 409
    case MedusaError.Types.UNAUTHORIZED:
      return 401
    case MedusaError.Types.FORBIDDEN:
      return 403
    case MedusaError.Types.PAYMENT_AUTHORIZATION_ERROR:
    case MedusaError.Types.DUPLICATE_ERROR:
      return 422
    case MedusaError.Types.NOT_ALLOWED:
    case MedusaError.Types.INVALID_DATA:
      return 400
    case MedusaError.Types.NOT_FOUND:
      return 404
    default:
      return 500
  }
}

function resolveCartVersionMismatchEtag(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined
  }

  const candidate = error as {
    code?: unknown
    name?: unknown
    currentEtag?: unknown
  }
  const isCartVersionMismatch =
    candidate.code === "CART_VERSION_MISMATCH" ||
    candidate.name === "CartVersionMismatchError"

  if (
    !isCartVersionMismatch ||
    typeof candidate.currentEtag !== "string" ||
    !/^"[1-9]\d*"$/.test(candidate.currentEtag)
  ) {
    return undefined
  }

  return candidate.currentEtag
}

function buildSentryOperation(
  error: unknown,
  req: MedusaRequest
): string {
  return (
    extractStringField((error as { operation?: unknown })?.operation) ??
    `http.${req.method.toLowerCase()}`
  )
}

function buildSentryIntegration(error: unknown): string | undefined {
  return extractStringField((error as { integration?: unknown })?.integration)
}

function buildSentryErrorClass(error: unknown): string {
  return (
    extractStringField((error as { type?: unknown })?.type) ??
    extractStringField((error as { name?: unknown })?.name) ??
    "Error"
  )
}

/**
 * Canonical Store path boundary for error-handler routing.
 * Matches `/store` and `/store/...` only — not adjacent prefixes like
 * `/storefront`, `/store-admin`, or `/storeXYZ`.
 *
 * Note: Medusa route matcher `/store*` may still mount Store middlewares for
 * adjacent prefixes; guard path normalization remains the fail-closed SSOT for
 * surface decisions (untouched in 13-03-R1). This helper only selects the
 * Store vs Admin/Webhooks error-response branch.
 */
export function isCanonicalStoreRequestPath(raw: string): boolean {
  if (typeof raw !== "string" || raw.length === 0) {
    return false
  }
  const withoutQuery = raw.split(/[?#]/, 1)[0] ?? ""
  return withoutQuery === "/store" || withoutQuery.startsWith("/store/")
}

/**
 * Store-only surface detection. Admin (/admin) and Webhooks (/hooks)
 * must keep the existing Medusa error delegation path.
 */
export function isStoreApiRequest(req: MedusaRequest): boolean {
  const originalUrl = typeof req.originalUrl === "string" ? req.originalUrl : ""
  if (isCanonicalStoreRequestPath(originalUrl)) {
    return true
  }

  const url = typeof req.url === "string" ? req.url : ""
  if (isCanonicalStoreRequestPath(url)) {
    return true
  }

  const baseUrl = typeof req.baseUrl === "string" ? req.baseUrl : ""
  const path = typeof req.path === "string" ? req.path : ""
  const joined = `${baseUrl}${path}`
  if (isCanonicalStoreRequestPath(joined)) {
    return true
  }

  const routePath = (req as MedusaRequest & { route?: { path?: string } }).route
    ?.path
  return typeof routePath === "string" && isCanonicalStoreRequestPath(routePath)
}

function extractStoreFieldErrors(
  error: unknown
): Record<string, unknown> | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined
  }

  const candidate = error as {
    fieldErrors?: unknown
    fields?: unknown
  }

  if (
    candidate.fieldErrors &&
    typeof candidate.fieldErrors === "object" &&
    !Array.isArray(candidate.fieldErrors)
  ) {
    return candidate.fieldErrors as Record<string, unknown>
  }

  if (
    candidate.fields &&
    typeof candidate.fields === "object" &&
    !Array.isArray(candidate.fields)
  ) {
    return candidate.fields as Record<string, unknown>
  }

  return undefined
}

export function createStoreErrorEnvelopeMiddleware() {
  return function storeErrorEnvelopeMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): void {
    if (!isExactCustomerAuthVerificationRequest(req)) {
      attachStoreErrorEnvelope(req as RequestWithLogging, res)
    }
    next()
  }
}

export function createSentryErrorHandler(
  deps: SentryErrorHandlerDeps = {}
) {
  const medusaHandler = deps.medusaErrorHandler ?? errorHandler()
  const captureException = deps.captureException ?? Sentry.captureException
  const processRole = deps.processRole ?? env.WORKER_MODE

  return function sentryErrorHandler(
    error: unknown,
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ) {
    const request = req as RequestWithLogging
    const formattedError = formatException(error as Error & { code?: string })
    const statusCode = resolveErrorStatusCode(formattedError)
    const level = statusCode >= 500 ? "error" : "warn"
    const persistent =
      (formattedError as { persistent?: boolean }).persistent === true
    const expected =
      (formattedError as { expected?: boolean }).expected ?? (statusCode < 500 && !persistent)

    // Sanitize correlation once; reuse across Sentry / header / Store body.
    const correlationId = sanitizeStoreCorrelationId(request.correlationId)
    request.correlationId = correlationId

    if (
      shouldCaptureError({
        level,
        expected,
        persistent,
      })
    ) {
      const routeOrJob = resolveRequestRouteOrJob(req)
      const operation = buildSentryOperation(formattedError, req)
      const integration = buildSentryIntegration(formattedError)
      const errorClass = buildSentryErrorClass(formattedError)
      const captureContext = buildSentryCaptureContext({
        errorClass,
        operation,
        integration,
        routeOrJob,
        correlationId,
        processRole,
      })

      captureException(formattedError, {
        fingerprint: captureContext.fingerprint,
        tags: captureContext.tags,
        extra: captureContext.extra,
      })
    }

    // Store-only public envelope. Admin/Webhooks keep Medusa delegation.
    if (isStoreApiRequest(req)) {
      if (res.headersSent) {
        return
      }

      if (isExactCustomerAuthVerificationRequest(req)) {
        const normalized = toAuthErrorResponse(
          { code: "AUTH_TEMPORARILY_UNAVAILABLE" },
          { correlationId }
        )
        res.setHeader(CORRELATION_HEADER, correlationId)
        res.setHeader("Retry-After", "60")
        res.status(normalized.statusCode).json(normalized.body)
        return
      }

      const normalized = toStoreErrorResponse(formattedError, {
        correlationId,
        fieldErrors: extractStoreFieldErrors(error),
      })

      request.log?.warn({
        operation: "http.store_error",
        error_code: normalized.body.code,
        status: normalized.statusCode,
        correlation_id: correlationId,
      })

      res.setHeader(CORRELATION_HEADER, correlationId)
      const currentCartEtag = resolveCartVersionMismatchEtag(formattedError)
      if (currentCartEtag !== undefined) {
        res.setHeader("ETag", currentCartEtag)
      }
      if (normalized.retryAfterSeconds !== undefined) {
        res.setHeader("Retry-After", String(normalized.retryAfterSeconds))
      }
      res.status(normalized.statusCode).json(normalized.body)
      return
    }

    medusaHandler(error, req, res, next)
  }
}

export function createCorrelationAndAccessLogMiddleware(
  deps: AccessLogMiddlewareDeps = { createChildLogger: childLogger }
) {
  return function correlationAndAccessLogMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): void {
    const startedAt = Date.now()
    const correlationId = resolveCorrelationId(req.headers[CORRELATION_HEADER])
    const request = req as RequestWithLogging

    request.correlationId = correlationId
    request.log = deps.createChildLogger({ correlation_id: correlationId })
    res.setHeader(CORRELATION_HEADER, correlationId)

    res.on("finish", () => {
      const route = normalizeRouteOrJob(getRouteTemplate(req))
      const status = res.statusCode
      const durationMs = Math.max(0, Date.now() - startedAt)

      if (shouldSkipSuccessfulHealthLog(route, status)) {
        return
      }

      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info"

      request.log?.[level]({
        operation: "http.access",
        method: req.method,
        route,
        status,
        duration_ms: durationMs,
      })
    })

    next()
  }
}

export const correlationAndAccessLogMiddleware =
  createCorrelationAndAccessLogMiddleware()

export const storeErrorEnvelopeMiddleware = createStoreErrorEnvelopeMiddleware()

export const sentryErrorMiddleware = createSentryErrorHandler()

export const storeTrackingLookupGuardMiddleware =
  createStoreTrackingLookupGuardMiddleware()

export type CustomerAuthAccessGuardMiddlewareOptions = {
  now?: () => Date
}

export function createCustomerAuthAccessGuardMiddleware(
  options: CustomerAuthAccessGuardMiddlewareOptions = {}
) {
  return async function customerAuthAccessGuardMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): Promise<void> {
    const request = req as RequestWithLogging
    let decision

    try {
      const connection = req.scope.resolve(
        ContainerRegistrationKeys.PG_CONNECTION
      ) as {
        raw(
          sql: string,
          bindings?: unknown[]
        ): Promise<{ rows?: Array<Record<string, unknown>> }>
      }
      if (!connection || typeof connection.raw !== "function") {
        throw new Error("CUSTOMER_AUTH_POSTGRES_UNAVAILABLE")
      }
      decision = await authorizeCustomerAuthAccess(
        createKnexCustomerAuthAccessDatabase(connection),
        req.headers.authorization,
        {
          jwtSecret: env.JWT_SECRET,
          now: options.now?.() ?? new Date(),
          ...(isExactCustomerAuthRevokeRequest(req)
            ? { operation: "revoke-current-lineage" as const }
            : {}),
        }
      )
    } catch {
      decision = {
        authorized: false as const,
        statusCode: 503 as const,
        code: "AUTH_TEMPORARILY_UNAVAILABLE" as const,
      }
    }

    if (!decision.authorized) {
      const normalized = toAuthErrorResponse(
        { code: decision.code },
        { correlationId: request.correlationId }
      )
      res.status(normalized.statusCode).json(normalized.body)
      return
    }

    request.customerAuth = decision
    next()
  }
}

export const customerAuthAccessGuardMiddleware =
  createCustomerAuthAccessGuardMiddleware()

export type CustomerAuthBffServiceGuardMiddlewareOptions = {
  expectedSecret?: string
}

export function createCustomerAuthBffServiceGuardMiddleware(
  options: CustomerAuthBffServiceGuardMiddlewareOptions = {}
) {
  return function customerAuthBffServiceGuardMiddleware(
    req: MedusaRequest,
    res: MedusaResponse,
    next: MedusaNextFunction
  ): void {
    const request = req as RequestWithLogging
    const decision = authenticateBffServiceRequest({
      expectedSecret: Object.prototype.hasOwnProperty.call(
        options,
        "expectedSecret"
      )
        ? options.expectedSecret
        : env.CUSTOMER_AUTH_BFF_SERVICE_SECRET,
      headerValue: req.headers[CUSTOMER_AUTH_BFF_AUTH_HEADER],
    })

    if (decision.outcome === "authorized") {
      request.customerAuthBff = { authorized: true }
      next()
      return
    }

    if (decision.outcome === "unavailable") {
      const normalized = toAuthErrorResponse(
        { code: "AUTH_TEMPORARILY_UNAVAILABLE" },
        { correlationId: request.correlationId }
      )
      res.status(normalized.statusCode).json(normalized.body)
      return
    }

    if (!res.headersSent) {
      res.status(404).json({ type: "not_found", message: "Not Found" })
    }
  }
}

export const customerAuthBffServiceGuardMiddleware =
  createCustomerAuthBffServiceGuardMiddleware()

function customerAuthBffProtectedRouteEntries(): Array<{
  method: Array<"GET" | "POST">
  matcher: string
  middlewares: Array<
    | typeof customerAuthBffServiceGuardMiddleware
    | typeof customerAuthAccessGuardMiddleware
  >
}> {
  return CUSTOMER_AUTH_BFF_PROTECTED_OPERATIONS.map((operation) => {
    const [rawMethod, path] = operation.split(" ")
    const method = rawMethod as "GET" | "POST"
    const requiresCustomerAccess =
      path === "/auth/customer/emailpass/revoke-current-lineage" ||
      path === "/store/customers/me" ||
      path === "/store/customers/me/verify" ||
      path === "/store/customers/me/verify/status"
    // POST /store/customers/me/password stays BFF-only: the handler owns
    // stable-or-resume access and must not inherit the stable-only access guard.

    return {
      method: [method],
      matcher: path,
      middlewares: requiresCustomerAccess
        ? [
            customerAuthBffServiceGuardMiddleware,
            customerAuthAccessGuardMiddleware,
          ]
        : [customerAuthBffServiceGuardMiddleware],
    }
  })
}

function storeCartBffProtectedRouteEntries(): Array<{
  method: Array<"GET" | "POST" | "DELETE">
  matcher: string
  middlewares: Array<
    | typeof customerAuthBffServiceGuardMiddleware
    | ReturnType<typeof authenticate>
  >
}> {
  return STORE_CART_BFF_PROTECTED_OPERATIONS.map((operation) => {
    const [rawMethod, path] = operation.split(" ")
    const method = rawMethod as "GET" | "POST" | "DELETE"
    const requiresCustomerBearer =
      path === "/store/customers/me/cart/merge" ||
      path === "/store/carts/:id/review/acknowledge"

    return {
      method: [method],
      matcher: path,
      middlewares: requiresCustomerBearer
        ? [
            customerAuthBffServiceGuardMiddleware,
            authenticate("customer", ["bearer"]),
          ]
        : [customerAuthBffServiceGuardMiddleware],
    }
  })
}

export default defineMiddlewares({
  errorHandler: sentryErrorMiddleware,
  routes: [
    {
      matcher: /.*/,
      middlewares: [correlationAndAccessLogMiddleware],
    },
    // Method-less /store* → RoutesSorter global bucket (Medusa 2.16.0), before
    // static/params Store business middlewares and handlers. Fail-closed SSOT.
    // Envelope wraps writers first so early guard DENYs become StoreErrorResponse
    // without editing guard classification/runtime policy.
    {
      matcher: "/store*",
      middlewares: [storeErrorEnvelopeMiddleware, storeSurfaceGuardMiddleware],
    },
    // Method-less /auth* is sorted before native/local handlers. Every Phase 14
    // entry starts DENY; owner plans may elevate one exact local override only.
    {
      matcher: "/auth*",
      middlewares: [authSurfaceGuardMiddleware],
    },
    // Exact Phase 14 BFF contracts only. Surface guards stay on /auth* and
    // /store*. BFF service auth is caller authority, not method/path policy.
    ...customerAuthBffProtectedRouteEntries(),
    // Exact Phase 15 Store Cart BFF contracts. Mixed Guest+Customer routes:
    // BFF service guard only; access guard is never mounted unconditionally.
    ...storeCartBffProtectedRouteEntries(),
    {
      method: ["POST", "DELETE"],
      matcher: "/store/carts/:id/line-items",
      middlewares: [
        storeCartPreOrderQueryConfigMiddleware,
        storeCartPreOrderResponseMiddleware,
      ],
    },
    {
      method: ["POST", "DELETE"],
      matcher: "/store/carts/:id/line-items/:line_id",
      middlewares: [
        storeCartPreOrderQueryConfigMiddleware,
        storeCartPreOrderResponseMiddleware,
      ],
    },
    {
      method: ["GET"],
      matcher: "/store/products",
      middlewares: [
        storeCatalogQueryConfigMiddleware,
        storeCatalogResponseMiddleware,
      ],
    },
    {
      method: ["GET"],
      matcher: "/store/products/:id",
      middlewares: [
        storeCatalogQueryConfigMiddleware,
        storeCatalogResponseMiddleware,
      ],
    },
    {
      method: ["GET", "POST"],
      matcher: "/store/carts/active",
      middlewares: [
        storeCartPreOrderQueryConfigMiddleware,
        storeCartPreOrderResponseMiddleware,
      ],
    },
    {
      method: ["POST"],
      matcher: "/store/customers/me/cart/attach",
      middlewares: [
        customerAuthBffServiceGuardMiddleware,
        authenticate("customer", ["session", "bearer"]),
        storeCartPreOrderQueryConfigMiddleware,
        storeCartPreOrderResponseMiddleware,
      ],
    },
    {
      method: ["POST"],
      matcher: "/store/carts/:id/payment-attempts/card",
      middlewares: [
        authenticate("customer", ["session", "bearer"], {
          allowUnauthenticated: true,
        }),
        storeCartPreOrderQueryConfigMiddleware,
      ],
    },
    {
      method: ["POST"],
      matcher: "/store/carts/:id/payment-attempts/pix",
      middlewares: [
        authenticate("customer", ["session", "bearer"], {
          allowUnauthenticated: true,
        }),
        storeCartPreOrderQueryConfigMiddleware,
      ],
    },
    {
      method: ["POST"],
      matcher: "/hooks/stripe",
      bodyParser: {
        preserveRawBody: true,
      },
    },
    {
      method: ["GET"],
      matcher: "/openapi/admin.json",
      middlewares: [
        authenticate("user", ["session", "bearer"], {
          allowUnauthenticated: true,
        }),
      ],
    },
    {
      method: ["GET"],
      matcher: "/openapi/webhooks.json",
      middlewares: [
        authenticate("user", ["session", "bearer"], {
          allowUnauthenticated: true,
        }),
      ],
    },
    {
      method: ["GET"],
      matcher: "/docs/assets/:asset",
      middlewares: [
        authenticate("user", ["session", "bearer"], {
          allowUnauthenticated: true,
        }),
      ],
    },
    {
      method: ["POST"],
      matcher: "/store/tracking/lookup",
      middlewares: [storeTrackingLookupGuardMiddleware],
    },
    {
      method: ["POST"],
      matcher: "/admin/products/:id/variants/:variant_id",
      middlewares: [sellableGateVariantUpdateMiddleware],
    },
    {
      method: ["POST"],
      matcher: "/admin/products/:id/variants",
      middlewares: [sellableGateVariantCreateMiddleware],
    },
    {
      method: ["POST"],
      matcher: "/admin/products/:id",
      middlewares: [sellableGateProductUpdateMiddleware],
    },
    {
      method: ["POST"],
      matcher: "/admin/products",
      middlewares: [sellableGateProductCreateMiddleware],
    },
  ],
})
