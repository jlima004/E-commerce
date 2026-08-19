import { createHmac } from "node:crypto"

export const AUTH_TEST_HARNESS_FORBIDDEN = "AUTH_TEST_HARNESS_FORBIDDEN"

export const AUTH_FAULT_POINTS = {
  IDENTITY_TO_CUSTOMER: "identity_to_customer",
  REFRESH_COMMIT_TO_RESPONSE: "refresh_commit_to_response",
  PASSWORD_UPDATE_TO_REVOCATION: "password_update_to_revocation",
  PASSWORD_PROOF_TO_REVOKE: "password_proof_to_revoke",
} as const

export type AuthFaultPointId =
  (typeof AUTH_FAULT_POINTS)[keyof typeof AUTH_FAULT_POINTS]

export type AuthFaultInjectorInput = {
  seed?: string
  enabled?: readonly AuthFaultPointId[]
}

export type AuthFaultEvent = {
  fired: boolean
  id: AuthFaultPointId
  fingerprint: string
}

export type AuthFaultInjector = {
  enable(id: AuthFaultPointId): void
  disable(id: AuthFaultPointId): void
  isEnabled(id: AuthFaultPointId): boolean
  fire(id: AuthFaultPointId): AuthFaultEvent
}

type AuthTestHarnessError = Error & { code: string }

function assertAuthTestHarnessAllowed(): void {
  if (process.env.NODE_ENV !== "test") {
    const error = new Error(AUTH_TEST_HARNESS_FORBIDDEN) as AuthTestHarnessError
    error.code = AUTH_TEST_HARNESS_FORBIDDEN
    throw error
  }
}

assertAuthTestHarnessAllowed()

function deriveFingerprint(seed: string, id: AuthFaultPointId): string {
  return createHmac("sha256", seed)
    .update(`auth-fault:${id}`)
    .digest("hex")
}

export function createAuthFaultInjector(
  input: AuthFaultInjectorInput = {}
): AuthFaultInjector {
  const seed = input.seed ?? "auth-fault-default-seed"
  const enabled = new Set<AuthFaultPointId>(input.enabled ?? [])

  return {
    enable(id: AuthFaultPointId): void {
      enabled.add(id)
    },
    disable(id: AuthFaultPointId): void {
      enabled.delete(id)
    },
    isEnabled(id: AuthFaultPointId): boolean {
      return enabled.has(id)
    },
    fire(id: AuthFaultPointId): AuthFaultEvent {
      return {
        fired: enabled.has(id),
        id,
        fingerprint: deriveFingerprint(seed, id),
      }
    },
  }
}
