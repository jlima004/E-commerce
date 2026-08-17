import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CustomerRegistrationRequest, CustomerRegistrationResult } from "../../../../../modules/customer-auth/registration"
import type { AtomicRateLimitStore } from "../../../../../modules/customer-auth/security/rate-limit"
import type { CapabilityKeyring } from "../../../../../modules/customer-auth/security/capabilities"

type AuthHeaders = Record<string, string | string[] | undefined>

export type CustomerAuthSignupRequest = {
  body?: unknown
  headers: AuthHeaders
  ip?: string
  correlationId?: string
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

export async function handleCustomerAuthSignup(
  _req: CustomerAuthSignupRequest,
  _res: CustomerAuthSignupResponse,
  _dependencies: CustomerAuthSignupDependencies
): Promise<void> {
  throw new Error("14-15 signup handler is not implemented")
}

export async function POST(
  _req: MedusaRequest,
  _res: MedusaResponse
): Promise<void> {
  throw new Error("14-15 signup route is not implemented")
}
