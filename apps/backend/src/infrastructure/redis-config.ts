import type { AppEnv } from "../config/env"

export type MedusaModuleDescriptor = {
  resolve: string
  options?: Record<string, unknown>
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

function isNonEmptyUrl(value: string | undefined): value is string {
  return Boolean(value && value.trim().length > 0)
}

export function hasRedisModuleContracts(env: AppEnv): boolean {
  return (
    isNonEmptyUrl(env.CACHE_REDIS_URL) &&
    isNonEmptyUrl(env.EVENTS_REDIS_URL) &&
    isNonEmptyUrl(env.WE_REDIS_URL)
  )
}

export function shouldWireRedisModules(env: AppEnv): boolean {
  if (env.NODE_ENV === "production") {
    return true
  }

  return hasRedisModuleContracts(env)
}

export function resolveProjectRedisUrl(env: AppEnv): string | undefined {
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

export function buildRedisModules(env: AppEnv): MedusaModuleDescriptor[] {
  if (!shouldWireRedisModules(env)) {
    return []
  }

  if (!hasRedisModuleContracts(env)) {
    throw new Error(
      "Missing required Redis module contracts: CACHE_REDIS_URL, EVENTS_REDIS_URL, WE_REDIS_URL"
    )
  }

  const lockingRedisUrl = resolveProjectRedisUrl(env)!

  return [
    {
      resolve: CACHING_MODULE,
      options: {
        providers: [
          {
            resolve: CACHING_REDIS_PROVIDER,
            id: "caching-redis",
            is_default: true,
            options: {
              redisUrl: env.CACHE_REDIS_URL!.trim(),
            },
          },
        ],
      },
    },
    {
      resolve: LOCKING_MODULE,
      options: {
        providers: [
          {
            resolve: LOCKING_REDIS_PROVIDER,
            id: "locking-redis",
            is_default: true,
            options: {
              redisUrl: lockingRedisUrl,
            },
          },
        ],
      },
    },
    {
      resolve: EVENT_BUS_REDIS,
      options: {
        redisUrl: env.EVENTS_REDIS_URL!.trim(),
      },
    },
    {
      resolve: WORKFLOW_ENGINE_REDIS,
      options: {
        redis: {
          redisUrl: env.WE_REDIS_URL!.trim(),
        },
      },
    },
  ]
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
