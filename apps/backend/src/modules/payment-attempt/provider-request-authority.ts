import { createHash } from "crypto"
import {
  PROVIDER_IDEMPOTENCY_KEY_METADATA_KEY,
  STRIPE_PAYMENT_INTENT_CREATE_METADATA_KEY,
  STRIPE_PAYMENT_INTENT_CREATE_SCHEMA,
  STRIPE_PAYMENT_INTENT_CREATE_VERSION,
} from "./pre-provider-arbitration"
import { buildPaymentAttemptProviderIdempotencyKey } from "./durable-initiation"
import type { StripePaymentIntentLike } from "./stripe-safe"
import type { PaymentMethodType } from "./types"

export const DEFAULT_PIX_EXPIRES_AFTER_SECONDS = 86_400

export const PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE =
  "PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE"
export const PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH =
  "PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH"
export const PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE =
  "PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE"

export const STRIPE_PAYMENT_INTENT_CREATE_OPERATION =
  "stripe_payment_intent_create" as const
export const STRIPE_PAYMENT_INTENT_CREATE_PROVIDER = "stripe" as const

export type StripeCanonicalPaymentIntentCreateRequest = {
  amount: number
  currency: "brl"
  payment_method_types: ["card"] | ["pix"]
  capture_method: "automatic"
  confirm?: true
  payment_method_data?: { type: "pix" }
  payment_method_options?: { pix: { expires_after_seconds: number } }
  metadata: {
    cart_id: string
    payment_attempt_id: string
    session_id?: string
  }
}

export type StripePaymentIntentCreateAuthorityV1 = {
  schema: typeof STRIPE_PAYMENT_INTENT_CREATE_SCHEMA
  version: typeof STRIPE_PAYMENT_INTENT_CREATE_VERSION
  operation: typeof STRIPE_PAYMENT_INTENT_CREATE_OPERATION
  provider: typeof STRIPE_PAYMENT_INTENT_CREATE_PROVIDER
  authority_created_at: string
  payment_method_type: PaymentMethodType
  amount_minor: number
  currency_code: "brl"
  cart_id: string
  cart_resource_version: number
  payment_attempt_id: string
  payment_collection_id: string | null
  payment_session_id: string | null
  idempotency_key: string
  provider_payment_intent_id: string | null
  payment_method_options?: { pix: { expires_after_seconds: number } }
  canonical_request: StripeCanonicalPaymentIntentCreateRequest
  request_digest: string
  replay_deadline: string
}

