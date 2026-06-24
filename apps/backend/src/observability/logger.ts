import pino, { type DestinationStream, type Logger as PinoLogger } from "pino"
import { sanitizeContext, sanitizeError } from "./sanitize"

const SERVICE_NAME = "@dtc/backend"
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MEDUSA_ID_SEGMENT =
  /^(order|cart|cus|pay|prod|variant|item|reg|pcol|pses|line|ful|ref|ex)_[a-z0-9]+$/i

export type LoggerEnvironment = "production" | "local"

export type CreateLoggerOptions = {
  environment: LoggerEnvironment
  destination?: DestinationStream
}

export type ErrorGroupingInput = {
  errorClass: string
  operation: string
  integration?: string
  routeOrJob: string
}

function normalizeSegment(segment: string): string {
  if (UUID_SEGMENT.test(segment)) {
    return ":id"
  }

  if (MEDUSA_ID_SEGMENT.test(segment)) {
    return ":id"
  }

  if (/^\d+$/.test(segment)) {
    return ":n"
  }

  if (segment.length > 48) {
    return ":token"
  }

  return segment.toLowerCase().replace(/[^a-z0-9:_-]/g, "_")
}

export function normalizeRouteOrJob(value: string): string {
  if (!value) {
    return "/unknown"
  }

  const pathOnly = value.split("?")[0]?.split("#")[0] ?? value
  const segments = pathOnly
    .split("/")
    .filter(Boolean)
    .map(normalizeSegment)

  const normalized = `/${segments.join("/")}`
  return normalized.slice(0, 120)
}

export function buildErrorGroupingKey(input: ErrorGroupingInput): string {
  const integration = (input.integration || "core").toLowerCase()
  const errorClass = input.errorClass.toLowerCase()
  const operation = input.operation.toLowerCase()
  const routeOrJob = normalizeRouteOrJob(input.routeOrJob)

  return [errorClass, operation, integration, routeOrJob].join("|")
}

function buildBaseOptions(environment: LoggerEnvironment) {
  return {
    level: environment === "production" ? "info" : "debug",
    base: {
      service: SERVICE_NAME,
    },
    serializers: {
      err: sanitizeError,
      error: sanitizeError,
    },
    formatters: {
      log(object: Record<string, unknown>) {
        const { err, error, ...rest } = object
        const sanitized = sanitizeContext(rest)

        if (err !== undefined) {
          sanitized.err = err instanceof Error ? sanitizeError(err) : err
        }

        if (error !== undefined) {
          sanitized.error =
            error instanceof Error ? sanitizeError(error) : error
        }

        return sanitized
      },
    },
  }
}

export function createLogger(options: CreateLoggerOptions): PinoLogger {
  const baseOptions = buildBaseOptions(options.environment)

  if (options.destination) {
    return pino(baseOptions, options.destination)
  }

  if (options.environment === "local") {
    return pino({
      ...baseOptions,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    })
  }

  return pino(baseOptions)
}

function resolveEnvironment(): LoggerEnvironment {
  return process.env.NODE_ENV === "production" ? "production" : "local"
}

export const appLogger = createLogger({
  environment: resolveEnvironment(),
})

export function childLogger(context: Record<string, unknown>): PinoLogger {
  return appLogger.child(sanitizeContext(context))
}

export function logAllowlisted(
  logger: PinoLogger,
  level: "info" | "warn" | "error" | "debug",
  context: Record<string, unknown>,
  message?: string
): void {
  const payload = sanitizeContext(context)

  if (message) {
    logger[level](payload, message)
    return
  }

  logger[level](payload)
}
