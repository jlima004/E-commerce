import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { toAuthErrorResponse } from "../../../../auth-surface/errors"
import {
  type AuthSessionDatabase,
  revokeAuthSessionLineage,
} from "../../../../../modules/customer-auth/session"
import type { CustomerAuthAccessContext } from "../../../../../modules/customer-auth/access-guard"

type RawResult = {
  rows?: Array<Record<string, unknown>>
}

type KnexLike = {
  raw(sql: string, bindings?: unknown[]): Promise<RawResult>
  transaction<T>(callback: (transaction: KnexLike) => Promise<T>): Promise<T>
}

type RevokeRequest = MedusaRequest & {
  correlationId?: string
  customerAuth?: Pick<CustomerAuthAccessContext, "lineageId">
}

export type RevokeCurrentLineageDependencies = {
  database: AuthSessionDatabase
  now?: () => Date
}

function hasExactlyEmptyBody(req: MedusaRequest): boolean {
  const contentLength = req.headers["content-length"]
  const transferEncoding = req.headers["transfer-encoding"]
  const body = req.body as unknown
  return (
    transferEncoding === undefined &&
    (contentLength === undefined || contentLength === "0") &&
    (body === undefined ||
      body === null ||
      (typeof body === "object" &&
        !Array.isArray(body) &&
        Object.keys(body as Record<string, unknown>).length === 0))
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

function writeError(
  req: RevokeRequest,
  res: MedusaResponse,
  code:
    | "INVALID_REQUEST"
    | "AUTHENTICATION_REQUIRED"
    | "AUTH_TEMPORARILY_UNAVAILABLE"
): void {
  const normalized = toAuthErrorResponse(
    { code },
    { correlationId: req.correlationId }
  )
  res.status(normalized.statusCode).json(normalized.body)
}

export async function handleRevokeCurrentLineage(
  req: RevokeRequest,
  res: MedusaResponse,
  dependencies: RevokeCurrentLineageDependencies
): Promise<void> {
  if (!hasExactlyEmptyBody(req)) {
    writeError(req, res, "INVALID_REQUEST")
    return
  }

  const lineageId = req.customerAuth?.lineageId
  if (!lineageId) {
    writeError(req, res, "AUTHENTICATION_REQUIRED")
    return
  }

  try {
    await revokeAuthSessionLineage(dependencies.database, {
      lineageId,
      reason: "logout",
      now: dependencies.now?.(),
    })
    res.status(204).end()
  } catch {
    writeError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE")
  }
}

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const request = req as RevokeRequest
  try {
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
    await handleRevokeCurrentLineage(request, res, {
      database: createKnexSessionDatabase(knex),
    })
  } catch {
    writeError(request, res, "AUTH_TEMPORARILY_UNAVAILABLE")
  }
}
