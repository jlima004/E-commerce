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

export const ADMIN_NATIVE_SECURITY = [
  { adminBearer: [] },
  { adminSession: [] },
  { adminApiKey: [] },
] as const

export const ADMIN_USER_SECURITY = [
  { adminBearer: [] },
  { adminSession: [] },
] as const

export function registerAdminSecuritySchemes(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("admin", "securitySchemes", "adminBearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Authenticated Medusa Admin user JWT bearer token.",
  })

  registry.registerComponent("admin", "securitySchemes", "adminSession", {
    type: "apiKey",
    in: "cookie",
    name: "connect.sid",
    description: "Authenticated Medusa Admin user session cookie.",
  })

  registry.registerComponent("admin", "securitySchemes", "adminApiKey", {
    type: "http",
    scheme: "basic",
    description:
      "Medusa secret Admin API key supplied as the HTTP Basic username. Accepted only by native Admin operations; project user-only operations reject API-key actors.",
  })
}
