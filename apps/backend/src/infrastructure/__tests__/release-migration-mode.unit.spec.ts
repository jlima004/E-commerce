import { isReleaseMigrationMode } from "../release-migration-mode"

const migrationEnv = {
  DTC_RELEASE_MIGRATION_MODE: "true",
  DTC_RELEASE_MIGRATION_CHILD_PROCESS: "true",
}

describe("isReleaseMigrationMode", () => {
  it("ativa somente quando as duas marcas privadas do filho estao presentes", () => {
    expect(isReleaseMigrationMode(migrationEnv)).toBe(true)
    expect(isReleaseMigrationMode({})).toBe(false)
    expect(
      isReleaseMigrationMode({
        DTC_RELEASE_MIGRATION_MODE: "false",
        DTC_RELEASE_MIGRATION_CHILD_PROCESS: "true",
      })
    ).toBe(false)
  })

  it.each(["server", "worker"])(
    "recusa vazamento da flag primaria para WORKER_MODE=%s",
    (workerMode) => {
      const canary = "rediss://username:password@host-canary.internal:6379"

      for (const childMarker of [undefined, "true"]) {
        expect(() =>
          isReleaseMigrationMode({
            NODE_ENV: "production",
            WORKER_MODE: workerMode,
            DTC_RELEASE_MIGRATION_MODE: "true",
            DTC_RELEASE_MIGRATION_CHILD_PROCESS: childMarker,
            REDIS_URL: canary,
          })
        ).toThrow(
          "Release migration mode is restricted to the migration child process"
        )
      }

      try {
        isReleaseMigrationMode({
          DTC_RELEASE_MIGRATION_MODE: "true",
          REDIS_URL: canary,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        expect(message).not.toContain("rediss://")
        expect(message).not.toContain("username")
        expect(message).not.toContain("password")
        expect(message).not.toContain("host-canary")
      }
    }
  )
})
