import path from "path"
import type { ContractSurface, HttpMethod } from "../contracts"
import { MEDUSA_VERSION } from "../document"
import { verifyEvidenceFingerprint } from "./native-fingerprints"

export type NativeExtensionEntry = {
  surface: Extract<ContractSurface, "store" | "admin">
  method: HttpMethod
  path: string
  medusaVersion: typeof MEDUSA_VERSION
  officialReference: string
  inclusionReason: string
  evidenceFiles: string[]
  owningContract: "store.openapi.json" | "admin.openapi.json"
  fingerprints: Record<string, string>
}

const STORE_EVIDENCE = [
  "apps/backend/src/api/middlewares.ts",
  "apps/backend/src/api/store/products/query-config.ts",
  "apps/backend/src/api/store/products/serializers.ts",
  "apps/backend/integration-tests/http/catalog-store.spec.ts",
]

const ADMIN_EVIDENCE = [
  "apps/backend/src/api/middlewares.ts",
  "apps/backend/src/api/admin/products/sellable-gate-middleware.ts",
  "apps/backend/src/api/admin/products/validators.ts",
  "apps/backend/integration-tests/http/catalog-admin.spec.ts",
]

const NATIVE_EXTENSION_REASON =
  "Project middleware changes the observable Medusa 2.16.0 contract"

export const NATIVE_EXTENSIONS: NativeExtensionEntry[] = [
  {
    surface: "store",
    method: "GET",
    path: "/store/products",
    medusaVersion: MEDUSA_VERSION,
    officialReference:
      "https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/store/products/route.ts",
    inclusionReason: NATIVE_EXTENSION_REASON,
    evidenceFiles: STORE_EVIDENCE,
    owningContract: "store.openapi.json",
    fingerprints: {
      "apps/backend/src/api/middlewares.ts":
        "a655a5a294edc5aba05b3e1b3768c035a3a3fa40a5b01d9fee628e4d2009402c",
      "apps/backend/src/api/store/products/query-config.ts":
        "2944ea725986a34d78187ea584220a1d79d3f8895f07c70203c209380b5c1f49",
      "apps/backend/src/api/store/products/serializers.ts":
        "be57c5ed194311492df7f41deaf1e642391293c5b5198dce6e354a723b8e9914",
      "apps/backend/integration-tests/http/catalog-store.spec.ts":
        "6130a0fd2a5b85a0082f062cbfcaa421f640785869bf9ce107bd766e6aed26af",
    },
  },
  {
    surface: "store",
    method: "GET",
    path: "/store/products/{id}",
    medusaVersion: MEDUSA_VERSION,
    officialReference:
      "https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/store/products/%5Bid%5D/route.ts",
    inclusionReason: NATIVE_EXTENSION_REASON,
    evidenceFiles: STORE_EVIDENCE,
    owningContract: "store.openapi.json",
    fingerprints: {
      "apps/backend/src/api/middlewares.ts":
        "093409cd3f78da62c76ebca6adb6e02fa6e2d2f0cf3c582cf884d027c1477307",
      "apps/backend/src/api/store/products/query-config.ts":
        "ea39d2f7872074c4b80981f0c974741cce019787b3607961d831111ed21d839b",
      "apps/backend/src/api/store/products/serializers.ts":
        "ea3dc08100a8f03540587e043a4bc4fe7b385f593d04c8a53ff27438cf924f22",
      "apps/backend/integration-tests/http/catalog-store.spec.ts":
        "bd1a94a45bcf69a663c648cd30e60fb36845097709454661de288393cd04bf53",
    },
  },
  {
    surface: "admin",
    method: "POST",
    path: "/admin/products",
    medusaVersion: MEDUSA_VERSION,
    officialReference:
      "https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/admin/products/route.ts",
    inclusionReason: NATIVE_EXTENSION_REASON,
    evidenceFiles: ADMIN_EVIDENCE,
    owningContract: "admin.openapi.json",
    fingerprints: {
      "apps/backend/src/api/middlewares.ts":
        "500a30af5be87eae08cc2e06919c78ac90c0caf909e27901641b79700f25ee0e",
      "apps/backend/src/api/admin/products/sellable-gate-middleware.ts":
        "b842235b42e08f2b20e4e97f5ed4cbb2a101e4050c03f5d5ec797ad537af62e5",
      "apps/backend/src/api/admin/products/validators.ts":
        "6143735dd15ef060d9872d43257b17dd700b6a22947321720a66ab03ab49189e",
      "apps/backend/integration-tests/http/catalog-admin.spec.ts":
        "a5809a9d5605ab9cec6182d7b01497ed202f2e6e527edbe8a3a2316a0b823e3f",
    },
  },
  {
    surface: "admin",
    method: "POST",
    path: "/admin/products/{id}",
    medusaVersion: MEDUSA_VERSION,
    officialReference:
      "https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/admin/products/%5Bid%5D/route.ts",
    inclusionReason: NATIVE_EXTENSION_REASON,
    evidenceFiles: ADMIN_EVIDENCE,
    owningContract: "admin.openapi.json",
    fingerprints: {
      "apps/backend/src/api/middlewares.ts":
        "996fff949d62ddf391daecf3aaccfea26424f409829b6d7136a1bbe5548a8a9f",
      "apps/backend/src/api/admin/products/sellable-gate-middleware.ts":
        "93501738f135f745c009c2793368e3d5e0da17169c5f7324852de05a672788ea",
      "apps/backend/src/api/admin/products/validators.ts":
        "42690a25816e361d98e684e23ca94b7ead07cef9213816ace064fd9c50766ad0",
      "apps/backend/integration-tests/http/catalog-admin.spec.ts":
        "6c5b1d18c626ce17effea9a4f8cd8104dbf7f740ab6fc9a0dd4c7ff1a94cf434",
    },
  },
  {
    surface: "admin",
    method: "POST",
    path: "/admin/products/{id}/variants",
    medusaVersion: MEDUSA_VERSION,
    officialReference:
      "https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/admin/products/%5Bid%5D/variants/route.ts",
    inclusionReason: NATIVE_EXTENSION_REASON,
    evidenceFiles: ADMIN_EVIDENCE,
    owningContract: "admin.openapi.json",
    fingerprints: {
      "apps/backend/src/api/middlewares.ts":
        "8d4fe9852b2c4d2e219088236b05c7eeae7cf3b2c90c02647b0eeee92042e81c",
      "apps/backend/src/api/admin/products/sellable-gate-middleware.ts":
        "df4749d9db6e11e3aad3528aa650085113925bf0bcfa01d560c917bda20a0c43",
      "apps/backend/src/api/admin/products/validators.ts":
        "ce7a8a041b962d850f872fcd076ff520702a7dd3a97318832ac6757191388a37",
      "apps/backend/integration-tests/http/catalog-admin.spec.ts":
        "ffa90878ed77af8129131e1342d3527163773f368b8eb773b14b76ccab6917a0",
    },
  },
  {
    surface: "admin",
    method: "POST",
    path: "/admin/products/{id}/variants/{variant_id}",
    medusaVersion: MEDUSA_VERSION,
    officialReference:
      "https://github.com/medusajs/medusa/blob/v2.16.0/packages/medusa/src/api/admin/products/%5Bid%5D/variants/%5Bvariant_id%5D/route.ts",
    inclusionReason: NATIVE_EXTENSION_REASON,
    evidenceFiles: ADMIN_EVIDENCE,
    owningContract: "admin.openapi.json",
    fingerprints: {
      "apps/backend/src/api/middlewares.ts":
        "c709abff4de34f131491df5a2c5e6fdebf58728bdf8dce78e40a54888d51f149",
      "apps/backend/src/api/admin/products/sellable-gate-middleware.ts":
        "b2ff3b600f54e653e70315ff80a6a02ddaae6e09d93e3ac20b96f80166737c91",
      "apps/backend/src/api/admin/products/validators.ts":
        "20e7c78c45cea0ae443bab004f0196cc6cf5a27438a9d7cd00a968490ed6fe4b",
      "apps/backend/integration-tests/http/catalog-admin.spec.ts":
        "0e8c02de1c36686f20deb7a618e8ca65371bc41b3a7c9e61a0dfc22b9eac99bb",
    },
  },
]

