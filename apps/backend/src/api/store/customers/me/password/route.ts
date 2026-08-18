import { createHash, createHmac } from "node:crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import Redis from "ioredis"
import { env } from "../../../../../config/env"
import { PasswordChangeRequestSchema } from "../../../../auth-surface/validators"
import { toAuthErrorResponse } from "../../../../auth-surface/errors"
import {
  authorizeCustomerAuthAccess,
  createKnexCustomerAuthAccessDatabase,
  type CustomerAuthAccessDatabase,
} from "../../../../../modules/customer-auth/access-guard"
import {
  AuthPasswordChangeError,
  authorizePasswordChangeResumeOnly,
  changePassword,
  createKnexPasswordChangeQueryDatabase,
  type PasswordChangeDatabase,
  type PasswordChangePasswordProvider,
  type PasswordChangeQueryDatabase,
  type PasswordChangeResult,
} from "../../../../../modules/customer-auth/password-change"
import type { CapabilityKeyring } from "../../../../../modules/customer-auth/security/capabilities"
import { normalizeCustomerAuthEmail } from "../../../../../modules/customer-auth/security/email-normalization"
import {
  AUTH_RATE_LIMIT_POLICIES,
  AuthRateLimitUnavailableError,
  RedisAtomicRateLimitStore,
  consumeRateLimitBuckets,
  type AtomicRateLimitStore,
  type AuthRateLimitKeyring,
  type DerivedRateLimitBucket,
} from "../../../../../modules/customer-auth/security/rate-limit"
import {
  fetchAuthoritativeRawEmailsForIdentity,
  type QueryGraphLike,
} from "../../../../../modules/customer-auth/notification-recipient"

type AuthHeaders = Record<string, string | string[] | undefined>

export type CustomerAuthPasswordChangeRequest = {
  body?: unknown
  headers: AuthHeaders
  correlationId?: string
  scope?: {
    resolve: <T = unknown>(key: unknown) => T
  }
}

export type CustomerAuthPasswordChangeResponse = {
  headersSent?: boolean
  status: (statusCode: number) => CustomerAuthPasswordChangeResponse
  setHeader: (
    name: string,
    value: string
  ) => CustomerAuthPasswordChangeResponse | void
  json: (body: unknown) => CustomerAuthPasswordChangeResponse | void
  end: () => CustomerAuthPasswordChangeResponse | void
}

export type CustomerAuthPasswordChangeDependencies = {
  accessDatabase: CustomerAuthAccessDatabase
  queryDatabase: PasswordChangeQueryDatabase
  database: PasswordChangeDatabase
  keyring: CapabilityKeyring
  jwtSecret: string
  rateLimitStore: AtomicRateLimitStore
  provider: PasswordChangePasswordProvider
  now?: () => Date
  changePassword?: (
    database: PasswordChangeDatabase,
    input: Parameters<typeof changePassword>[1]
  ) => Promise<PasswordChangeResult>
}

type KnexLike = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
  transaction<T>(
    callback: (transaction: KnexLike) => Promise<T>
  ): Promise<T>
}

type AuthModuleLike = {
  updateProvider(
    provider: string,
    data: Record<string, unknown>
  ): Promise<{ success?: boolean; error?: unknown; authIdentity?: { id?: string } }>
  authenticate(
    provider: string,
    input: {
      actor_type: string
      body: { email: string; password: string }
    }
  ): Promise<{
    success?: boolean
    authIdentity?: { id?: string }
  }>
}

type PasswordChangeRuntime = {
  dependencies: CustomerAuthPasswordChangeDependencies
  close: () => Promise<void>
}

function getRequestBody(req: CustomerAuthPasswordChangeRequest): unknown {
  return req.body === undefined ? {} : req.body
}

