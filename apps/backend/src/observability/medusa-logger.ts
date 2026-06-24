import type { Logger } from "@medusajs/framework/types"
import type { Logger as PinoLogger } from "pino"
import {
  appLogger,
  buildErrorGroupingKey,
  logAllowlisted,
} from "./logger"
import { sanitizeError } from "./sanitize"

function resolveError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  return new Error(typeof error === "string" ? error : "Unknown error")
}

export function createMedusaLogger(baseLogger: PinoLogger): Logger {
  let configuredLevel = "info"

  const logger: Logger = {
    panic(data: unknown): void {
      const error = resolveError(data)
      baseLogger.error({
        operation: "logger.panic",
        error_class: error.name,
        grouping_key: buildErrorGroupingKey({
          errorClass: error.name,
          operation: "logger.panic",
          routeOrJob: "/internal",
        }),
        error_chain: sanitizeError(error),
      })
    },

    shouldLog(level: string): boolean {
      const levels = ["silly", "debug", "verbose", "http", "info", "warn", "error"]
      const currentIndex = levels.indexOf(configuredLevel)
      const requestedIndex = levels.indexOf(level)
      return requestedIndex >= currentIndex
    },

    setLogLevel(level: string): void {
      configuredLevel = level
      baseLogger.level = level
    },

    unsetLogLevel(): void {
      configuredLevel = "info"
      baseLogger.level = "info"
    },

    activity(message: string, config?: unknown): string {
      const activityId = `activity_${Date.now()}`
      logAllowlisted(baseLogger, "info", {
        operation: "logger.activity",
        activity_id: activityId,
        message,
      })
      return activityId
    },

    progress(activityId: string, message: string): void {
      logAllowlisted(baseLogger, "info", {
        operation: "logger.progress",
        activity_id: activityId,
        message,
      })
    },

    error(messageOrError: string | Error, error?: Error): void {
      const primary = resolveError(messageOrError)
      const secondary = error ? resolveError(error) : undefined
      const resolvedError = secondary || primary
      const operation =
        typeof messageOrError === "string" ? messageOrError : "logger.error"
      const route = "/internal"
      const sanitized = sanitizeError(resolvedError)

      baseLogger.error(
        {
          operation,
          route,
          error_class: sanitized.name,
          grouping_key: buildErrorGroupingKey({
            errorClass: sanitized.name,
            operation,
            routeOrJob: route,
          }),
          message:
            typeof messageOrError === "string" ? messageOrError : sanitized.message,
          error_chain: sanitized,
        },
        typeof messageOrError === "string" ? messageOrError : sanitized.message
      )
    },

    failure(activityId: string, message: string): unknown {
      logAllowlisted(baseLogger, "warn", {
        operation: "logger.failure",
        activity_id: activityId,
        message,
      })
      return null
    },

    success(activityId: string, message: string): Record<string, unknown> {
      logAllowlisted(baseLogger, "info", {
        operation: "logger.success",
        activity_id: activityId,
        message,
      })
      return { activityId, message }
    },

    silly(message: string): void {
      logAllowlisted(baseLogger, "debug", {
        operation: "logger.silly",
        message,
      })
    },

    debug(message: string): void {
      logAllowlisted(baseLogger, "debug", {
        operation: "logger.debug",
        message,
      })
    },

    verbose(message: string): void {
      logAllowlisted(baseLogger, "info", {
        operation: "logger.verbose",
        message,
      })
    },

    http(message: string): void {
      logAllowlisted(baseLogger, "info", {
        operation: "logger.http",
        message,
      })
    },

    info(message: string): void {
      logAllowlisted(baseLogger, "info", {
        operation: "logger.info",
        message,
      })
    },

    warn(message: string): void {
      logAllowlisted(baseLogger, "warn", {
        operation: "logger.warn",
        message,
      })
    },

    log(...args: unknown[]): void {
      logAllowlisted(baseLogger, "info", {
        operation: "logger.log",
        message: args.map(String).join(" "),
      })
    },
  }

  return logger
}

export const medusaLogger = createMedusaLogger(appLogger)
