import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import Redis from "ioredis"
import { env } from "../../../../config/env"
import { serializeAuthSessionEnvelope } from "../../../auth-surface/contracts"
import { toAuthErrorResponse } from "../../../auth-surface/errors"
import { LoginRequestSchema } from "../../../auth-surface/validators"
import {
  loginCustomer,
  runEmailpassDummyScrypt,
  type CustomerLoginAuth,
  type CustomerLoginCustomer,
  type CustomerLoginCredential,
  type CustomerLoginInput,
  type CustomerLoginOutcome,
  type CustomerLoginSession,
} from "../../../../modules/customer-auth/login"
import {
  issueInitialAuthSession,
  type AuthSessionDatabase,
} from "../../../../modules/customer-auth/session"
import type { CapabilityKeyring } from "../../../../modules/customer-auth/security/capabilities"
import { normalizeCustomerAuthEmail } from "../../../../modules/customer-auth/security/email-normalization"
import {
  type AtomicRateLimitStore,
  AuthRateLimitUnavailableError,
  RedisAtomicRateLimitStore,
  buildPreLookupRateLimitKeys,
  consumeRateLimitBuckets,
} from "../../../../modules/customer-auth/security/rate-limit"
import { applyAuthTimingEnvelope } from "../../../../modules/customer-auth/security/timing"

type AuthHeaders = Record<string, string | string[] | undefined>

export type CustomerAuthLoginRequest = {
  body?: unknown
  headers: AuthHeaders
  ip?: string
  correlationId?: string
  scope?: {
    resolve: <T = unknown>(key: unknown) => T
  }
}

export type CustomerAuthLoginResponse = {
  headersSent?: boolean
  status: (statusCode: number) => CustomerAuthLoginResponse
  setHeader: (
    name: string,
    value: string
  ) => CustomerAuthLoginResponse | void
  json: (body: unknown) => CustomerAuthLoginResponse | void
}

export type CustomerAuthLoginDependencies = {
  keyring: CapabilityKeyring
  jwtSecret: string
  rateLimitStore: AtomicRateLimitStore
  now?: () => Date
  timing?: (startedAtMs: number) => Promise<number>
  dummyPasswordWork?: (password: string) => Promise<void>
  login?: (input: CustomerLoginInput) => Promise<CustomerLoginOutcome>
  auth: CustomerLoginAuth
  customer: CustomerLoginCustomer
  credential: CustomerLoginCredential
  session: CustomerLoginSession
  bffAuthorized?: boolean
}

type LoginErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CREDENTIALS"
  | "EMAIL_VERIFICATION_REQUIRED"
  | "RATE_LIMITED"
  | "AUTH_TEMPORARILY_UNAVAILABLE"
  | "AUTHENTICATION_REQUIRED"

type RawResult = {
  rows?: Array<Record<string, unknown>>
}

type KnexLike = {
  raw(sql: string, bindings?: unknown[]): Promise<RawResult>
  transaction<T>(callback: (transaction: KnexLike) => Promise<T>): Promise<T>
}

type AuthModuleLike = {
  getAuthIdentityProviderService(provider: string): {
    retrieve(input: { entity_id: string }): Promise<{
      id: string
      app_metadata?: Record<string, unknown> | null
    }>
  }
  authenticate(
    provider: string,
    input: {
      actor_type: string
      body: { email: string; password: string }
    }
  ): Promise<{
    success: boolean
    authIdentity?: {
      id: string
      app_metadata?: Record<string, unknown> | null
    }
  }>
}

type CustomerModuleLike = {
  retrieveCustomer(id: string): Promise<{
    id: string
    email?: string
    first_name?: string | null
    last_name?: string | null
  }>
  listCustomers(filters: {
    email: string
  }): Promise<
    Array<{
      id: string
      email?: string
      first_name?: string | null
      last_name?: string | null
    }>
  >
}

