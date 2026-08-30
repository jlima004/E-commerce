#!/usr/bin/env node

import { createRequire } from "node:module"
import { readdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import process from "node:process"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const BACKEND_ROOT = resolve(SCRIPT_DIRECTORY, "..")
const MODULES_ROOT = resolve(BACKEND_ROOT, "integration-tests/modules")
const DISPOSABLE_RUNNER = resolve(
  BACKEND_ROOT,
  "scripts/run-disposable-postgres-tests.mjs"
)
const require = createRequire(import.meta.url)

const EXPECTED_MODULE_SPECS = Object.freeze([
  "auth-notification-outbox.postgres.spec.ts",
  "auth-order-invariants.postgres.spec.ts",
  "auth-password-change-reconcile.postgres.spec.ts",
  "auth-registration.postgres.spec.ts",
  "auth-reset.postgres.spec.ts",
  "auth-session.postgres.spec.ts",
  "auth-validation-foundation.spec.ts",
  "auth-verification.postgres.spec.ts",
  "cart-merge-review.postgres.spec.ts",
  "customer-auth-email-collision.postgres.spec.ts",
  "customer-auth-models.postgres.spec.ts",
  "customer-auth-transaction-compatibility.postgres.spec.ts",
  "guest-cart-capability-link.postgres.spec.ts",
  "guest-cart-order-invariants.postgres.spec.ts",
  "guest-cart-validation-foundation.postgres.spec.ts",
  "payment-attempt-cart-authority.postgres.spec.ts",
])

const MEDUSA_RUNNER_SPECS = new Set([
  "auth-order-invariants.postgres.spec.ts",
  "cart-merge-review.postgres.spec.ts",
  "customer-auth-transaction-compatibility.postgres.spec.ts",
  "guest-cart-capability-link.postgres.spec.ts",
  "guest-cart-order-invariants.postgres.spec.ts",
  "payment-attempt-cart-authority.postgres.spec.ts",
])

const R5_SPEC = "guest-cart-order-invariants.postgres.spec.ts"
const R3_SPEC = "customer-auth-transaction-compatibility.postgres.spec.ts"
const REQUIRED_NODE_OPTION = "--experimental-vm-modules"
const DIAGNOSTIC_R5_R3 = "--diagnostic-r5-r3"
const DIAGNOSTIC_FAILURE = "--diagnostic-failure"

class ModulesOrchestratorError extends Error {
  constructor(code) {
    super(code)
    this.name = "ModulesOrchestratorError"
    this.code = code
  }
}

let activeChild
let receivedSignal

const DISPOSABLE_CONTEXT_STATE = Object.freeze({
  NONE: "NONE",
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
})

function readPairState(environment, firstName, secondName) {
  const hasFirst = Boolean(environment[firstName]?.trim())
  const hasSecond = Boolean(environment[secondName]?.trim())

  if (hasFirst && hasSecond) {
    return DISPOSABLE_CONTEXT_STATE.COMPLETE
  }
  if (!hasFirst && !hasSecond) {
    return DISPOSABLE_CONTEXT_STATE.NONE
  }
  return DISPOSABLE_CONTEXT_STATE.PARTIAL
}

function readProvisioningContextState(environment = process.env) {
  return readPairState(
    environment,
    "P12_DISPOSABLE_DATABASE_URL",
    "P12_DISPOSABLE_DB_NAME"
  )
}

function readActiveDisposableContextState(environment = process.env) {
  return readPairState(environment, "DATABASE_URL", "DB_TEMP_NAME")
}

function normalizeRelativePath(value) {
  return value.split("\\").join("/")
}

function addNodeOption(existing, requiredOption) {
  const current = (existing ?? "").trim()
  if (current.split(/\s+/).includes(requiredOption)) {
    return current
  }
  return [current, requiredOption].filter(Boolean).join(" ")
}

function buildTestEnvironment() {
  return {
    ...process.env,
    NODE_ENV: "test",
    TEST_TYPE: "integration:modules",
    NODE_OPTIONS: addNodeOption(process.env.NODE_OPTIONS, REQUIRED_NODE_OPTION),
    PATH: process.env.PATH ?? "",
  }
}

function buildNestedTestEnvironment() {
  const environment = buildTestEnvironment()
  delete environment.P12_DISPOSABLE_DATABASE_URL
  delete environment.P12_DISPOSABLE_DB_NAME
  return environment
}

function processOutputSecrets() {
  return Object.entries(process.env)
    .filter(([name, value]) => {
      return (
        Boolean(value) &&
        /(?:SECRET|PASSWORD|TOKEN|KEY|DSN|DATABASE_URL|REDIS_URL)/i.test(name)
      )
    })
    .map(([, value]) => value)
}

function redactOutput(value) {
  let redacted = String(value ?? "")
  redacted = redacted.replace(
    /postgres(?:ql)?:\/\/[^\s/@:]+(?::[^\s/@]*)?@/gi,
    "postgres://[REDACTED]@"
  )
  redacted = redacted.replace(/\b(?:redis|rediss):\/\/[^\s]+/gi, "redis://[REDACTED]")

  for (const secret of processOutputSecrets()) {
    redacted = redacted.split(secret).join("[REDACTED]")
  }

  return redacted
}

async function discoverModuleSpecs(directory = MODULES_ROOT, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)
    const relativePath = normalizeRelativePath(join(prefix, entry.name))

    if (entry.isDirectory()) {
      files.push(...(await discoverModuleSpecs(entryPath, relativePath)))
      continue
    }

    if (entry.isFile() && entry.name.endsWith(".spec.ts")) {
      files.push(relativePath)
    }
  }

  return files.sort()
}

