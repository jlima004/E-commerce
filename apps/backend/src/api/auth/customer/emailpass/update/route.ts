import { z } from "zod"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import Redis from "ioredis"
import { env } from "../../../../../config/env"
import { ResetConfirmRequestSchema } from "../../../../auth-surface/validators"
import { toAuthErrorResponse } from "../../../../auth-surface/errors"
import {
  AuthResetError,
  confirmPasswordReset,
  resolveResetIntentId,
  type AuthResetConfirmResult,
  type AuthResetDatabase,
  type AuthResetPasswordProvider,
} from "../../../../../modules/customer-auth/reset"
import type { CapabilityKeyring } from "../../../../../modules/customer-auth/security/capabilities"
import { normalizeCustomerAuthEmail } from "../../../../../modules/customer-auth/security/email-normalization"
import {
  type AtomicRateLimitStore,
  AuthRateLimitUnavailableError,
  RedisAtomicRateLimitStore,
  buildPostLookupRateLimitKey,
  buildPreLookupRateLimitKeys,
  consumeRateLimitBuckets,
} from "../../../../../modules/customer-auth/security/rate-limit"
import {
  applyAuthTimingEnvelope,
  runAuthDummyWork,
} from "../../../../../modules/customer-auth/security/timing"
import {
  fetchAuthoritativeRawEmailsForIdentity,
  type QueryGraphLike,
} from "../../../../../modules/customer-auth/notification-recipient"

type AuthHeaders = Record<string, string | string[] | undefined>

export type CustomerAuthResetConfirmRequest = {
  body?: unknown
  headers: AuthHeaders
  ip?: string
  correlationId?: string
  scope?: {
    resolve: <T = unknown>(key: unknown) => T
  }
}

export type CustomerAuthResetConfirmResponse = {
  headersSent?: boolean
  status: (statusCode: number) => CustomerAuthResetConfirmResponse
  setHeader: (
    name: string,
    value: string
  ) => CustomerAuthResetConfirmResponse | void
  json: (body: unknown) => CustomerAuthResetConfirmResponse | void
}

export type CustomerAuthResetConfirmDependencies = {
  database: AuthResetDatabase
  keyring: CapabilityKeyring
  rateLimitStore: AtomicRateLimitStore
  provider: AuthResetPasswordProvider
  now?: () => Date
  timing?: (startedAtMs: number) => Promise<number>
  dummyWork?: (
    keyring: CapabilityKeyring,
    operation: "reset-confirm",
    preDigest: string
  ) => string
  resolveResetIntentId?: (
    database: AuthResetDatabase,
    capability: string
  ) => Promise<string | null>
  confirmPasswordReset?: (
    database: AuthResetDatabase,
    input: Parameters<typeof confirmPasswordReset>[1]
  ) => Promise<AuthResetConfirmResult>
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

type ResetConfirmRuntime = {
  dependencies: CustomerAuthResetConfirmDependencies
  close: () => Promise<void>
}

type AuthTiming = (startedAtMs: number) => Promise<number>

const PUBLIC_CONFIRM_RESPONSE = Object.freeze({
  code: "PASSWORD_RESET_COMPLETED",
} as const)

const PUBLIC_CONFIRM_CAPABILITY_SHAPE = z
  .string()
  .min(43)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/)

function getRequestBody(req: CustomerAuthResetConfirmRequest): unknown {
  return req.body === undefined ? {} : req.body
}

