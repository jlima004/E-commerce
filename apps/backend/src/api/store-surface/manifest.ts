/**
 * Store surface manifest — single source of truth for Medusa 2.16.0 runtime
 * Store operations (FND-01 / D13-03 / D13-04).
 *
 * Classification authority: 13-RESEARCH.md §5 matrix (rows 1–58).
 * runtime_policy is decided per-route; never inferred from classification alone
 * except the mandatory BLOCKED → DENY rule.
 */

export const STORE_SURFACE_MEDUSA_VERSION = "2.16.0" as const

export const STORE_SURFACE_CLASSIFICATIONS = [
  "AUTHORIZED",
  "EXTENDED",
  "BLOCKED",
  "OUTSIDE_FRONTEND_M1",
] as const

export const STORE_SURFACE_RUNTIME_POLICIES = [
  "DENY",
  "PRESERVE_LEGACY",
  "M1_ENABLED",
] as const

export const STORE_SURFACE_M1_ENABLEMENTS = ["disabled", "enabled"] as const

export const STORE_SURFACE_OPENAPI_M1_EXPECTATIONS = [
  "include_executable_m1",
  "exclude",
  "support_only",
] as const

export const STORE_SURFACE_ORIGINS = [
  "native",
  "local",
  "native+local_extension",
] as const

export type StoreSurfaceClassification =
  (typeof STORE_SURFACE_CLASSIFICATIONS)[number]
export type StoreSurfaceRuntimePolicy =
  (typeof STORE_SURFACE_RUNTIME_POLICIES)[number]
export type StoreSurfaceM1Enablement =
  (typeof STORE_SURFACE_M1_ENABLEMENTS)[number]
export type StoreSurfaceOpenApiM1Expectation =
  (typeof STORE_SURFACE_OPENAPI_M1_EXPECTATIONS)[number]
export type StoreSurfaceOrigin = (typeof STORE_SURFACE_ORIGINS)[number]
export type StoreSurfaceHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "HEAD"

export type StoreSurfaceEntry = {
  method: StoreSurfaceHttpMethod
  pathTemplate: string
  origin: StoreSurfaceOrigin
  medusaVersion: typeof STORE_SURFACE_MEDUSA_VERSION
  classification: StoreSurfaceClassification
  runtime_policy: StoreSurfaceRuntimePolicy
  m1_enablement: StoreSurfaceM1Enablement
  openapi_m1_expectation: StoreSurfaceOpenApiM1Expectation
  rationale: string
  owner_phase?: string
  owner_domain?: string
}

function entry(
  partial: Omit<StoreSurfaceEntry, "medusaVersion" | "m1_enablement"> & {
    m1_enablement?: StoreSurfaceM1Enablement
  }
): StoreSurfaceEntry {
  return {
    ...partial,
    medusaVersion: STORE_SURFACE_MEDUSA_VERSION,
    m1_enablement: partial.m1_enablement ?? "disabled",
  }
}

/**
 * Closed 63-operation inventory. Order follows RESEARCH §5 row numbers,
 * followed by the Phase 14 verification contracts and password change.
 */
