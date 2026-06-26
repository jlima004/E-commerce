import type { AppEnv } from "../config/env"
import type { MedusaModuleDescriptor } from "./redis-config"

const FILE_MODULE = "@medusajs/medusa/file"
const FILE_S3_PROVIDER = "@medusajs/medusa/file-s3"

const STORAGE_ENV_KEYS = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_FILE_URL",
] as const satisfies ReadonlyArray<keyof AppEnv>

function isNonEmpty(value: string | undefined): value is string {
  return Boolean(value && value.trim().length > 0)
}

export function hasStorageModuleContracts(env: AppEnv): boolean {
  return STORAGE_ENV_KEYS.every((key) => isNonEmpty(env[key]))
}

export function shouldWireStorageModule(env: AppEnv): boolean {
  if (env.NODE_ENV === "production") {
    return true
  }

  return hasStorageModuleContracts(env)
}

export function buildStorageModule(env: AppEnv): MedusaModuleDescriptor[] {
  if (!shouldWireStorageModule(env)) {
    return []
  }

  if (!hasStorageModuleContracts(env)) {
    throw new Error(
      "Missing required storage module contracts: S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FILE_URL"
    )
  }

  return [
    {
      resolve: FILE_MODULE,
      options: {
        providers: [
          {
            resolve: FILE_S3_PROVIDER,
            id: "s3",
            options: {
              file_url: env.S3_FILE_URL,
              access_key_id: env.S3_ACCESS_KEY_ID,
              secret_access_key: env.S3_SECRET_ACCESS_KEY,
              region: env.S3_REGION,
              bucket: env.S3_BUCKET,
              endpoint: env.S3_ENDPOINT,
              additional_client_config: {
                forcePathStyle: true,
              },
            },
          },
        ],
      },
    },
  ]
}
