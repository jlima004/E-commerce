import type {
  ComponentTypeKey,
  ComponentTypeOf,
} from "@asteasolutions/zod-to-openapi"
import type { ContractRegistryBundle } from "../registry"

export function registerSharedComponent<K extends ComponentTypeKey>(
  registry: ContractRegistryBundle,
  type: K,
  name: string,
  component: ComponentTypeOf<K>
): void {
  registry.registerComponent("shared", type, name, component)
}