export const STORE_SURFACE_MANIFEST: readonly StoreSurfaceEntry[] = [
  entry({
    method: "POST",
    pathTemplate: "/store/carts",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Native cart create bypasses active-cart capability and idempotency; BLOCKED→DENY.",
    owner_domain: "cart",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/carts/{id}",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Direct cart ID read lacks guest ownership/capability; BLOCKED→DENY.",
    owner_domain: "cart",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/{id}",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Native cart mutation lacks capability/If-Match contract; BLOCKED→DENY.",
    owner_domain: "cart",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/{id}/complete",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Creates Order directly and violates webhook-only Order birth; BLOCKED→DENY.",
    owner_domain: "checkout",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/{id}/customer",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Alternate attach/merge path without approved merge contract; BLOCKED→DENY.",
    owner_domain: "cart",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/{id}/line-items",
    origin: "native",
    classification: "EXTENDED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Cart M1 candidate requiring capability, idempotency key, If-Match and DTO; not v1.0 Store OpenAPI accepted — DENY until owner phase enables.",
    owner_phase: "15",
    owner_domain: "cart",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/{id}/line-items/{line_id}",
    origin: "native",
    classification: "EXTENDED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Cart M1 line update candidate; no v1.0 Store OpenAPI acceptance — DENY pending Phase 15 hardening.",
    owner_phase: "15",
    owner_domain: "cart",
  }),
  entry({
    method: "DELETE",
    pathTemplate: "/store/carts/{id}/line-items/{line_id}",
    origin: "native",
    classification: "EXTENDED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Destructive cart M1 candidate without automatic retry contract; DENY until Phase 15.",
    owner_phase: "15",
    owner_domain: "cart",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/{id}/promotions",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Promotion mutation outside Frontend M1 and not in Store 1.0.0 acceptance — DENY.",
    owner_domain: "promotions",
  }),
  entry({
    method: "DELETE",
    pathTemplate: "/store/carts/{id}/promotions",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Promotion removal outside Frontend M1 and not v1.0 accepted — DENY.",
    owner_domain: "promotions",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/{id}/shipping-methods",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Bypasses approved quote/select shipping flow; BLOCKED→DENY.",
    owner_domain: "shipping",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/{id}/taxes",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Public tax recalculation not contracted for M1 and not v1.0 accepted — DENY.",
    owner_domain: "taxes",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/collections",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Catalog expansion surface outside Frontend M1; no Store 1.0.0 acceptance — DENY.",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/collections/{id}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Collection detail outside Frontend M1; no Store 1.0.0 acceptance — DENY.",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/currencies",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Multi-currency surface conflicts with BRL single-currency scope — DENY.",
    owner_domain: "currency",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/currencies/{code}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Currency detail exposes multi-currency API; BRL-only market — DENY.",
    owner_domain: "currency",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/customers",
    origin: "native",
    classification: "EXTENDED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Auth/register M1 candidate; Phase 14 must restrict contract — DENY until enabled.",
    owner_phase: "14",
    owner_domain: "auth",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/customers/me",
    origin: "native",
    classification: "EXTENDED",
    runtime_policy: "M1_ENABLED",
    m1_enablement: "enabled",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Phase 14 current auth/customer state; PostgreSQL access guard and allowlisted DTO are mandatory.",
    owner_phase: "14",
    owner_domain: "auth",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/customers/me",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Profile update not contracted for Frontend M1 and not v1.0 accepted — DENY.",
    owner_domain: "account",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/customers/me/addresses",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Address PII listing outside Frontend M1 contract — DENY.",
    owner_domain: "account",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/customers/me/addresses",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Address create mutates PII outside M1 contract — DENY.",
    owner_domain: "account",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/customers/me/addresses/{address_id}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Address detail enables PII enumeration outside M1 — DENY.",
    owner_domain: "account",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/customers/me/addresses/{address_id}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Address update outside Frontend M1 — DENY.",
    owner_domain: "account",
  }),
  entry({
    method: "DELETE",
    pathTemplate: "/store/customers/me/addresses/{address_id}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Destructive address delete outside Frontend M1 — DENY.",
    owner_domain: "account",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/locales",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Locale discovery surface not required for BR M1 — DENY.",
    owner_domain: "i18n",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/orders",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Order list DTO/ownership belong to later phases; not v1.0 Store accepted — DENY.",
    owner_domain: "orders",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/orders/{id}",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Order ID lookup lacks adequate ownership controls; BLOCKED→DENY.",
    owner_domain: "orders",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/orders/{id}/transfer/accept",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Order transfer accept is an alternate capability prohibited for M1; BLOCKED→DENY.",
    owner_domain: "orders",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/orders/{id}/transfer/cancel",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Order transfer cancel prohibited for M1; BLOCKED→DENY.",
    owner_domain: "orders",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/orders/{id}/transfer/decline",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Order transfer decline prohibited for M1; BLOCKED→DENY.",
    owner_domain: "orders",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/orders/{id}/transfer/request",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Order transfer request prohibited for M1; BLOCKED→DENY.",
    owner_domain: "orders",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/payment-collections",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Bypasses PaymentAttempt initiation contract; BLOCKED→DENY.",
    owner_domain: "payment",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/payment-collections/{id}/payment-sessions",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Native payment-session create bypasses PaymentAttempt; BLOCKED→DENY.",
    owner_domain: "payment",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/payment-providers",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Provider discovery exposes infrastructure outside M1; not v1.0 accepted — DENY.",
    owner_domain: "payment",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/product-categories",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Category catalog outside contracted Frontend M1 surface — DENY.",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/product-categories/{id}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Category detail outside Frontend M1 — DENY.",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/product-tags",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Product tags outside Frontend M1 catalog contract — DENY.",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/product-tags/{id}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Product tag detail outside Frontend M1 — DENY.",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/product-types",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Product types outside Frontend M1 — DENY.",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/product-types/{id}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Product type detail outside Frontend M1 — DENY.",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/product-variants",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Variant list bypasses product serializer allowlist — DENY.",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/product-variants/{id}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Variant detail bypasses product serializer allowlist — DENY.",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/products",
    origin: "native+local_extension",
    classification: "EXTENDED",
    runtime_policy: "PRESERVE_LEGACY",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Store 1.0.0 accepted catalog list with local field allowlist/serializer; preserve v1.0 behavior only (not M1 auth).",
    owner_phase: "21",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/products/{id}",
    origin: "native+local_extension",
    classification: "EXTENDED",
    runtime_policy: "PRESERVE_LEGACY",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Store 1.0.0 accepted product detail with local serializer; preserve v1.0 behavior only.",
    owner_phase: "21",
    owner_domain: "catalog",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/regions",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Generic regional surface; market is single BR region — DENY.",
    owner_domain: "region",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/regions/{id}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Region detail not required for single-region BR scope — DENY.",
    owner_domain: "region",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/return-reasons",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Return-reason listing is Admin operational flow — DENY on Store.",
    owner_domain: "returns",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/return-reasons/{id}",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Return-reason detail is Admin operational — DENY on Store.",
    owner_domain: "returns",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/returns",
    origin: "native",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Store-created returns bypass Admin operational path — DENY.",
    owner_domain: "returns",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/shipping-options",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Bypasses contextual shipping quote ownership/TTL; BLOCKED→DENY.",
    owner_domain: "shipping",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/shipping-options/{id}/calculate",
    origin: "native",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Bypasses quote/TTL/ownership shipping contract; BLOCKED→DENY.",
    owner_domain: "shipping",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/carts/active",
    origin: "local",
    classification: "EXTENDED",
    runtime_policy: "PRESERVE_LEGACY",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Store 1.0.0 accepted active cart read; preserve v1.0 only until Phase 15 capability/version hardening.",
    owner_phase: "15",
    owner_domain: "cart",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/active",
    origin: "local",
    classification: "EXTENDED",
    runtime_policy: "PRESERVE_LEGACY",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Store 1.0.0 accepted active cart create/resolve; preserve v1.0 only (no M1 capability upgrade).",
    owner_phase: "15",
    owner_domain: "cart",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/customers/me/cart/attach",
    origin: "local",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Had Store 1.0.0 exposure but merge contract is blocked pending new merge/review; BLOCKED→DENY.",
    owner_domain: "cart",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/{id}/payment-attempts/card",
    origin: "local",
    classification: "EXTENDED",
    runtime_policy: "PRESERVE_LEGACY",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Store 1.0.0 accepted card PaymentAttempt initiation; preserve v1.0 only until Phase 19 hardening.",
    owner_phase: "19",
    owner_domain: "payment",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/carts/{id}/payment-attempts/pix",
    origin: "local",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "PRESERVE_LEGACY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Store 1.0.0 accepted Pix initiation retained as inherited backend behavior; Pix is outside Frontend M1 contract.",
    owner_domain: "payment",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/tracking/lookup",
    origin: "local",
    classification: "OUTSIDE_FRONTEND_M1",
    runtime_policy: "PRESERVE_LEGACY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Store 1.0.0 accepted tracking lookup retained as legacy; outside Frontend M1 with its own limiter/capability.",
    owner_domain: "tracking",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/custom",
    origin: "local",
    classification: "BLOCKED",
    runtime_policy: "DENY",
    openapi_m1_expectation: "exclude",
    rationale:
      "Public scaffold route returns 200 without product contract; BLOCKED→DENY.",
    owner_domain: "scaffold",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/customers/me/verify",
    origin: "local",
    classification: "EXTENDED",
    runtime_policy: "M1_ENABLED",
    m1_enablement: "enabled",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Phase 14 authenticated email-verification request; PostgreSQL access guard and verification-request limiter are mandatory.",
    owner_phase: "14",
    owner_domain: "auth",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/customers/verify/resend",
    origin: "local",
    classification: "EXTENDED",
    runtime_policy: "M1_ENABLED",
    m1_enablement: "enabled",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Phase 14 public resend contract with normalized input, anti-enumeration envelope and absorb-on-failure limiter policy.",
    owner_phase: "14",
    owner_domain: "auth",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/customers/verify",
    origin: "local",
    classification: "EXTENDED",
    runtime_policy: "M1_ENABLED",
    m1_enablement: "enabled",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Phase 14 public capability confirmation; hash-only verification and no session or Order side effects.",
    owner_phase: "14",
    owner_domain: "auth",
  }),
  entry({
    method: "GET",
    pathTemplate: "/store/customers/me/verify/status",
    origin: "local",
    classification: "EXTENDED",
    runtime_policy: "M1_ENABLED",
    m1_enablement: "enabled",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Phase 14 authenticated sanitized verification status DTO behind the PostgreSQL access guard.",
    owner_phase: "14",
    owner_domain: "auth",
  }),
  entry({
    method: "POST",
    pathTemplate: "/store/customers/me/password",
    origin: "local",
    classification: "EXTENDED",
    runtime_policy: "M1_ENABLED",
    m1_enablement: "enabled",
    openapi_m1_expectation: "include_executable_m1",
    rationale:
      "Phase 14 authenticated password change behind the BFF service guard and stable-or-resume handler.",
    owner_phase: "14",
    owner_domain: "auth",
  }),
] as const satisfies readonly StoreSurfaceEntry[]

