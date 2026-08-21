#!/usr/bin/env ts-node
/**
 * Read-only Store surface scanner.
 * Discovers native Medusa 2.16.0 + local non-overlapping Store routes and
 * exact-set compares against the closed manifest SSOT.
 *
 * Usage:
 *   ts-node --swc scripts/store-surface/scan-installed.ts --check
 *   ts-node --swc scripts/store-surface/scan-installed.ts --json
 */

import fs from "fs"
import path from "path"
import {
  STORE_SURFACE_MANIFEST,
  STORE_SURFACE_MEDUSA_VERSION,
  storeSurfaceOperationKey,
  summarizeStoreSurfaceManifest,
  validateStoreSurfaceManifest,
  type StoreSurfaceEntry,
  type StoreSurfaceHttpMethod,
} from "../../src/api/store-surface/manifest"

const HTTP_METHODS: StoreSurfaceHttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]

export type DiscoveredStoreOperation = {
  method: StoreSurfaceHttpMethod
  pathTemplate: string
  source: "native" | "local"
  sourceFile: string
}

export type StoreSurfaceScanResult = {
  medusaVersion: string
  expectedMedusaVersion: string
  discovered: DiscoveredStoreOperation[]
  discoveredKeys: string[]
  manifestKeys: string[]
  missingFromManifest: string[]
  missingFromInstalled: string[]
  duplicatesInstalled: string[]
  manifestViolations: ReturnType<typeof validateStoreSurfaceManifest>
  counts: ReturnType<typeof summarizeStoreSurfaceManifest>
  ok: boolean
  errors: string[]
}

function repositoryRootFrom(scriptDir: string): string {
  // apps/backend/scripts/store-surface → repo root is ../../../../
  return path.resolve(scriptDir, "../../../..")
}

function backendRootFrom(scriptDir: string): string {
  return path.resolve(scriptDir, "../..")
}

function resolveMedusaPackageRoot(repositoryRoot: string): string {
  const candidates = [
    path.join(repositoryRoot, "node_modules/@medusajs/medusa"),
    path.join(repositoryRoot, "apps/backend/node_modules/@medusajs/medusa"),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "package.json"))) {
      return candidate
    }
  }
  throw new Error(
    "STORE_SURFACE_SCAN_MEDUSA_PACKAGE_MISSING: @medusajs/medusa not found"
  )
}

function readMedusaVersion(medusaRoot: string): string {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(medusaRoot, "package.json"), "utf8")
  ) as { version?: string }
  if (!pkg.version) {
    throw new Error("STORE_SURFACE_SCAN_MEDUSA_VERSION_MISSING")
  }
  return pkg.version
}

function listRouteFiles(directory: string, fileName: string): string[] {
  if (!fs.existsSync(directory)) {
    return []
  }
  const files: string[] = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...listRouteFiles(absolute, fileName))
    } else if (entry.name === fileName) {
      files.push(absolute)
    }
  }
  return files.sort()
}

function canonicalizePathTemplate(apiRoot: string, routeFile: string): string {
  const relativeDirectory = path.relative(apiRoot, path.dirname(routeFile))
  const segments = relativeDirectory
    .split(path.sep)
    .filter(Boolean)
    .map((segment) => {
      const bracket = segment.match(/^\[([^\]]+)\]$/)
      return bracket ? `{${bracket[1]}}` : segment
    })
  // apiRoot is already .../api/store; restore the public /store prefix.
  return segments.length === 0 ? "/store" : `/store/${segments.join("/")}`
}

