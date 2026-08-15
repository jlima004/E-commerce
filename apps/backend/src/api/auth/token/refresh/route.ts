import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import Redis from "ioredis"
import { env } from "../../../../config/env"
import {
  serializeAuthSessionEnvelope,
} from "../../../auth-surface/contracts"
import { toAuthErrorResponse } from "../../../auth-surface/errors"
import {
  type AuthSessionDatabase,
  type AuthSessionEnvelope,
  AuthSessionError,
  hashAuthRefreshToken,
  rotateAuthRefresh,
} from "../../../../modules/customer-auth/session"
import {
  type AtomicRateLimitStore,
  AuthRateLimitUnavailableError,
  RedisAtomicRateLimitStore,
  buildPostLookupRateLimitKey,
  buildPreLookupRateLimitKeys,
  consumeRateLimitBuckets,
} from "../../../../modules/customer-auth/security/rate-limit"
import type { CapabilityKeyring } from "../../../../modules/customer-auth/security/capabilities"
import { applyAuthTimingEnvelope } from "../../../../modules/customer-auth/security/timing"

type RawResult = {
  rows?: Array<Record<string, unknown>>
}

type KnexLike = {
  raw(sql: string, bindings?: unknown[]): Promise<RawResult>
  transaction<T>(callback: (transaction: KnexLike) => Promise<T>): Promise<T>
}

type RefreshCustomer = {
  id: string
  email: string
  firstName: string
  lastName: string
  verificationState: "pending" | "verified"
}

export type CustomerAuthRefreshDependencies = {
  database: AuthSessionDatabase
  keyring: CapabilityKeyring
  jwtSecret: string
  rateLimitStore: AtomicRateLimitStore
  now?: () => Date
  timing?: (startedAtMs: number) => Promise<number>
  resolveCustomer: (
    envelope: AuthSessionEnvelope
  ) => Promise<RefreshCustomer>
}

type RefreshRequest = MedusaRequest & {
  correlationId?: string
}

