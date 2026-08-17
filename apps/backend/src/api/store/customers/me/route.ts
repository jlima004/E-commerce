import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  serializeCurrentAuthCustomer,
  type AuthCustomer,
  type AuthVerificationState,
} from "../../../auth-surface/contracts"
import { toAuthErrorResponse } from "../../../auth-surface/errors"
import type { CustomerAuthAccessContext } from "../../../../modules/customer-auth/access-guard"

type AuthHeaders = Record<string, string | string[] | undefined>

export type CustomerAuthMeRequest = {
  body?: unknown
  headers: AuthHeaders
  correlationId?: string
  customerAuth?: (Partial<CustomerAuthAccessContext> & {
    authorized?: boolean
  })
  scope?: {
    resolve: <T = unknown>(key: unknown) => T
  }
}

export type CustomerAuthMeResponse = {
  headersSent?: boolean
  status: (statusCode: number) => CustomerAuthMeResponse
  setHeader: (
    name: string,
    value: string
  ) => CustomerAuthMeResponse | void
  json: (body: unknown) => CustomerAuthMeResponse | void
}

export type CustomerAuthMeDependencies = {
  resolveCustomer: (
    customerId: string
  ) => Promise<AuthCustomer & Record<string, unknown>>
  resolveVerificationState: (
    authIdentityId: string
  ) => Promise<AuthVerificationState>
}

type KnexLike = {
  raw(
    sql: string,
    bindings?: unknown[]
  ): Promise<{ rows?: Array<Record<string, unknown>> }>
}

function writeAuthError(
  req: CustomerAuthMeRequest,
  res: CustomerAuthMeResponse,
  code: "AUTHENTICATION_REQUIRED" | "AUTH_TEMPORARILY_UNAVAILABLE"
): void {
  const normalized = toAuthErrorResponse(
    { code },
    { correlationId: req.correlationId }
  )
  res.status(normalized.statusCode).json(normalized.body)
}

function requireAuthenticatedContext(
  req: CustomerAuthMeRequest
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
    context.lineageId.length === 0 ||
    !(context.originalAuthenticatedAt instanceof Date) ||
    !(context.absoluteExpiresAt instanceof Date)
  ) {
    return null
  }
  return context as CustomerAuthAccessContext
}

export async function handleCustomerAuthCurrentCustomer(
  req: CustomerAuthMeRequest,
  res: CustomerAuthMeResponse,
  dependencies: CustomerAuthMeDependencies
): Promise<void> {
  const context = requireAuthenticatedContext(req)
  if (!context) {
    writeAuthError(req, res, "AUTHENTICATION_REQUIRED")
    return
  }

  try {
    const [customer, verificationState] = await Promise.all([
      dependencies.resolveCustomer(context.customerId),
      dependencies.resolveVerificationState(context.authIdentityId),
    ])
    res.status(200).json(
      serializeCurrentAuthCustomer({
        customer,
        verificationState,
        originalAuthenticatedAt:
          context.originalAuthenticatedAt.toISOString(),
        absoluteExpiresAt: context.absoluteExpiresAt.toISOString(),
      })
    )
  } catch {
    writeAuthError(req, res, "AUTH_TEMPORARILY_UNAVAILABLE")
  }
}

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const request = req as CustomerAuthMeRequest
  try {
    const knex = req.scope.resolve(
      ContainerRegistrationKeys.PG_CONNECTION
    ) as KnexLike
    const customerService = req.scope.resolve(Modules.CUSTOMER) as unknown as {
      retrieveCustomer(id: string): Promise<Record<string, unknown>>
    }
    if (!knex || typeof knex.raw !== "function") {
      throw new Error("CUSTOMER_AUTH_POSTGRES_UNAVAILABLE")
    }
    await handleCustomerAuthCurrentCustomer(
      request,
      res as CustomerAuthMeResponse,
      {
        async resolveCustomer(customerId) {
          const customer = await customerService.retrieveCustomer(customerId)
          return {
            id: String(customer.id ?? customerId),
            email: String(customer.email ?? ""),
            firstName: String(
              customer.first_name ?? customer.firstName ?? ""
            ),
            lastName: String(customer.last_name ?? customer.lastName ?? ""),
          }
        },
        async resolveVerificationState(authIdentityId) {
          const result = await knex.raw(
            `select email_verified_at
               from auth_credential_state
              where auth_identity_id = ?
                and deleted_at is null`,
            [authIdentityId]
          )
          const rows = result.rows ?? []
          if (rows.length !== 1) {
            throw new Error("CUSTOMER_AUTH_CREDENTIAL_STATE_INCONSISTENT")
          }
          return rows[0]?.email_verified_at ? "verified" : "pending"
        },
      }
    )
  } catch {
    writeAuthError(request, res as CustomerAuthMeResponse, "AUTH_TEMPORARILY_UNAVAILABLE")
  }
}
