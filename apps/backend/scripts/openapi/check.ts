import { execFileSync } from "child_process"
import fs from "fs"
import path from "path"
import {
  CONTRACT_SURFACES,
  type ContractSurface,
} from "../../src/api-docs/contracts"
import { verifyNativeExtensions } from "../../src/api-docs/coverage/native-routes"
import {
  verifyCoverage,
  type CoverageScope,
} from "../../src/api-docs/coverage/verify-coverage"
import { buildContracts } from "../../src/api-docs/generation/build-documents"
import { validateDocuments } from "../../src/api-docs/generation/validate"
import { createFoundationRegistry } from "../../src/api-docs/registry"
import {
  GENERATED_ARTIFACTS,
  GENERATED_DIRECTORY,
  REPOSITORY_ROOT,
} from "./toolchain"

type CheckOptions = {
  coverageScope: CoverageScope
  allowUntracked: boolean
  requireTracked: boolean
  requireClean: boolean
}

export function parseCheckArguments(args: string[]): CheckOptions {
  const scopeIndex = args.indexOf("--coverage-scope")
  const scope = args[scopeIndex + 1] as CoverageScope | undefined
  const allowedScopes = new Set<CoverageScope>([
    "foundation",
    ...CONTRACT_SURFACES,
    "global",
  ])
  if (
    scopeIndex < 0 ||
    !scope ||
    !allowedScopes.has(scope) ||
    args.filter((arg) => arg === "--coverage-scope").length !== 1
  ) {
    throw new Error("A valid --coverage-scope is required")
  }

  const flags = new Set(args)
  const known = new Set([
    "--coverage-scope",
    scope,
    "--allow-untracked",
    "--require-tracked",
    "--require-clean",
  ])
  const unknown = args.filter((argument) => !known.has(argument))
  if (unknown.length > 0) {
    throw new Error(`Unknown check arguments: ${unknown.join(" ")}`)
  }

  return {
    coverageScope: scope,
    allowUntracked: flags.has("--allow-untracked"),
    requireTracked: flags.has("--require-tracked"),
    requireClean: flags.has("--require-clean"),
  }
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim()
}

function verifyTrackedArtifacts(): void {
  git([
    "ls-files",
    "--error-unmatch",
    ...GENERATED_ARTIFACTS.map((file) => path.relative(REPOSITORY_ROOT, file)),
  ])
}

function verifyExactlyThreeArtifacts(): void {
  const files = fs
    .readdirSync(GENERATED_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()

  const expected = [
    "admin.openapi.json",
    "store.openapi.json",
    "webhooks.openapi.json",
  ]
  if (JSON.stringify(files) !== JSON.stringify(expected)) {
    throw new Error("Generated directory must contain exactly three OpenAPI JSON files")
  }
}

export function runCheck(options: CheckOptions): void {
  if (options.allowUntracked && (options.requireTracked || options.requireClean)) {
    throw new Error("--allow-untracked cannot be combined with global clean gates")
  }
  if (options.requireClean && git(["status", "--porcelain=v1"])) {
    throw new Error("Global OpenAPI check requires a clean worktree")
  }
  if (options.requireTracked) {
    verifyTrackedArtifacts()
  }

  verifyExactlyThreeArtifacts()
  const registry = createFoundationRegistry()
  const first = buildContracts(registry)
  const second = buildContracts(registry)
  validateDocuments(first)
  validateDocuments(second)

  for (let index = 0; index < first.length; index += 1) {
    if (first[index].bytes !== second[index].bytes) {
      throw new Error(`Nondeterministic OpenAPI bytes: ${first[index].surface}`)
    }
    const present = fs.readFileSync(
      path.join(GENERATED_DIRECTORY, first[index].fileName),
      "utf8"
    )
    if (present !== first[index].bytes) {
      throw new Error(`Generated OpenAPI artifact drift: ${first[index].fileName}`)
    }
  }

  verifyNativeExtensions()
  verifyCoverage(options.coverageScope, registry)
}

if (require.main === module) {
  const options = parseCheckArguments(process.argv.slice(2))
  runCheck(options)
  process.stdout.write(
    `PASS: OpenAPI ${options.coverageScope} verification is read-only\n`
  )
}
