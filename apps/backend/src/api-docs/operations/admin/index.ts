import { registerAdminSharedComponents } from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { registerAdminExchangeOperations } from "./exchanges"
import { registerAdminOperationalAlertOperations } from "./operational-alerts"
import { registerAdminProductOperations } from "./products"
import { registerAdminRefundOperations } from "./refunds"
import { registerAdminSchemas } from "./schemas"

export function registerAdminContract(
  registry: ContractRegistryBundle
): void {
  registerAdminSharedComponents(registry)
  registerAdminSchemas(registry)
  registerAdminProductOperations(registry)
  registerAdminRefundOperations(registry)
  registerAdminExchangeOperations(registry)
  registerAdminOperationalAlertOperations(registry)
}