function writeAuthError(
  req: CustomerAuthLoginRequest,
  res: CustomerAuthLoginResponse,
  code: LoginErrorCode,
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

function notFound(error: unknown): boolean {
  return (
    error instanceof MedusaError &&
    error.type === MedusaError.Types.NOT_FOUND
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

export async function handleCustomerAuthLogin(
  req: CustomerAuthLoginRequest,
  res: CustomerAuthLoginResponse,
  dependencies: CustomerAuthLoginDependencies
): Promise<void> {
  const startedAtMs = Date.now()
  const timing =
    dependencies.timing ??
    ((started) => applyAuthTimingEnvelope({ startedAtMs: started }))
  const finish = () => timing(startedAtMs)

  const parsed = LoginRequestSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    writeAuthError(req, res, "INVALID_REQUEST")
    return
  }

  let normalizedEmail: string
  try {
    normalizedEmail = normalizeCustomerAuthEmail(parsed.data.email)
  } catch {
    writeAuthError(req, res, "INVALID_REQUEST")
    return
  }

  const ip = typeof req.ip === "string" ? req.ip : ""
  try {
    const preBuckets = buildPreLookupRateLimitKeys({
      operation: "login",
      keyring: dependencies.keyring,
      ip,
      email: normalizedEmail,
    })
    const pre = await consumeRateLimitBuckets(
      dependencies.rateLimitStore,
      preBuckets
    )
    if (!pre.allowed) {
      writeAuthError(
        req,
        res,
        "RATE_LIMITED",
        pre.blockedBy?.retryAfterSeconds
      )
      return
    }
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
    writeAuthError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE", 60)
    return
  }

  const login = dependencies.login ?? loginCustomer
  try {
    const outcome = await login({
      email: parsed.data.email,
      password: parsed.data.password,
      now: dependencies.now?.(),
      dummyPasswordWork:
        dependencies.dummyPasswordWork ?? runEmailpassDummyScrypt,
      auth: dependencies.auth,
      customer: dependencies.customer,
      credential: dependencies.credential,
      session: dependencies.session,
      keyring: dependencies.keyring,
      jwtSecret: dependencies.jwtSecret,
    })

    if (outcome.kind === "invalid_credentials") {
      await finish()
      writeAuthError(req, res, "INVALID_CREDENTIALS")
      return
    }
    if (outcome.kind === "email_verification_required") {
      await finish()
      writeAuthError(req, res, "EMAIL_VERIFICATION_REQUIRED")
      return
    }

    const envelope = serializeAuthSessionEnvelope(
      {
        accessToken: outcome.session.accessToken,
        accessExpiresAt: outcome.session.accessExpiresAt.toISOString(),
        refreshToken: outcome.session.refreshToken,
        refreshExpiresAt: outcome.session.refreshExpiresAt.toISOString(),
        originalAuthenticatedAt:
          outcome.session.originalAuthenticatedAt.toISOString(),
        absoluteExpiresAt: outcome.session.absoluteExpiresAt.toISOString(),
        customer: outcome.customer,
        verificationState: outcome.verificationState,
      },
      { bffAuthorized: dependencies.bffAuthorized !== false }
    )
    if (!envelope) {
      await finish()
      writeAuthError(req, res, "AUTHENTICATION_REQUIRED")
      return
    }
    res.status(200).json(envelope)
  } catch {
    await finish().catch(() => undefined)
    writeAuthError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE", 60)
  }
}

function createLoginAuthAdapter(authModule: AuthModuleLike): CustomerLoginAuth {
  const provider = authModule.getAuthIdentityProviderService("emailpass")
  return {
    async findIdentity({ normalizedEmail }) {
      try {
        const identity = await provider.retrieve({ entity_id: normalizedEmail })
        return {
          id: identity.id,
          app_metadata: identity.app_metadata,
        }
      } catch (error) {
        if (notFound(error)) {
          return null
        }
        throw error
      }
    },
    async authenticate({ normalizedEmail, password }) {
      const response = await authModule.authenticate("emailpass", {
        actor_type: "customer",
        body: { email: normalizedEmail, password },
      })
      return response.success && response.authIdentity
        ? {
            id: response.authIdentity.id,
            app_metadata: response.authIdentity.app_metadata,
          }
        : null
    },
  }
}

function createLoginCustomerAdapter(
  customerModule: CustomerModuleLike
): CustomerLoginCustomer {
  return {
    async find({ authIdentity, normalizedEmail }) {
      const customerId = authIdentity.app_metadata?.customer_id
      if (typeof customerId === "string" && customerId.trim() !== "") {
        try {
          return await customerModule.retrieveCustomer(customerId)
        } catch (error) {
          if (notFound(error)) {
            return null
          }
          throw error
        }
      }
      const customers = await customerModule.listCustomers({
        email: normalizedEmail,
      })
      return customers.length === 1 ? (customers[0] ?? null) : null
    },
  }
}

function createLoginCredentialAdapter(
  knex: KnexLike
): CustomerLoginCredential {
  return {
    async load({ authIdentityId, customerId }) {
      const result = await knex.raw(
        `select customer_id, credential_version, email_verified_at, operation_status
           from auth_credential_state
          where auth_identity_id = ?
            and deleted_at is null`,
        [authIdentityId]
      )
      const rows = result.rows ?? []
      if (rows.length !== 1) {
        return null
      }
      const row = rows[0]!
      const loadedCustomerId =
        typeof row.customer_id === "string" ? row.customer_id : ""
      if (loadedCustomerId !== customerId) {
        return null
      }
      const verifiedAt = row.email_verified_at
      return {
        customerId: loadedCustomerId,
        credentialVersion: Number(row.credential_version),
        emailVerifiedAt:
          verifiedAt instanceof Date
            ? verifiedAt
            : verifiedAt
              ? new Date(String(verifiedAt))
              : null,
        operationStatus: String(row.operation_status ?? ""),
      }
    },
  }
}

function createLoginSessionAdapter(
  knex: KnexLike,
  keyring: CapabilityKeyring,
  jwtSecret: string
): CustomerLoginSession {
  const database = createKnexSessionDatabase(knex)
  return {
    issue(input) {
      return issueInitialAuthSession(database, {
        authIdentityId: input.authIdentityId,
        customerId: input.customerId,
        credentialVersion: input.credentialVersion,
        keyring,
        jwtSecret,
        now: input.now,
      })
    },
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const request = req as CustomerAuthLoginRequest
  let redis: Redis | undefined
  try {
    const knex = req.scope.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    ) as KnexLike
    const keyring = env.CUSTOMER_AUTH_CAPABILITY_KEYRING
    if (
      !knex ||
      typeof knex.raw !== "function" ||
      typeof knex.transaction !== "function" ||
      !env.REDIS_URL ||
      !keyring
    ) {
      throw new Error("CUSTOMER_AUTH_RUNTIME_UNAVAILABLE")
    }
    redis = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
    })
    await redis.connect()
    const authModule = req.scope.resolve(
      Modules.AUTH
    ) as unknown as AuthModuleLike
    const customerModule = req.scope.resolve(
      Modules.CUSTOMER
    ) as unknown as CustomerModuleLike
    await handleCustomerAuthLogin(request, res as CustomerAuthLoginResponse, {
      keyring,
      jwtSecret: env.JWT_SECRET,
      rateLimitStore: new RedisAtomicRateLimitStore(redis),
      dummyPasswordWork: runEmailpassDummyScrypt,
      auth: createLoginAuthAdapter(authModule),
      customer: createLoginCustomerAdapter(customerModule),
      credential: createLoginCredentialAdapter(knex),
      session: createLoginSessionAdapter(knex, keyring, env.JWT_SECRET),
      bffAuthorized: true,
    })
  } catch {
    writeAuthError(
      request,
      res as CustomerAuthLoginResponse,
      "AUTH_TEMPORARILY_UNAVAILABLE",
      60
    )
  } finally {
    await redis?.quit().catch(() => undefined)
  }
}
