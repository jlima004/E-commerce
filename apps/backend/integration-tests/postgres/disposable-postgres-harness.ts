export const DISPOSABLE_DATABASE_PREFIX = "p12_disposable_"
export const POSTGRES_UNAVAILABLE_CODE = "P12_DISPOSABLE_POSTGRES_UNAVAILABLE"

export type DisposableMedusaEnvironment = Record<string, string | undefined>

const REDIS_CONTRACT_NAMES = [
  "REDIS_URL",
  "CACHE_REDIS_URL",
  "EVENTS_REDIS_URL",
  "WE_REDIS_URL",
] as const

const DISPOSABLE_MEDUSA_ENVIRONMENT_OVERRIDES = {
  NODE_ENV: "test",
  WORKER_MODE: "shared",
  REDIS_URL: "",
  CACHE_REDIS_URL: "",
  EVENTS_REDIS_URL: "",
  WE_REDIS_URL: "",
  REDIS_TLS_REJECT_UNAUTHORIZED: "",
  REDIS_CACHE_PROVIDER_DISABLED: "",
  DTC_RELEASE_MIGRATION_MODE: "",
  DTC_RELEASE_MIGRATION_CHILD_PROCESS: "",
  STRIPE_REAL_INITIATION_ENABLED: "false",
  STRIPE_WEBHOOK_INGESTION_ENABLED: "false",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  RESEND_ORDER_CONFIRMATION_ENABLED: "false",
  RESEND_API_KEY: "",
  RESEND_FROM_EMAIL: "",
  GELATO_DISPATCH_ENABLED: "false",
  GELATO_API_KEY: "",
  GELATO_SHIPMENT_METHOD_UID: "",
  GELATO_WEBHOOK_SECRET: "",
  SENTRY_DSN: "",
  POSTHOG_API_KEY: "",
  POSTHOG_HOST: "",
  S3_ENDPOINT: "",
  S3_REGION: "",
  S3_BUCKET: "",
  S3_ACCESS_KEY_ID: "",
  S3_SECRET_ACCESS_KEY: "",
  S3_FILE_URL: "",
} as const

const FORBIDDEN_REDIS_OUTPUT = [
  { name: "Connection to Redis in module", pattern: /Connection to Redis in module/i },
  { name: "Redis cache connection established", pattern: /Redis cache connection established/i },
  { name: "event-bus-redis", pattern: /event-bus-redis/i },
  { name: "locking-redis", pattern: /locking-redis/i },
  { name: "workflow-engine-redis", pattern: /workflow-engine-redis/i },
  { name: "bullmq", pattern: /bullmq/i },
  { name: "ioredis", pattern: /ioredis/i },
  { name: "ECONNREFUSED_6379", pattern: /ECONNREFUSED[^\r\n]*6379/i },
  { name: "Connection is closed", pattern: /Connection is closed/i },
  { name: "MaxRetriesPerRequestError", pattern: /MaxRetriesPerRequestError/i },
] as const

const DISPOSABLE_DATABASE_PATTERN = /^p12_disposable_[a-z0-9_]+$/
const DISPOSABLE_CONTAINER_PATTERN = /^p12-pg-[a-z0-9-]+$/
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"])
const SYSTEM_DATABASES = new Set(["postgres", "template0", "template1"])

export function normalizeLoopbackHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase()

  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return normalized.slice(1, -1)
  }

  return normalized
}

export class DisposablePostgresHarnessError extends Error {
  readonly code: string

  constructor(code: string, message = code) {
    super(message)
    this.name = "DisposablePostgresHarnessError"
    this.code = code
  }
}

export function buildDisposableMedusaEnvironment(
  source: NodeJS.ProcessEnv
): DisposableMedusaEnvironment {
  return {
    ...source,
    ...DISPOSABLE_MEDUSA_ENVIRONMENT_OVERRIDES,
  }
}

export function assertDisposableMedusaEnvironment(
  environment: DisposableMedusaEnvironment
): void {
  if (environment.NODE_ENV !== "test") {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_NODE_ENV_FORBIDDEN"
    )
  }

  requireDisposableDatabaseName(environment.DB_TEMP_NAME)

  const invalidRedisContracts = REDIS_CONTRACT_NAMES.filter(
    (name) =>
      !Object.prototype.hasOwnProperty.call(environment, name) ||
      environment[name] !== ""
  )

  if (invalidRedisContracts.length > 0) {
    throw new DisposablePostgresHarnessError(
      "P12_REAL_REDIS_FORBIDDEN",
      `P12_REAL_REDIS_FORBIDDEN: ${invalidRedisContracts.join(", ")}`
    )
  }
}

export function assertNoRealRedisProcessOutput(value: unknown): void {
  const output = String(value ?? "")
  const matches = FORBIDDEN_REDIS_OUTPUT.filter(({ pattern }) =>
    pattern.test(output)
  ).map(({ name }) => name)

  if (matches.length > 0) {
    throw new DisposablePostgresHarnessError(
      "P12_REAL_REDIS_FORBIDDEN",
      `P12_REAL_REDIS_FORBIDDEN: ${matches.join(", ")}`
    )
  }
}

export function requireDisposableDatabaseName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_DATABASE_NAME_REQUIRED"
    )
  }

  const databaseName = value.trim()

  if (
    databaseName.length > 63 ||
    !DISPOSABLE_DATABASE_PATTERN.test(databaseName) ||
    SYSTEM_DATABASES.has(databaseName)
  ) {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN"
    )
  }

  return databaseName
}