function duplicates(values) {
  const counts = new Map()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort()
}

function difference(left, right) {
  const rightSet = new Set(right)
  return [...new Set(left)].filter((value) => !rightSet.has(value)).sort()
}

function assertExpectedManifest() {
  const manifestDuplicates = duplicates(EXPECTED_MODULE_SPECS)
  if (manifestDuplicates.length > 0) {
    throw new ModulesOrchestratorError("P12_MODULES_EXPECTED_SET_DUPLICATE")
  }

  const unclassifiedRunner = [...MEDUSA_RUNNER_SPECS].filter(
    (spec) => !EXPECTED_MODULE_SPECS.includes(spec)
  )
  if (unclassifiedRunner.length > 0 || MEDUSA_RUNNER_SPECS.size !== 6) {
    throw new ModulesOrchestratorError("P12_MODULES_MEDUSA_SET_INVALID")
  }
}

function validateSchedule(discoveredSpecs, partitions, expectedSpecs) {
  const expectedSet = new Set(expectedSpecs)
  const scheduledSpecs = partitions.flatMap((partition) => partition.specs)
  const discoveredUnexpected = difference(discoveredSpecs, expectedSpecs)
  const discoveredMissing = difference(expectedSpecs, discoveredSpecs)
  const scheduledUnexpected = difference(scheduledSpecs, expectedSpecs)
  const scheduledMissing = difference(expectedSpecs, scheduledSpecs)
  const scheduledDuplicates = duplicates(scheduledSpecs)

  return {
    expectedCount: expectedSpecs.length,
    scheduledCount: scheduledSpecs.length,
    expectedSpecs: [...expectedSpecs].sort(),
    scheduledSpecs: [...scheduledSpecs].sort(),
    missing: [...new Set([...discoveredMissing, ...scheduledMissing])].sort(),
    duplicates: scheduledDuplicates,
    unexpected: [
      ...new Set([...discoveredUnexpected, ...scheduledUnexpected]),
    ].sort(),
    valid:
      expectedSet.size === expectedSpecs.length &&
      discoveredUnexpected.length === 0 &&
      discoveredMissing.length === 0 &&
      scheduledUnexpected.length === 0 &&
      scheduledMissing.length === 0 &&
      scheduledDuplicates.length === 0 &&
      scheduledSpecs.length === expectedSpecs.length,
  }
}

