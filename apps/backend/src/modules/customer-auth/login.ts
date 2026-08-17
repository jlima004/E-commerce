import type { AuthSessionEnvelope } from "./session"

export type CustomerLoginAuthIdentity = {
  id: string
  app_metadata?: Record<string, unknown> | null
}

export type CustomerLoginCustomerRecord = {
  id: string
  email?: string
  first_name?: string | null
  last_name?: string | null
}

export type CustomerLoginCredentialRecord = {
  customerId: string
  credentialVersion: number
  emailVerifiedAt: Date | null
  operationStatus: string
}

export type CustomerLoginAuth = {
  findIdentity(input: {
    normalizedEmail: string
  }): Promise<CustomerLoginAuthIdentity | null>
  authenticate(input: {
    normalizedEmail: string
    password: string
  }): Promise<CustomerLoginAuthIdentity | null>
}

export type CustomerLoginCustomer = {
  find(input: {
    authIdentityId: string
    normalizedEmail: string
    authIdentity: CustomerLoginAuthIdentity
  }): Promise<CustomerLoginCustomerRecord | null>
}

export type CustomerLoginCredential = {
  load(input: {
    authIdentityId: string
    customerId: string
  }): Promise<CustomerLoginCredentialRecord | null>
}

export type CustomerLoginSession = {
  issue(input: {
    authIdentityId: string
    customerId: string
    credentialVersion: number
    now: Date
  }): Promise<AuthSessionEnvelope>
}

export type CustomerLoginInput = {
  email: string
  password: string
  now?: Date
  dummyPasswordWork?: (password: string) => Promise<void>
  auth: CustomerLoginAuth
  customer: CustomerLoginCustomer
  credential: CustomerLoginCredential
  session: CustomerLoginSession
  keyring: { active: { version: number; secret: string }; previous?: readonly unknown[] }
  jwtSecret: string
}

export type CustomerLoginCustomerView = {
  id: string
  email: string
  firstName: string
  lastName: string
}

export type CustomerLoginOutcome =
  | {
      kind: "authenticated"
      session: AuthSessionEnvelope
      customer: CustomerLoginCustomerView
      verificationState: "verified"
    }
  | { kind: "email_verification_required" }
  | { kind: "invalid_credentials" }

export async function loginCustomer(
  _input: CustomerLoginInput
): Promise<CustomerLoginOutcome> {
  throw new Error("14-15 loginCustomer is not implemented")
}

export async function runEmailpassDummyScrypt(
  _password: string
): Promise<void> {
  throw new Error("14-15 dummy scrypt is not implemented")
}
