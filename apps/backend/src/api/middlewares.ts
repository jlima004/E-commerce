import { randomUUID } from "crypto"
import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import type { Logger as PinoLogger } from "pino"
import { childLogger, normalizeRouteOrJob } from "../observability/logger"

const CORRELATION_HEADER = "x-correlation-id"
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

type RequestWithLogging = MedusaRequest & {
  correlationId?: string
  log?: PinoLogger
}

type AccessLogMiddlewareDeps = {
  createChildLogger: typeof childLogger
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

function shouldSkipSuccessfulHealthLog(route: string, statusCode: number): boolean {
  if (statusCode >= 400) {
    return false
  }

  return route === "/health/live" || route === "/health/ready"
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

export default defineMiddlewares({
  routes: [
    {
      matcher: /.*/,
      middlewares: [correlationAndAccessLogMiddleware],
    },
  ],
})
