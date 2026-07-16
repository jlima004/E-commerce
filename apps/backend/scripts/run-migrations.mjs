#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { writeSync } from "node:fs"
import { loadEnv } from "@medusajs/framework/utils"
import { fileURLToPath } from "node:url"
import path from "node:path"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

export const RELEASE_MIGRATION_INFRASTRUCTURE_MODE_LOG = Object.freeze({
  operation: "release_migration.infrastructure_mode",
  mode: "release_migration_db_only",
  redis_runtime_modules: "intentionally_omitted",
  operational_jobs: "disabled",
})

const backendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
)

export function assertMigrationUrl(url) {
  if (!url || url.trim().length === 0) {
    throw new Error("Missing required variable: DATABASE_MIGRATION_URL")
  }

  let parsedUrl

  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error("Invalid DATABASE_MIGRATION_URL: must be a valid URL")
  }

  if (parsedUrl.port === "6543") {
    throw new Error(
      "Invalid DATABASE_MIGRATION_URL: transaction pooler port 6543 is not allowed"
    )
  }
}

export function buildMigrationChildEnv(sourceEnv) {
  const childEnv = { ...sourceEnv }
  const migrationUrl = sourceEnv.DATABASE_MIGRATION_URL

  assertMigrationUrl(migrationUrl)
  childEnv.DATABASE_URL = migrationUrl
  childEnv.DTC_RELEASE_MIGRATION_MODE = "true"
  childEnv.DTC_RELEASE_MIGRATION_CHILD_PROCESS = "true"
  delete childEnv.WORKER_MODE

  return childEnv
}

export function runMigrations(options = {}) {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL
  assertMigrationUrl(migrationUrl)

  const childEnv = buildMigrationChildEnv(process.env)
  const writeLine = options.writeLine ?? ((line) => writeSync(1, `${line}\n`))
  const spawn = options.spawn ?? spawnSync

  writeLine(JSON.stringify(RELEASE_MIGRATION_INFRASTRUCTURE_MODE_LOG))

  if (options.checkOnly) {
    return { status: 0, childEnv }
  }

  const result = spawn("npx", ["medusa", "db:migrate"], {
    cwd: backendRoot,
    env: childEnv,
    stdio: "inherit",
    shell: false,
  })

  return {
    status: result.status ?? 1,
    childEnv,
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) {
  const checkOnly = process.argv.includes("--check-only")

  try {
    const result = runMigrations({ checkOnly })

    if (result.status !== 0) {
      process.exit(result.status ?? 1)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(message)
    process.exit(1)
  }
}
