import { randomUUID } from "node:crypto"
import jwt, { type JwtPayload } from "jsonwebtoken"

export const AUTH_ACCESS_TOKEN_TTL_SECONDS = 10 * 60
export const AUTH_ACCESS_TOKEN_ALGORITHM = "HS256" as const
export const AUTH_ACCESS_TOKEN_TYPE = "access" as const

export type AuthAccessJwtClaims = JwtPayload & {
  sub: string
  customer_id: string
  identity_id: string
  auth_identity_id: string
  sid: string
  cv: number
  token_type: typeof AUTH_ACCESS_TOKEN_TYPE
  original_authenticated_at: number
  absolute_expires_at: number
  jti: string
  iat: number
  exp: number
}

export type IssueCustomerAuthAccessTokenInput = {
  secret: string
  authIdentityId: string
  customerId: string
  sid: string
  credentialVersion: number
  originalAuthenticatedAt: Date
  absoluteExpiresAt: Date
  now?: Date
  jti?: string
}

export type IssuedCustomerAuthAccessToken = {
  token: string
  claims: AuthAccessJwtClaims
  issuedAt: Date
  expiresAt: Date
}

export type VerifyCustomerAuthAccessTokenInput = {
  secret: string
  now?: Date
  clockToleranceSeconds?: number
}

export class AuthJwtError extends Error {
  readonly code: "AUTH_ACCESS_TOKEN_INVALID" | "AUTH_ACCESS_TOKEN_DEADLINE_REACHED"

  constructor(
    code: "AUTH_ACCESS_TOKEN_INVALID" | "AUTH_ACCESS_TOKEN_DEADLINE_REACHED"
  ) {
    super(code)
    this.name = "AuthJwtError"
    this.code = code
  }
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_INVALID")
  }

  if (value.length > 512) {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_INVALID")
  }

  return value
}

function requireDate(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_INVALID")
  }

  return new Date(value.getTime())
}

function requirePositiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_INVALID")
  }

  return Number(value)
}

function requireSecret(secret: unknown): string {
  return requireNonEmptyString(secret)
}

function assertClaims(payload: JwtPayload | string): AuthAccessJwtClaims {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_INVALID")
  }

  const claims = payload as Partial<AuthAccessJwtClaims>
  const customerId = requireNonEmptyString(claims.customer_id)
  const identityId = requireNonEmptyString(claims.identity_id)
  const authIdentityId = requireNonEmptyString(claims.auth_identity_id)
  const sid = requireNonEmptyString(claims.sid)
  const jti = requireNonEmptyString(claims.jti)
  const cv = requirePositiveInteger(claims.cv)
  const iat = requirePositiveInteger(claims.iat)
  const exp = requirePositiveInteger(claims.exp)
  const originalAuthenticatedAt = requirePositiveInteger(
    claims.original_authenticated_at
  )
  const absoluteExpiresAt = requirePositiveInteger(claims.absolute_expires_at)

  if (
    claims.token_type !== AUTH_ACCESS_TOKEN_TYPE ||
    claims.sub !== customerId ||
    authIdentityId !== identityId ||
    exp <= iat ||
    exp > absoluteExpiresAt ||
    originalAuthenticatedAt > iat ||
    originalAuthenticatedAt > absoluteExpiresAt ||
    absoluteExpiresAt - originalAuthenticatedAt !==
      30 * 24 * 60 * 60
  ) {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_INVALID")
  }

  return {
    ...claims,
    sub: customerId,
    customer_id: customerId,
    identity_id: identityId,
    auth_identity_id: authIdentityId,
    sid,
    cv,
    token_type: AUTH_ACCESS_TOKEN_TYPE,
    original_authenticated_at: originalAuthenticatedAt,
    absolute_expires_at: absoluteExpiresAt,
    jti,
    iat,
    exp,
  }
}

export function issueCustomerAuthAccessToken(
  input: IssueCustomerAuthAccessTokenInput
): IssuedCustomerAuthAccessToken {
  const secret = requireSecret(input.secret)
  const authIdentityId = requireNonEmptyString(input.authIdentityId)
  const customerId = requireNonEmptyString(input.customerId)
  const sid = requireNonEmptyString(input.sid)
  const credentialVersion = requirePositiveInteger(input.credentialVersion)
  const originalAuthenticatedAt = requireDate(input.originalAuthenticatedAt)
  const absoluteExpiresAt = requireDate(input.absoluteExpiresAt)
  const now = requireDate(input.now ?? new Date())
  const jti = input.jti
    ? requireNonEmptyString(input.jti)
    : randomUUID()

  if (
    absoluteExpiresAt.getTime() !==
    originalAuthenticatedAt.getTime() + 30 * 24 * 60 * 60 * 1000
  ) {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_INVALID")
  }

  if (originalAuthenticatedAt.getTime() > now.getTime()) {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_INVALID")
  }

  if (absoluteExpiresAt.getTime() <= now.getTime()) {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_DEADLINE_REACHED")
  }

  const issuedAtSeconds = Math.floor(now.getTime() / 1000)
  const absoluteExpiresAtSeconds = Math.floor(
    absoluteExpiresAt.getTime() / 1000
  )
  const expiresAtSeconds = Math.min(
    issuedAtSeconds + AUTH_ACCESS_TOKEN_TTL_SECONDS,
    absoluteExpiresAtSeconds
  )

  if (expiresAtSeconds <= issuedAtSeconds) {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_DEADLINE_REACHED")
  }

  const claims: AuthAccessJwtClaims = {
    sub: customerId,
    customer_id: customerId,
    identity_id: authIdentityId,
    auth_identity_id: authIdentityId,
    sid,
    cv: credentialVersion,
    token_type: AUTH_ACCESS_TOKEN_TYPE,
    original_authenticated_at: Math.floor(
      originalAuthenticatedAt.getTime() / 1000
    ),
    absolute_expires_at: absoluteExpiresAtSeconds,
    jti,
    iat: issuedAtSeconds,
    exp: expiresAtSeconds,
  }

  const token = jwt.sign(claims, secret, {
    algorithm: AUTH_ACCESS_TOKEN_ALGORITHM,
  })

  return {
    token,
    claims,
    issuedAt: new Date(issuedAtSeconds * 1000),
    expiresAt: new Date(expiresAtSeconds * 1000),
  }
}

export function verifyCustomerAuthAccessToken(
  token: string,
  input: VerifyCustomerAuthAccessTokenInput
): AuthAccessJwtClaims {
  const secret = requireSecret(input.secret)
  const now = input.now ? requireDate(input.now) : undefined

  if (typeof token !== "string" || token.trim() === "") {
    throw new AuthJwtError("AUTH_ACCESS_TOKEN_INVALID")
  }

  try {
    const payload = jwt.verify(token, secret, {
      algorithms: [AUTH_ACCESS_TOKEN_ALGORITHM],
      clockTimestamp: now ? Math.floor(now.getTime() / 1000) : undefined,
      clockTolerance: input.clockToleranceSeconds,
    })
    return assertClaims(payload)
  } catch (error) {
    if (error instanceof AuthJwtError) {
      throw error
    }

    throw new AuthJwtError("AUTH_ACCESS_TOKEN_INVALID")
  }
}

export const createCustomerAuthAccessToken = issueCustomerAuthAccessToken
export const signCustomerAuthAccessToken = issueCustomerAuthAccessToken
export const verifyAccessToken = verifyCustomerAuthAccessToken
