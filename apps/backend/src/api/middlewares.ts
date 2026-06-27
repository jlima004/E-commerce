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
import { MedusaError } from "@medusajs/utils"
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
import { env } from "../config/env"
import {
  childLogger,
  normalizeRouteOrJob,
} from "../observability/logger"
import { buildSentryCaptureContext, shouldCaptureError } from "../observability/sentry-scrub"

const CORRELATION_HEADER = "x-correlation-id"
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/
const QUERY_RUNNER_RELEASED = "QueryRunnerAlreadyReleasedError"
const TRANSACTION_STARTED = "TransactionAlreadyStartedError"
const TRANSACTION_NOT_STARTED = "TransactionNotStartedError"

type RequestWithLogging = MedusaRequest & {
  correlationId?: string
  log?: PinoLogger
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
    const formattedError = formatException(error as Error & { code?: string })
    const statusCode = resolveErrorStatusCode(formattedError)
    const level = statusCode >= 500 ? "error" : "warn"
    const persistent =
      (formattedError as { persistent?: boolean }).persistent === true
    const expected =
      (formattedError as { expected?: boolean }).expected ?? (statusCode < 500 && !persistent)

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
        correlationId: (req as RequestWithLogging).correlationId,
        processRole,
      })

      captureException(formattedError, {
        fingerprint: captureContext.fingerprint,
        tags: captureContext.tags,
        extra: captureContext.extra,
      })
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

export const sentryErrorMiddleware = createSentryErrorHandler()

export default defineMiddlewares({
  errorHandler: sentryErrorMiddleware,
  routes: [
    {
      matcher: /.*/,
      middlewares: [correlationAndAccessLogMiddleware],
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
        authenticate("customer", ["session", "bearer"], {
          allowUnauthenticated: true,
        }),
      ],
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