function extractExportedMethods(source: string): StoreSurfaceHttpMethod[] {
  const found = new Set<StoreSurfaceHttpMethod>()
  for (const method of HTTP_METHODS) {
    const patterns = [
      new RegExp(`\\bexports\\.${method}\\b`),
      new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`),
      new RegExp(`export\\s+const\\s+${method}\\b`),
      new RegExp(`export\\s*\\{[^}]*\\b${method}\\b[^}]*\\}`),
    ]
    if (patterns.some((pattern) => pattern.test(source))) {
      found.add(method)
    }
  }
  return HTTP_METHODS.filter((method) => found.has(method))
}

function discoverNativeOperations(
  medusaRoot: string
): DiscoveredStoreOperation[] {
  const apiRoot = path.join(medusaRoot, "dist/api/store")
  const operations: DiscoveredStoreOperation[] = []
  for (const file of listRouteFiles(apiRoot, "route.js")) {
    const source = fs.readFileSync(file, "utf8")
    const pathTemplate = canonicalizePathTemplate(apiRoot, file)
    for (const method of extractExportedMethods(source)) {
      operations.push({
        method,
        pathTemplate,
        source: "native",
        sourceFile: file,
      })
    }
  }
  return operations
}

function discoverLocalOperations(
  backendRoot: string
): DiscoveredStoreOperation[] {
  const apiRoot = path.join(backendRoot, "src/api/store")
  const operations: DiscoveredStoreOperation[] = []
  for (const file of listRouteFiles(apiRoot, "route.ts")) {
    const source = fs.readFileSync(file, "utf8")
    const pathTemplate = canonicalizePathTemplate(apiRoot, file)
    for (const method of extractExportedMethods(source)) {
      operations.push({
        method,
        pathTemplate,
        source: "local",
        sourceFile: file,
      })
    }
  }
  return operations
}

function dedupeInstalled(
  native: DiscoveredStoreOperation[],
  local: DiscoveredStoreOperation[]
): {
  operations: DiscoveredStoreOperation[]
  duplicates: string[]
} {
  const byKey = new Map<string, DiscoveredStoreOperation>()
  const duplicates: string[] = []

  for (const op of native) {
    const key = storeSurfaceOperationKey(op.method, op.pathTemplate)
    if (byKey.has(key)) {
      duplicates.push(key)
      continue
    }
    byKey.set(key, op)
  }

  for (const op of local) {
    const key = storeSurfaceOperationKey(op.method, op.pathTemplate)
    const existing = byKey.get(key)
    if (existing) {
      // Local overlapping native (e.g. products) is an extension, not a second op.
      // Exact-set identity remains one method+path; keep native discovery row.
      if (existing.source === "native") {
        continue
      }
      duplicates.push(key)
      continue
    }
    byKey.set(key, op)
  }

  return {
    operations: [...byKey.values()].sort(
      (left, right) =>
        left.pathTemplate.localeCompare(right.pathTemplate) ||
        left.method.localeCompare(right.method)
    ),
    duplicates,
  }
}

export function scanInstalledStoreSurface(options?: {
  repositoryRoot?: string
  backendRoot?: string
  manifest?: readonly StoreSurfaceEntry[]
}): StoreSurfaceScanResult {
  const scriptDir = __dirname
  const repositoryRoot = options?.repositoryRoot ?? repositoryRootFrom(scriptDir)
  const backendRoot = options?.backendRoot ?? backendRootFrom(scriptDir)
  const manifest = options?.manifest ?? STORE_SURFACE_MANIFEST

  const errors: string[] = []
  const medusaRoot = resolveMedusaPackageRoot(repositoryRoot)
  const medusaVersion = readMedusaVersion(medusaRoot)

  if (medusaVersion !== STORE_SURFACE_MEDUSA_VERSION) {
    errors.push(
      `MEDUSA_VERSION_DRIFT: installed ${medusaVersion} != expected ${STORE_SURFACE_MEDUSA_VERSION}`
    )
  }

  const native = discoverNativeOperations(medusaRoot)
  const local = discoverLocalOperations(backendRoot)
  const { operations, duplicates } = dedupeInstalled(native, local)

  const discoveredKeys = operations.map((op) =>
    storeSurfaceOperationKey(op.method, op.pathTemplate)
  )
  const manifestKeys = manifest.map((item) =>
    storeSurfaceOperationKey(item.method, item.pathTemplate)
  )

  const discoveredSet = new Set(discoveredKeys)
  const manifestSet = new Set(manifestKeys)

  const missingFromManifest = discoveredKeys.filter(
    (key) => !manifestSet.has(key)
  )
  const missingFromInstalled = manifestKeys.filter(
    (key) => !discoveredSet.has(key)
  )

  if (duplicates.length > 0) {
    errors.push(`DUPLICATE_INSTALLED: ${duplicates.join(", ")}`)
  }
  if (missingFromManifest.length > 0) {
    errors.push(
      `UNKNOWN_INSTALLED_NOT_IN_MANIFEST: ${missingFromManifest.join(", ")}`
    )
  }
  if (missingFromInstalled.length > 0) {
    errors.push(
      `MANIFEST_MISSING_FROM_INSTALLED: ${missingFromInstalled.join(", ")}`
    )
  }
  if (operations.length !== 64) {
    errors.push(
      `INSTALLED_COUNT: expected 64 unique operations, found ${operations.length} (native=${native.length}, local=${local.length})`
    )
  }

  const nativeUnique = new Set(
    native.map((op) => storeSurfaceOperationKey(op.method, op.pathTemplate))
  )
  const localOnly = local.filter(
    (op) =>
      !nativeUnique.has(storeSurfaceOperationKey(op.method, op.pathTemplate))
  )
  if (nativeUnique.size !== 51) {
    errors.push(
      `NATIVE_COUNT: expected 51 unique native operations, found ${nativeUnique.size}`
    )
  }
  if (localOnly.length !== 13) {
    errors.push(
      `LOCAL_NON_OVERLAPPING_COUNT: expected 13, found ${localOnly.length}`
    )
  }

  const manifestViolations = validateStoreSurfaceManifest(manifest)
  for (const violation of manifestViolations) {
    errors.push(
      `MANIFEST_${violation.code}${violation.key ? `@${violation.key}` : ""}: ${violation.message}`
    )
  }

  const counts = summarizeStoreSurfaceManifest(manifest)

  return {
    medusaVersion,
    expectedMedusaVersion: STORE_SURFACE_MEDUSA_VERSION,
    discovered: operations,
    discoveredKeys,
    manifestKeys,
    missingFromManifest,
    missingFromInstalled,
    duplicatesInstalled: duplicates,
    manifestViolations,
    counts,
    ok: errors.length === 0,
    errors,
  }
}

function main(argv: string[]): number {
  const check = argv.includes("--check")
  const json = argv.includes("--json")
  const result = scanInstalledStoreSurface()

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(
      [
        `medusa=${result.medusaVersion}`,
        `discovered=${result.discovered.length}`,
        `manifest=${result.manifestKeys.length}`,
        `authorized=${result.counts.authorized}`,
        `extended=${result.counts.extended}`,
        `blocked=${result.counts.blocked}`,
        `outside=${result.counts.outsideFrontendM1}`,
        `deny=${result.counts.deny}`,
        `preserve_legacy=${result.counts.preserveLegacy}`,
        `m1_enabled_policy=${result.counts.m1EnabledPolicy}`,
        `m1_enablement_enabled=${result.counts.m1EnablementEnabled}`,
        result.ok ? "STORE_SURFACE_SCAN_OK" : "STORE_SURFACE_SCAN_FAILED",
      ].join(" ") + "\n"
    )
    if (!result.ok) {
      for (const error of result.errors) {
        process.stderr.write(`${error}\n`)
      }
    }
  }

  if (check || !result.ok) {
    return result.ok ? 0 : 1
  }
  return 0
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)))
}