export const STORE_SURFACE_PHASE14_VERIFICATION_OPERATIONS = [
  "POST /store/customers/me/verify",
  "POST /store/customers/verify/resend",
  "POST /store/customers/verify",
  "GET /store/customers/me/verify/status",
] as const

export const STORE_SURFACE_PHASE14_ENABLED_OPERATIONS = [
  "GET /store/customers/me",
  ...STORE_SURFACE_PHASE14_VERIFICATION_OPERATIONS,
  "POST /store/customers/me/password",
] as const

export function storeSurfaceOperationKey(
  method: string,
  pathTemplate: string
): string {
  return `${method.toUpperCase()} ${pathTemplate}`
}

export type StoreSurfaceManifestCounts = {
  total: number
  native: number
  local: number
  nativeLocalExtension: number
  authorized: number
  extended: number
  blocked: number
  outsideFrontendM1: number
  deny: number
  preserveLegacy: number
  m1EnabledPolicy: number
  m1EnablementEnabled: number
  duplicates: string[]
}

export function summarizeStoreSurfaceManifest(
  entries: readonly StoreSurfaceEntry[] = STORE_SURFACE_MANIFEST
): StoreSurfaceManifestCounts {
  const seen = new Map<string, number>()
  const duplicates: string[] = []

  let native = 0
  let local = 0
  let nativeLocalExtension = 0
  let authorized = 0
  let extended = 0
  let blocked = 0
  let outsideFrontendM1 = 0
  let deny = 0
  let preserveLegacy = 0
  let m1EnabledPolicy = 0
  let m1EnablementEnabled = 0

  for (const item of entries) {
    const key = storeSurfaceOperationKey(item.method, item.pathTemplate)
    const prior = seen.get(key) ?? 0
    seen.set(key, prior + 1)
    if (prior === 1) {
      duplicates.push(key)
    }

    if (item.origin === "native") native += 1
    else if (item.origin === "local") local += 1
    else nativeLocalExtension += 1

    if (item.classification === "AUTHORIZED") authorized += 1
    else if (item.classification === "EXTENDED") extended += 1
    else if (item.classification === "BLOCKED") blocked += 1
    else outsideFrontendM1 += 1

    if (item.runtime_policy === "DENY") deny += 1
    else if (item.runtime_policy === "PRESERVE_LEGACY") preserveLegacy += 1
    else m1EnabledPolicy += 1

    if (item.m1_enablement === "enabled") m1EnablementEnabled += 1
  }

  return {
    total: entries.length,
    native,
    local,
    nativeLocalExtension,
    authorized,
    extended,
    blocked,
    outsideFrontendM1,
    deny,
    preserveLegacy,
    m1EnabledPolicy,
    m1EnablementEnabled,
    duplicates,
  }
}