function singleHeader(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function hasExactlyEmptyBody(req: MedusaRequest): boolean {
  const contentLength = req.headers["content-length"]
  const transferEncoding = req.headers["transfer-encoding"]
  const body = req.body as unknown
  const parsedBodyEmpty =
    body === undefined ||
    body === null ||
    (typeof body === "object" &&
      !Array.isArray(body) &&
      Object.keys(body as Record<string, unknown>).length === 0)

  return (
    transferEncoding === undefined &&
    (contentLength === undefined || contentLength === "0") &&
    parsedBodyEmpty
  )
}

function createKnexSessionDatabase(knex: KnexLike): AuthSessionDatabase {
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

async function resolveLineageId(
  database: AuthSessionDatabase,
  refreshToken: string
): Promise<string | null> {
  let tokenHash: string
  try {
    tokenHash = hashAuthRefreshToken(refreshToken)
  } catch {
    return null
  }

  return database.transaction(async (transaction) => {
    const result = await transaction.raw(
      `select lineage_id
         from auth_refresh_credential
        where token_hash = ?
          and deleted_at is null`,
      [tokenHash]
    )
    const rows = result.rows ?? []
    if (
      rows.length !== 1 ||
      typeof rows[0]?.lineage_id !== "string" ||
      rows[0].lineage_id.length === 0
    ) {
      return null
    }
    return rows[0].lineage_id
  })
}

function statusForSessionError(error: AuthSessionError): {
  statusCode: 400 | 401 | 503
  code:
    | "INVALID_REQUEST"
    | "AUTHENTICATION_REQUIRED"
    | "AUTH_TEMPORARILY_UNAVAILABLE"
} {
  if (error.code === "AUTH_SESSION_INVALID_REQUEST") {
    return { statusCode: 400, code: "INVALID_REQUEST" }
  }
  if (
    error.code === "AUTH_SESSION_AUTHENTICATION_REQUIRED" ||
    error.code === "AUTH_SESSION_DEADLINE_REACHED" ||
    error.code === "AUTH_SESSION_RECOVERY_REJECTED"
  ) {
    return { statusCode: 401, code: "AUTHENTICATION_REQUIRED" }
  }
  return { statusCode: 503, code: "AUTH_TEMPORARILY_UNAVAILABLE" }
}

function writeError(
  req: RefreshRequest,
  res: MedusaResponse,
  code:
    | "INVALID_REQUEST"
    | "AUTHENTICATION_REQUIRED"
    | "RATE_LIMITED"
    | "AUTH_TEMPORARILY_UNAVAILABLE",
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

export async function handleCustomerAuthRefresh(
  req: RefreshRequest,
  res: MedusaResponse,
  dependencies: CustomerAuthRefreshDependencies
): Promise<void> {
  const startedAtMs = Date.now()
  const timing =
    dependencies.timing ??
    ((started) => applyAuthTimingEnvelope({ startedAtMs: started }))
  const finish = () => timing(startedAtMs)
  const refreshToken = singleHeader(
    req.headers["x-indicio-refresh-token"]
  )
  const idempotencyKey = singleHeader(req.headers["idempotency-key"])

  if (!refreshToken || !idempotencyKey || !hasExactlyEmptyBody(req)) {
    await finish()
    writeError(req, res, "INVALID_REQUEST")
    return
  }

  const ip = typeof req.ip === "string" ? req.ip : ""
  try {
    const preBuckets = buildPreLookupRateLimitKeys({
      operation: "refresh",
      keyring: dependencies.keyring,
      ip,
      presentedToken: refreshToken,
    })
    const pre = await consumeRateLimitBuckets(
      dependencies.rateLimitStore,
      preBuckets
    )
    if (!pre.allowed) {
      await finish()
      writeError(
        req,
        res,
        "RATE_LIMITED",
        pre.blockedBy?.retryAfterSeconds
      )
      return
    }

    const lineageId = await resolveLineageId(
      dependencies.database,
      refreshToken
    )
    const postBucket = buildPostLookupRateLimitKey({
      operation: "refresh",
      keyring: dependencies.keyring,
      ip,
      presentedToken: refreshToken,
      resolved: lineageId
        ? { kind: "lineage", opaqueId: lineageId }
        : null,
    })
    const post = await consumeRateLimitBuckets(
      dependencies.rateLimitStore,
      [postBucket]
    )
    if (!post.allowed) {
      await finish()
      writeError(
        req,
        res,
        "RATE_LIMITED",
        post.blockedBy?.retryAfterSeconds
      )
      return
    }

    const envelope = await rotateAuthRefresh(dependencies.database, {
      refreshToken,
      idempotencyKey,
      keyring: dependencies.keyring,
      jwtSecret: dependencies.jwtSecret,
      now: dependencies.now?.(),
    })
    const customer = await dependencies.resolveCustomer(envelope)
    const body = serializeAuthSessionEnvelope(
      {
        accessToken: envelope.accessToken,
        accessExpiresAt: envelope.accessExpiresAt.toISOString(),
        refreshToken: envelope.refreshToken,
        refreshExpiresAt: envelope.refreshExpiresAt.toISOString(),
        originalAuthenticatedAt:
          envelope.originalAuthenticatedAt.toISOString(),
        absoluteExpiresAt: envelope.absoluteExpiresAt.toISOString(),
        customer,
        verificationState: customer.verificationState,
      },
      { bffAuthorized: true }
    )
    await finish()
    res.status(200).json(body)
  } catch (error) {
    await finish()
    if (error instanceof AuthRateLimitUnavailableError) {
      writeError(
        req,
        res,
        "AUTH_TEMPORARILY_UNAVAILABLE",
        error.retryAfterSeconds
      )
      return
    }
    if (error instanceof AuthSessionError) {
      const classification = statusForSessionError(error)
      writeError(req, res, classification.code)
      return
    }
    writeError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE")
  }
}

function resolveKnex(req: MedusaRequest): KnexLike {
  const knex = req.scope.resolve(
    ContainerRegistrationKeys.PG_CONNECTION
  ) as KnexLike
  if (
    !knex ||
    typeof knex.raw !== "function" ||
    typeof knex.transaction !== "function"
  ) {
    throw new Error("CUSTOMER_AUTH_POSTGRES_UNAVAILABLE")
  }
  return knex
}

async function resolveCustomer(
  req: MedusaRequest,
  knex: KnexLike,
  envelope: AuthSessionEnvelope
): Promise<RefreshCustomer> {
  const customerService = req.scope.resolve(Modules.CUSTOMER) as unknown as {
    retrieveCustomer(id: string): Promise<Record<string, unknown>>
  }
  const [customer, credential] = await Promise.all([
    customerService.retrieveCustomer(envelope.customerId),
    knex.raw(
      `select email_verified_at
         from auth_credential_state
        where auth_identity_id = ?
          and customer_id = ?
          and deleted_at is null`,
      [envelope.authIdentityId, envelope.customerId]
    ),
  ])
  if ((credential.rows ?? []).length !== 1) {
    throw new Error("CUSTOMER_AUTH_CREDENTIAL_STATE_INCONSISTENT")
  }
  return {
    id: envelope.customerId,
    email: String(customer.email ?? ""),
    firstName: String(customer.first_name ?? customer.firstName ?? ""),
    lastName: String(customer.last_name ?? customer.lastName ?? ""),
    verificationState: credential.rows?.[0]?.email_verified_at
      ? "verified"
      : "pending",
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  let redis: Redis | undefined
  try {
    const knex = resolveKnex(req)
    const keyring = env.CUSTOMER_AUTH_CAPABILITY_KEYRING
    if (!env.REDIS_URL || !keyring) {
      throw new Error("CUSTOMER_AUTH_RUNTIME_UNAVAILABLE")
    }
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
    })
    await redis.connect()
    await handleCustomerAuthRefresh(req, res, {
      database: createKnexSessionDatabase(knex),
      keyring,
      jwtSecret: env.JWT_SECRET,
      rateLimitStore: new RedisAtomicRateLimitStore(redis),
      resolveCustomer: (envelope) =>
        resolveCustomer(req, knex, envelope),
    })
  } catch {
    writeError(
      req as RefreshRequest,
      res,
      "AUTH_TEMPORARILY_UNAVAILABLE",
      60
    )
  } finally {
    await redis?.quit().catch(() => undefined)
  }
}