function singleHeader(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function isPublicCapabilityShape(value: unknown): value is string {
  return PUBLIC_CONFIRM_CAPABILITY_SHAPE.safeParse(value).success
}

function defaultAuthTiming(startedAtMs: number): Promise<number> {
  return applyAuthTimingEnvelope({ startedAtMs })
}

async function finishTiming(
  timing: AuthTiming | undefined,
  startedAtMs: number
): Promise<void> {
  await (timing ?? defaultAuthTiming)(startedAtMs)
}

function writeResetConfirmError(
  req: CustomerAuthResetConfirmRequest,
  res: CustomerAuthResetConfirmResponse,
  code:
    | "RESET_INVALID_OR_EXPIRED"
    | "RATE_LIMITED"
    | "AUTH_TEMPORARILY_UNAVAILABLE"
    | "AUTH_RECOVERY_PENDING",
  options: {
    stage?: "pre_lookup" | "correlated_recovery"
    retryAfterSeconds?: number
  } = {}
): void {
  const classified =
    code === "AUTH_TEMPORARILY_UNAVAILABLE" || code === "AUTH_RECOVERY_PENDING"
  const normalized = toAuthErrorResponse(
    classified ? { code, stage: options.stage } : { code },
    {
      correlationId: req.correlationId,
      resetConfirm: classified,
    }
  )
  const retryAfter = options.retryAfterSeconds ?? normalized.retryAfterSeconds
  if (retryAfter !== undefined) {
    res.setHeader("Retry-After", String(retryAfter))
  }
  res.status(normalized.statusCode).json(normalized.body)
}

function createKnexAuthResetDatabase(knex: KnexLike): AuthResetDatabase {
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

function resolveKnex(req: CustomerAuthResetConfirmRequest): KnexLike {
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
  req: CustomerAuthResetConfirmRequest
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
  req: CustomerAuthResetConfirmRequest,
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

export function createEmailpassResetProvider(
  req: CustomerAuthResetConfirmRequest,
  authModule: AuthModuleLike
): AuthResetPasswordProvider {
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

export async function handleCustomerAuthResetConfirm(
  req: CustomerAuthResetConfirmRequest,
  res: CustomerAuthResetConfirmResponse,
  dependencies: CustomerAuthResetConfirmDependencies
): Promise<void> {
  const startedAtMs = Date.now()
  const rawBody = getRequestBody(req)
  const parsed = ResetConfirmRequestSchema.safeParse(rawBody)
  const presentedToken =
    typeof rawBody === "object" &&
    rawBody !== null &&
    typeof (rawBody as Record<string, unknown>).token === "string"
      ? ((rawBody as Record<string, unknown>).token as string)
      : undefined
  const idempotencyKey = singleHeader(req.headers["idempotency-key"])

  try {
    const ip = typeof req.ip === "string" ? req.ip : ""
    const preBuckets = buildPreLookupRateLimitKeys({
      operation: "reset-confirm",
      keyring: dependencies.keyring,
      ip,
      presentedToken,
    })
    const pre = await consumeRateLimitBuckets(
      dependencies.rateLimitStore,
      preBuckets
    )
    if (!pre.allowed) {
      writeResetConfirmError(
        req,
        res,
        "RATE_LIMITED",
        { retryAfterSeconds: pre.blockedBy?.retryAfterSeconds }
      )
      return
    }

    const semanticallyValid = isPublicCapabilityShape(presentedToken)
    const intentId =
      semanticallyValid
        ? await (
            dependencies.resolveResetIntentId ?? resolveResetIntentId
          )(dependencies.database, presentedToken)
        : null
    const postBucket = buildPostLookupRateLimitKey({
      operation: "reset-confirm",
      keyring: dependencies.keyring,
      ip,
      presentedToken,
      resolved: intentId ? { kind: "intent", opaqueId: intentId } : null,
    })
    const post = await consumeRateLimitBuckets(dependencies.rateLimitStore, [
      postBucket,
    ])
    const dummyWork = dependencies.dummyWork ?? runAuthDummyWork
    if (!post.allowed) {
      dummyWork(
        dependencies.keyring,
        "reset-confirm",
        pre.buckets[0]?.digest ?? ""
      )
      await finishTiming(dependencies.timing, startedAtMs)
      writeResetConfirmError(
        req,
        res,
        "RATE_LIMITED",
        { retryAfterSeconds: post.blockedBy?.retryAfterSeconds }
      )
      return
    }

    let result: AuthResetConfirmResult | null = null
    let resetError: unknown = null
    if (semanticallyValid && intentId && parsed.success && idempotencyKey) {
      try {
        const confirmHandler =
          dependencies.confirmPasswordReset ?? confirmPasswordReset
        result = await confirmHandler(dependencies.database, {
          capability: parsed.data.token,
          newPassword: parsed.data.newPassword,
          idempotencyKey,
          keyring: dependencies.keyring,
          provider: dependencies.provider,
          now: dependencies.now?.(),
        })
      } catch (error) {
        resetError = error
      }
    }

    dummyWork(
      dependencies.keyring,
      "reset-confirm",
      pre.buckets[0]?.digest ?? ""
    )
    await finishTiming(dependencies.timing, startedAtMs)

    if (result?.outcome === "completed") {
      res.status(200).json(PUBLIC_CONFIRM_RESPONSE)
      return
    }

    if (result?.outcome === "recovery_pending") {
      writeResetConfirmError(req, res, "AUTH_RECOVERY_PENDING", {
        stage: "correlated_recovery",
      })
      return
    }

    if (resetError instanceof AuthResetError) {
      writeResetConfirmError(req, res, "RESET_INVALID_OR_EXPIRED")
      return
    }

    if (resetError) {
      writeAuthErrorUnavailable(req, res)
      return
    }

    writeResetConfirmError(req, res, "RESET_INVALID_OR_EXPIRED")
  } catch (error) {
    if (error instanceof AuthRateLimitUnavailableError) {
      writeResetConfirmError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE", {
        stage: "pre_lookup",
      })
      return
    }
    writeAuthErrorUnavailable(req, res)
  }
}

function writeAuthErrorUnavailable(
  req: CustomerAuthResetConfirmRequest,
  res: CustomerAuthResetConfirmResponse
): void {
  const normalized = toAuthErrorResponse(
    { code: "AUTH_TEMPORARILY_UNAVAILABLE" },
    { correlationId: req.correlationId }
  )
  res.setHeader("Retry-After", "60")
  res.status(normalized.statusCode).json(normalized.body)
}

export async function openCustomerAuthResetConfirmRuntime(
  req: CustomerAuthResetConfirmRequest
): Promise<ResetConfirmRuntime> {
  const knex = resolveKnex(req)
  const database = createKnexAuthResetDatabase(knex)
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

  return {
    dependencies: {
      database,
      keyring,
      rateLimitStore: new RedisAtomicRateLimitStore(redis),
      provider: createEmailpassResetProvider(req, authModule),
      now: () => new Date(),
      resolveResetIntentId,
      confirmPasswordReset,
    },
    close: async () => {
      await redis.quit().catch(() => undefined)
    },
  }
}

export async function runCustomerAuthResetConfirmRoute(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  let runtime: ResetConfirmRuntime | undefined
  try {
    runtime = await openCustomerAuthResetConfirmRuntime(
      req as CustomerAuthResetConfirmRequest
    )
    await handleCustomerAuthResetConfirm(
      req as CustomerAuthResetConfirmRequest,
      res as CustomerAuthResetConfirmResponse,
      runtime.dependencies
    )
  } catch {
    const request = req as CustomerAuthResetConfirmRequest
    writeResetConfirmError(
      request,
      res as CustomerAuthResetConfirmResponse,
      "AUTH_TEMPORARILY_UNAVAILABLE",
      { stage: "pre_lookup" }
    )
  } finally {
    await runtime?.close()
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  await runCustomerAuthResetConfirmRoute(req, res)
}
