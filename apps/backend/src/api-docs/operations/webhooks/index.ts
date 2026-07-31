import { registerWebhookSharedComponents } from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { registerGelatoWebhookOperation } from "./gelato"
import { registerWebhookSchemas } from "./schemas"
import { registerStripeWebhookOperation } from "./stripe"

export function registerWebhookContract(
  registry: ContractRegistryBundle
): void {
  registerWebhookSharedComponents(registry)
  registerWebhookSchemas(registry)
  registerStripeWebhookOperation(registry)
  registerGelatoWebhookOperation(registry)
}
