import type {
  ComponentTypeKey,
  ComponentTypeOf,
  ContractRegistryBundle,
} from "../registry"
import { registerStoreErrorSchemas } from "./errors"
import { registerStoreResponseHeaders } from "./headers"
import { registerStoreSecuritySchemes } from "./security-schemes"
import { registerAdminErrorSchemas } from "./errors"
import { registerAdminResponseHeaders } from "./headers"
import { registerAdminSecuritySchemes } from "./security-schemes"
import { registerWebhookErrorSchemas } from "./errors"
import { registerWebhookResponseHeaders } from "./headers"
import { registerWebhookSecuritySchemes } from "./security-schemes"

export function registerSharedComponent<K extends ComponentTypeKey>(
  registry: ContractRegistryBundle,
  type: K,
  name: string,
  component: ComponentTypeOf<K>
): void {
  registry.registerComponent("shared", type, name, component)
}

export function registerStoreSharedComponents(
  registry: ContractRegistryBundle
): void {
  registerStoreSecuritySchemes(registry)
  registerStoreResponseHeaders(registry)
  registerStoreErrorSchemas(registry)
}

export function registerAdminSharedComponents(
  registry: ContractRegistryBundle
): void {
  registerAdminSecuritySchemes(registry)
  registerAdminResponseHeaders(registry)
  registerAdminErrorSchemas(registry)
}

export function registerWebhookSharedComponents(
  registry: ContractRegistryBundle
): void {
  registerWebhookSecuritySchemes(registry)
  registerWebhookResponseHeaders(registry)
  registerWebhookErrorSchemas(registry)
}

export { storeErrorResponse } from "./errors"
export {
  adminErrorResponse,
  adminUnauthorizedResponse,
  webhookErrorResponse,
  webhookControlledOrFrameworkErrorResponse,
  webhookFrameworkErrorResponse,
} from "./errors"
export {
  STORE_X_CORRELATION_ID_RESPONSE_HEADERS,
  ADMIN_X_CORRELATION_ID_RESPONSE_HEADERS,
  WEBHOOK_X_CORRELATION_ID_RESPONSE_HEADERS,
} from "./headers"
export {
  STORE_OPTIONAL_CUSTOMER,
  STORE_PUBLISHABLE_ONLY,
  STORE_REQUIRED_CUSTOMER,
  ADMIN_NATIVE_SECURITY,
  ADMIN_USER_SECURITY,
  STRIPE_SIGNATURE_SECURITY,
  GELATO_WEBHOOK_SECRET_SECURITY,
} from "./security-schemes"
export {
  CORRELATION_ID_HEADER,
  STORE_CART_ID_PATH,
  STORE_PRODUCT_ID_PATH,
  STORE_PRODUCT_LIST_QUERY,
  STORE_PRODUCT_RETRIEVE_QUERY,
  ADMIN_PRODUCT_ID_PATH,
  ADMIN_VARIANT_ID_PATH,
  ADMIN_PRODUCT_FIELDS_QUERY,
  ADMIN_EXCHANGE_ID_PATH,
  ADMIN_OPERATIONAL_ALERT_ID_PATH,
  ADMIN_OPERATIONAL_ALERT_LIST_QUERY,
} from "./parameters"
