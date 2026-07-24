import { spawnSync } from "node:child_process"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describeInfrastructureMode } from "../infrastructure-mode"

const moduleUrl = pathToFileURL(
  path.resolve(process.cwd(), "scripts/run-migrations.mjs")
).href

function runModuleSnippet(source: string) {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      DATABASE_MIGRATION_URL:
        "postgresql://migration-user:migration-password@db.invalid:5432/app",
      REDIS_URL: "rediss://username:password@host-canary.invalid:6379",
      CACHE_REDIS_URL: "rediss://username:password@host-canary.invalid:6379",
      EVENTS_REDIS_URL: "rediss://username:password@host-canary.invalid:6379",
      WE_REDIS_URL: "rediss://username:password@host-canary.invalid:6379",
    },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: 10_000,
  })
}

function emitJsonExpression(expression: string): string {
  return `
    const { writeSync } = await import("node:fs")
    writeSync(1, JSON.stringify(${expression}) + "\\n")
  `
}

function assertSuccessfulSnippet(
  result: ReturnType<typeof runModuleSnippet>
): void {
  const stdoutLength = result.stdout?.length ?? 0
  const stderrLength = result.stderr?.length ?? 0

  if (
    result.error ||
    result.signal !== null ||
    result.status !== 0 ||
    stdoutLength === 0
  ) {
    const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code

    throw new Error(
      [
        "migration subprocess probe failed",
        `status=${String(result.status)}`,
        `signal=${String(result.signal)}`,
        `error.code=${errorCode ?? "none"}`,
        `stdout.length=${stdoutLength}`,
        `stderr.length=${stderrLength}`,
      ].join(" ")
    )
  }
}

function parseJsonLines(stdout: string): Array<Record<string, unknown>> {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe("run-migrations", () => {
  it("constroi copia controlada sem mutar a fonte ou o ambiente do chamador", () => {
    const result = runModuleSnippet(`
      const before = process.env.DTC_RELEASE_MIGRATION_MODE
      const module = await import(${JSON.stringify(moduleUrl)})
      const afterImport = process.env.DTC_RELEASE_MIGRATION_MODE
      const source = {
        DATABASE_MIGRATION_URL: process.env.DATABASE_MIGRATION_URL,
        WORKER_MODE: "worker",
      }
      const snapshot = JSON.stringify(source)
      const childEnv = module.buildMigrationChildEnv(source)
      ${emitJsonExpression(`{
        before,
        afterImport,
        sourceUnchanged: JSON.stringify(source) === snapshot,
        migrationMode: childEnv.DTC_RELEASE_MIGRATION_MODE,
        childMarker: childEnv.DTC_RELEASE_MIGRATION_CHILD_PROCESS,
        databaseUrlCopied: childEnv.DATABASE_URL === source.DATABASE_MIGRATION_URL,
        workerModeRemoved: childEnv.WORKER_MODE === undefined,
      }`)}
    `)

    assertSuccessfulSnippet(result)
    expect(parseJsonLines(result.stdout)).toEqual([
      {
        sourceUnchanged: true,
        migrationMode: "true",
        childMarker: "true",
        databaseUrlCopied: true,
        workerModeRemoved: true,
      },
    ])
  })

  it("preserva check-only sem spawn e com o mesmo childEnv controlado", () => {
    const result = runModuleSnippet(`
      const module = await import(${JSON.stringify(moduleUrl)})
      const migration = module.runMigrations({ checkOnly: true })
      ${emitJsonExpression(`{
        status: migration.status,
        migrationMode: migration.childEnv.DTC_RELEASE_MIGRATION_MODE,
        childMarker: migration.childEnv.DTC_RELEASE_MIGRATION_CHILD_PROCESS,
      }`)}
    `)

    assertSuccessfulSnippet(result)
    const lines = parseJsonLines(result.stdout)
    expect(lines.at(-1)).toEqual({
      status: 0,
      migrationMode: "true",
      childMarker: "true",
    })
  })

  it("emite uma unica linha DB-only sanitizada antes da operacao", () => {
    const result = runModuleSnippet(`
      const module = await import(${JSON.stringify(moduleUrl)})
      module.runMigrations({ checkOnly: true })
    `)

    assertSuccessfulSnippet(result)
    const lines = result.stdout.trim().split("\n").filter(Boolean)
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual({
      operation: "release_migration.infrastructure_mode",
      mode: "release_migration_db_only",
      redis_runtime_modules: "intentionally_omitted",
      operational_jobs: "disabled",
    })
    for (const forbidden of [
      "redis://",
      "rediss://",
      "username",
      "password",
      "host-canary",
    ]) {
      expect(lines[0]).not.toContain(forbidden)
    }
  })

  it("mantem o payload exportado alinhado com a classificacao pura", () => {
    const result = runModuleSnippet(`
      const module = await import(${JSON.stringify(moduleUrl)})
      ${emitJsonExpression("module.RELEASE_MIGRATION_INFRASTRUCTURE_MODE_LOG")}
    `)
    assertSuccessfulSnippet(result)
    const [payload] = parseJsonLines(result.stdout)
    const mode = describeInfrastructureMode({
      NODE_ENV: "production",
      DTC_RELEASE_MIGRATION_MODE: "true",
      DTC_RELEASE_MIGRATION_CHILD_PROCESS: "true",
    })
    expect(payload).toMatchObject({
      mode: mode.mode,
      redis_runtime_modules: mode.redis_runtime_modules,
    })
  })

  it("escreve sincronamente antes do spawn injetado sem executar migration real", () => {
    const result = runModuleSnippet(`
      const module = await import(${JSON.stringify(moduleUrl)})
      const events = []
      const migration = module.runMigrations({
        writeLine: (line) => events.push({ type: "write", line }),
        spawn: () => {
          events.push({ type: "spawn" })
          return { status: 0 }
        },
      })
      ${emitJsonExpression("{ events, status: migration.status }")}
    `)

    assertSuccessfulSnippet(result)
    const [record] = parseJsonLines(result.stdout)
    expect(record.status).toBe(0)
    expect(record.events).toEqual([
      {
        type: "write",
        line: JSON.stringify({
          operation: "release_migration.infrastructure_mode",
          mode: "release_migration_db_only",
          redis_runtime_modules: "intentionally_omitted",
          operational_jobs: "disabled",
        }),
      },
      { type: "spawn" },
    ])
  })
})
