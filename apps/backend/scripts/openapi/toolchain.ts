import fs from "fs"
import path from "path"

export const REPOSITORY_ROOT = path.resolve(__dirname, "../../../..")
export const BACKEND_ROOT = path.join(REPOSITORY_ROOT, "apps/backend")
export const GENERATED_DIRECTORY = path.join(
  BACKEND_ROOT,
  "src/api-docs/generated"
)
export const SPECTRAL_CONFIG = path.join(REPOSITORY_ROOT, ".spectral.yaml")
export const SPECTRAL_VERSION = "6.16.2"
export const GENERATED_ARTIFACTS = [
  path.join(GENERATED_DIRECTORY, "store.openapi.json"),
  path.join(GENERATED_DIRECTORY, "admin.openapi.json"),
  path.join(GENERATED_DIRECTORY, "webhooks.openapi.json"),
] as const

const FORBIDDEN_LINTER_PACKAGES = new Set([
  "@redocly/cli",
  "swagger-cli",
  "openapi-cli",
  "ibm-openapi-validator",
  "openapi-schema-validator",
])

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
}

function dependencies(manifest: Record<string, unknown>): Record<string, string> {
  return {
    ...((manifest.dependencies ?? {}) as Record<string, string>),
    ...((manifest.devDependencies ?? {}) as Record<string, string>),
  }
}

export function assertToolchain(): void {
  const backendManifest = readJson(path.join(BACKEND_ROOT, "package.json"))
  const rootManifest = readJson(path.join(REPOSITORY_ROOT, "package.json"))
  const backendDependencies = dependencies(backendManifest)
  const rootDependencies = dependencies(rootManifest)

  if (backendDependencies["@stoplight/spectral-cli"] !== SPECTRAL_VERSION) {
    throw new Error(`Spectral must be pinned to ${SPECTRAL_VERSION}`)
  }

  for (const name of FORBIDDEN_LINTER_PACKAGES) {
    if (name in backendDependencies || name in rootDependencies) {
      throw new Error(`Second OpenAPI linter is forbidden: ${name}`)
    }
  }

  const forbiddenConfigs = [
    ".spectral.yml",
    ".spectral.json",
    ".spectral.js",
    ".spectral.cjs",
    ".spectral.mjs",
    ".spectralignore",
  ]
  for (const file of forbiddenConfigs) {
    if (fs.existsSync(path.join(REPOSITORY_ROOT, file))) {
      throw new Error(`Second Spectral config or ignore file is forbidden: ${file}`)
    }
  }

  const config = fs.readFileSync(SPECTRAL_CONFIG, "utf8").replace(/\r\n/g, "\n")
  if (config !== "extends: spectral:oas\n") {
    throw new Error(
      "Spectral config must extend only the local spectral:oas ruleset"
    )
  }
  if (/https?:\/\//i.test(config)) {
    throw new Error("Remote Spectral rulesets are forbidden")
  }
}

export function spectralBinary(): string {
  const binary = path.join(REPOSITORY_ROOT, "node_modules/.bin/spectral")
  if (!fs.existsSync(binary)) {
    throw new Error("Local Spectral binary was not found")
  }
  return binary
}
