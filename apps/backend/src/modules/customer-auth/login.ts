import scryptKdf from "scrypt-kdf"
import type { AuthSessionEnvelope } from "./session"
import type { CapabilityKeyring } from "./security/capabilities"
import { normalizeCustomerAuthEmail } from "./security/email-normalization"

/**
 * Matches @medusajs/auth-emailpass@2.16.0 default `hashConfig` so missing-account
 * dummy verify does equivalent scrypt work to a real provider verify.
 */
const EMAILPASS_HASH_CONFIG = { logN: 15, r: 8, p: 1 } as const

let dummyPasswordHash: Buffer | undefined

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
  keyring: CapabilityKeyring
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

export async function runEmailpassDummyScrypt(
  password: string
): Promise<void> {
  dummyPasswordHash ??= await scryptKdf.kdf(
    "customer-auth-login-dummy",
    EMAILPASS_HASH_CONFIG
  )
  await scryptKdf.verify(dummyPasswordHash, password)
}

function invalidCredentials(): CustomerLoginOutcome {
  return { kind: "invalid_credentials" }
}

function customerView(
  customer: CustomerLoginCustomerRecord,
  normalizedEmail: string
): CustomerLoginCustomerView {
  return {
    id: customer.id,
    email:
      typeof customer.email === "string" && customer.email.length > 0
        ? customer.email
        : normalizedEmail,
    firstName: String(customer.first_name ?? ""),
    lastName: String(customer.last_name ?? ""),
  }
}

export async function loginCustomer(
  input: CustomerLoginInput
): Promise<CustomerLoginOutcome> {
  const normalizedEmail = normalizeCustomerAuthEmail(input.email)
  const now = input.now ?? new Date()
  const dummyPasswordWork =
    input.dummyPasswordWork ?? runEmailpassDummyScrypt

  const identity = await input.auth.findIdentity({ normalizedEmail })
  if (!identity) {
    await dummyPasswordWork(input.password)
    return invalidCredentials()
  }

  const authenticated = await input.auth.authenticate({
    normalizedEmail,
    password: input.password,
  })
  if (!authenticated || authenticated.id !== identity.id) {
    return invalidCredentials()
  }

  const customer = await input.customer.find({
    authIdentityId: authenticated.id,
    normalizedEmail,
    authIdentity: authenticated,
  })
  if (!customer) {
    return invalidCredentials()
  }

  const credential = await input.credential.load({
    authIdentityId: authenticated.id,
    customerId: customer.id,
  })
  if (
    !credential ||
    credential.customerId !== customer.id ||
    credential.operationStatus !== "stable" ||
    !Number.isSafeInteger(credential.credentialVersion) ||
    credential.credentialVersion < 1
  ) {
    return invalidCredentials()
  }

  if (!credential.emailVerifiedAt) {
    return { kind: "email_verification_required" }
  }

  const session = await input.session.issue({
    authIdentityId: authenticated.id,
    customerId: customer.id,
    credentialVersion: credential.credentialVersion,
    now,
  })

  return {
    kind: "authenticated",
    session,
    customer: customerView(customer, normalizedEmail),
    verificationState: "verified",
  }
}
