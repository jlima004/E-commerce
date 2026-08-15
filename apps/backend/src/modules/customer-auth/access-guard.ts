import {
  verifyCustomerAuthAccessToken,
  type AuthAccessJwtClaims,
} from "./jwt"

export type CustomerAuthAccessQueryResult = {
  rows?: Array<Record<string, unknown>>
}

export type CustomerAuthAccessDatabase = {
  query(
    sql: string,
    bindings?: unknown[]
  ): Promise<CustomerAuthAccessQueryResult>
}

type PostgresQueryConnection = {
  query(
    sql: string,
    bindings?: unknown[]
  ): Promise<CustomerAuthAccessQueryResult>
}

type KnexRawConnection = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<CustomerAuthAccessQueryResult>
}

export type CustomerAuthAccessContext = {
  lineageId: string
  sid: string
  authIdentityId: string
  customerId: string
  credentialVersion: number
  originalAuthenticatedAt: Date
  absoluteExpiresAt: Date
  claims: AuthAccessJwtClaims
}

export type CustomerAuthAccessDecision =
  | ({ authorized: true } & CustomerAuthAccessContext)
  | {
      authorized: false
      statusCode: 401 | 503
      code:
        | "AUTHENTICATION_REQUIRED"
        | "AUTH_TEMPORARILY_UNAVAILABLE"
    }

export type AuthorizeCustomerAuthAccessOptions = {
  jwtSecret: string
  now?: Date
}

const ACCESS_LOOKUP_SQL = `
select
  lineage.id as lineage_id,
  lineage.sid,
  lineage.auth_identity_id as lineage_auth_identity_id,
  lineage.customer_id as lineage_customer_id,
  lineage.credential_version_snapshot,
  lineage.status as lineage_status,
  lineage.original_authenticated_at,
  lineage.absolute_expires_at,
  credential.auth_identity_id as credential_auth_identity_id,
  credential.customer_id as credential_customer_id,
  credential.credential_version,
  credential.operation_status
from auth_session_lineage lineage
join auth_credential_state credential
  on credential.auth_identity_id = lineage.auth_identity_id
 and credential.deleted_at is null
where lineage.sid = ?
  and lineage.deleted_at is null
`

function replaceBindings(sql: string): string {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}

export function createPostgresCustomerAuthAccessDatabase(
  connection: PostgresQueryConnection
): CustomerAuthAccessDatabase {
  return {
    query(sql, bindings = []) {
      return connection.query(replaceBindings(sql), bindings)
    },
  }
}

export function createKnexCustomerAuthAccessDatabase(
  connection: KnexRawConnection
): CustomerAuthAccessDatabase {
  return {
    query(sql, bindings = []) {
      return connection.raw(sql, bindings)
    },
  }
}

function deny(): CustomerAuthAccessDecision {
  return {
    authorized: false,
    statusCode: 401,
    code: "AUTHENTICATION_REQUIRED",
  }
}

function unavailable(): CustomerAuthAccessDecision {
  return {
    authorized: false,
    statusCode: 503,
    code: "AUTH_TEMPORARILY_UNAVAILABLE",
  }
}

function extractBearerToken(authorization: unknown): string | null {
  if (typeof authorization !== "string") {
    return null
  }
  const match = /^Bearer ([^\s]+)$/.exec(authorization)
  return match?.[1] ?? null
}

function stringField(row: Record<string, unknown>, field: string): string | null {
  const value = row[field]
  return typeof value === "string" && value.length > 0 ? value : null
}

function positiveIntegerField(
  row: Record<string, unknown>,
  field: string
): number | null {
  const value = Number(row[field])
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function dateField(row: Record<string, unknown>, field: string): Date | null {
  const value = row[field]
  const parsed =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
}

function exactSecond(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

export async function authorizeCustomerAuthAccess(
  database: CustomerAuthAccessDatabase,
  authorization: unknown,
  options: AuthorizeCustomerAuthAccessOptions
): Promise<CustomerAuthAccessDecision> {
  const token = extractBearerToken(authorization)
  if (!token) {
    return deny()
  }

  let claims: AuthAccessJwtClaims
  const now = options.now ?? new Date()
  try {
    claims = verifyCustomerAuthAccessToken(token, {
      secret: options.jwtSecret,
      now,
    })
  } catch {
    return deny()
  }

  let rows: Array<Record<string, unknown>>
  try {
    const result = await database.query(ACCESS_LOOKUP_SQL, [claims.sid])
    rows = result.rows ?? []
  } catch {
    return unavailable()
  }

  if (rows.length !== 1) {
    return deny()
  }

  const row = rows[0]!
  const lineageId = stringField(row, "lineage_id")
  const sid = stringField(row, "sid")
  const lineageIdentityId = stringField(row, "lineage_auth_identity_id")
  const credentialIdentityId = stringField(
    row,
    "credential_auth_identity_id"
  )
  const lineageCustomerId = stringField(row, "lineage_customer_id")
  const credentialCustomerId = stringField(row, "credential_customer_id")
  const lineageCredentialVersion = positiveIntegerField(
    row,
    "credential_version_snapshot"
  )
  const credentialVersion = positiveIntegerField(row, "credential_version")
  const originalAuthenticatedAt = dateField(
    row,
    "original_authenticated_at"
  )
  const absoluteExpiresAt = dateField(row, "absolute_expires_at")

  if (
    !lineageId ||
    sid !== claims.sid ||
    lineageIdentityId !== claims.auth_identity_id ||
    credentialIdentityId !== claims.auth_identity_id ||
    lineageCustomerId !== claims.customer_id ||
    credentialCustomerId !== claims.customer_id ||
    lineageCredentialVersion !== claims.cv ||
    credentialVersion !== claims.cv ||
    row.lineage_status !== "active" ||
    row.operation_status !== "stable" ||
    !originalAuthenticatedAt ||
    !absoluteExpiresAt ||
    exactSecond(originalAuthenticatedAt) !==
      claims.original_authenticated_at ||
    exactSecond(absoluteExpiresAt) !== claims.absolute_expires_at ||
    now.getTime() >= absoluteExpiresAt.getTime()
  ) {
    return deny()
  }

  return {
    authorized: true,
    lineageId,
    sid: claims.sid,
    authIdentityId: claims.auth_identity_id,
    customerId: claims.customer_id,
    credentialVersion: claims.cv,
    originalAuthenticatedAt,
    absoluteExpiresAt,
    claims,
  }
}
