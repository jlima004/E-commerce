export const CUSTOMER_AUTH_MODULE = "customer_auth"

export { default as AuthCredentialState } from "./models/auth-credential-state"
export { default as RegistrationIntent } from "./models/registration-intent"

export {
  AUTH_CREDENTIAL_OPERATION_STATUSES,
  AUTH_CREDENTIAL_OPERATION_TYPES,
  CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS,
  CUSTOMER_AUTH_SCHEMA_VERSION,
  REGISTRATION_INTENT_ACTIVE_STATUSES,
  REGISTRATION_INTENT_STATUSES,
} from "./types"

export type {
  AuthCredentialOperationStatus,
  AuthCredentialOperationType,
  RegistrationIntentStatus,
} from "./types"
