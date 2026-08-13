export const CUSTOMER_AUTH_SCHEMA_VERSION = 1 as const

export const CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS = 24 * 60 * 60

export const REGISTRATION_INTENT_STATUSES = [
  "pending_identity",
  "pending_customer",
  "completed",
  "expired",
  "failed_reconcilable",
] as const

export type RegistrationIntentStatus =
  (typeof REGISTRATION_INTENT_STATUSES)[number]

export const REGISTRATION_INTENT_ACTIVE_STATUSES = [
  "pending_identity",
  "pending_customer",
  "failed_reconcilable",
] as const satisfies readonly RegistrationIntentStatus[]

export const AUTH_CREDENTIAL_OPERATION_TYPES = [
  "reset",
  "password_change",
] as const

export type AuthCredentialOperationType =
  (typeof AUTH_CREDENTIAL_OPERATION_TYPES)[number]

export const AUTH_CREDENTIAL_OPERATION_STATUSES = [
  "stable",
  "claimed",
  "provider_outcome_ambiguous",
  "credential_proved",
  "credential_updated",
  "revocation_pending",
  "revocation_committed",
  "completed",
] as const

export type AuthCredentialOperationStatus =
  (typeof AUTH_CREDENTIAL_OPERATION_STATUSES)[number]

