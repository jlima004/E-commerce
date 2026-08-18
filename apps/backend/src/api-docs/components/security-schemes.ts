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

export const STORE_AUTH_PUBLIC_BFF = STORE_PUBLISHABLE_ONLY

export const STORE_AUTH_ACCESS_BEARER = [
  { publishableApiKey: [], customerBearer: [] },
] as const

export const STORE_AUTH_PUBLIC_BFF_NO_SESSION_NOTE =
  "Same-origin Next.js BFF to Medusa using the publishable store key only. The browser is not an authorized Medusa client and never calls this contract directly. No customer session or access bearer is presented or minted."

export const STORE_AUTH_SECURITY_BY_REQUIREMENT = {
  public_bff: STORE_AUTH_PUBLIC_BFF,
  public_bff_no_session: STORE_AUTH_PUBLIC_BFF,
  access_bearer: STORE_AUTH_ACCESS_BEARER,
  refresh_header_and_idempotency_key: STORE_AUTH_PUBLIC_BFF,
  capability_and_idempotency_key: STORE_AUTH_PUBLIC_BFF,
  access_bearer_and_idempotency_key: STORE_AUTH_ACCESS_BEARER,
} as const

export const STORE_AUTH_HEADERS_BY_REQUIREMENT = {
  public_bff: [] as const,
  public_bff_no_session: [] as const,
  access_bearer: [] as const,
  refresh_header_and_idempotency_key: [
    "x-indicio-refresh-token",
    "Idempotency-Key",
  ] as const,
  capability_and_idempotency_key: ["Idempotency-Key"] as const,
  access_bearer_and_idempotency_key: ["Idempotency-Key"] as const,
} as const

export const STORE_AUTH_REFRESH_HEADER_PARAMETER = {
  name: "x-indicio-refresh-token",
  in: "header" as const,
  required: true,
  schema: {
    type: "string",
    minLength: 1,
  },
  description:
    "Opaque refresh capability presented only on the same-origin Next.js BFF to Medusa hop. It is not a user/browser credential, never a Swagger Try-It-Out field, and not authorization for direct browser access to Medusa. Examples are omitted. Swagger remains non-interactive.",
  "x-bff-only": true,
  "x-not-browser-credential": true,
} as const

export const STORE_AUTH_REFRESH_HEADER_REF = {
  $ref: "#/components/parameters/XIndicioRefreshToken",
} as const

export const STORE_AUTH_IDEMPOTENCY_KEY_REF = {
  $ref: "#/components/parameters/IdempotencyKey",
} as const

export function registerStoreSecuritySchemes(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("store", "securitySchemes", "publishableApiKey", {
    type: "apiKey",
    in: "header",
    name: "x-publishable-api-key",
    description:
      "Server-to-server credential assembled only by the same-origin Next.js BFF for Medusa Store API calls. The browser is not an authorized direct Medusa client and never receives this key as a Medusa credential.",
  })

  registry.registerComponent("store", "securitySchemes", "customerBearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "Optional or required customer JWT used only on the server-to-server BFF to Medusa hop. The same-origin BFF keeps it server-side; the browser is not authorized to call Medusa directly with it.",
  })

  registry.registerComponent("store", "securitySchemes", "customerSession", {
    type: "apiKey",
    in: "cookie",
    name: "connect.sid",
    description:
      "Optional or required Medusa customer session assembled by the same-origin BFF for server-to-server use. It is not a browser credential for direct Medusa access; guest and confirmation capabilities likewise remain server-side.",
  })

  registry.registerComponent(
    "store",
    "parameters",
    "XIndicioRefreshToken",
    STORE_AUTH_REFRESH_HEADER_PARAMETER
  )
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

export const STRIPE_SIGNATURE_SECURITY = [
  { stripeSignature: [] },
] as const

export const GELATO_WEBHOOK_SECRET_SECURITY = [
  { gelatoWebhookSecret: [] },
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

export function registerWebhookSecuritySchemes(
  registry: ContractRegistryBundle
): void {
  registry.registerComponent("webhooks", "securitySchemes", "stripeSignature", {
    type: "apiKey",
    in: "header",
    name: "stripe-signature",
    description:
      "Stripe signature header used to verify the exact preserved request bytes before provider event processing.",
  })

  registry.registerComponent("webhooks", "securitySchemes", "gelatoWebhookSecret", {
    type: "apiKey",
    in: "header",
    name: "x-gelato-webhook-secret",
    description:
      "Shared secret in the canonical Gelato webhook authentication header.",
  })
}
