import type { AppEnv } from "../config/env"
import {
  classifyRedisContracts,
  describeInfrastructureMode,
  type InfrastructureModeDescription,
} from "./infrastructure-mode"

export type RedisInfrastructureEnv = AppEnv & {
  DTC_RELEASE_MIGRATION_MODE?: string
  DTC_RELEASE_MIGRATION_CHILD_PROCESS?: string
  REDIS_CACHE_PROVIDER_DISABLED?: string
}

export type MedusaModuleDescriptor = {
  resolve: string
  options?: Record<string, unknown>
}

type InfrastructureModuleDescriptor = {
  resolve?: string
  options?: Record<string, unknown>
}

export type RedisTlsOptions = {
  tls: {
    rejectUnauthorized: boolean
  }
}

export type StandardRedisModuleOptions = {
  redisUrl: string
  redisOptions?: RedisTlsOptions
}

export type CachingRedisProviderOptions = {
  redisUrl: string
  tls?: RedisTlsOptions["tls"]
}

const CACHING_MODULE = "@medusajs/medusa/caching"
const CACHING_REDIS_PROVIDER = "@medusajs/caching-redis"
const EVENT_BUS_REDIS = "@medusajs/medusa/event-bus-redis"
const WORKFLOW_ENGINE_REDIS = "@medusajs/medusa/workflow-engine-redis"
const LOCKING_MODULE = "@medusajs/medusa/locking"
const LOCKING_REDIS_PROVIDER = "@medusajs/medusa/locking-redis"

const IN_MEMORY_RESOLVES = [
  "@medusajs/medusa/event-bus-local",
  "@medusajs/medusa/workflow-engine-inmemory",
  "@medusajs/medusa/cache-inmemory",
]

type ProductionRedisAssertionInput = {
  env: RedisInfrastructureEnv
  mode: InfrastructureModeDescription
  projectConfig: {
    redisUrl?: unknown
  }
  modules: InfrastructureModuleDescriptor[]
}

function isNonEmptyUrl(value: string | undefined): value is string {
  return Boolean(value && value.trim().length > 0)
}

function productionRedisError(issues: string[]): Error {
  const details = [...new Set(issues)].join(", ")
  return new Error(
    details
      ? `Production Redis infrastructure is incomplete: ${details}`
      : "Production Redis infrastructure is incomplete"
  )
}

export function hasRedisModuleContracts(env: AppEnv): boolean {
  return classifyRedisContracts(env).state === "complete"
}

export function shouldWireRedisModules(env: RedisInfrastructureEnv): boolean {
  return describeInfrastructureMode(env).redis_runtime_modules === "enabled"
}

export function shouldWireRedisCachingProvider(
  env: Pick<
    RedisInfrastructureEnv,
    "NODE_ENV" | "REDIS_CACHE_PROVIDER_DISABLED"
  > = {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    REDIS_CACHE_PROVIDER_DISABLED:
      process.env.REDIS_CACHE_PROVIDER_DISABLED,
  }
): boolean {
  return (
    env.NODE_ENV !== "production" ||
    env.REDIS_CACHE_PROVIDER_DISABLED !== "true"
  )
}

export function resolveProjectRedisUrl(
  env: RedisInfrastructureEnv
): string | undefined {
  if (!shouldWireRedisModules(env)) {
    return undefined
  }

  if (!isNonEmptyUrl(env.REDIS_URL)) {
    throw new Error("Missing required Redis module contract: REDIS_URL")
  }

  return env.REDIS_URL.trim()
}

export function uniqueRedisUrls(env: AppEnv): string[] {
  const urls = [
    env.REDIS_URL,
    env.CACHE_REDIS_URL,
    env.EVENTS_REDIS_URL,
    env.WE_REDIS_URL,
  ].filter(isNonEmptyUrl)

  return [...new Set(urls)]
}

export function redisOptionsForUrl(
  redisUrl: string | undefined
): RedisTlsOptions | undefined {
  if (!isNonEmptyUrl(redisUrl)) {
    return undefined
  }

  let parsedUrl: URL

  try {
    parsedUrl = new URL(redisUrl.trim())
  } catch {
    return undefined
  }

  if (parsedUrl.protocol !== "rediss:") {
    return undefined
  }

  if (process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false") {
    return undefined
  }

  return {
    tls: {
      rejectUnauthorized: false,
    },
  }
}

export function buildStandardRedisModuleOptions(
  redisUrl: string
): StandardRedisModuleOptions {
  const trimmedRedisUrl = redisUrl.trim()
  const redisOptions = redisOptionsForUrl(trimmedRedisUrl)

  return redisOptions
    ? { redisUrl: trimmedRedisUrl, redisOptions }
    : { redisUrl: trimmedRedisUrl }
}

export function buildCachingRedisProviderOptions(
  redisUrl: string
): CachingRedisProviderOptions {
  const trimmedRedisUrl = redisUrl.trim()
  const redisOptions = redisOptionsForUrl(trimmedRedisUrl)

  return redisOptions
    ? { redisUrl: trimmedRedisUrl, ...redisOptions }
    : { redisUrl: trimmedRedisUrl }
}

