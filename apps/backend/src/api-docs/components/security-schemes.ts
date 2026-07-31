import type { ContractRegistryBundle } from "../registry"

export const STORE_PUBLISHABLE_ONLY = [
  { publishableApiKey: [] },
] as const

export const STORE_OPTIONAL_CUSTOMER = [
  { publishableApiKey: [] },
  { publishableApiKey: [], customerBearer: [] },
  { publishableApiKey: [], customerSession: [] },
] as const

export const STORE_REQUIRED_CUSTOMER = [
  { publishableApiKey: [], customerBearer: [] },
  { publishableApiKey: [], customerSession: [] },
] as const

export function registerStoreSecuritySchemes(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("store", "securitySchemes", "publishableApiKey", {
    type: "apiKey",
    in: "header",
    name: "x-publishable-api-key",
    description:
      "Medusa publishable API key required for Store namespace routes.",
  })

  registry.registerComponent("store", "securitySchemes", "customerBearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "Optional or required customer JWT bearer token, depending on the operation.",
  })

  registry.registerComponent("store", "securitySchemes", "customerSession", {
    type: "apiKey",
    in: "cookie",
    name: "connect.sid",
    description:
      "Optional or required customer session cookie, depending on the operation.",
  })
}
