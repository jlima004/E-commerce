import { loadEnv } from "@medusajs/framework/utils"
import { z } from "zod"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const FORBIDDEN_SECRETS = new Set([
  "supersecret",
  "changeme",
  "your-secret",
  "jwt_secret",
  "cookie_secret",
  "secret",
  "password",
])

const FORBIDDEN_APP_VERSIONS = new Set(["dev", "unknown"])

const WORKER_MODES = ["shared", "server", "worker"] as const

type WorkerMode = (typeof WORKER_MODES)[number]

export type AppEnv = {
  NODE_ENV: string
  DATABASE_URL: string | undefined
  DATABASE_MIGRATION_URL: string | undefined
  API_PUBLIC_URL: string | undefined
  STORE_CORS: string
  ADMIN_CORS: string
  AUTH_CORS: string
  REDIS_URL: string | undefined
  CACHE_REDIS_URL: string | undefined
  EVENTS_REDIS_URL: string | undefined
  WE_REDIS_URL: string | undefined
  JWT_SECRET: string
  COOKIE_SECRET: string
  SENTRY_DSN: string | undefined
  APP_VERSION: string
  WORKER_MODE: WorkerMode
  ADMIN_DISABLED: boolean
}

function isProduction(input: Record<string, string | undefined>): boolean {
  return input.NODE_ENV === "production"
}

function parseBoolean(
  value: string | undefined,
  fieldName: string,
  defaultValue = false
): boolean {
  if (value === undefined) {
    return defaultValue
  }

  if (value === "true") {
    return true
  }

  if (value === "false") {
    return false
  }

  throw new Error(`Invalid ${fieldName}: must be true or false`)
}

function parseWorkerMode(value: string | undefined, fieldName: string): WorkerMode {
  if (!value) {
    return "shared"
  }

  if ((WORKER_MODES as readonly string[]).includes(value)) {
    return value as WorkerMode
  }

  throw new Error(
    `Invalid ${fieldName}: must be one of ${WORKER_MODES.join(", ")}`
  )
}

function assertNonEmpty(value: string | undefined, fieldName: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required variable: ${fieldName}`)
  }

  return value
}

function assertProductionSecret(value: string | undefined, fieldName: string): string {
  const secret = assertNonEmpty(value, fieldName)

  if (secret.length < 32) {
    throw new Error(`Invalid ${fieldName}: must be at least 32 characters`)
  }

  if (FORBIDDEN_SECRETS.has(secret.toLowerCase())) {
    throw new Error(`Invalid ${fieldName}: placeholder values are not allowed`)
  }

  return secret
}

function assertProductionAppVersion(value: string | undefined): string {
  const version = assertNonEmpty(value, "APP_VERSION")

  if (FORBIDDEN_APP_VERSIONS.has(version.toLowerCase())) {
    throw new Error(`Invalid APP_VERSION: placeholder values are not allowed`)
  }

  return version
}

function assertProductionUrl(value: string | undefined, fieldName: string): string {
  return assertNonEmpty(value, fieldName)
}

function formatZodIssues(error: z.ZodError): string {
  const fieldNames = [...new Set(error.issues.map((issue) => issue.path.join(".")))]
  return `Invalid environment configuration: ${fieldNames.join(", ")}`
}

export function parseEnv(
  input: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): AppEnv {
  const production = isProduction(input)
  const normalized = { ...input }

  if (!production && !normalized.APP_VERSION) {
    normalized.APP_VERSION = "dev"
  }

  if (production) {
    assertProductionUrl(normalized.DATABASE_URL, "DATABASE_URL")
    assertProductionUrl(normalized.DATABASE_MIGRATION_URL, "DATABASE_MIGRATION_URL")
    assertProductionUrl(normalized.API_PUBLIC_URL, "API_PUBLIC_URL")
    assertProductionUrl(normalized.STORE_CORS, "STORE_CORS")
    assertProductionUrl(normalized.ADMIN_CORS, "ADMIN_CORS")
    assertProductionUrl(normalized.AUTH_CORS, "AUTH_CORS")
    assertProductionUrl(normalized.REDIS_URL, "REDIS_URL")
    assertProductionUrl(normalized.CACHE_REDIS_URL, "CACHE_REDIS_URL")
    assertProductionUrl(normalized.EVENTS_REDIS_URL, "EVENTS_REDIS_URL")
    assertProductionUrl(normalized.WE_REDIS_URL, "WE_REDIS_URL")
    assertProductionUrl(normalized.SENTRY_DSN, "SENTRY_DSN")
    assertProductionAppVersion(normalized.APP_VERSION)
    assertProductionSecret(normalized.JWT_SECRET, "JWT_SECRET")
    assertProductionSecret(normalized.COOKIE_SECRET, "COOKIE_SECRET")
  }

  const baseSchema = z.object({
    NODE_ENV: z.string().default("development"),
    DATABASE_URL: z.string().optional(),
    DATABASE_MIGRATION_URL: z.string().optional(),
    API_PUBLIC_URL: z.string().optional(),
    STORE_CORS: z.string().default("http://localhost:8000"),
    ADMIN_CORS: z.string().default("http://localhost:9000"),
    AUTH_CORS: z.string().default("http://localhost:9000"),
    REDIS_URL: z.string().optional(),
    CACHE_REDIS_URL: z.string().optional(),
    EVENTS_REDIS_URL: z.string().optional(),
    WE_REDIS_URL: z.string().optional(),
    JWT_SECRET: z.string().default("supersecret"),
    COOKIE_SECRET: z.string().default("supersecret"),
    SENTRY_DSN: z.string().optional(),
    APP_VERSION: z.string().default("dev"),
  })

  const parsed = baseSchema.safeParse(normalized)

  if (!parsed.success) {
    throw new Error(formatZodIssues(parsed.error))
  }

  const data = parsed.data

  return {
    NODE_ENV: data.NODE_ENV,
    DATABASE_URL: data.DATABASE_URL,
    DATABASE_MIGRATION_URL: data.DATABASE_MIGRATION_URL,
    API_PUBLIC_URL: data.API_PUBLIC_URL,
    STORE_CORS: data.STORE_CORS,
    ADMIN_CORS: data.ADMIN_CORS,
    AUTH_CORS: data.AUTH_CORS,
    REDIS_URL: data.REDIS_URL,
    CACHE_REDIS_URL: data.CACHE_REDIS_URL,
    EVENTS_REDIS_URL: data.EVENTS_REDIS_URL,
    WE_REDIS_URL: data.WE_REDIS_URL,
    JWT_SECRET: data.JWT_SECRET,
    COOKIE_SECRET: data.COOKIE_SECRET,
    SENTRY_DSN: data.SENTRY_DSN,
    APP_VERSION: data.APP_VERSION,
    WORKER_MODE: parseWorkerMode(normalized.WORKER_MODE, "WORKER_MODE"),
    ADMIN_DISABLED: parseBoolean(normalized.ADMIN_DISABLED, "ADMIN_DISABLED"),
  }
}

export const env = parseEnv()
