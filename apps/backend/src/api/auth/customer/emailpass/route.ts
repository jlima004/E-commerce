import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { AtomicRateLimitStore } from "../../../../modules/customer-auth/security/rate-limit"
import type { CapabilityKeyring } from "../../../../modules/customer-auth/security/capabilities"
import type {
  CustomerLoginAuth,
  CustomerLoginCustomer,
  CustomerLoginCredential,
  CustomerLoginInput,
  CustomerLoginOutcome,
  CustomerLoginSession,
} from "../../../../modules/customer-auth/login"

type AuthHeaders = Record<string, string | string[] | undefined>

export type CustomerAuthLoginRequest = {
  body?: unknown
  headers: AuthHeaders
  ip?: string
  correlationId?: string
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

export async function handleCustomerAuthLogin(
  _req: CustomerAuthLoginRequest,
  _res: CustomerAuthLoginResponse,
  _dependencies: CustomerAuthLoginDependencies
): Promise<void> {
  throw new Error("14-15 login handler is not implemented")
}

export async function POST(
  _req: MedusaRequest,
  _res: MedusaResponse
): Promise<void> {
  throw new Error("14-15 login route is not implemented")
}