export type StoreSurfaceManifestViolation = {
  code: string
  message: string
  key?: string
}

export function validateStoreSurfaceManifest(
  entries: readonly StoreSurfaceEntry[] = STORE_SURFACE_MANIFEST
): StoreSurfaceManifestViolation[] {
  const violations: StoreSurfaceManifestViolation[] = []
  const counts = summarizeStoreSurfaceManifest(entries)

  if (counts.total !== 63) {
    violations.push({
      code: "COUNT_TOTAL",
      message: `expected 63 entries, found ${counts.total}`,
    })
  }
  if (counts.authorized !== 0) {
    violations.push({
      code: "COUNT_AUTHORIZED",
      message: `expected AUTHORIZED=0, found ${counts.authorized}`,
    })
  }
  if (counts.extended !== 15) {
    violations.push({
      code: "COUNT_EXTENDED",
      message: `expected EXTENDED=15, found ${counts.extended}`,
    })
  }
  if (counts.blocked !== 17) {
    violations.push({
      code: "COUNT_BLOCKED",
      message: `expected BLOCKED=17, found ${counts.blocked}`,
    })
  }
  if (counts.outsideFrontendM1 !== 31) {
    violations.push({
      code: "COUNT_OUTSIDE",
      message: `expected OUTSIDE_FRONTEND_M1=31, found ${counts.outsideFrontendM1}`,
    })
  }
  if (counts.m1EnabledPolicy !== 6) {
    violations.push({
      code: "M1_ENABLED_POLICY",
      message: `Phase 14 requires exactly six M1_ENABLED entries; found ${counts.m1EnabledPolicy}`,
    })
  }
  if (counts.m1EnablementEnabled !== 6) {
    violations.push({
      code: "M1_ENABLEMENT_ENABLED",
      message: `Phase 14 requires exactly six enablements; found ${counts.m1EnablementEnabled}`,
    })
  }
  if (counts.deny + counts.preserveLegacy + counts.m1EnabledPolicy !== counts.total) {
    violations.push({
      code: "POLICY_SUM",
      message: `DENY+PRESERVE_LEGACY+M1_ENABLED must equal total (${counts.deny}+${counts.preserveLegacy}+${counts.m1EnabledPolicy}!=${counts.total})`,
    })
  }
  if (counts.duplicates.length > 0) {
    violations.push({
      code: "DUPLICATE",
      message: `duplicate operation keys: ${counts.duplicates.join(", ")}`,
    })
  }

  for (const item of entries) {
    const key = storeSurfaceOperationKey(item.method, item.pathTemplate)

    if (item.medusaVersion !== STORE_SURFACE_MEDUSA_VERSION) {
      violations.push({
        code: "MEDUSA_VERSION",
        key,
        message: `medusaVersion must be ${STORE_SURFACE_MEDUSA_VERSION}`,
      })
    }
    if (!item.pathTemplate.startsWith("/store/")) {
      violations.push({
        code: "PATH_PREFIX",
        key,
        message: "pathTemplate must start with /store/",
      })
    }
    if (!item.rationale || item.rationale.trim().length === 0) {
      violations.push({
        code: "RATIONALE_REQUIRED",
        key,
        message: "rationale must be non-empty",
      })
    }
    if (
      item.classification === "BLOCKED" &&
      item.runtime_policy !== "DENY"
    ) {
      violations.push({
        code: "BLOCKED_MUST_DENY",
        key,
        message: "BLOCKED requires runtime_policy DENY",
      })
    }
    if (
      item.runtime_policy === "M1_ENABLED" &&
      item.m1_enablement !== "enabled"
    ) {
      violations.push({
        code: "M1_POLICY_WITHOUT_ENABLEMENT",
        key,
        message: "M1_ENABLED policy requires m1_enablement enabled",
      })
    }
    if (
      item.m1_enablement === "enabled" &&
      item.runtime_policy === "PRESERVE_LEGACY"
    ) {
      violations.push({
        code: "PRESERVE_LEGACY_NOT_M1",
        key,
        message: "PRESERVE_LEGACY cannot combine with m1_enablement enabled",
      })
    }
    if (
      item.runtime_policy === "PRESERVE_LEGACY" &&
      item.openapi_m1_expectation === "include_executable_m1" &&
      item.m1_enablement === "enabled"
    ) {
      violations.push({
        code: "PRESERVE_LEGACY_NOT_EXECUTABLE_M1",
        key,
        message:
          "PRESERVE_LEGACY must not be treated as executable M1 while enabled",
      })
    }
    if (
      !(STORE_SURFACE_CLASSIFICATIONS as readonly string[]).includes(
        item.classification
      )
    ) {
      violations.push({
        code: "UNKNOWN_CLASSIFICATION",
        key,
        message: `invalid classification ${String(item.classification)}`,
      })
    }
    if (
      !(STORE_SURFACE_RUNTIME_POLICIES as readonly string[]).includes(
        item.runtime_policy
      )
    ) {
      violations.push({
        code: "UNKNOWN_RUNTIME_POLICY",
        key,
        message: `invalid runtime_policy ${String(item.runtime_policy)}`,
      })
    }
  }

  const enabledOperations = entries
    .filter((item) => item.runtime_policy === "M1_ENABLED")
    .map((item) => storeSurfaceOperationKey(item.method, item.pathTemplate))
  if (
    enabledOperations.length !==
      STORE_SURFACE_PHASE14_ENABLED_OPERATIONS.length ||
    enabledOperations.some(
      (operation, index) =>
        operation !== STORE_SURFACE_PHASE14_ENABLED_OPERATIONS[index]
    )
  ) {
    violations.push({
      code: "PHASE14_EXACT_SURFACE",
      message:
        "M1_ENABLED must contain exactly GET /store/customers/me, the four Phase 14 verification operations, and POST /store/customers/me/password",
    })
  }

  return violations
}

export function lookupStoreSurfaceEntry(
  method: string,
  pathTemplate: string,
  entries: readonly StoreSurfaceEntry[] = STORE_SURFACE_MANIFEST
): StoreSurfaceEntry | undefined {
  const key = storeSurfaceOperationKey(method, pathTemplate)
  return entries.find(
    (item) =>
      storeSurfaceOperationKey(item.method, item.pathTemplate) === key
  )
}
