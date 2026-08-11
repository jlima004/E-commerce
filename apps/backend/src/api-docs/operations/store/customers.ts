import type { ContractRegistryBundle } from "../../registry"

/**
 * Store customer operations registry.
 *
 * POST /store/customers/me/cart/attach is intentionally NOT registered as a
 * public/executable Store OpenAPI operation during Phase 13 fail-closed
 * lockdown (BLOCKED→DENY). Handler + attach schemas remain as internal/
 * domain support knowledge; see ROUTE_EXCLUSIONS.
 */
export function registerStoreCustomerOperations(
  _registry: ContractRegistryBundle
): void {
  // No public Store customer operations in the current Phase 13 contract.
}
