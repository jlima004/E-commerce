import { spawnSync } from "child_process"
import fs from "fs"
import path from "path"
import { validateDocuments } from "../../src/api-docs/generation/validate"
import type { BuiltContract } from "../../src/api-docs/contracts"
import {
  assertToolchain,
  GENERATED_ARTIFACTS,
  REPOSITORY_ROOT,
  SPECTRAL_CONFIG,
  spectralBinary,
} from "./toolchain"

function readContracts(): BuiltContract[] {
  return GENERATED_ARTIFACTS.map((file) => {
    const surface = path.basename(file).split(".")[0] as BuiltContract["surface"]
    const bytes = fs.readFileSync(file, "utf8")
    return {
      surface,
      fileName: path.basename(file) as BuiltContract["fileName"],
      document: JSON.parse(bytes),
      bytes,
    }
  })
}

export function runLint(): void {
  assertToolchain()
  const artifactArguments = GENERATED_ARTIFACTS.map((file) =>
    path.relative(REPOSITORY_ROOT, file)
  )
  const result = spawnSync(
    spectralBinary(),
    [
      "lint",
      ...artifactArguments,
      "--ruleset",
      path.relative(REPOSITORY_ROOT, SPECTRAL_CONFIG),
      "--fail-severity",
      "warn",
    ],
    {
      cwd: REPOSITORY_ROOT,
      shell: false,
      encoding: "utf8",
      env: {
        ...process.env,
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
        NO_PROXY: "",
      },
    }
  )

  if (result.stdout) {
    process.stdout.write(result.stdout)
  }
  if (result.stderr) {
    process.stderr.write(result.stderr)
  }
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`Spectral failed with status ${result.status}`)
  }

  validateDocuments(readContracts())
  process.stdout.write("PASS: Spectral 6.16.2 and TypeScript OpenAPI checks\n")
}

if (require.main === module) {
  runLint()
}