function singleHeader(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function writePasswordChangeError(
  req: CustomerAuthPasswordChangeRequest,
  res: CustomerAuthPasswordChangeResponse,
  code:
    | "INVALID_REQUEST"
    | "CURRENT_CREDENTIAL_INVALID"
    | "AUTHENTICATION_REQUIRED"
    | "RATE_LIMITED"
    | "AUTH_TEMPORARILY_UNAVAILABLE"
    | "AUTH_RECOVERY_PENDING",
  options: { retryAfterSeconds?: number } = {}
): void {
  const normalized = toAuthErrorResponse(
    { code },
    { correlationId: req.correlationId }
  )
  const retryAfter = options.retryAfterSeconds ?? normalized.retryAfterSeconds
  if (retryAfter !== undefined) {
    res.setHeader("Retry-After", String(retryAfter))
  }
  if (code === "AUTH_TEMPORARILY_UNAVAILABLE") {
    res.setHeader("Retry-After", String(retryAfter ?? 60))
  }
  res.status(normalized.statusCode).json(normalized.body)
}

export function buildAuthenticatedPasswordChangeKeys(input: {
  keyring: AuthRateLimitKeyring
  authorizedLineageId: string
}): DerivedRateLimitBucket[] {
  if (!input.authorizedLineageId) {
    throw new Error("Authorized lineage is required")
  }
  const version = input.keyring.active.version
  const policy = AUTH_RATE_LIMIT_POLICIES["password-change"].authenticated.lineage
  const material = `lineage-digest:${createHash("sha256")
    .update(input.authorizedLineageId, "utf8")
    .digest("hex")}`
  const domain = [
    "auth-rate",
    `key-version:${version}`,
    "operation:password-change",
    "purpose:authenticated-lineage",
    material,
  ].join("|")
  const digest = createHmac("sha256", input.keyring.active.secret)
    .update(domain, "utf8")
    .digest("hex")
  return [
    {
      key: `auth-rate:v${version}:authenticated-lineage:${digest}`,
      digest,
      limit: policy[0],
      windowSeconds: policy[1],
    },
  ]
}

function createKnexPasswordChangeDatabase(knex: KnexLike): PasswordChangeDatabase {
  return {
    transaction(callback) {
      return knex.transaction((transaction) =>
        callback({
          raw(sql, bindings = []) {
            return transaction.raw(sql, bindings)
          },
        })
      )
    },
  }
}

function resolveKnex(req: CustomerAuthPasswordChangeRequest): KnexLike {
  const knex = req.scope?.resolve<KnexLike>(
    ContainerRegistrationKeys.PG_CONNECTION
  )
  if (
    !knex ||
    typeof knex.raw !== "function" ||
    typeof knex.transaction !== "function"
  ) {
    throw new Error("CUSTOMER_AUTH_POSTGRES_UNAVAILABLE")
  }
  return knex
}

function resolveQuery(
  req: CustomerAuthPasswordChangeRequest
): QueryGraphLike | null {
  try {
    const query = req.scope?.resolve<QueryGraphLike>(
      ContainerRegistrationKeys.QUERY
    )
    return query && typeof query.graph === "function" ? query : null
  } catch {
    return null
  }
}

function normalizeSingleEmail(rawEmails: readonly string[]): string | null {
  const normalized = new Set<string>()
  for (const rawEmail of rawEmails) {
    try {
      normalized.add(normalizeCustomerAuthEmail(rawEmail))
    } catch {
      return null
    }
  }
  return normalized.size === 1 ? [...normalized][0] ?? null : null
}

async function resolveEmailByIdentityId(
  req: CustomerAuthPasswordChangeRequest,
  authIdentityId: string
): Promise<string | null> {
  const rawEmails = await fetchAuthoritativeRawEmailsForIdentity(
    authIdentityId,
    {
      query: resolveQuery(req) ?? undefined,
    }
  )
  return normalizeSingleEmail(rawEmails)
}

function isTimeoutLike(error: unknown): boolean {
  if (!error) {
    return false
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof error === "object" &&
            "message" in error &&
            typeof error.message === "string"
          ? error.message
          : ""
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : ""
  const haystack = `${code} ${message}`.toLowerCase()
  return (
    haystack.includes("timeout") ||
    haystack.includes("etimedout") ||
    haystack.includes("aborted")
  )
}

export function createEmailpassPasswordChangeProvider(
  req: CustomerAuthPasswordChangeRequest,
  authModule: AuthModuleLike
): PasswordChangePasswordProvider {
  return {
    async updatePassword({ authIdentityId, password }) {
      const email = await resolveEmailByIdentityId(req, authIdentityId)
      if (!email) {
        return "ambiguous"
      }
      try {
        const updated = await authModule.updateProvider("emailpass", {
          entity_id: email,
          password,
        })
        if (updated.success) {
          return "updated"
        }
        return isTimeoutLike(updated.error) ? "timeout" : "ambiguous"
      } catch (error) {
        return isTimeoutLike(error) ? "timeout" : "ambiguous"
      }
    },
    async verifyPassword({ authIdentityId, password }) {
      const email = await resolveEmailByIdentityId(req, authIdentityId)
      if (!email) {
        return false
      }
      try {
        const response = await authModule.authenticate("emailpass", {
          actor_type: "customer",
          body: { email, password },
        })
        return Boolean(
          response.success && response.authIdentity?.id === authIdentityId
        )
      } catch {
        return false
      }
    },
  }
}

export async function handleCustomerAuthPasswordChange(
  req: CustomerAuthPasswordChangeRequest,
  res: CustomerAuthPasswordChangeResponse,
  dependencies: CustomerAuthPasswordChangeDependencies
): Promise<void> {
  const parsed = PasswordChangeRequestSchema.safeParse(getRequestBody(req))
  if (!parsed.success) {
    writePasswordChangeError(req, res, "INVALID_REQUEST")
    return
  }

  const authorization = singleHeader(req.headers.authorization)
  const idempotencyKey = singleHeader(req.headers["idempotency-key"])
  const now = dependencies.now?.() ?? new Date()

  try {
    const stable = await authorizeCustomerAuthAccess(
      dependencies.accessDatabase,
      authorization,
      {
        jwtSecret: dependencies.jwtSecret,
        now,
      }
    )

    let mode: "fresh" | "resume"
    let authIdentityId: string
    let customerId: string
    let lineageId: string

    if (stable.authorized) {
      if (!idempotencyKey) {
        writePasswordChangeError(req, res, "INVALID_REQUEST")
        return
      }
      mode = "fresh"
      authIdentityId = stable.authIdentityId
      customerId = stable.customerId
      lineageId = stable.lineageId
    } else {
      const resume = await authorizePasswordChangeResumeOnly(
        dependencies.queryDatabase,
        authorization,
        {
          jwtSecret: dependencies.jwtSecret,
          idempotencyKey,
          keyring: dependencies.keyring,
          now,
        }
      )
      if (!resume.authorized) {
        writePasswordChangeError(req, res, "AUTHENTICATION_REQUIRED")
        return
      }
      mode = "resume"
      authIdentityId = resume.authIdentityId
      customerId = resume.customerId
      lineageId = resume.lineageId
    }

    const buckets = buildAuthenticatedPasswordChangeKeys({
      keyring: dependencies.keyring,
      authorizedLineageId: lineageId,
    })
    const limited = await consumeRateLimitBuckets(
      dependencies.rateLimitStore,
      buckets
    )
    if (!limited.allowed) {
      writePasswordChangeError(req, res, "RATE_LIMITED", {
        retryAfterSeconds: limited.blockedBy?.retryAfterSeconds,
      })
      return
    }

    const changeHandler = dependencies.changePassword ?? changePassword
    const result = await changeHandler(dependencies.database, {
      authIdentityId,
      customerId,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      idempotencyKey: idempotencyKey!,
      keyring: dependencies.keyring,
      provider: dependencies.provider,
      mode,
      now,
    })

    if (result.outcome === "completed") {
      res.status(204).end()
      return
    }

    writePasswordChangeError(req, res, "AUTH_RECOVERY_PENDING")
  } catch (error) {
    if (error instanceof AuthRateLimitUnavailableError) {
      writePasswordChangeError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE", {
        retryAfterSeconds: error.retryAfterSeconds,
      })
      return
    }
    if (error instanceof AuthPasswordChangeError) {
      if (error.code === "AUTH_PASSWORD_CHANGE_CURRENT_PASSWORD_INVALID") {
        writePasswordChangeError(req, res, "CURRENT_CREDENTIAL_INVALID")
        return
      }
      if (error.code === "AUTH_PASSWORD_CHANGE_INVALID_REQUEST") {
        writePasswordChangeError(req, res, "INVALID_REQUEST")
        return
      }
      if (error.code === "AUTH_PASSWORD_CHANGE_DENIED") {
        writePasswordChangeError(req, res, "AUTHENTICATION_REQUIRED")
        return
      }
    }
    writePasswordChangeError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE")
  }
}