export function buildRedisModules(env: AppEnv): MedusaModuleDescriptor[] {
  if (!shouldWireRedisModules(env)) {
    return []
  }

  if (env.NODE_ENV === "production") {
    if (!shouldWireRedisCachingProvider(env)) {
      throw productionRedisError(["REDIS_CACHE_PROVIDER_DISABLED"])
    }
  }

  const lockingRedisUrl = resolveProjectRedisUrl(env)!

  const modules: MedusaModuleDescriptor[] = []

  if (shouldWireRedisCachingProvider(env)) {
    modules.push({
      resolve: CACHING_MODULE,
      options: {
        providers: [
          {
            resolve: CACHING_REDIS_PROVIDER,
            id: "caching-redis",
            is_default: true,
            options: buildCachingRedisProviderOptions(env.CACHE_REDIS_URL!),
          },
        ],
      },
    })
  }

  modules.push(
    {
      resolve: LOCKING_MODULE,
      options: {
        providers: [
          {
            resolve: LOCKING_REDIS_PROVIDER,
            id: "locking-redis",
            is_default: true,
            options: buildStandardRedisModuleOptions(lockingRedisUrl),
          },
        ],
      },
    },
    {
      resolve: EVENT_BUS_REDIS,
      options: buildStandardRedisModuleOptions(env.EVENTS_REDIS_URL!),
    },
    {
      resolve: WORKFLOW_ENGINE_REDIS,
      options: {
        redis: buildStandardRedisModuleOptions(env.WE_REDIS_URL!),
      },
    },
  )

  return modules
}

export function assertNoInMemoryInfrastructure(
  modules: MedusaModuleDescriptor[]
): void {
  for (const module of modules) {
    if (IN_MEMORY_RESOLVES.includes(module.resolve)) {
      throw new Error(`In-memory infrastructure module is not allowed: ${module.resolve}`)
    }
  }
}

function hasExactDefaultProvider(
  module: InfrastructureModuleDescriptor | undefined,
  providerResolve: string
): boolean {
  const providers = module?.options?.providers

  return (
    Array.isArray(providers) &&
    providers.length === 1 &&
    typeof providers[0] === "object" &&
    providers[0] !== null &&
    "resolve" in providers[0] &&
    providers[0].resolve === providerResolve &&
    "is_default" in providers[0] &&
    providers[0].is_default === true
  )
}

function isLocalOrInMemoryResolve(resolve: string): boolean {
  return (
    IN_MEMORY_RESOLVES.includes(resolve) ||
    resolve.includes("inmemory") ||
    resolve.endsWith("-local")
  )
}

export function assertProductionRedisInfrastructure({
  env,
  mode,
  projectConfig,
  modules,
}: ProductionRedisAssertionInput): void {
  if (mode.release_migration || mode.mode !== "production_redis") {
    return
  }

  const issues = classifyRedisContracts(env).missing.map(
    (contract) => `missing ${contract}`
  )

  if (!isNonEmptyUrl(projectConfig.redisUrl as string | undefined)) {
    issues.push("missing projectConfig.redisUrl")
  }

  if (!shouldWireRedisCachingProvider(env)) {
    issues.push("REDIS_CACHE_PROVIDER_DISABLED")
  }

  const requiredResolves = [
    CACHING_MODULE,
    LOCKING_MODULE,
    EVENT_BUS_REDIS,
    WORKFLOW_ENGINE_REDIS,
  ]

  for (const resolve of requiredResolves) {
    if (modules.filter((module) => module.resolve === resolve).length !== 1) {
      issues.push(`missing ${resolve}`)
    }
  }

  const cachingModule = modules.find(
    (module) => module.resolve === CACHING_MODULE
  )
  const lockingModule = modules.find(
    (module) => module.resolve === LOCKING_MODULE
  )

  if (!hasExactDefaultProvider(cachingModule, CACHING_REDIS_PROVIDER)) {
    issues.push(`missing ${CACHING_REDIS_PROVIDER}`)
  }

  if (!hasExactDefaultProvider(lockingModule, LOCKING_REDIS_PROVIDER)) {
    issues.push(`missing ${LOCKING_REDIS_PROVIDER}`)
  }

  for (const module of modules) {
    if (
      module.resolve &&
      isLocalOrInMemoryResolve(module.resolve)
    ) {
      issues.push(`forbidden ${module.resolve}`)
    }

    const providers = module.options?.providers
    if (Array.isArray(providers)) {
      for (const provider of providers) {
        if (
          typeof provider === "object" &&
          provider !== null &&
          "resolve" in provider &&
          typeof provider.resolve === "string" &&
          isLocalOrInMemoryResolve(provider.resolve)
        ) {
          issues.push(`forbidden ${provider.resolve}`)
        }
      }
    }
  }

  if (issues.length > 0) {
    throw productionRedisError(issues)
  }
}
