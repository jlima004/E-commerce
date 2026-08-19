export const CUSTOMER_AUTH_MODULE = "customer_auth"

export { default as AuthCredentialState } from "./models/auth-credential-state"
export { default as AuthRefreshCredential } from "./models/auth-refresh-credential"
export { default as AuthSessionLineage } from "./models/auth-session-lineage"
export { default as RegistrationIntent } from "./models/registration-intent"

export {
  AUTH_CREDENTIAL_OPERATION_STATUSES,
  AUTH_CREDENTIAL_OPERATION_TYPES,
  AUTH_REFRESH_CREDENTIAL_STATUSES,
  AUTH_REFRESH_INACTIVITY_TTL_SECONDS,
  AUTH_REFRESH_RECOVERY_SECONDS,
  AUTH_SESSION_ABSOLUTE_TTL_SECONDS,
  AUTH_SESSION_LINEAGE_STATUSES,
  AUTH_SESSION_REVOCATION_REASONS,
  CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS,
  CUSTOMER_AUTH_SCHEMA_VERSION,
  REGISTRATION_INTENT_ACTIVE_STATUSES,
  REGISTRATION_INTENT_STATUSES,
} from "./types"

export type {
  AuthCredentialOperationStatus,
  AuthCredentialOperationType,
  AuthRefreshCredentialStatus,
  AuthSessionLineageStatus,
  AuthSessionRevocationReason,
  RegistrationIntentStatus,
} from "./types"