export async function openCustomerAuthPasswordChangeRuntime(
  req: CustomerAuthPasswordChangeRequest
): Promise<PasswordChangeRuntime> {
  const knex = resolveKnex(req)
  const keyring = env.CUSTOMER_AUTH_CAPABILITY_KEYRING
  if (!env.REDIS_URL || !keyring) {
    throw new Error("CUSTOMER_AUTH_RUNTIME_UNAVAILABLE")
  }

  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
  })
  try {
    await redis.connect()
  } catch (error) {
    await redis.quit().catch(() => undefined)
    throw error
  }

  const authModule = req.scope?.resolve<AuthModuleLike>(Modules.AUTH)
  if (
    !authModule ||
    typeof authModule.updateProvider !== "function" ||
    typeof authModule.authenticate !== "function"
  ) {
    await redis.quit().catch(() => undefined)
    throw new Error("CUSTOMER_AUTH_RUNTIME_UNAVAILABLE")
  }

  const accessDatabase = createKnexCustomerAuthAccessDatabase(knex)
  const queryDatabase = createKnexPasswordChangeQueryDatabase(knex)
  const database = createKnexPasswordChangeDatabase(knex)

  return {
    dependencies: {
      accessDatabase,
      queryDatabase,
      database,
      keyring,
      jwtSecret: env.JWT_SECRET,
      rateLimitStore: new RedisAtomicRateLimitStore(redis),
      provider: createEmailpassPasswordChangeProvider(req, authModule),
      now: () => new Date(),
    },
    close: async () => {
      await redis.quit().catch(() => undefined)
    },
  }
}

export async function runCustomerAuthPasswordChangeRoute(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  let runtime: PasswordChangeRuntime | undefined
  try {
    runtime = await openCustomerAuthPasswordChangeRuntime(
      req as CustomerAuthPasswordChangeRequest
    )
    await handleCustomerAuthPasswordChange(
      req as CustomerAuthPasswordChangeRequest,
      res as CustomerAuthPasswordChangeResponse,
      runtime.dependencies
    )
  } catch {
    writePasswordChangeError(
      req as CustomerAuthPasswordChangeRequest,
      res as CustomerAuthPasswordChangeResponse,
      "AUTH_TEMPORARILY_UNAVAILABLE"
    )
  } finally {
    await runtime?.close()
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  await runCustomerAuthPasswordChangeRoute(req, res)
}
