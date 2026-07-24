#!/usr/bin/env node

import { randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import process from "node:process"
import { Client } from "pg"
import {
  DisposablePostgresHarnessError,
  assertDisposableMedusaEnvironment,
  assertNoRealRedisProcessOutput,
  buildDatabaseEnvironment,
  buildDisposableMedusaEnvironment,
  createCleanupCoordinator,
  redactDisposableProcessOutput,
  requireDisposableContainerName,
  requireDisposableDatabaseName,
  selectProvisioningMode,
  validateMaintenanceTarget,
} from "../integration-tests/postgres/disposable-postgres-harness.ts"

const READINESS_ATTEMPTS = 60
const READINESS_DELAY_MS = 500

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    })
    let stdout = ""
    let stderr = ""

    options.onChild?.(child)
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal, stdout, stderr })
    })
  })
}

async function dockerIsAvailable() {
  try {
    const result = await run("docker", ["info"], { capture: true })
    return result.code === 0
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false
    }

    throw error
  }
}

async function dockerRun(args, capture = true) {
  return run("docker", args, { capture })
}

async function waitForDockerPostgres(containerName, username, wasSignaled) {
  for (let attempt = 1; attempt <= READINESS_ATTEMPTS; attempt += 1) {
    if (wasSignaled()) {
      throw new DisposablePostgresHarnessError("P12_DISPOSABLE_SIGNALLED")
    }

    const result = await dockerRun([
      "exec",
      containerName,
      "pg_isready",
      "-U",
      username,
      "-d",
      "postgres",
    ])

    if (result.code === 0) {
      return
    }

    await delay(READINESS_DELAY_MS)
  }

  throw new DisposablePostgresHarnessError(
    "P12_DISPOSABLE_POSTGRES_READINESS_TIMEOUT"
  )
}

async function databaseIsAbsent(maintenanceUrl, databaseName) {
  requireDisposableDatabaseName(databaseName)
  const client = new Client({ connectionString: maintenanceUrl })

  await client.connect()
  try {
    const result = await client.query(
      "select 1 from pg_database where datname = $1",
      [databaseName]
    )
    return result.rowCount === 0
  } finally {
    await client.end()
  }
}

async function removeContainer(containerName) {
  requireDisposableContainerName(containerName)
  const remove = await dockerRun(["rm", "--force", containerName])

  if (remove.code !== 0) {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_CONTAINER_CLEANUP_FAILED"
    )
  }

  const inspect = await dockerRun(["inspect", containerName])
  if (inspect.code === 0) {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_CONTAINER_RESIDUE"
    )
  }
}

function parseTestCommand(argv) {
  const separator = argv.indexOf("--")
  const command = separator >= 0 ? argv.slice(separator + 1) : []

  if (command.length === 0) {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_TEST_COMMAND_REQUIRED"
    )
  }

  return command
}

