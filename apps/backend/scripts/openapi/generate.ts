import fs from "fs"
import path from "path"
import { buildContracts } from "../../src/api-docs/generation/build-documents"
import { validateDocuments } from "../../src/api-docs/generation/validate"
import {
  GENERATED_DIRECTORY,
  REPOSITORY_ROOT,
} from "./toolchain"

type SurfaceSelection = "all" | "store" | "admin" | "webhooks"

export function parseGenerateArguments(args: string[]): SurfaceSelection {
  if (args.filter((arg) => arg === "--write").length !== 1) {
    throw new Error("openapi:generate must run in explicit writer mode")
  }

  const surfaceIndexes = args
    .map((arg, index) => (arg === "--surface" ? index : -1))
    .filter((index) => index >= 0)
  if (surfaceIndexes.length !== 1) {
    throw new Error("--surface is required exactly once")
  }

  const index = surfaceIndexes[0]
  const selection = args[index + 1] as SurfaceSelection | undefined
  const allowed = new Set<SurfaceSelection>([
    "all",
    "store",
    "admin",
    "webhooks",
  ])
  if (!selection || !allowed.has(selection)) {
    throw new Error("--surface must be all, store, admin, or webhooks")
  }

  const consumed = new Set([args.indexOf("--write"), index, index + 1])
  const unknown = args.filter((_arg, argumentIndex) => !consumed.has(argumentIndex))
  if (unknown.length > 0) {
    throw new Error(`Unknown generator arguments: ${unknown.join(" ")}`)
  }
  return selection
}

export function writeContracts(selection: SurfaceSelection): string[] {
  const contracts = buildContracts()
  validateDocuments(contracts)
  fs.mkdirSync(GENERATED_DIRECTORY, { recursive: true })

  const selected = contracts.filter(
    (contract) => selection === "all" || contract.surface === selection
  )
  for (const contract of selected) {
    fs.writeFileSync(
      path.join(GENERATED_DIRECTORY, contract.fileName),
      contract.bytes,
      "utf8"
    )
  }
  return selected.map((contract) =>
    path.relative(REPOSITORY_ROOT, path.join(GENERATED_DIRECTORY, contract.fileName))
  )
}

if (require.main === module) {
  const selection = parseGenerateArguments(process.argv.slice(2))
  const written = writeContracts(selection)
  process.stdout.write(`Generated ${written.join(", ")}\n`)
}
