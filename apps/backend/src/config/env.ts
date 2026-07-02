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
  S3_ENDPOINT: string | undefined
  S3_REGION: string | undefined
  S3_BUCKET: string | undefined
  S3_ACCESS_KEY_ID: string | undefined
  S3_SECRET_ACCESS_KEY: string | undefined
  S3_FILE_URL: string | undefined
  STRIPE_REAL_INITIATION_ENABLED: boolean
  STRIPE_SECRET_KEY: string | undefined
  STRIPE_PIX_EXPIRES_AFTER_SECONDS: number
  STRIPE_WEBHOOK_SECRET: string | undefined
  STRIPE_WEBHOOK_INGESTION_ENABLED: boolean
  RESEND_API_KEY: string | undefined
  RESEND_FROM_EMAIL: string | undefined
  RESEND_ORDER_CONFIRMATION_ENABLED: boolean
  RESEND_REPLY_TO: string | undefined
  GELATO_DISPATCH_ENABLED: boolean
  GELATO_API_KEY: string | undefined
  GELATO_SHIPMENT_METHOD_UID: string | undefined
  GELATO_WEBHOOK_AUTH_HEADER_NAME: string
  GELATO_WEBHOOK_SECRET: string | undefined
  TRACKING_TOKEN_PEPPER: string | undefined
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