export function requireDisposableContainerName(value: unknown): string {
  if (
    typeof value !== "string" ||
    !DISPOSABLE_CONTAINER_PATTERN.test(value)
  ) {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_CONTAINER_NAME_FORBIDDEN"
    )
  }

  return value
}

export type ValidatedMaintenanceTarget = {
  url: URL
  hostname: string
  port: string
  username: string
  password: string
  maintenanceDatabase: string
  disposableDatabase: string
}

export function validateMaintenanceTarget(
  rawUrl: unknown,
  rawDatabaseName: unknown
): ValidatedMaintenanceTarget {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_DATABASE_URL_REQUIRED"
    )
  }

  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_DATABASE_URL_INVALID"
    )
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_DATABASE_PROTOCOL_FORBIDDEN"
    )
  }

  const hostname = normalizeLoopbackHostname(url.hostname)

  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_DATABASE_HOST_FORBIDDEN"
    )
  }

  const maintenanceDatabase = decodeURIComponent(url.pathname.slice(1))
  const disposableDatabase = requireDisposableDatabaseName(rawDatabaseName)

  if (
    maintenanceDatabase.trim() === "" ||
    maintenanceDatabase.includes("/") ||
    maintenanceDatabase === disposableDatabase
  ) {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_MAINTENANCE_DATABASE_FORBIDDEN"
    )
  }

  return {
    url,
    hostname,
    port: url.port || "5432",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    maintenanceDatabase,
    disposableDatabase,
  }
}

export function buildDatabaseEnvironment(
  target: ValidatedMaintenanceTarget
): Record<string, string> {
  const disposableUrl = new URL(target.url)
  disposableUrl.pathname = `/${target.disposableDatabase}`
  disposableUrl.search = ""
  disposableUrl.hash = ""

  return {
    // @medusajs/test-utils@2.16.0 only disables its remote-SSL branch when
    // the generated client URL contains the literal "localhost".
    DB_HOST: target.hostname === "127.0.0.1" ? "localhost" : target.hostname,
    DB_PORT: target.port,
    DB_USERNAME: target.username,
    DB_PASSWORD: target.password,
    DB_TEMP_NAME: target.disposableDatabase,
    DATABASE_URL: disposableUrl.toString(),
    DATABASE_MIGRATION_URL: disposableUrl.toString(),
  }
}

export function selectProvisioningMode(input: {
  databaseUrl?: string
  databaseName?: string
  dockerAvailable: boolean
}): "external" | "docker" {
  const hasUrl = Boolean(input.databaseUrl)
  const hasName = Boolean(input.databaseName)

  if (hasUrl !== hasName) {
    throw new DisposablePostgresHarnessError(
      "P12_DISPOSABLE_POSTGRES_CONFIG_INCOMPLETE"
    )
  }

  if (hasUrl && hasName) {
    validateMaintenanceTarget(input.databaseUrl, input.databaseName)
    return "external"
  }

  if (!input.dockerAvailable) {
    throw new DisposablePostgresHarnessError(POSTGRES_UNAVAILABLE_CODE)
  }

  return "docker"
}

export function redactPostgresText(
  value: unknown,
  secrets: string[] = []
): string {
  let redacted = String(value ?? "")

  redacted = redacted.replace(
    /postgres(?:ql)?:\/\/[^\s/@:]+(?::[^\s/@]*)?@/gi,
    "postgres://[REDACTED]@"
  )
  redacted = redacted.replace(
    /\b(DB_PASSWORD|POSTGRES_PASSWORD|PGPASSWORD)=([^\s]+)/gi,
    "$1=[REDACTED]"
  )

  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join("[REDACTED]")
    }
  }

  return redacted
}

export function redactDisposableProcessOutput(
  value: unknown,
  environment: DisposableMedusaEnvironment
): string {
  const sensitiveValues = Object.entries(environment)
    .filter(([name, candidate]) => {
      return (
        Boolean(candidate) &&
        /(?:SECRET|PASSWORD|TOKEN|KEY|DSN|DATABASE_URL|REDIS_URL)/i.test(name)
      )
    })
    .map(([, candidate]) => candidate!)

  return redactPostgresText(value, sensitiveValues).replace(
    /\b(?:redis|rediss):\/\/[^\s]+/gi,
    "redis://[REDACTED]"
  )
}

type CleanupCoordinatorInput = {
  databaseName: string
  containerName?: string
  confirmDatabaseAbsent: (databaseName: string) => Promise<boolean>
  removeContainer?: (containerName: string) => Promise<void>
}

export function createCleanupCoordinator(input: CleanupCoordinatorInput) {
  const databaseName = requireDisposableDatabaseName(input.databaseName)
  const containerName = input.containerName
    ? requireDisposableContainerName(input.containerName)
    : undefined
  let cleanupPromise: Promise<void> | undefined

  async function cleanup(): Promise<void> {
    if (cleanupPromise) {
      return cleanupPromise
    }

    cleanupPromise = (async () => {
      let cleanupError: unknown

      try {
        requireDisposableDatabaseName(databaseName)
        const absent = await input.confirmDatabaseAbsent(databaseName)

        if (!absent) {
          cleanupError = new DisposablePostgresHarnessError(
            "P12_DISPOSABLE_DATABASE_RESIDUE"
          )
        }
      } catch (error) {
        cleanupError = error
      } finally {
        if (containerName && input.removeContainer) {
          await input.removeContainer(containerName)
        }
      }

      if (cleanupError) {
        throw cleanupError
      }
    })()

    return cleanupPromise
  }

  async function handleSignal(signal: "SIGINT" | "SIGTERM"): Promise<number> {
    await cleanup()
    return signal === "SIGINT" ? 130 : 143
  }

  return { cleanup, handleSignal }
}