function printExactSetStatus(schedule, mode) {
  console.info(
    `[P12_MODULES_EXACT_SET] mode=${mode} expected=${schedule.expectedCount} scheduled=${schedule.scheduledCount} missing=${schedule.missing.length} duplicates=${schedule.duplicates.length} unexpected=${schedule.unexpected.length} status=${schedule.valid ? "PASS" : "FAIL"}`
  )

  if (!schedule.valid) {
    if (schedule.missing.length > 0) {
      console.error(`missing=${schedule.missing.join(",")}`)
    }
    if (schedule.duplicates.length > 0) {
      console.error(`duplicates=${schedule.duplicates.join(",")}`)
    }
    if (schedule.unexpected.length > 0) {
      console.error(`unexpected=${schedule.unexpected.join(",")}`)
    }
  }
}

function createFullPartitions() {
  return EXPECTED_MODULE_SPECS.map((spec, index) => ({
    id: `P${String(index + 1).padStart(2, "0")}`,
    specs: [spec],
  }))
}

function createDiagnosticPartitions(kind) {
  if (kind === "r5-r3") {
    return [
      { id: "R5", specs: [R5_SPEC] },
      { id: "R3", specs: [R3_SPEC] },
    ]
  }

  return [{ id: "FAIL-01", specs: ["<diagnostic-child-failure>"] }]
}

function resolveJestPath() {
  try {
    const packageJsonPath = require.resolve("jest/package.json")
    const packageMetadata = require(packageJsonPath)
    const binEntry =
      typeof packageMetadata.bin === "string"
        ? packageMetadata.bin
        : packageMetadata.bin?.jest
    if (typeof binEntry !== "string" || binEntry.trim() === "") {
      throw new Error("missing bin")
    }
    const resolved = resolve(dirname(packageJsonPath), binEntry)
    if (!existsSync(resolved)) {
      throw new Error("missing")
    }
    return resolved
  } catch {
    throw new ModulesOrchestratorError("P12_MODULES_JEST_NOT_FOUND")
  }
}

function runChild(command, args, options = {}) {
  return new Promise((resolveResult) => {
    let child

    try {
      child = spawn(command, args, {
        cwd: options.cwd ?? BACKEND_ROOT,
        env: options.env ?? process.env,
        stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      })
    } catch {
      resolveResult({
        code: 1,
        signal: null,
        pid: undefined,
        stdout: "",
        stderr: "",
        spawnError: true,
      })
      return
    }

    activeChild = child
    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.once("error", () => {
      resolveResult({
        code: 1,
        signal: null,
        pid: child.pid,
        stdout,
        stderr,
        spawnError: true,
      })
    })
    child.once("exit", (code, signal) => {
      resolveResult({
        code: code ?? 1,
        signal,
        pid: child.pid,
        stdout,
        stderr,
        spawnError: false,
      })
    })
    child.once("close", () => {
      if (activeChild === child) {
        activeChild = undefined
      }
    })
  })
}

function writeCapturedOutput(result) {
  const stdout = redactOutput(result.stdout)
  const stderr = redactOutput(result.stderr)

  if (stdout) {
    process.stdout.write(stdout)
  }
  if (stderr) {
    process.stderr.write(stderr)
  }
}

function findLastMarker(output, marker) {
  const matches = [...output.matchAll(new RegExp(`${marker}[^\\r\\n]*`, "g"))]
  return matches.at(-1)
}

function hasCompletedCleanup(output) {
  const readyIndex = output.indexOf("[P12_DISPOSABLE_POSTGRES_READY]")
  const cleanIndex = output.lastIndexOf("[P12_DISPOSABLE_POSTGRES_CLEAN]")
  return readyIndex >= 0 && cleanIndex > readyIndex
}