function parseBoundedInteger(
  value: string | undefined,
  fieldName: string,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (value === undefined) {
    return defaultValue
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${fieldName}: must be an integer`)
  }

  const parsed = Number.parseInt(value, 10)
  if (parsed < min || parsed > max) {
    throw new Error(`Invalid ${fieldName}: must be between ${min} and ${max}`)
  }

  return parsed
}

function assertStripeTestSecret(
  value: string | undefined,
  fieldName: string,
  enabled: boolean
): string | undefined {
  if (!value || value.trim().length === 0) {
    if (enabled) {
      throw new Error(`Missing required variable: ${fieldName}`)
    }

    return undefined
  }

  const secret = value.trim()
  if (!secret.startsWith("sk_test_")) {
    throw new Error(`Invalid ${fieldName}: must be a Stripe test-mode secret key`)
  }

  return secret
}

function assertStripeWebhookSecret(
  value: string | undefined,
  fieldName: string,
  enabled: boolean
): string | undefined {
  if (!value || value.trim().length === 0) {
    if (enabled) {
      throw new Error(`Missing required variable: ${fieldName}`)
    }

    return undefined
  }

  const secret = value.trim()

  if (!secret.startsWith("whsec_")) {
    throw new Error(`Invalid ${fieldName}: must start with whsec_`)
  }

  if (FORBIDDEN_SECRETS.has(secret.toLowerCase())) {
    throw new Error(`Invalid ${fieldName}: placeholder values are not allowed`)
  }

  return secret
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

const SIGNED_STORAGE_URL_MARKERS = [
  "/object/sign/",
  "X-Amz-",
  "token=",
  "signature=",
  "expires=",
] as const

function assertProductionPublicStorageUrl(
  value: string | undefined,
  fieldName: string
): string {
  const url = assertProductionUrl(value, fieldName)

  if (!url.startsWith("https://")) {
    throw new Error(`Invalid ${fieldName}: must use https for public catalog URLs`)
  }

  if (!url.includes("/storage/v1/object/public/")) {
    throw new Error(
      `Invalid ${fieldName}: must use a public Supabase Storage object URL`
    )
  }

  for (const marker of SIGNED_STORAGE_URL_MARKERS) {
    if (url.includes(marker)) {
      throw new Error(`Invalid ${fieldName}: signed or expiring URLs are not allowed`)
    }
  }

  return url
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
    assertProductionUrl(normalized.S3_ENDPOINT, "S3_ENDPOINT")
    assertProductionUrl(normalized.S3_REGION, "S3_REGION")
    assertProductionUrl(normalized.S3_BUCKET, "S3_BUCKET")
    assertProductionUrl(normalized.S3_ACCESS_KEY_ID, "S3_ACCESS_KEY_ID")
    assertProductionUrl(normalized.S3_SECRET_ACCESS_KEY, "S3_SECRET_ACCESS_KEY")
    assertProductionPublicStorageUrl(normalized.S3_FILE_URL, "S3_FILE_URL")
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
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FILE_URL: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PIX_EXPIRES_AFTER_SECONDS: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_WEBHOOK_INGESTION_ENABLED: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().optional(),
    RESEND_ORDER_CONFIRMATION_ENABLED: z.string().optional(),
    RESEND_REPLY_TO: z.string().optional(),
    GELATO_DISPATCH_ENABLED: z.string().optional(),
    GELATO_API_KEY: z.string().optional(),
    GELATO_SHIPMENT_METHOD_UID: z.string().optional(),
    GELATO_WEBHOOK_AUTH_HEADER_NAME: z.string().optional(),
    GELATO_WEBHOOK_SECRET: z.string().optional(),
    TRACKING_TOKEN_PEPPER: z.string().optional(),
  })

  const parsed = baseSchema.safeParse(normalized)

  if (!parsed.success) {
    throw new Error(formatZodIssues(parsed.error))
  }

  const data = parsed.data
  const stripeRealInitiationEnabled = parseBoolean(
    normalized.STRIPE_REAL_INITIATION_ENABLED,
    "STRIPE_REAL_INITIATION_ENABLED"
  )
  const stripeWebhookIngestionEnabled = parseBoolean(
    normalized.STRIPE_WEBHOOK_INGESTION_ENABLED,
    "STRIPE_WEBHOOK_INGESTION_ENABLED"
  )
  const resendOrderConfirmationEnabled = parseBoolean(
    normalized.RESEND_ORDER_CONFIRMATION_ENABLED,
    "RESEND_ORDER_CONFIRMATION_ENABLED"
  )
  const gelatoDispatchEnabled = parseBoolean(
    normalized.GELATO_DISPATCH_ENABLED,
    "GELATO_DISPATCH_ENABLED"
  )

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
    S3_ENDPOINT: data.S3_ENDPOINT,
    S3_REGION: data.S3_REGION,
    S3_BUCKET: data.S3_BUCKET,
    S3_ACCESS_KEY_ID: data.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: data.S3_SECRET_ACCESS_KEY,
    S3_FILE_URL: data.S3_FILE_URL,
    STRIPE_REAL_INITIATION_ENABLED: stripeRealInitiationEnabled,
    STRIPE_SECRET_KEY: assertStripeTestSecret(
      data.STRIPE_SECRET_KEY,
      "STRIPE_SECRET_KEY",
      stripeRealInitiationEnabled
    ),
    STRIPE_PIX_EXPIRES_AFTER_SECONDS: parseBoundedInteger(
      data.STRIPE_PIX_EXPIRES_AFTER_SECONDS,
      "STRIPE_PIX_EXPIRES_AFTER_SECONDS",
      86_400,
      10,
      1_209_600
    ),
    STRIPE_WEBHOOK_SECRET: assertStripeWebhookSecret(
      data.STRIPE_WEBHOOK_SECRET,
      "STRIPE_WEBHOOK_SECRET",
      stripeWebhookIngestionEnabled
    ),
    STRIPE_WEBHOOK_INGESTION_ENABLED: stripeWebhookIngestionEnabled,
    RESEND_API_KEY: data.RESEND_API_KEY?.trim() || undefined,
    RESEND_FROM_EMAIL: data.RESEND_FROM_EMAIL?.trim() || undefined,
    RESEND_ORDER_CONFIRMATION_ENABLED: resendOrderConfirmationEnabled,
    RESEND_REPLY_TO: data.RESEND_REPLY_TO?.trim() || undefined,
    GELATO_DISPATCH_ENABLED: gelatoDispatchEnabled,
    GELATO_API_KEY: data.GELATO_API_KEY?.trim() || undefined,
    GELATO_SHIPMENT_METHOD_UID:
      data.GELATO_SHIPMENT_METHOD_UID?.trim() || undefined,
    GELATO_WEBHOOK_AUTH_HEADER_NAME:
      data.GELATO_WEBHOOK_AUTH_HEADER_NAME?.trim() ||
      "X-GELATO-WEBHOOK-SECRET",
    GELATO_WEBHOOK_SECRET: data.GELATO_WEBHOOK_SECRET?.trim() || undefined,
    TRACKING_TOKEN_PEPPER: data.TRACKING_TOKEN_PEPPER?.trim() || undefined,
  }
}

export const env = parseEnv()
