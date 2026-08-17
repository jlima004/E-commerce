import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Redis from "ioredis"
import { env } from "../../../../../config/env"
import { EmailRequestSchema } from "../../../../auth-surface/validators"
import { toAuthErrorResponse } from "../../../../auth-surface/errors"
import { REQUEST_ACCEPTED_RESPONSE } from "../../../../auth-surface/contracts"
import {
  requestPasswordReset,
  type AuthResetDatabase,
  type AuthResetRequestResult,
} from "../../../../../modules/customer-auth/reset"
import type { CapabilityKeyring } from "../../../../../modules/customer-auth/security/capabilities"
import { normalizeCustomerAuthEmail } from "../../../../../modules/customer-auth/security/email-normalization"
import {
  type AtomicRateLimitStore,
  AuthRateLimitUnavailableError,
  RedisAtomicRateLimitStore,
  buildPreLookupRateLimitKeys,
  consumeRateLimitBuckets,
} from "../../../../../modules/customer-auth/security/rate-limit"
import { applyAuthTimingEnvelope } from "../../../../../modules/customer-auth/security/timing"
import {
  fetchAuthoritativeRawEmailsForIdentity,
  type QueryGraphLike,
} from "../../../../../modules/customer-auth/notification-recipient"

type AuthHeaders = Record<string, string | string[] | undefined>

export type CustomerAuthResetRequest = {
  body?: unknown
  headers: AuthHeaders
  ip?: string
  correlationId?: string
  scope?: {
    resolve: <T = unknown>(key: unknown) => T
  }
}

export type CustomerAuthResetResponse = {
  headersSent?: boolean
  status: (statusCode: number) => CustomerAuthResetResponse
  setHeader: (
    name: string,
    value: string
  ) => CustomerAuthResetResponse | void
  json: (body: unknown) => CustomerAuthResetResponse | void
}

export type PublicResetIdentity = {
  authIdentityId: string
  recipientIdentityId?: string
  normalizedEmail: string
}

export type CustomerAuthResetRequestDependencies = {
  database: AuthResetDatabase
  keyring: CapabilityKeyring
  rateLimitStore: AtomicRateLimitStore
  now?: () => Date
  timing?: (startedAtMs: number) => Promise<number>
  resolveIdentityByEmail: (
    normalizedEmail: string
  ) => Promise<PublicResetIdentity | null>
  requestPasswordReset?: (
    database: AuthResetDatabase,
    input: Parameters<typeof requestPasswordReset>[1]
  ) => Promise<AuthResetRequestResult>
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

type ResetRequestRuntime = {
  dependencies: CustomerAuthResetRequestDependencies
  close: () => Promise<void>
}

type AuthTiming = (startedAtMs: number) => Promise<number>

type CustomerAuthResetRequestRuntimeOpener = (
  req: CustomerAuthResetRequest,
  requiresRateLimiter: boolean
) => Promise<ResetRequestRuntime>

type CustomerAuthResetRequestRouteOptions = {
  openRuntime?: CustomerAuthResetRequestRuntimeOpener
  timing?: AuthTiming
  handleRequest?: typeof handleCustomerAuthResetRequest
}

function writeAccepted(res: CustomerAuthResetResponse): void {
  res.status(202).json(REQUEST_ACCEPTED_RESPONSE)
}

function writeAuthError(
  req: CustomerAuthResetRequest,
  res: CustomerAuthResetResponse,
  code: "INVALID_REQUEST" | "AUTH_TEMPORARILY_UNAVAILABLE",
  retryAfterSeconds?: number
): void {
  const normalized = toAuthErrorResponse(
    { code },
    { correlationId: req.correlationId }
  )
  if (retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(retryAfterSeconds))
  }
  res.status(normalized.statusCode).json(normalized.body)
}