function parseTarget(output) {
  return output.match(/target=(p12_disposable_[a-z0-9_]+)/)?.[1] ?? null
}

async function readJestReport(reportPath) {
  try {
    const parsed = JSON.parse(await readFile(reportPath, "utf8"))
    const numericFields = [
      "numTotalTestSuites",
      "numPassedTestSuites",
      "numFailedTestSuites",
      "numPendingTestSuites",
      "numTotalTests",
      "numPassedTests",
      "numFailedTests",
      "numPendingTests",
      "numTodoTests",
    ]

    if (
      numericFields.some(
        (field) =>
          !Number.isInteger(parsed[field]) || parsed[field] < 0
      )
    ) {
      return { valid: false }
    }

    return {
      valid: true,
      suites: parsed.numTotalTestSuites,
      tests: parsed.numTotalTests,
      failedSuites: parsed.numFailedTestSuites,
      failedTests: parsed.numFailedTests,
      pendingSuites: parsed.numPendingTestSuites,
      pendingTests: parsed.numPendingTests,
      todoTests: parsed.numTodoTests,
      allTestsPassed:
        parsed.numFailedTestSuites === 0 &&
        parsed.numFailedTests === 0 &&
        parsed.numPendingTestSuites === 0 &&
        parsed.numPendingTests === 0 &&
        parsed.numTodoTests === 0,
    }
  } catch {
    return { valid: false }
  }
}

function jestCommand(jestPath, spec, reportPath) {
  return [
    process.execPath,
    jestPath,
    "--silent=false",
    "--runInBand",
    "--forceExit",
    "--json",
    "--outputFile",
    reportPath,
    "--runTestsByPath",
    `integration-tests/modules/${spec}`,
  ]
}

function diagnosticFailureCommand() {
  return [process.execPath, "-e", "process.exitCode = 23"]
}

async function runPartition(partition, temporaryDirectory, jestPath, mode) {
  const isFailureDiagnostic = mode === "diagnostic-failure"
  const spec = partition.specs[0]
  const reportPath = join(temporaryDirectory, `${partition.id}.json`)
  const testCommand = isFailureDiagnostic
    ? diagnosticFailureCommand()
    : jestCommand(jestPath, spec, reportPath)
  const runnerArgs = [DISPOSABLE_RUNNER, "--", ...testCommand]
  const result = await runChild(process.execPath, runnerArgs, {
    cwd: BACKEND_ROOT,
    env: buildTestEnvironment(),
    capture: true,
  })
  const combinedOutput = `${result.stdout}\n${result.stderr}`
  const cleanupPassed = hasCompletedCleanup(combinedOutput)
  const report = isFailureDiagnostic
    ? { valid: true, suites: 0, tests: 0, allTestsPassed: false }
    : await readJestReport(reportPath)
  const childPassed = result.code === 0 && result.signal === null
  const reportPassed = isFailureDiagnostic
    ? true
    : report.valid &&
      report.suites === 1 &&
      report.tests > 0 &&
      report.allTestsPassed
  const partitionPassed = childPassed && cleanupPassed && reportPassed

  writeCapturedOutput(result)
  const readyMarker = findLastMarker(combinedOutput, "\\[P12_DISPOSABLE_POSTGRES_READY\\]")
  const cleanMarker = findLastMarker(combinedOutput, "\\[P12_DISPOSABLE_POSTGRES_CLEAN\\]")
  const target = parseTarget(combinedOutput)
  const status = partitionPassed ? "PASS" : "FAIL"

  console.info(
    `[P12_MODULES_PARTITION] id=${partition.id} specs=${spec} runner_pid=${result.pid ?? "unknown"} target=${target ?? "unknown"} child=${status} exit=${result.code} cleanup=${cleanupPassed ? "PASS" : "FAIL"} suites=${report.suites ?? "UNAVAILABLE"} tests=${report.tests ?? "UNAVAILABLE"}`
  )

  if (!readyMarker || !cleanMarker) {
    console.error(
      `[P12_MODULES_PARTITION_EVIDENCE] id=${partition.id} ready=${readyMarker ? "PRESENT" : "ABSENT"} clean=${cleanMarker ? "PRESENT" : "ABSENT"}`
    )
  }

  return {
    ...partition,
    result,
    report,
    target,
    cleanupPassed,
    childPassed,
    partitionPassed,
  }
}

