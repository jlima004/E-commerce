import { createHash, createHmac } from "node:crypto"
import type {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import Redis from "ioredis"
import { z } from "zod"
import { env } from "../../../../../config/env"
import {
  EmptyRequestSchema,
  EmailRequestSchema,
  VerificationTokenRequestSchema,
} from "../../../../auth-surface/validators"
import { toAuthErrorResponse } from "../../../../auth-surface/errors"
import type { CustomerAuthAccessContext } from "../../../../../modules/customer-auth/access-guard"
import {
  autoRequestVerification,
  confirmVerification,
  getVerificationStatus,
  resendVerification,
  AuthVerificationError,
  type AuthVerificationConfirmResult,
  type AuthVerificationDatabase,
  type AuthVerificationRequestResult,
  type AuthVerificationStatusResult,
} from "../../../../../modules/customer-auth/verification"
import {
  hashCustomerAuthCapability,
  type CapabilityKeyring,
} from "../../../../../modules/customer-auth/security/capabilities"
import {
  AUTH_RATE_LIMIT_POLICIES,
  AuthRateLimitUnavailableError,
  buildAuthenticatedVerificationRequestKeys,
  buildPostLookupRateLimitKey,
  buildPreLookupRateLimitKeys,
  consumeRateLimitBuckets,
  RedisAtomicRateLimitStore,
  normalizeAuthRateLimitNetworkPrefix,
  type AtomicRateLimitStore,
  type AuthRateLimitKeyring,
  type DerivedRateLimitBucket,
} from "../../../../../modules/customer-auth/security/rate-limit"
import {
  applyAuthTimingEnvelope,
  runAuthDummyWork,
} from "../../../../../modules/customer-auth/security/timing"
import {
  fetchAuthoritativeRawEmailsForIdentity,
  type QueryGraphLike,
} from "../../../../../modules/customer-auth/notification-recipient"
import { normalizeCustomerAuthEmail } from "../../../../../modules/customer-auth/security/email-normalization"

type VerificationHttpHeaders = Record<string, string | string[] | undefined>

export type CustomerAuthVerificationRequest = {
  body?: unknown
  headers: VerificationHttpHeaders
  ip?: string
  correlationId?: string
  customerAuth?: (Partial<CustomerAuthAccessContext> & {
    authorized?: boolean
  })
  scope?: {
    resolve: <T = unknown>(key: unknown) => T
  }
}

export type CustomerAuthVerificationResponse = {
  headersSent?: boolean
  status: (statusCode: number) => CustomerAuthVerificationResponse
  setHeader: (
    name: string,
    value: string
  ) => CustomerAuthVerificationResponse | void
  json: (body: unknown) => CustomerAuthVerificationResponse | void
}

export type PublicVerificationIdentity = {
  authIdentityId: string
  recipientIdentityId?: string
  normalizedEmail: string
}

export type CustomerAuthVerificationDependencies = {
  database: AuthVerificationDatabase
  keyring?: CapabilityKeyring
  rateLimitStore?: AtomicRateLimitStore
  now?: () => Date
  timing?: (startedAtMs: number) => Promise<number>
  resolveEmailByIdentityId: (
    authIdentityId: string
  ) => Promise<string | null>
  resolveIdentityByEmail: (
    normalizedEmail: string
  ) => Promise<PublicVerificationIdentity | null>
  requestVerification?: (
    database: AuthVerificationDatabase,
    input: Parameters<typeof autoRequestVerification>[1]
  ) => Promise<AuthVerificationRequestResult>
  resendVerification?: (
    database: AuthVerificationDatabase,
    input: Parameters<typeof resendVerification>[1]
  ) => Promise<AuthVerificationRequestResult>
  resolveVerificationIntentId?: (
    database: AuthVerificationDatabase,
    capability: string
  ) => Promise<string | null>
  confirmVerification?: (
    database: AuthVerificationDatabase,
    input: Parameters<typeof confirmVerification>[1]
  ) => Promise<AuthVerificationConfirmResult>
  getVerificationStatus?: (
    database: AuthVerificationDatabase,
    authIdentityId: string
  ) => Promise<AuthVerificationStatusResult>
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

type VerificationRuntime = {
  dependencies: CustomerAuthVerificationDependencies
  close: () => Promise<void>
}

type AuthTiming = (startedAtMs: number) => Promise<number>

type CustomerAuthVerificationRuntimeOpener = (
  req: CustomerAuthVerificationRequest,
  requiresRateLimiter: boolean
) => Promise<VerificationRuntime>

type CustomerAuthVerificationResendRouteOptions = {
  openRuntime?: CustomerAuthVerificationRuntimeOpener
  timing?: AuthTiming
  handleResend?: typeof handleCustomerAuthVerificationResend
}

const PUBLIC_ACCEPTED_RESPONSE = Object.freeze({
  code: "REQUEST_ACCEPTED",
} as const)

const AUTHENTICATED_REQUEST_RESPONSE = Object.freeze({
  code: "REQUEST_ACCEPTED",
} as const)

const PUBLIC_CONFIRM_RESPONSE = Object.freeze({
  code: "EMAIL_VERIFIED",
  state: "verified",
} as const)

const PUBLIC_CONFIRM_CAPABILITY_SHAPE = z
  .string()
  .min(43)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/)

function getRequestBody(req: CustomerAuthVerificationRequest): unknown {
  return req.body === undefined ? {} : req.body
}

function hasExactlyEmptyBody(req: CustomerAuthVerificationRequest): boolean {
  const contentLength = req.headers["content-length"]
  const transferEncoding = req.headers["transfer-encoding"]
  const body = req.body
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

function writeAuthError(
  req: CustomerAuthVerificationRequest,
  res: CustomerAuthVerificationResponse,
  code:
    | "INVALID_REQUEST"
    | "AUTHENTICATION_REQUIRED"
    | "VERIFICATION_INVALID_OR_EXPIRED"
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

function writeAccepted(
  res: CustomerAuthVerificationResponse,
  body: typeof PUBLIC_ACCEPTED_RESPONSE = PUBLIC_ACCEPTED_RESPONSE
): void {
  res.status(202).json(body)
}

function requireRateLimitRuntime(
  dependencies: CustomerAuthVerificationDependencies
): {
  keyring: CapabilityKeyring
  store: AtomicRateLimitStore
} {
  if (!dependencies.keyring || !dependencies.rateLimitStore) {
    throw new AuthRateLimitUnavailableError()
  }
  return {
    keyring: dependencies.keyring,
    store: dependencies.rateLimitStore,
  }
}

function requireAuthenticatedContext(
  req: CustomerAuthVerificationRequest
): CustomerAuthAccessContext | null {
  const context = req.customerAuth
  if (
    !context ||
    context.authorized !== true ||
    typeof context.authIdentityId !== "string" ||
    context.authIdentityId.length === 0 ||
    typeof context.customerId !== "string" ||
    context.customerId.length === 0 ||
    typeof context.lineageId !== "string" ||
    context.lineageId.length === 0
  ) {
    return null
  }
  return context as CustomerAuthAccessContext
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

function resolveQuery(req: CustomerAuthVerificationRequest): QueryGraphLike | null {
  try {
    const query = req.scope?.resolve<QueryGraphLike>(
      ContainerRegistrationKeys.QUERY
    )
    return query && typeof query.graph === "function" ? query : null
  } catch {
    return null
  }
}

async function resolveEmailByIdentityId(
  req: CustomerAuthVerificationRequest,
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

async function resolveIdentityByEmail(
  req: CustomerAuthVerificationRequest,
  normalizedEmail: string
): Promise<PublicVerificationIdentity | null> {
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

function createKnexVerificationDatabase(
  knex: KnexLike
): AuthVerificationDatabase {
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

function resolveKnex(req: CustomerAuthVerificationRequest): KnexLike {
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

async function resolveVerificationIntentId(
  database: AuthVerificationDatabase,
  capability: string
): Promise<string | null> {
  const tokenHash = hashCustomerAuthCapability(capability)
  return database.transaction(async (transaction) => {
    const result = await transaction.raw(
      `select id
         from auth_verification_intent
        where token_hash = ?
          and deleted_at is null
        limit 1`,
      [tokenHash]
    )
    const rows = result.rows ?? []
    if (rows.length !== 1 || typeof rows[0]?.id !== "string") {
      return null
    }
    return rows[0].id
  })
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function buildPublicResendPostBucket(input: {
  keyring: AuthRateLimitKeyring
  ip: string
  normalizedEmail: string
  identityId: string | null
}): DerivedRateLimitBucket {
  const policy = AUTH_RATE_LIMIT_POLICIES["reset-resend"].pre.email
  const networkDigest = sha256(normalizeAuthRateLimitNetworkPrefix(input.ip))
  const material = input.identityId
    ? `identity-digest:${sha256(input.identityId)}`
    : [
        `dummy-network-digest:${networkDigest}`,
        `email-digest:${sha256(input.normalizedEmail)}`,
      ].join("|")
  const version = input.keyring.active.version
  const digest = createHmac("sha256", input.keyring.active.secret)
    .update(
      [
        "auth-rate",
        `key-version:${version}`,
        "operation:reset-resend",
        "purpose:post-identity",
        material,
      ].join("|"),
      "utf8"
    )
    .digest("hex")

  return {
    key: `auth-rate:v${version}:post-identity:${digest}`,
    digest,
    limit: policy[0],
    windowSeconds: policy[1],
  }
}

function defaultAuthTiming(startedAtMs: number): Promise<number> {
  return applyAuthTimingEnvelope({ startedAtMs })
}

async function finishAuthTiming(
  timing: AuthTiming | undefined,
  startedAtMs: number
): Promise<void> {
  await (timing ?? defaultAuthTiming)(startedAtMs)
}

async function finishTiming(
  dependencies: CustomerAuthVerificationDependencies,
  startedAtMs: number
): Promise<void> {
  await finishAuthTiming(dependencies.timing, startedAtMs)
}

function isPublicCapabilityShape(value: unknown): value is string {
  return PUBLIC_CONFIRM_CAPABILITY_SHAPE.safeParse(value).success
}

function authVerificationErrorCode(error: unknown):
  | "INVALID_REQUEST"
  | "VERIFICATION_INVALID_OR_EXPIRED"
  | null {
  if (!(error instanceof AuthVerificationError)) {
    return null
  }
  if (error.code === "AUTH_VERIFICATION_INVALID_REQUEST") {
    return "INVALID_REQUEST"
  }
  if (error.code === "AUTH_VERIFICATION_INVALID_OR_EXPIRED") {
    return "VERIFICATION_INVALID_OR_EXPIRED"
  }
  return null
}

export async function handleCustomerAuthVerificationRequest(
  req: CustomerAuthVerificationRequest,
  res: CustomerAuthVerificationResponse,
  dependencies: CustomerAuthVerificationDependencies
): Promise<void> {
  const context = requireAuthenticatedContext(req)
  if (!context) {
    writeAuthError(req, res, "AUTHENTICATION_REQUIRED")
    return
  }

  if (!hasExactlyEmptyBody(req) || !EmptyRequestSchema.safeParse(getRequestBody(req)).success) {
    writeAuthError(req, res, "INVALID_REQUEST")
    return
  }

  try {
    const { keyring, store } = requireRateLimitRuntime(dependencies)
    const ip = typeof req.ip === "string" ? req.ip : ""
    const buckets = buildAuthenticatedVerificationRequestKeys({
      keyring,
      ip,
      authorizedLineageId: context.lineageId,
    })
    const rateLimit = await consumeRateLimitBuckets(store, buckets)
    if (!rateLimit.allowed) {
      writeAuthError(
        req,
        res,
        "RATE_LIMITED",
        rateLimit.blockedBy?.retryAfterSeconds
      )
      return
    }

    const normalizedEmail = await dependencies.resolveEmailByIdentityId(
      context.authIdentityId
    )
    if (!normalizedEmail) {
      writeAuthError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE")
      return
    }

    const requestVerificationHandler =
      dependencies.requestVerification ?? autoRequestVerification
    await requestVerificationHandler(dependencies.database, {
      authIdentityId: context.authIdentityId,
      recipientIdentityId: context.authIdentityId,
      normalizedEmail,
      keyring,
      now: dependencies.now?.(),
    })
    res.status(202).json(AUTHENTICATED_REQUEST_RESPONSE)
  } catch (error) {
    if (error instanceof AuthRateLimitUnavailableError) {
      writeAuthError(
        req,
        res,
        "AUTH_TEMPORARILY_UNAVAILABLE",
        error.retryAfterSeconds
      )
      return
    }

    const code = authVerificationErrorCode(error)
    writeAuthError(req, res, code ?? "AUTH_TEMPORARILY_UNAVAILABLE")
  }
}

export async function handleCustomerAuthVerificationStatus(
  req: CustomerAuthVerificationRequest,
  res: CustomerAuthVerificationResponse,
  dependencies: CustomerAuthVerificationDependencies
): Promise<void> {
  const context = requireAuthenticatedContext(req)
  if (!context) {
    writeAuthError(req, res, "AUTHENTICATION_REQUIRED")
    return
  }

  try {
    const statusHandler = dependencies.getVerificationStatus ?? getVerificationStatus
    const result = await statusHandler(
      dependencies.database,
      context.authIdentityId
    )
    res.status(200).json({
      state: result.state === "verified" ? "verified" : "pending",
    })
  } catch {
    writeAuthError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE")
  }
}

export async function handleCustomerAuthVerificationResend(
  req: CustomerAuthVerificationRequest,
  res: CustomerAuthVerificationResponse,
  dependencies: CustomerAuthVerificationDependencies
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
    await finishTiming(dependencies, startedAtMs)
    writeAuthError(req, res, "INVALID_REQUEST")
    return
  }

  let normalizedEmail: string
  try {
    normalizedEmail = normalizeCustomerAuthEmail(parsed.data.email)
  } catch {
    await finishTiming(dependencies, startedAtMs)
    writeAuthError(req, res, "INVALID_REQUEST")
    return
  }

  try {
    const { keyring, store } = requireRateLimitRuntime(dependencies)
    const ip = typeof req.ip === "string" ? req.ip : ""
    const preBuckets = buildPreLookupRateLimitKeys({
      operation: "reset-resend",
      keyring,
      ip,
      email: normalizedEmail,
    })
    const pre = await consumeRateLimitBuckets(store, preBuckets)
    if (!pre.allowed) {
      await finishTiming(dependencies, startedAtMs)
      writeAccepted(res)
      return
    }

    const identity = await dependencies.resolveIdentityByEmail(normalizedEmail)
    const postBucket = buildPublicResendPostBucket({
      keyring,
      ip,
      normalizedEmail,
      identityId: identity?.authIdentityId ?? null,
    })
    const post = await consumeRateLimitBuckets(store, [postBucket])
    if (!post.allowed) {
      await finishTiming(dependencies, startedAtMs)
      writeAccepted(res)
      return
    }

    if (identity) {
      const resendHandler = dependencies.resendVerification ?? resendVerification
      await resendHandler(dependencies.database, {
        authIdentityId: identity.authIdentityId,
        recipientIdentityId:
          identity.recipientIdentityId ?? identity.authIdentityId,
        normalizedEmail,
        keyring,
        now: dependencies.now?.(),
      })
    }

    await finishTiming(dependencies, startedAtMs)
    writeAccepted(res)
  } catch {
    await finishTiming(dependencies, startedAtMs).catch(() => undefined)
    writeAccepted(res)
  }
}

export async function handleCustomerAuthVerificationConfirm(
  req: CustomerAuthVerificationRequest,
  res: CustomerAuthVerificationResponse,
  dependencies: CustomerAuthVerificationDependencies
): Promise<void> {
  const startedAtMs = Date.now()
  const rawBody = getRequestBody(req)
  const parsed = VerificationTokenRequestSchema.safeParse(rawBody)
  const presentedToken =
    typeof rawBody === "object" &&
    rawBody !== null &&
    typeof (rawBody as Record<string, unknown>).token === "string"
      ? ((rawBody as Record<string, unknown>).token as string)
      : undefined

  try {
    const { keyring, store } = requireRateLimitRuntime(dependencies)
    const ip = typeof req.ip === "string" ? req.ip : ""
    const preBuckets = buildPreLookupRateLimitKeys({
      operation: "verification-confirm",
      keyring,
      ip,
      presentedToken,
    })
    const pre = await consumeRateLimitBuckets(store, preBuckets)
    if (!pre.allowed) {
      writeAuthError(
        req,
        res,
        "RATE_LIMITED",
        pre.blockedBy?.retryAfterSeconds
      )
      return
    }

    const semanticallyValid = parsed.success && isPublicCapabilityShape(
      parsed.data.token
    )
    const intentId =
      semanticallyValid
        ? await (
            dependencies.resolveVerificationIntentId ??
            resolveVerificationIntentId
          )(dependencies.database, parsed.data.token)
        : null
    const postBucket = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring,
      ip,
      presentedToken,
      resolved: intentId
        ? { kind: "intent", opaqueId: intentId }
        : null,
    })
    const post = await consumeRateLimitBuckets(store, [postBucket])
    if (!post.allowed) {
      runAuthDummyWork(
        keyring,
        "verification-confirm",
        pre.buckets[0]?.digest ?? ""
      )
      await finishTiming(dependencies, startedAtMs)
      writeAuthError(
        req,
        res,
        "RATE_LIMITED",
        post.blockedBy?.retryAfterSeconds
      )
      return
    }

    let result: AuthVerificationConfirmResult | null = null
    let verificationError: unknown = null
    if (semanticallyValid && intentId) {
      try {
        const confirmHandler =
          dependencies.confirmVerification ?? confirmVerification
        result = await confirmHandler(dependencies.database, {
          capability: parsed.data.token,
          now: dependencies.now?.(),
        })
      } catch (error) {
        verificationError = error
      }
    }

    runAuthDummyWork(
      keyring,
      "verification-confirm",
      pre.buckets[0]?.digest ?? ""
    )
    await finishTiming(dependencies, startedAtMs)

    if (result?.success) {
      res.status(200).json(PUBLIC_CONFIRM_RESPONSE)
      return
    }

    if (verificationError && !(verificationError instanceof AuthVerificationError)) {
      writeAuthError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE")
      return
    }
    writeAuthError(req, res, "VERIFICATION_INVALID_OR_EXPIRED")
  } catch (error) {
    if (error instanceof AuthRateLimitUnavailableError) {
      writeAuthError(
        req,
        res,
        "AUTH_TEMPORARILY_UNAVAILABLE",
        error.retryAfterSeconds
      )
      return
    }
    writeAuthError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE")
  }
}

export async function openCustomerAuthVerificationRuntime(
  req: CustomerAuthVerificationRequest,
  requiresRateLimiter: boolean
): Promise<VerificationRuntime> {
  const knex = resolveKnex(req)
  const database = createKnexVerificationDatabase(knex)
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

  return {
    dependencies: {
      database,
      keyring,
      rateLimitStore: redis ? new RedisAtomicRateLimitStore(redis) : undefined,
      now: () => new Date(),
      resolveEmailByIdentityId: (authIdentityId) =>
        resolveEmailByIdentityId(req, authIdentityId),
      resolveIdentityByEmail: (normalizedEmail) =>
        resolveIdentityByEmail(req, normalizedEmail),
      requestVerification: autoRequestVerification,
      resendVerification,
      resolveVerificationIntentId,
      confirmVerification,
      getVerificationStatus: getVerificationStatus,
    },
    close: async () => {
      await redis?.quit().catch(() => undefined)
    },
  }
}

export async function runCustomerAuthVerificationRequestRoute(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  let runtime: VerificationRuntime | undefined
  try {
    runtime = await openCustomerAuthVerificationRuntime(
      req as CustomerAuthVerificationRequest,
      true
    )
    await handleCustomerAuthVerificationRequest(
      req as CustomerAuthVerificationRequest,
      res as CustomerAuthVerificationResponse,
      runtime.dependencies
    )
  } catch {
    writeAuthError(
      req as CustomerAuthVerificationRequest,
      res as CustomerAuthVerificationResponse,
      "AUTH_TEMPORARILY_UNAVAILABLE",
      60
    )
  } finally {
    await runtime?.close()
  }
}

export async function runCustomerAuthVerificationStatusRoute(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  let runtime: VerificationRuntime | undefined
  try {
    runtime = await openCustomerAuthVerificationRuntime(
      req as CustomerAuthVerificationRequest,
      false
    )
    await handleCustomerAuthVerificationStatus(
      req as CustomerAuthVerificationRequest,
      res as CustomerAuthVerificationResponse,
      runtime.dependencies
    )
  } catch {
    writeAuthError(
      req as CustomerAuthVerificationRequest,
      res as CustomerAuthVerificationResponse,
      "AUTH_TEMPORARILY_UNAVAILABLE"
    )
  } finally {
    await runtime?.close()
  }
}

export async function runCustomerAuthVerificationResendRoute(
  req: MedusaRequest,
  res: MedusaResponse,
  options: CustomerAuthVerificationResendRouteOptions = {}
): Promise<void> {
  const startedAtMs = Date.now()
  let runtime: VerificationRuntime | undefined
  let runtimeAcquired = false
  const openRuntime =
    options.openRuntime ?? openCustomerAuthVerificationRuntime
  const handleResend =
    options.handleResend ?? handleCustomerAuthVerificationResend
  try {
    runtime = await openRuntime(
      req as CustomerAuthVerificationRequest,
      true
    )
    runtimeAcquired = true
    await handleResend(
      req as CustomerAuthVerificationRequest,
      res as CustomerAuthVerificationResponse,
      runtime.dependencies
    )
  } catch {
    if (!runtimeAcquired) {
      await finishAuthTiming(options.timing, startedAtMs).catch(
        () => undefined
      )
    }
    writeAccepted(res as CustomerAuthVerificationResponse)
  } finally {
    await runtime?.close()
  }
}

export async function runCustomerAuthVerificationConfirmRoute(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  let runtime: VerificationRuntime | undefined
  try {
    runtime = await openCustomerAuthVerificationRuntime(
      req as CustomerAuthVerificationRequest,
      true
    )
    await handleCustomerAuthVerificationConfirm(
      req as CustomerAuthVerificationRequest,
      res as CustomerAuthVerificationResponse,
      runtime.dependencies
    )
  } catch {
    writeAuthError(
      req as CustomerAuthVerificationRequest,
      res as CustomerAuthVerificationResponse,
      "AUTH_TEMPORARILY_UNAVAILABLE",
      60
    )
  } finally {
    await runtime?.close()
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  await runCustomerAuthVerificationRequestRoute(req, res)
}
