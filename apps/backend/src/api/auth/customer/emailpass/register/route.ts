import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import Redis from "ioredis"
import { env } from "../../../../../config/env"
import {
  CustomerRegistrationError,
  type CustomerRegistrationRequest,
  type CustomerRegistrationResult,
} from "../../../../../modules/customer-auth/registration"
import { registerCustomerWorkflow } from "../../../../../workflows/customer-auth/register-customer"
import { serializeAuthSessionEnvelope } from "../../../../auth-surface/contracts"
import { toAuthErrorResponse } from "../../../../auth-surface/errors"
import { SignupRequestSchema } from "../../../../auth-surface/validators"
import type { CapabilityKeyring } from "../../../../../modules/customer-auth/security/capabilities"
import { normalizeCustomerAuthEmail } from "../../../../../modules/customer-auth/security/email-normalization"
import {
  type AtomicRateLimitStore,
  AuthRateLimitUnavailableError,
  RedisAtomicRateLimitStore,
  buildPreLookupRateLimitKeys,
  consumeRateLimitBuckets,
} from "../../../../../modules/customer-auth/security/rate-limit"

type AuthHeaders = Record<string, string | string[] | undefined>

export type CustomerAuthSignupRequest = {
  body?: unknown
  headers: AuthHeaders
  ip?: string
  correlationId?: string
  scope?: {
    resolve: <T = unknown>(key: unknown) => T
  }
}

export type CustomerAuthSignupResponse = {
  headersSent?: boolean
  status: (statusCode: number) => CustomerAuthSignupResponse
  setHeader: (
    name: string,
    value: string
  ) => CustomerAuthSignupResponse | void
  json: (body: unknown) => CustomerAuthSignupResponse | void
}

export type CustomerAuthSignupDependencies = {
  keyring: CapabilityKeyring
  jwtSecret: string
  rateLimitStore: AtomicRateLimitStore
  now?: () => Date
  registerCustomer: (
    request: CustomerRegistrationRequest
  ) => Promise<CustomerRegistrationResult>
  bffAuthorized?: boolean
}

type SignupErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUEST_REJECTED"
  | "RATE_LIMITED"
  | "AUTH_TEMPORARILY_UNAVAILABLE"
  | "AUTHENTICATION_REQUIRED"

function writeAuthError(
  req: CustomerAuthSignupRequest,
  res: CustomerAuthSignupResponse,
  code: SignupErrorCode,
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

function mapRegistrationError(error: CustomerRegistrationError): SignupErrorCode {
  if (error.code === "CUSTOMER_REGISTRATION_INVALID_REQUEST") {
    return "INVALID_REQUEST"
  }
  if (
    error.code === "CUSTOMER_REGISTRATION_SEMANTIC_MISMATCH" ||
    error.code === "CUSTOMER_REGISTRATION_PASSWORD_MISMATCH" ||
    error.code === "CUSTOMER_REGISTRATION_ALREADY_COMPLETED"
  ) {
    return "AUTH_REQUEST_REJECTED"
  }
  return "AUTH_TEMPORARILY_UNAVAILABLE"
}

function registrationIsComplete(
  result: CustomerRegistrationResult
): boolean {
  return (
    result.status === "completed" &&
    typeof result.customerId === "string" &&
    result.customerId.length > 0 &&
    typeof result.session?.accessToken === "string" &&
    result.session.accessToken.length > 0 &&
    typeof result.session?.refreshToken === "string" &&
    result.session.refreshToken.length > 0 &&
    typeof result.verification?.intentId === "string" &&
    result.verification.intentId.length > 0 &&
    typeof result.verification?.outboxId === "string" &&
    result.verification.outboxId.length > 0
  )
}

export async function handleCustomerAuthSignup(
  req: CustomerAuthSignupRequest,
  res: CustomerAuthSignupResponse,
  dependencies: CustomerAuthSignupDependencies
): Promise<void> {
  const parsed = SignupRequestSchema.safeParse(req.body ?? {})
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
      operation: "signup",
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

  try {
    const result = await dependencies.registerCustomer({
      email: parsed.data.email,
      password: parsed.data.password,
      customerData: {
        first_name: parsed.data.firstName,
        last_name: parsed.data.lastName,
      },
      keyring: dependencies.keyring,
      jwtSecret: dependencies.jwtSecret,
      now: dependencies.now?.(),
    })

    if (!registrationIsComplete(result)) {
      writeAuthError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE", 60)
      return
    }

    const envelope = serializeAuthSessionEnvelope(
      {
        accessToken: result.session.accessToken,
        accessExpiresAt: result.session.accessExpiresAt.toISOString(),
        refreshToken: result.session.refreshToken,
        refreshExpiresAt: result.session.refreshExpiresAt.toISOString(),
        originalAuthenticatedAt:
          result.session.originalAuthenticatedAt.toISOString(),
        absoluteExpiresAt: result.session.absoluteExpiresAt.toISOString(),
        customer: {
          id: result.customerId,
          email: normalizedEmail,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
        },
        verificationState:
          result.verification.state === "verified" ? "verified" : "pending",
      },
      { bffAuthorized: dependencies.bffAuthorized !== false }
    )
    if (!envelope) {
      writeAuthError(req, res, "AUTHENTICATION_REQUIRED")
      return
    }

    res.status(201).json(envelope)
  } catch (error) {
    if (error instanceof CustomerRegistrationError) {
      const code = mapRegistrationError(error)
      writeAuthError(
        req,
        res,
        code,
        code === "AUTH_TEMPORARILY_UNAVAILABLE" ? 60 : undefined
      )
      return
    }
    writeAuthError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE", 60)
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const request = req as CustomerAuthSignupRequest
  let redis: Redis | undefined
  try {
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
    await handleCustomerAuthSignup(request, res as CustomerAuthSignupResponse, {
      keyring,
      jwtSecret: env.JWT_SECRET,
      rateLimitStore: new RedisAtomicRateLimitStore(redis),
      registerCustomer: async (input) => {
        const { result } = await registerCustomerWorkflow(
          req.scope
        ).run({ input })
        return result
      },
      bffAuthorized: true,
    })
  } catch {
    writeAuthError(
      request,
      res as CustomerAuthSignupResponse,
      "AUTH_TEMPORARILY_UNAVAILABLE",
      60
    )
  } finally {
    await redis?.quit().catch(() => undefined)
  }
}
