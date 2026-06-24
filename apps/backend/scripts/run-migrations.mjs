#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

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

  return childEnv
}

export function runMigrations(options = {}) {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL
  assertMigrationUrl(migrationUrl)

  const childEnv = buildMigrationChildEnv(process.env)

  if (options.checkOnly) {
    return { status: 0, childEnv }
  }

  const result = spawnSync("npx", ["medusa", "db:migrate"], {
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
