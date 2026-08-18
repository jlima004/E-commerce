import { registerStoreSharedComponents } from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { registerStoreAuthOperations } from "./auth"
import { registerStoreCartOperations } from "./carts"
import { registerStoreCatalogOperations } from "./catalog"
import { registerStoreCustomerOperations } from "./customers"
import { registerStoreHealthOperations } from "./health"
import { registerStorePaymentAttemptOperations } from "./payment-attempts"
import { registerStoreSchemas } from "./schemas"
import { registerStoreTrackingOperations } from "./tracking"

export function registerStoreContract(
  registry: ContractRegistryBundle
): void {
  registerStoreSharedComponents(registry)
  registerStoreSchemas(registry)
  registerStoreHealthOperations(registry)
  registerStoreCatalogOperations(registry)
  registerStoreCartOperations(registry)
  registerStoreAuthOperations(registry)
  registerStoreCustomerOperations(registry)
  registerStorePaymentAttemptOperations(registry)
  registerStoreTrackingOperations(registry)
}
