import type {
  ComponentTypeKey,
  ComponentTypeOf,
} from "@asteasolutions/zod-to-openapi"
import type { ContractRegistryBundle } from "../registry"
import { registerStoreErrorSchemas } from "./errors"
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
  registerStoreErrorSchemas(registry)
}

export { storeErrorResponse } from "./errors"
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
} from "./parameters"
