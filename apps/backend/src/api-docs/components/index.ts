import type {
  ComponentTypeKey,
  ComponentTypeOf,
} from "@asteasolutions/zod-to-openapi"
import type { ContractRegistryBundle } from "../registry"
import { registerStoreErrorSchemas } from "./errors"
import { registerStoreResponseHeaders } from "./headers"
import { registerStoreSecuritySchemes } from "./security-schemes"

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

export { storeErrorResponse } from "./errors"
export {
  STORE_X_CORRELATION_ID_RESPONSE_HEADERS,
} from "./headers"
export {
  STORE_OPTIONAL_CUSTOMER,
  STORE_PUBLISHABLE_ONLY,
  STORE_REQUIRED_CUSTOMER,
} from "./security-schemes"
export {
  CORRELATION_ID_HEADER,
  STORE_CART_ID_PATH,
  STORE_PRODUCT_ID_PATH,
  STORE_PRODUCT_LIST_QUERY,
  STORE_PRODUCT_RETRIEVE_QUERY,
} from "./parameters"