export function verifyNativeExtensions(
  entries: NativeExtensionEntry[] = NATIVE_EXTENSIONS,
  repositoryRoot = path.resolve(__dirname, "../../../../..")
): void {
  if (entries.length !== 6) {
    throw new Error("Native extension manifest must contain exactly six entries")
  }

  const keys = new Set<string>()
  for (const entry of entries) {
    const key = `${entry.method} ${entry.path}`
    if (keys.has(key)) {
      throw new Error(`Duplicate native extension: ${key}`)
    }
    keys.add(key)

    if (
      entry.medusaVersion !== MEDUSA_VERSION ||
      !entry.officialReference.startsWith(
        "https://github.com/medusajs/medusa/blob/v2.16.0/"
      ) ||
      !entry.inclusionReason.trim()
    ) {
      throw new Error(`Invalid native extension provenance: ${key}`)
    }

    if (
      entry.evidenceFiles.length === 0 ||
      Object.keys(entry.fingerprints).length !== entry.evidenceFiles.length
    ) {
      throw new Error(`Invalid native extension evidence set: ${key}`)
    }

    for (const sourceFile of entry.evidenceFiles) {
      const expected = entry.fingerprints[sourceFile]
      if (!expected) {
        throw new Error(`Missing native evidence fingerprint: ${key} ${sourceFile}`)
      }
      verifyEvidenceFingerprint({
        repositoryRoot,
        method: entry.method,
        path: entry.path,
        sourceFile,
        expected,
      })
    }
  }
}
