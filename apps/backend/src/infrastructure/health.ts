import Redis, { type RedisOptions } from "ioredis"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { AppEnv } from "../config/env"
import { env } from "../config/env"
import { appLogger, logAllowlisted } from "../observability/logger"
import { uniqueRedisUrls } from "./redis-config"

export const SERVICE_NAME = "medusa-backend"
export const CHECK_TIMEOUT_MS = 1500
export const GLOBAL_READINESS_TIMEOUT_MS = 2000
const REDIS_CONNECT_TIMEOUT_MS = 1000

export type HealthCheckStatus = "up" | "down"
export type ReadinessStatus = "ready" | "not_ready"

export type ReadinessChecks = {
  postgres: HealthCheckStatus
  redis: HealthCheckStatus
}

export type ReadinessResult = {
  status: ReadinessStatus
  checks: ReadinessChecks
}

export type ProbeLogger = {
  warn: (payload: Record<string, unknown>, message?: string) => void
}

export type RedisProbeClient = {
  connect: () => Promise<unknown>
  ping: () => Promise<unknown>
  disconnect: () => void
}

export type RedisProbeClientFactory = (
  url: string,
  options: RedisOptions
) => RedisProbeClient

type PgConnection = {
  raw: (query: string) => Promise<unknown>
}

type ScopeLike = {
  resolve: (key: string) => unknown
}

type ProbeOptions = {
  correlationId?: string
  logger?: ProbeLogger
}

export type CheckRedisOptions = ProbeOptions & {
  env?: AppEnv
  createClient?: RedisProbeClientFactory
}

export type CheckReadinessOptions = ProbeOptions & {
  checkPostgres?: () => Promise<HealthCheckStatus>
  checkRedis?: () => Promise<HealthCheckStatus>
  timeoutMs?: number
  globalTimeoutMs?: number
}

function toErrorClass(error: unknown): string {
  if (error instanceof Error && error.name) {
    return error.name
  }

  return "Error"
}

function logExpectedDependencyFailure(
  check: keyof ReadinessChecks,
  operation: string,
  error: unknown,
  options: ProbeOptions = {}
): void {
  const payload = {
    check,
    operation,
    correlation_id: options.correlationId,
    error_class: toErrorClass(error),
  }

  if (options.logger) {
    options.logger.warn(payload, "health dependency unavailable")
    return
  }

  logAllowlisted(appLogger, "warn", payload, "health dependency unavailable")
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutValue: T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      resolve(timeoutValue)
    }, timeoutMs)

    promise.then(
      (value) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

export async function checkPostgres(
  scope: ScopeLike | undefined,
  options: ProbeOptions = {}
): Promise<HealthCheckStatus> {
  try {
    const pgConnection = scope?.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    ) as PgConnection | undefined

    if (!pgConnection?.raw) {
      throw new Error("Postgres connection unavailable")
    }

    await pgConnection.raw("SELECT 1")
    return "up"
  } catch (error) {
    logExpectedDependencyFailure(
      "postgres",
      "health.postgres",
      error,
      options
    )
    return "down"
  }
}

function createRedisProbeClient(
  url: string,
  options: RedisOptions
): RedisProbeClient {
  return new Redis(url, options)
}

async function pingRedisUrl(
  url: string,
  createClient: RedisProbeClientFactory
): Promise<void> {
  const client = createClient(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
  })

  try {
    await client.connect()
    await client.ping()
  } finally {
    client.disconnect()
  }
}

export async function checkRedis(
  options: CheckRedisOptions = {}
): Promise<HealthCheckStatus> {
  const urls = uniqueRedisUrls(options.env ?? env)

  if (urls.length === 0) {
    logExpectedDependencyFailure(
      "redis",
      "health.redis",
      new Error("Redis contracts unavailable"),
      options
    )
    return "down"
  }

  try {
    const createClient = options.createClient ?? createRedisProbeClient
    await Promise.all(urls.map((url) => pingRedisUrl(url, createClient)))
    return "up"
  } catch (error) {
    logExpectedDependencyFailure("redis", "health.redis", error, options)
    return "down"
  }
}

export async function checkReadiness(
  scope: ScopeLike | undefined,
  options: CheckReadinessOptions = {}
): Promise<ReadinessResult> {
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS
  const globalTimeoutMs =
    options.globalTimeoutMs ?? GLOBAL_READINESS_TIMEOUT_MS
  const postgresProbe =
    options.checkPostgres ??
    (() =>
      checkPostgres(scope, {
        correlationId: options.correlationId,
        logger: options.logger,
      }))
  const redisProbe =
    options.checkRedis ??
    (() =>
      checkRedis({
        correlationId: options.correlationId,
        logger: options.logger,
      }))

  const postgresPromise = withTimeout(postgresProbe(), timeoutMs, "down")
  const redisPromise = withTimeout(redisProbe(), timeoutMs, "down")
  const checksPromise = Promise.all([postgresPromise, redisPromise]).then(
    ([postgres, redis]) => ({ postgres, redis })
  )
  const checks = await withTimeout<ReadinessChecks>(checksPromise, globalTimeoutMs, {
    postgres: "down",
    redis: "down",
  })
  const ready = checks.postgres === "up" && checks.redis === "up"

  return {
    status: ready ? "ready" : "not_ready",
    checks,
  }
}
