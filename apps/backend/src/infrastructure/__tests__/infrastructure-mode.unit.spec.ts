import { describeInfrastructureMode } from "../infrastructure-mode"

const completeRedisContracts = {
  REDIS_URL: "redis://shared.invalid:6379",
  CACHE_REDIS_URL: "redis://cache.invalid:6379",
  EVENTS_REDIS_URL: "redis://events.invalid:6379",
  WE_REDIS_URL: "redis://workflow.invalid:6379",
}

describe("describeInfrastructureMode", () => {
  it("classifica o filho de migration como DB-only sem retornar contratos", () => {
    expect(
      describeInfrastructureMode({
        NODE_ENV: "production",
        DTC_RELEASE_MIGRATION_MODE: "true",
        DTC_RELEASE_MIGRATION_CHILD_PROCESS: "true",
      })
    ).toEqual({
      mode: "release_migration_db_only",
      release_migration: true,
      redis_runtime_modules: "intentionally_omitted",
    })
  })

  it("classifica producao completa como Redis obrigatorio", () => {
    expect(
      describeInfrastructureMode({
        NODE_ENV: "production",
        ...completeRedisContracts,
      })
    ).toEqual({
      mode: "production_redis",
      release_migration: false,
      redis_runtime_modules: "enabled",
    })
  })

  it("mantem desenvolvimento sem Redis opcional e completo habilitado", () => {
    expect(describeInfrastructureMode({ NODE_ENV: "development" })).toEqual({
      mode: "local_optional",
      release_migration: false,
      redis_runtime_modules: "optional",
    })
    expect(
      describeInfrastructureMode({
        NODE_ENV: "development",
        ...completeRedisContracts,
      })
    ).toEqual({
      mode: "local_optional",
      release_migration: false,
      redis_runtime_modules: "enabled",
    })
  })

  it("recusa contratos Redis parciais localmente sem expor valores", () => {
    const canary = "rediss://username:password@host-canary.internal:6379"

    try {
      describeInfrastructureMode({
        NODE_ENV: "development",
        REDIS_URL: canary,
      })
      throw new Error("Expected local classification to fail")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).toContain("Local Redis infrastructure is incomplete")
      expect(message).toContain("CACHE_REDIS_URL")
      expect(message).not.toContain("rediss://")
      expect(message).not.toContain("username")
      expect(message).not.toContain("password")
      expect(message).not.toContain("host-canary")
    }
  })

  it("falha de forma sanitizada quando producao esta incompleta", () => {
    const canary = "rediss://username:password@host-canary.internal:6379"

    expect(() =>
      describeInfrastructureMode({
        NODE_ENV: "production",
        REDIS_URL: canary,
      })
    ).toThrow("Production Redis infrastructure is incomplete")

    try {
      describeInfrastructureMode({
        NODE_ENV: "production",
        REDIS_URL: canary,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      expect(message).not.toContain("rediss://")
      expect(message).not.toContain("username")
      expect(message).not.toContain("password")
      expect(message).not.toContain("host-canary")
    }
  })
})