async function main() {
  const testCommand = parseTestCommand(process.argv.slice(2))
  const suppliedUrl = process.env.P12_DISPOSABLE_DATABASE_URL
  const suppliedName = process.env.P12_DISPOSABLE_DB_NAME
  const hasExternalConfig = Boolean(suppliedUrl || suppliedName)
  const dockerAvailable = hasExternalConfig ? false : await dockerIsAvailable()
  const mode = selectProvisioningMode({
    databaseUrl: suppliedUrl,
    databaseName: suppliedName,
    dockerAvailable,
  })

  let containerName
  let maintenanceUrl
  let databaseName
  let databaseEnvironment
  let activeChild
  let receivedSignal

  const signalHandler = (signal) => {
    receivedSignal = signal
    activeChild?.kill(signal)
  }
  process.once("SIGINT", signalHandler)
  process.once("SIGTERM", signalHandler)

  try {
    if (mode === "external") {
      const target = validateMaintenanceTarget(suppliedUrl, suppliedName)
      maintenanceUrl = target.url.toString()
      databaseName = target.disposableDatabase
      databaseEnvironment = buildDatabaseEnvironment(target)
    } else {
      const token = randomBytes(8).toString("hex")
      const username = `p12runner_${token}`
      const password = randomBytes(24).toString("hex")
      containerName = requireDisposableContainerName(`p12-pg-${token}`)
      databaseName = requireDisposableDatabaseName(`p12_disposable_${token}`)

      const started = await dockerRun([
        "run",
        "--detach",
        "--name",
        containerName,
        "--publish",
        "127.0.0.1::5432",
        "--env",
        `POSTGRES_USER=${username}`,
        "--env",
        `POSTGRES_PASSWORD=${password}`,
        "--env",
        "POSTGRES_DB=postgres",
        "postgres:17-alpine",
      ])

      if (started.code !== 0) {
        throw new DisposablePostgresHarnessError(
          "P12_DISPOSABLE_POSTGRES_START_FAILED"
        )
      }

      const portResult = await dockerRun(["port", containerName, "5432/tcp"])
      const publishedPort = portResult.stdout.trim().match(/:(\d+)$/)?.[1]

      if (portResult.code !== 0 || !publishedPort) {
        throw new DisposablePostgresHarnessError(
          "P12_DISPOSABLE_POSTGRES_PORT_INVALID"
        )
      }

      await waitForDockerPostgres(
        containerName,
        username,
        () => Boolean(receivedSignal)
      )

      maintenanceUrl = `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1:${publishedPort}/postgres`
      const target = validateMaintenanceTarget(maintenanceUrl, databaseName)
      databaseEnvironment = buildDatabaseEnvironment(target)
    }

    const target = validateMaintenanceTarget(maintenanceUrl, databaseName)
    const coordinator = createCleanupCoordinator({
      databaseName: target.disposableDatabase,
      containerName,
      confirmDatabaseAbsent: (name) => databaseIsAbsent(maintenanceUrl, name),
      removeContainer: containerName ? removeContainer : undefined,
    })

    console.info(
      `[P12_DISPOSABLE_POSTGRES_READY] mode=${mode} target=${target.disposableDatabase} host=${target.hostname} port=${target.port} maintenance=${target.maintenanceDatabase}`
    )

    let testResult
    let cleanupError
    try {
      const childEnv = buildDisposableMedusaEnvironment({
        ...process.env,
        ...databaseEnvironment,
      })
      assertDisposableMedusaEnvironment(childEnv)

      testResult = await run(testCommand[0], testCommand.slice(1), {
        env: childEnv,
        capture: true,
        onChild: (child) => {
          activeChild = child
        },
      })

      const redactedStdout = redactDisposableProcessOutput(
        testResult.stdout,
        childEnv
      )
      const redactedStderr = redactDisposableProcessOutput(
        testResult.stderr,
        childEnv
      )
      if (redactedStdout) {
        process.stdout.write(redactedStdout)
      }
      if (redactedStderr) {
        process.stderr.write(redactedStderr)
      }
      assertNoRealRedisProcessOutput(
        `${testResult.stdout}\n${testResult.stderr}`
      )
    } finally {
      activeChild = undefined
      try {
        await coordinator.cleanup()
        console.info(
          `[P12_DISPOSABLE_POSTGRES_CLEAN] target=${target.disposableDatabase} container=${containerName ?? "external"}`
        )
      } catch (error) {
        cleanupError = error
      }
    }

    if (cleanupError) {
      throw cleanupError
    }

    if (receivedSignal) {
      return receivedSignal === "SIGINT" ? 130 : 143
    }

    return testResult.code
  } finally {
    process.removeListener("SIGINT", signalHandler)
    process.removeListener("SIGTERM", signalHandler)

    if (containerName) {
      const inspect = await dockerRun(["inspect", containerName])
      if (inspect.code === 0) {
        await removeContainer(containerName)
      }
    }
  }
}

try {
  const exitCode = await main()
  process.exitCode = exitCode
} catch (error) {
  const code =
    error instanceof DisposablePostgresHarnessError
      ? error.code
      : "P12_DISPOSABLE_POSTGRES_FAILED"
  console.error(
    redactDisposableProcessOutput(
      `[${code}] ${error?.message ?? code}`,
      process.env
    )
  )
  process.exitCode = 1
}