export type BuildStripeCanonicalPaymentIntentCreateRequestInput = {
  payment_method_type: PaymentMethodType
  amount_minor: number
  cart_id: string
  payment_attempt_id: string
  payment_session_id?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isSafePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function readNullableText(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return undefined
}

export function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "null"
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`
}

export function digestCanonicalJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex")
}

export function buildStripeCanonicalPaymentIntentCreateRequest(
  input: BuildStripeCanonicalPaymentIntentCreateRequestInput
): StripeCanonicalPaymentIntentCreateRequest {
  const sessionId =
    typeof input.payment_session_id === "string" &&
    input.payment_session_id.trim().length > 0
      ? input.payment_session_id.trim()
      : undefined

  const metadata: StripeCanonicalPaymentIntentCreateRequest["metadata"] = {
    cart_id: input.cart_id,
    payment_attempt_id: input.payment_attempt_id,
    ...(sessionId ? { session_id: sessionId } : {}),
  }

  if (input.payment_method_type === "pix") {
    return {
      amount: input.amount_minor,
      currency: "brl",
      payment_method_types: ["pix"],
      capture_method: "automatic",
      confirm: true,
      payment_method_data: { type: "pix" },
      payment_method_options: {
        pix: { expires_after_seconds: DEFAULT_PIX_EXPIRES_AFTER_SECONDS },
      },
      metadata,
    }
  }

  return {
    amount: input.amount_minor,
    currency: "brl",
    payment_method_types: ["card"],
    capture_method: "automatic",
    metadata,
  }
}

export function digestStripeCanonicalPaymentIntentCreateRequest(
  canonicalRequest: StripeCanonicalPaymentIntentCreateRequest
): string {
  return digestCanonicalJson(canonicalRequest)
}

export function canonicalPaymentIntentCreateRequestsEqual(
  left: StripeCanonicalPaymentIntentCreateRequest,
  right: StripeCanonicalPaymentIntentCreateRequest
): boolean {
  return stableStringify(left) === stableStringify(right)
}

export function assertCanonicalRequestMatchesRebuild(
  persisted: StripeCanonicalPaymentIntentCreateRequest,
  rebuildInput: BuildStripeCanonicalPaymentIntentCreateRequestInput
): void {
  const rebuilt = buildStripeCanonicalPaymentIntentCreateRequest(rebuildInput)
  if (!canonicalPaymentIntentCreateRequestsEqual(persisted, rebuilt)) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH)
  }
}

export function buildCompleteStripePaymentIntentCreateAuthorityV1(input: {
  payment_method_type: PaymentMethodType
  amount_minor: number
  cart_id: string
  cart_resource_version: number
  payment_attempt_id: string
  payment_collection_id?: string | null
  payment_session_id?: string | null
  idempotency_key?: string
  authority_created_at: string
  replay_deadline: string
  provider_payment_intent_id?: string | null
}): StripePaymentIntentCreateAuthorityV1 {
  const canonical_request = buildStripeCanonicalPaymentIntentCreateRequest(input)
  const payment_session_id =
    typeof input.payment_session_id === "string" &&
    input.payment_session_id.trim().length > 0
      ? input.payment_session_id.trim()
      : null
  const payment_collection_id =
    typeof input.payment_collection_id === "string" &&
    input.payment_collection_id.trim().length > 0
      ? input.payment_collection_id.trim()
      : null

  const authority: StripePaymentIntentCreateAuthorityV1 = {
    schema: STRIPE_PAYMENT_INTENT_CREATE_SCHEMA,
    version: STRIPE_PAYMENT_INTENT_CREATE_VERSION,
    operation: STRIPE_PAYMENT_INTENT_CREATE_OPERATION,
    provider: STRIPE_PAYMENT_INTENT_CREATE_PROVIDER,
    authority_created_at: input.authority_created_at,
    payment_method_type: input.payment_method_type,
    amount_minor: input.amount_minor,
    currency_code: "brl",
    cart_id: input.cart_id,
    cart_resource_version: input.cart_resource_version,
    payment_attempt_id: input.payment_attempt_id,
    payment_collection_id,
    payment_session_id,
    idempotency_key:
      input.idempotency_key ??
      buildPaymentAttemptProviderIdempotencyKey(
        input.payment_method_type,
        input.payment_attempt_id
      ),
    provider_payment_intent_id: input.provider_payment_intent_id ?? null,
    canonical_request,
    request_digest: digestStripeCanonicalPaymentIntentCreateRequest(
      canonical_request
    ),
    replay_deadline: input.replay_deadline,
  }

  if (input.payment_method_type === "pix") {
    authority.payment_method_options = {
      pix: { expires_after_seconds: DEFAULT_PIX_EXPIRES_AFTER_SECONDS },
    }
  }

  return authority
}

function parsePixExpiresAfterSeconds(value: unknown): number | null {
  if (!isRecord(value) || !isRecord(value.pix)) {
    return null
  }
  const expires = value.pix.expires_after_seconds
  return typeof expires === "number" && Number.isInteger(expires) && expires > 0
    ? expires
    : null
}

function parseCanonicalRequest(
  value: unknown,
  method: PaymentMethodType
): StripeCanonicalPaymentIntentCreateRequest | null {
  if (!isRecord(value)) {
    return null
  }
  if (
    !isSafePositiveInteger(value.amount) ||
    value.currency !== "brl" ||
    value.capture_method !== "automatic" ||
    !Array.isArray(value.payment_method_types) ||
    value.payment_method_types.length !== 1 ||
    value.payment_method_types[0] !== method ||
    !isRecord(value.metadata) ||
    !isNonEmptyString(value.metadata.cart_id) ||
    !isNonEmptyString(value.metadata.payment_attempt_id)
  ) {
    return null
  }

  const sessionId = readNullableText(value.metadata.session_id)
  const metadata: StripeCanonicalPaymentIntentCreateRequest["metadata"] = {
    cart_id: value.metadata.cart_id.trim(),
    payment_attempt_id: value.metadata.payment_attempt_id.trim(),
    ...(typeof sessionId === "string" ? { session_id: sessionId } : {}),
  }

  if (method === "pix") {
    const expires = parsePixExpiresAfterSeconds(value.payment_method_options)
    if (
      value.confirm !== true ||
      !isRecord(value.payment_method_data) ||
      value.payment_method_data.type !== "pix" ||
      expires !== DEFAULT_PIX_EXPIRES_AFTER_SECONDS
    ) {
      return null
    }
    return {
      amount: value.amount,
      currency: "brl",
      payment_method_types: ["pix"],
      capture_method: "automatic",
      confirm: true,
      payment_method_data: { type: "pix" },
      payment_method_options: {
        pix: { expires_after_seconds: expires },
      },
      metadata,
    }
  }

  if (
    value.confirm !== undefined ||
    value.payment_method_data !== undefined ||
    value.payment_method_options !== undefined
  ) {
    return null
  }

  return {
    amount: value.amount,
    currency: "brl",
    payment_method_types: ["card"],
    capture_method: "automatic",
    metadata,
  }
}

export function parseCompleteStripePaymentIntentCreateAuthorityV1(
  blob: Record<string, unknown> | null | undefined
): StripePaymentIntentCreateAuthorityV1 | null {
  if (!blob) {
    return null
  }
  const version = blob.version
  if (
    blob.schema !== STRIPE_PAYMENT_INTENT_CREATE_SCHEMA ||
    (version !== STRIPE_PAYMENT_INTENT_CREATE_VERSION && version !== "1") ||
    blob.operation !== STRIPE_PAYMENT_INTENT_CREATE_OPERATION ||
    blob.provider !== STRIPE_PAYMENT_INTENT_CREATE_PROVIDER
  ) {
    return null
  }

  const payment_method_type = blob.payment_method_type
  if (payment_method_type !== "card" && payment_method_type !== "pix") {
    return null
  }

  const amount_minor =
    typeof blob.amount_minor === "number"
      ? blob.amount_minor
      : typeof blob.amount === "number"
        ? blob.amount
        : null
  if (amount_minor === null || !Number.isFinite(amount_minor) || amount_minor <= 0) {
    return null
  }

  const currency_code = blob.currency_code ?? blob.currency
  if (currency_code !== "brl") {
    return null
  }

  if (
    !isNonEmptyString(blob.cart_id) ||
    !isSafePositiveInteger(blob.cart_resource_version) ||
    !isNonEmptyString(blob.payment_attempt_id) ||
    !isNonEmptyString(blob.idempotency_key) ||
    !isNonEmptyString(blob.authority_created_at) ||
    !isNonEmptyString(blob.replay_deadline) ||
    !isNonEmptyString(blob.request_digest)
  ) {
    return null
  }

  const expectedKey = buildPaymentAttemptProviderIdempotencyKey(
    payment_method_type,
    blob.payment_attempt_id
  )
  if (blob.idempotency_key !== expectedKey) {
    return null
  }

  if (
    blob.provider_payment_intent_id !== null &&
    blob.provider_payment_intent_id !== undefined &&
    !isNonEmptyString(blob.provider_payment_intent_id)
  ) {
    return null
  }

  const payment_collection_id = readNullableText(blob.payment_collection_id)
  const payment_session_id = readNullableText(blob.payment_session_id)
  if (payment_collection_id === undefined || payment_session_id === undefined) {
    return null
  }

  const canonical_request = parseCanonicalRequest(
    blob.canonical_request,
    payment_method_type
  )
  if (!canonical_request) {
    return null
  }

  if (
    canonical_request.amount !== amount_minor ||
    canonical_request.metadata.cart_id !== blob.cart_id ||
    canonical_request.metadata.payment_attempt_id !== blob.payment_attempt_id
  ) {
    return null
  }

  const digest = digestStripeCanonicalPaymentIntentCreateRequest(canonical_request)
  if (blob.request_digest !== digest) {
    return null
  }

  if (payment_method_type === "pix") {
    const expires = parsePixExpiresAfterSeconds(blob.payment_method_options)
    if (expires !== DEFAULT_PIX_EXPIRES_AFTER_SECONDS) {
      return null
    }
  } else if (blob.payment_method_options !== undefined) {
    return null
  }

  const authority: StripePaymentIntentCreateAuthorityV1 = {
    schema: STRIPE_PAYMENT_INTENT_CREATE_SCHEMA,
    version: STRIPE_PAYMENT_INTENT_CREATE_VERSION,
    operation: STRIPE_PAYMENT_INTENT_CREATE_OPERATION,
    provider: STRIPE_PAYMENT_INTENT_CREATE_PROVIDER,
    authority_created_at: blob.authority_created_at.trim(),
    payment_method_type,
    amount_minor,
    currency_code: "brl",
    cart_id: blob.cart_id.trim(),
    cart_resource_version: blob.cart_resource_version,
    payment_attempt_id: blob.payment_attempt_id.trim(),
    payment_collection_id,
    payment_session_id,
    idempotency_key: blob.idempotency_key.trim(),
    provider_payment_intent_id: isNonEmptyString(blob.provider_payment_intent_id)
      ? blob.provider_payment_intent_id.trim()
      : null,
    canonical_request,
    request_digest: digest,
    replay_deadline: blob.replay_deadline.trim(),
  }

  if (payment_method_type === "pix") {
    authority.payment_method_options = {
      pix: { expires_after_seconds: DEFAULT_PIX_EXPIRES_AFTER_SECONDS },
    }
  }

  return authority
}

export function assertCompleteStripePaymentIntentCreateAuthorityV1(
  blob: Record<string, unknown> | null | undefined
): StripePaymentIntentCreateAuthorityV1 {
  const parsed = parseCompleteStripePaymentIntentCreateAuthorityV1(blob)
  if (!parsed) {
    throw new Error(PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE)
  }
  return parsed
}

export function stripePaymentIntentCreateAuthoritiesEqual(
  left: StripePaymentIntentCreateAuthorityV1,
  right: StripePaymentIntentCreateAuthorityV1
): boolean {
  return stableStringify(left) === stableStringify(right)
}

function readPaymentIntentMetadata(
  paymentIntent: StripePaymentIntentLike
): Record<string, unknown> {
  return isRecord(paymentIntent.metadata) ? paymentIntent.metadata : {}
}

function paymentIntentMethodTypes(
  paymentIntent: StripePaymentIntentLike
): string[] {
  return Array.isArray(paymentIntent.payment_method_types)
    ? paymentIntent.payment_method_types.map((value) => String(value))
    : []
}

export function assertStripePaymentIntentMatchesAuthorityV1(
  paymentIntent: StripePaymentIntentLike,
  authority: StripePaymentIntentCreateAuthorityV1
): void {
  const id =
    typeof paymentIntent.id === "string" ? paymentIntent.id.trim() : ""
  if (!id) {
    throw new Error(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  }

  const amount =
    typeof paymentIntent.amount === "number"
      ? paymentIntent.amount
      : Number(paymentIntent.amount)
  const currency =
    typeof paymentIntent.currency === "string"
      ? paymentIntent.currency.toLowerCase()
      : ""

  if (amount !== authority.amount_minor || currency !== "brl") {
    throw new Error(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  }

  const methodTypes = paymentIntentMethodTypes(paymentIntent)
  if (!methodTypes.includes(authority.payment_method_type)) {
    throw new Error(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  }

  const metadata = readPaymentIntentMetadata(paymentIntent)
  const metadataAttemptId = readNullableText(metadata.payment_attempt_id)
  if (metadataAttemptId !== authority.payment_attempt_id) {
    throw new Error(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  }

  const metadataCartId = readNullableText(metadata.cart_id)
  if (metadataCartId !== authority.cart_id) {
    throw new Error(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
  }

  const metadataSessionId = readNullableText(metadata.session_id)
  if (
    authority.payment_method_type === "card" &&
    typeof authority.payment_session_id === "string"
  ) {
    if (metadataSessionId !== authority.payment_session_id) {
      throw new Error(PAYMENT_ATTEMPT_PROVIDER_INTENT_INCOMPATIBLE)
    }
  }
}

export function readPersistedStripePaymentIntentCreateAuthorityV1(
  metadata: Record<string, unknown> | null | undefined
): StripePaymentIntentCreateAuthorityV1 | null {
  const value = metadata?.[STRIPE_PAYMENT_INTENT_CREATE_METADATA_KEY]
  if (!isRecord(value)) {
    return null
  }
  return parseCompleteStripePaymentIntentCreateAuthorityV1(value)
}

export {
  PROVIDER_IDEMPOTENCY_KEY_METADATA_KEY,
  STRIPE_PAYMENT_INTENT_CREATE_METADATA_KEY,
  STRIPE_PAYMENT_INTENT_CREATE_SCHEMA,
  STRIPE_PAYMENT_INTENT_CREATE_VERSION,
}