function getRequestBody(req: CustomerAuthResetRequest): unknown {
  return req.body === undefined ? {} : req.body
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

function resolveKnex(req: CustomerAuthResetRequest): KnexLike {
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

function resolveQuery(req: CustomerAuthResetRequest): QueryGraphLike | null {
  try {
    const query = req.scope?.resolve<QueryGraphLike>(
      ContainerRegistrationKeys.QUERY
    )
    return query && typeof query.graph === "function" ? query : null
  } catch {
    return null
  }
}

function normalizeSingleEmail(rawEmails: string[]): string | null {
  const unique = [...new Set(rawEmails.filter((value) => value.length > 0))]
  if (unique.length !== 1) {
    return null
  }
  try {
    return normalizeCustomerAuthEmail(unique[0]!)
  } catch {
    return null
  }
}

export async function resolveResetIdentityByEmail(
  req: CustomerAuthResetRequest,
  normalizedEmail: string
): Promise<PublicResetIdentity | null> {
  const query = resolveQuery(req)
  if (!query) {
    return null
  }

  try {
    const result = await query.graph({
      entity: "auth_identity",
      fields: [
        "id",
        "app_metadata",
        "user_metadata",
        "provider_identities.entity_id",
        "provider_identities.provider",
        "customer.email",
      ],
      filters: {
        customer: {
          email: normalizedEmail,
        },
      },
    })
    const records = Array.isArray(result.data) ? result.data : []
    if (records.length !== 1) {
      return null
    }

    const identityId = records[0]?.id
    if (typeof identityId !== "string" || identityId.length === 0) {
      return null
    }

    const authoritativeEmail = normalizeSingleEmail(
      await fetchAuthoritativeRawEmailsForIdentity(identityId, { query })
    )
    if (authoritativeEmail !== normalizedEmail) {
      return null
    }

    return {
      authIdentityId: identityId,
      recipientIdentityId: identityId,
      normalizedEmail,
    }
  } catch {
    return null
  }
}

export async function handleCustomerAuthResetRequest(
  req: CustomerAuthResetRequest,
  res: CustomerAuthResetResponse,
  dependencies: CustomerAuthResetRequestDependencies
): Promise<void> {
  const startedAtMs = Date.now()
  const rawBody = getRequestBody(req)
  const body =
    typeof rawBody === "object" && rawBody !== null
      ? {
          ...(rawBody as Record<string, unknown>),
          email:
            typeof (rawBody as Record<string, unknown>).email === "string"
              ? ((rawBody as Record<string, unknown>).email as string).trim()
              : (rawBody as Record<string, unknown>).email,
        }
      : rawBody
  const parsed = EmailRequestSchema.safeParse(body)
  if (!parsed.success) {
    await finishTiming(dependencies.timing, startedAtMs)
    writeAuthError(req, res, "INVALID_REQUEST")
    return
  }

  let normalizedEmail: string
  try {
    normalizedEmail = normalizeCustomerAuthEmail(parsed.data.email)
  } catch {
    await finishTiming(dependencies.timing, startedAtMs)
    writeAuthError(req, res, "INVALID_REQUEST")
    return
  }

  try {
    const ip = typeof req.ip === "string" ? req.ip : ""
    const preBuckets = buildPreLookupRateLimitKeys({
      operation: "reset-request",
      keyring: dependencies.keyring,
      ip,
      email: normalizedEmail,
    })
    const pre = await consumeRateLimitBuckets(
      dependencies.rateLimitStore,
      preBuckets
    )
    if (!pre.allowed) {
      await finishTiming(dependencies.timing, startedAtMs)
      writeAccepted(res)
      return
    }

    const identity = await dependencies.resolveIdentityByEmail(normalizedEmail)
    if (identity) {
      const requestHandler =
        dependencies.requestPasswordReset ?? requestPasswordReset
      await requestHandler(dependencies.database, {
        authIdentityId: identity.authIdentityId,
        recipientIdentityId:
          identity.recipientIdentityId ?? identity.authIdentityId,
        normalizedEmail,
        keyring: dependencies.keyring,
        now: dependencies.now?.(),
      })
    }

    await finishTiming(dependencies.timing, startedAtMs)
    writeAccepted(res)
  } catch (error) {
    await finishTiming(dependencies.timing, startedAtMs).catch(() => undefined)
    if (error instanceof AuthRateLimitUnavailableError) {
      writeAccepted(res)
      return
    }
    writeAccepted(res)
  }
}

export async function openCustomerAuthResetRequestRuntime(
  req: CustomerAuthResetRequest,
  requiresRateLimiter: boolean
): Promise<ResetRequestRuntime> {
  const knex = resolveKnex(req)
  const database = createKnexAuthResetDatabase(knex)
  const keyring = env.CUSTOMER_AUTH_CAPABILITY_KEYRING
  let redis: Redis | undefined

  if (requiresRateLimiter) {
    if (!env.REDIS_URL || !keyring) {
      throw new Error("CUSTOMER_AUTH_RUNTIME_UNAVAILABLE")
    }
    redis = new Redis(env.REDIS_URL, {
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
  }

  if (!keyring) {
    throw new Error("CUSTOMER_AUTH_RUNTIME_UNAVAILABLE")
  }

  return {
    dependencies: {
      database,
      keyring,
      rateLimitStore: redis
        ? new RedisAtomicRateLimitStore(redis)
        : (undefined as never),
      now: () => new Date(),
      resolveIdentityByEmail: (normalizedEmail) =>
        resolveResetIdentityByEmail(req, normalizedEmail),
      requestPasswordReset,
    },
    close: async () => {
      await redis?.quit().catch(() => undefined)
    },
  }
}

export async function runCustomerAuthResetRequestRoute(
  req: MedusaRequest,
  res: MedusaResponse,
  options: CustomerAuthResetRequestRouteOptions = {}
): Promise<void> {
  const startedAtMs = Date.now()
  let runtime: ResetRequestRuntime | undefined
  let runtimeAcquired = false
  const openRuntime =
    options.openRuntime ?? openCustomerAuthResetRequestRuntime
  const handleRequest =
    options.handleRequest ?? handleCustomerAuthResetRequest
  try {
    runtime = await openRuntime(
      req as CustomerAuthResetRequest,
      true
    )
    runtimeAcquired = true
    await handleRequest(
      req as CustomerAuthResetRequest,
      res as CustomerAuthResetResponse,
      runtime.dependencies
    )
  } catch {
    if (!runtimeAcquired) {
      await finishTiming(options.timing, startedAtMs).catch(() => undefined)
    }
    writeAccepted(res as CustomerAuthResetResponse)
  } finally {
    await runtime?.close()
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  await runCustomerAuthResetRequestRoute(req, res)
}
