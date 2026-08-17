import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CustomerAuthAccessContext } from "../../../../modules/customer-auth/access-guard"
import type { AuthCustomer, AuthVerificationState } from "../../../auth-surface/contracts"

type AuthHeaders = Record<string, string | string[] | undefined>

export type CustomerAuthMeRequest = {
  body?: unknown
  headers: AuthHeaders
  correlationId?: string
  customerAuth?: (Partial<CustomerAuthAccessContext> & {
    authorized?: boolean
  })
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
  resolveCustomer: (customerId: string) => Promise<
    AuthCustomer & Record<string, unknown>
  >
  resolveVerificationState: (
    authIdentityId: string
  ) => Promise<AuthVerificationState>
}

export async function handleCustomerAuthCurrentCustomer(
  _req: CustomerAuthMeRequest,
  _res: CustomerAuthMeResponse,
  _dependencies: CustomerAuthMeDependencies
): Promise<void> {
  throw new Error("14-15 current-customer handler is not implemented")
}

export async function GET(
  _req: MedusaRequest,
  _res: MedusaResponse
): Promise<void> {
  throw new Error("14-15 current-customer route is not implemented")
}