function printAggregate(mode, schedule, results) {
  const executedSpecs = results.flatMap((result) => result.specs)
  const executedModuleSpecs =
    mode === "full"
      ? results.filter((result) => result.specs.length === 1).length
      : executedSpecs.length
  const suiteTotal = results.reduce(
    (total, result) => total + (result.report.suites ?? 0),
    0
  )
  const testTotal = results.reduce(
    (total, result) => total + (result.report.tests ?? 0),
    0
  )
  const cleanupPassCount = results.filter(
    (result) => result.cleanupPassed
  ).length
  const allPartitionsPassed =
    results.length === schedule.expectedCount &&
    results.every((result) => result.partitionPassed) &&
    cleanupPassCount === results.length
  const status = allPartitionsPassed ? "PASS" : "FAIL"

  console.info(
    `[P12_MODULES_AGGREGATE] mode=${mode} expected=${schedule.expectedCount} scheduled=${schedule.scheduledCount} executed=${executedModuleSpecs} missing=${schedule.missing.length} duplicates=${schedule.duplicates.length} unexpected=${schedule.unexpected.length} partitions=${results.length}/${schedule.expectedCount} suites=${suiteTotal} tests=${testTotal} cleanup=${cleanupPassCount}/${results.length} status=${status}`
  )

  return allPartitionsPassed ? 0 : 1
}

async function runNestedRestrictedJest(args, jestPath) {
  const provisioningState = readProvisioningContextState(process.env)
  const activeState = readActiveDisposableContextState(process.env)

  if (
    provisioningState === DISPOSABLE_CONTEXT_STATE.PARTIAL ||
    activeState === DISPOSABLE_CONTEXT_STATE.PARTIAL
  ) {
    throw new ModulesOrchestratorError("P12_MODULES_DISPOSABLE_CONTEXT_INCOMPLETE")
  }
  if (activeState !== DISPOSABLE_CONTEXT_STATE.COMPLETE) {
    throw new ModulesOrchestratorError(
      "P12_MODULES_RESTRICTED_ARGS_REQUIRE_DISPOSABLE_CONTEXT"
    )
  }
  if (
    args.length !== 2 ||
    args[0] !== "--runTestsByPath" ||
    !args[1].startsWith("integration-tests/modules/")
  ) {
    throw new ModulesOrchestratorError("P12_MODULES_RESTRICTED_ARGS_FORBIDDEN")
  }

  const spec = normalizeRelativePath(args[1]).slice("integration-tests/modules/".length)
  if (!EXPECTED_MODULE_SPECS.includes(spec)) {
    throw new ModulesOrchestratorError("P12_MODULES_RESTRICTED_SPEC_FORBIDDEN")
  }

  const result = await runChild(
    process.execPath,
    [jestPath, "--silent=false", "--runInBand", "--forceExit", ...args],
    {
      cwd: BACKEND_ROOT,
      env: buildNestedTestEnvironment(),
      capture: true,
    }
  )
  writeCapturedOutput(result)
  return result.code
}

