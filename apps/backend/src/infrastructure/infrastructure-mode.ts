import { isReleaseMigrationMode } from "./release-migration-mode"

export type InfrastructureRuntimeMode =
  | "release_migration_db_only"
  | "production_redis"
  | "local_optional"

export type InfrastructureModeDescription = {
  mode: InfrastructureRuntimeMode
  release_migration: boolean
  redis_runtime_modules: "enabled" | "intentionally_omitted" | "optional"
}

export type InfrastructureModeInput = {
  NODE_ENV?: string
  WORKER_MODE?: string
  DTC_RELEASE_MIGRATION_MODE?: string
  DTC_RELEASE_MIGRATION_CHILD_PROCESS?: string
  REDIS_URL?: string
  CACHE_REDIS_URL?: string
  EVENTS_REDIS_URL?: string
  WE_REDIS_URL?: string
}

export type RedisContractClassification = {
  state: "none" | "complete" | "partial"
  missing: string[]
}

const REDIS_CONTRACT_NAMES = [
  "REDIS_URL",
  "CACHE_REDIS_URL",
  "EVENTS_REDIS_URL",
  "WE_REDIS_URL",
] as const

function isPresent(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

export function classifyRedisContracts(
  input: InfrastructureModeInput
): RedisContractClassification {
  const missing = REDIS_CONTRACT_NAMES.filter((name) => !isPresent(input[name]))
  let state: RedisContractClassification["state"] = "partial"

  if (missing.length === 0) {
    state = "complete"
  } else if (missing.length === REDIS_CONTRACT_NAMES.length) {
    state = "none"
  }

  return {
    state,
    missing,
  }
}

export function describeInfrastructureMode(
  input: InfrastructureModeInput = process.env
): InfrastructureModeDescription {
  if (isReleaseMigrationMode(input)) {
    return {
      mode: "release_migration_db_only",
      release_migration: true,
      redis_runtime_modules: "intentionally_omitted",
    }
  }

  const contracts = classifyRedisContracts(input)

  if (input.NODE_ENV === "production") {
    if (contracts.state !== "complete") {
      // Startup validation is not an HTTP boundary.
      // eslint-disable-next-line @medusajs/use-medusa-error-not-generic-error
      throw new Error(
        `Production Redis infrastructure is incomplete: missing ${contracts.missing.join(
          ", "
        )}`
      )
    }

    return {
      mode: "production_redis",
      release_migration: false,
      redis_runtime_modules: "enabled",
    }
  }

  if (contracts.state === "partial") {
    // Startup validation is not an HTTP boundary.
    // eslint-disable-next-line @medusajs/use-medusa-error-not-generic-error
    throw new Error(
      `Local Redis infrastructure is incomplete: missing ${contracts.missing.join(
        ", "
      )}`
    )
  }

  return {
    mode: "local_optional",
    release_migration: false,
    redis_runtime_modules:
      contracts.state === "complete" ? "enabled" : "optional",
  }
}