async function runFullOrDiagnostic(mode, diagnosticKind) {
  assertExpectedManifest()
  const discoveredSpecs = await discoverModuleSpecs()
  const repositorySchedule = validateSchedule(
    discoveredSpecs,
    createFullPartitions(),
    EXPECTED_MODULE_SPECS
  )
  printExactSetStatus(repositorySchedule, "repository")
  if (!repositorySchedule.valid) {
    return 1
  }

  const partitions =
    mode === "full"
      ? createFullPartitions()
      : createDiagnosticPartitions(diagnosticKind)
  const expectedSpecs =
    mode === "full"
      ? EXPECTED_MODULE_SPECS
      : diagnosticKind === "r5-r3"
        ? [R5_SPEC, R3_SPEC]
        : ["<diagnostic-child-failure>"]
  const schedule = validateSchedule(expectedSpecs, partitions, expectedSpecs)
  if (mode !== "full") {
    printExactSetStatus(schedule, mode)
  }
  if (!schedule.valid) {
    return 1
  }

  const jestPath = resolveJestPath()
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "p12-modules-"))
  const results = []

  try {
    console.info(
      `[P12_MODULES_RUNTIME] node=${process.version} exec=${process.execPath} partitions=${partitions.length} mode=${mode}`
    )

    for (const partition of partitions) {
      console.info(
        `[P12_MODULES_PARTITION_START] id=${partition.id} specs=${partition.specs.join(",")}`
      )
      const result = await runPartition(
        partition,
        temporaryDirectory,
        jestPath,
        mode === "full" ? "full" : diagnosticKind === "r5-r3" ? "diagnostic-r5-r3" : "diagnostic-failure"
      )
      results.push(result)

      if (!result.partitionPassed) {
        break
      }
    }

    return printAggregate(mode, schedule, results)
  } finally {
    try {
      await rm(temporaryDirectory, { recursive: true, force: true })
    } catch {
      console.error("[P12_MODULES_TEMP_CLEANUP_FAIL]")
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const provisioningState = readProvisioningContextState(process.env)
  const activeState = readActiveDisposableContextState(process.env)
  const hasPartialContext =
    provisioningState === DISPOSABLE_CONTEXT_STATE.PARTIAL ||
    activeState === DISPOSABLE_CONTEXT_STATE.PARTIAL
  const isTopLevelDiagnostic =
    args.length === 1 &&
    (args[0] === DIAGNOSTIC_R5_R3 || args[0] === DIAGNOSTIC_FAILURE)

  if (hasPartialContext) {
    throw new ModulesOrchestratorError("P12_MODULES_DISPOSABLE_CONTEXT_INCOMPLETE")
  }

  if (isTopLevelDiagnostic) {
    if (activeState === DISPOSABLE_CONTEXT_STATE.COMPLETE) {
      throw new ModulesOrchestratorError("P12_MODULES_CONTEXT_REUSE_FORBIDDEN")
    }
    return runFullOrDiagnostic(
      "diagnostic",
      args[0] === DIAGNOSTIC_R5_R3 ? "r5-r3" : "failure"
    )
  }

  if (args.length > 0) {
    return runNestedRestrictedJest(args, resolveJestPath())
  }

  if (activeState === DISPOSABLE_CONTEXT_STATE.COMPLETE) {
    throw new ModulesOrchestratorError("P12_MODULES_CONTEXT_REUSE_FORBIDDEN")
  }

  return runFullOrDiagnostic("full", undefined)
}

function installSignalHandlers() {
  const signalHandler = (signal) => {
    receivedSignal = signal
    activeChild?.kill(signal)
  }
  process.once("SIGINT", signalHandler)
  process.once("SIGTERM", signalHandler)
  return () => {
    process.removeListener("SIGINT", signalHandler)
    process.removeListener("SIGTERM", signalHandler)
  }
}

const removeSignalHandlers = installSignalHandlers()

try {
  process.exitCode = await main()
} catch (error) {
  const code =
    error instanceof ModulesOrchestratorError
      ? error.code
      : "P12_MODULES_ORCHESTRATOR_FAILED"
  console.error(redactOutput(`[${code}]`))
  process.exitCode = 1
} finally {
  removeSignalHandlers()
  if (receivedSignal && process.exitCode === 0) {
    process.exitCode = receivedSignal === "SIGINT" ? 130 : 143
  }
}
