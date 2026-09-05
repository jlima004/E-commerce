import { MedusaError } from "@medusajs/framework/utils"
import { REDACTED, sanitizeString } from "../../observability/sanitize"
import {
  assertPaymentStartEligible,
  type PaymentStartActorContext,
  type PaymentStartCartSnapshot,
} from "./eligibility"
import {
  reconcileStalePaymentAttemptsForCartFingerprint,
  readPaymentAttemptCartFingerprint,
  withPaymentAttemptCartFingerprintMetadata,
} from "./cart-invalidation"
import { resolvePaymentAttemptCartFingerprintFromStoreCart } from "../../api/store/carts/serializers"
import {
  assertOrderIdMustStayNull,
  assertPaymentAttemptTransition,
  isPaymentAttemptActive,
} from "./state-machine"
import {
  createPaymentAttemptReplacingActive,
} from "./service"
import {
  splitStripePixPaymentIntent,
  type SafeStripeImmediatePixAction,
  type StripePaymentIntentLike,
} from "./stripe-safe"
import type { PaymentAttemptRecord } from "./types"
import {
  buildPaymentAttemptProviderIdempotencyKey,
  withDurablePaymentAttemptIdentity,
} from "./durable-initiation"
import {
  isStripePaymentIntentCreateAuthorityV1,
  readPersistedRequestAuthorityBlob,
  type DurablePreProviderAuthority,
} from "./pre-provider-arbitration"
import {
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE,
  PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH,
  PROVIDER_IDEMPOTENCY_KEY_METADATA_KEY,
  STRIPE_PAYMENT_INTENT_CREATE_METADATA_KEY,
  assertCanonicalRequestMatchesRebuild,
  assertCompleteStripePaymentIntentCreateAuthorityV1,
  type StripeCanonicalPaymentIntentCreateRequest,
} from "./provider-request-authority"

export type PixPaymentAttemptResponse = {
  payment_attempt_id: string
  payment_method_type: "pix"
  status: PaymentAttemptRecord["status"]
  amount: number
  currency_code: "BRL"
  provider_payment_intent_id: string | null
  expires_at: string
  qr_code: string
  copy_paste: string
  hosted_instructions_url: string | null
  client_secret?: string
}

export type StripePixInitiationRequest = {
  amount_minor: number
  currency_code: string
  cart_id: string
  idempotency_key: string
  payment_session_id?: string | null
  payment_attempt_id?: string | null
  canonical_request: StripeCanonicalPaymentIntentCreateRequest
}

export type StripeProviderDiscoveryResult = {
  matches: StripePaymentIntentLike[]
  unresolved?: boolean
  reconciliation_required?: boolean
  reason?: string
}

export type StripePixInitiationLayer = {
  createPixPaymentIntent: (
    request: StripePixInitiationRequest
  ) => Promise<StripePaymentIntentLike>
  discoverPaymentIntentsByPaymentAttemptId?: (
    paymentAttemptId: string
  ) => Promise<StripeProviderDiscoveryResult>
}

export type StartPixPaymentAttemptInput = {
  cart: PaymentStartCartSnapshot
  actor: PaymentStartActorContext
  sessionActiveCartId?: string | null
  existingAttempts: PaymentAttemptRecord[]
  stripeLayer: StripePixInitiationLayer
  generateId: () => string
  paymentCollection: {
    payment_collection_id: string
  }
  cartResourceVersion?: number | null
  commitAndRereadAuthority?: (
    prepared: PreparePixPaymentAttemptResult
  ) => Promise<DurablePreProviderAuthority>
  at?: Date
}

export type StartPixPaymentAttemptResult = {
  invalidatedAttempts: PaymentAttemptRecord[]
  supersededAttempts: PaymentAttemptRecord[]
  attempt: PaymentAttemptRecord
  response: PixPaymentAttemptResponse
  paymentSessionData: Record<string, unknown>
}

export type PreparePixPaymentAttemptResult = {
  invalidatedAttempts: PaymentAttemptRecord[]
  supersededAttempts: PaymentAttemptRecord[]
  attempt: PaymentAttemptRecord
  idempotencyKey: string
}

const STRIPE_SAFE_PROVIDER = "stripe"
export const STRIPE_PIX_INITIATION_LAYER = "stripePixInitiationLayer"

function toPixPaymentAttemptResponse(
  attempt: PaymentAttemptRecord,
  immediate: SafeStripeImmediatePixAction,
  expiresAt: string
): PixPaymentAttemptResponse {
  const response: PixPaymentAttemptResponse = {
    payment_attempt_id: attempt.id,
    payment_method_type: "pix",
    status: attempt.status,
    amount: attempt.amount,
    currency_code: "BRL",
    provider_payment_intent_id: attempt.provider_payment_intent_id,
    expires_at: expiresAt,
    qr_code: immediate.qr_code,
    copy_paste: immediate.copy_paste,
    hosted_instructions_url: immediate.hosted_instructions_url,
  }

  if (immediate.client_secret) {
    response.client_secret = immediate.client_secret
  }

  return response
}

function sanitizePixInitiationErrorMessage(message: string): string {
  const withoutSecrets = message.replace(
    /pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9]+/g,
    REDACTED
  )

  const withoutPixPayload = withoutSecrets.replace(
    /\b00020126\d+/g,
    REDACTED
  )

  return sanitizeString(withoutPixPayload)
}

function wrapStripePixInitiationError(error: unknown): never {
  const message =
    error instanceof Error
      ? sanitizePixInitiationErrorMessage(error.message)
      : "Falha ao iniciar pagamento Pix."

  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    message || "Falha ao iniciar pagamento Pix."
  )
}

function mergeFinalizeMetadataPreservingPreProviderAuthority(
  current: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const merged = {
    ...(current ?? {}),
    ...(incoming ?? {}),
  }
  if (current?.[STRIPE_PAYMENT_INTENT_CREATE_METADATA_KEY] !== undefined) {
    merged[STRIPE_PAYMENT_INTENT_CREATE_METADATA_KEY] =
      current[STRIPE_PAYMENT_INTENT_CREATE_METADATA_KEY]
  }
  if (typeof current?.[PROVIDER_IDEMPOTENCY_KEY_METADATA_KEY] === "string") {
    merged[PROVIDER_IDEMPOTENCY_KEY_METADATA_KEY] =
      current[PROVIDER_IDEMPOTENCY_KEY_METADATA_KEY]
  }
  if (current?.cart_resource_version !== undefined) {
    merged.cart_resource_version = current.cart_resource_version
  }
  return merged
}

export function assertDurablePreProviderAuthorityForPixInitiation(
  authority: DurablePreProviderAuthority | null | undefined,
  expected: {
    cart_id: string
    amount_minor: number
    payment_attempt_id: string
    idempotency_key: string
  }
): DurablePreProviderAuthority {
  if (
    !authority ||
    authority.financial_freeze_started_at == null ||
    authority.currency_code !== "brl" ||
    authority.payment_method_type !== "pix" ||
    authority.amount_minor !== expected.amount_minor ||
    authority.attempt.id !== expected.payment_attempt_id ||
    authority.attempt.cart_id !== expected.cart_id ||
    authority.provider_idempotency_key !== expected.idempotency_key
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE
    )
  }

  const blob = readPersistedRequestAuthorityBlob(authority.attempt.metadata)
  if (!isStripePaymentIntentCreateAuthorityV1(blob)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE
    )
  }

  const complete = assertCompleteStripePaymentIntentCreateAuthorityV1(blob)
  if (
    complete.cart_id !== expected.cart_id ||
    complete.payment_attempt_id !== expected.payment_attempt_id ||
    complete.payment_method_type !== "pix" ||
    complete.amount_minor !== expected.amount_minor ||
    complete.idempotency_key !== expected.idempotency_key ||
    complete.currency_code !== "brl"
  ) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_MISMATCH
    )
  }

  assertCanonicalRequestMatchesRebuild(complete.canonical_request, {
    payment_method_type: "pix",
    amount_minor: complete.amount_minor,
    cart_id: complete.cart_id,
    payment_attempt_id: complete.payment_attempt_id,
    payment_session_id: complete.payment_session_id,
  })

  return authority
}

function assertStripePixPaymentIntentMatchesEligibility(
  persistable: {
    amount: number
    currency_code: string
  },
  eligibility: {
    provider_amount_minor: number
    currency_code: string
  }
): void {
  if (
    persistable.amount !== eligibility.provider_amount_minor ||
    persistable.currency_code !== eligibility.currency_code.toLowerCase()
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Stripe retornou dados de pagamento divergentes do carrinho."
    )
  }
}

export function preparePixPaymentAttempt(
  input: Omit<StartPixPaymentAttemptInput, "stripeLayer">
): PreparePixPaymentAttemptResult {
  const eligibility = assertPaymentStartEligible({
    cart: input.cart,
    actor: input.actor,
    paymentMethod: "pix",
    sessionActiveCartId: input.sessionActiveCartId,
  })

  const at = input.at ?? new Date()
  const cartFingerprint = resolvePaymentAttemptCartFingerprintFromStoreCart(
    input.cart
  )
  const { attempts: attemptsAfterInvalidation, invalidated } =
    reconcileStalePaymentAttemptsForCartFingerprint(
      input.existingAttempts,
      input.cart.id,
      cartFingerprint,
      at
    )

  const newAttemptId = input.generateId()
  const paymentCollectionId = input.paymentCollection.payment_collection_id
  const { supersededAttempts, newAttempt } = createPaymentAttemptReplacingActive(
    attemptsAfterInvalidation,
    {
      cart_id: input.cart.id,
      payment_collection_id: paymentCollectionId,
      payment_session_id: null,
      provider: STRIPE_SAFE_PROVIDER,
      provider_payment_intent_id: null,
      provider_payment_session_id: null,
      payment_method_type: "pix",
      amount: eligibility.provider_amount_minor,
      currency_code: eligibility.currency_code,
      expires_at: null,
      metadata: withPaymentAttemptCartFingerprintMetadata(
        withDurablePaymentAttemptIdentity(null, newAttemptId),
        cartFingerprint,
        input.cartResourceVersion
      ),
    },
    newAttemptId,
    at
  )

  return {
    invalidatedAttempts: invalidated,
    supersededAttempts,
    attempt: newAttempt,
    idempotencyKey: buildPaymentAttemptProviderIdempotencyKey(
      "pix",
      newAttempt.id
    ),
  }
}

function resolvePixFinalStatus(
  currentStatus: PaymentAttemptRecord["status"]
): PaymentAttemptRecord["status"] {
  if (currentStatus === "created") {
    assertPaymentAttemptTransition(currentStatus, "awaiting_pix_payment")
    return "awaiting_pix_payment"
  }

  if (!isPaymentAttemptActive(currentStatus)) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Tentativa Pix nao esta mais ativa."
    )
  }

  return currentStatus
}

export async function finalizePixPaymentAttempt(input: {
  prepared: PreparePixPaymentAttemptResult
  cart: PaymentStartCartSnapshot
  actor: PaymentStartActorContext
  sessionActiveCartId?: string | null
  rawIntent: StripePaymentIntentLike
  currentAttempt?: PaymentAttemptRecord
  at?: Date
}): Promise<StartPixPaymentAttemptResult> {
  const eligibility = assertPaymentStartEligible({
    cart: input.cart,
    actor: input.actor,
    paymentMethod: "pix",
    sessionActiveCartId: input.sessionActiveCartId,
  })
  const currentAttempt = input.currentAttempt ?? input.prepared.attempt
  if (
    currentAttempt.id !== input.prepared.attempt.id ||
    currentAttempt.cart_id !== input.cart.id ||
    currentAttempt.payment_method_type !== "pix"
  ) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Tentativa Pix divergente do cart."
    )
  }

  const { persistable, immediate, paymentSessionData } =
    splitStripePixPaymentIntent(input.rawIntent)
  assertStripePixPaymentIntentMatchesEligibility(persistable, eligibility)

  const providerAttemptId =
    typeof persistable.metadata?.payment_attempt_id === "string"
      ? persistable.metadata.payment_attempt_id
      : null
  if (providerAttemptId !== currentAttempt.id) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "PaymentIntent Stripe sem identidade de tentativa duravel."
    )
  }

  if (!persistable.expires_at) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Stripe nao retornou expires_at para Pix."
    )
  }
  if (
    currentAttempt.provider_payment_intent_id &&
    currentAttempt.provider_payment_intent_id !==
      persistable.provider_payment_intent_id
  ) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "PaymentIntent Stripe divergente da tentativa duravel."
    )
  }

  const at = input.at ?? new Date()
  const cartFingerprint = resolvePaymentAttemptCartFingerprintFromStoreCart(
    input.cart
  )
  if (readPaymentAttemptCartFingerprint(currentAttempt) !== cartFingerprint) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Carrinho mudou antes da finalizacao da tentativa Pix."
    )
  }
  const attempt: PaymentAttemptRecord = {
    ...currentAttempt,
    provider: STRIPE_SAFE_PROVIDER,
    provider_payment_intent_id: persistable.provider_payment_intent_id,
    provider_payment_session_id:
      persistable.provider_payment_session_id ??
      currentAttempt.provider_payment_session_id,
    amount: persistable.amount,
    currency_code: persistable.currency_code,
    expires_at: persistable.expires_at,
    instructions_displayed_at:
      currentAttempt.instructions_displayed_at ?? at.toISOString(),
    metadata: withPaymentAttemptCartFingerprintMetadata(
      withDurablePaymentAttemptIdentity(
        mergeFinalizeMetadataPreservingPreProviderAuthority(
          currentAttempt.metadata,
          persistable.metadata
        ),
        currentAttempt.id
      ),
      cartFingerprint,
      currentAttempt.metadata?.cart_resource_version as
        | number
        | null
        | undefined
    ),
    financial_freeze_started_at: currentAttempt.financial_freeze_started_at,
    status: resolvePixFinalStatus(currentAttempt.status),
    order_id: null,
    updated_at: at.toISOString(),
  }
  assertOrderIdMustStayNull(attempt)

  return {
    invalidatedAttempts: input.prepared.invalidatedAttempts,
    supersededAttempts: input.prepared.supersededAttempts,
    attempt,
    response: toPixPaymentAttemptResponse(
      attempt,
      immediate,
      persistable.expires_at
    ),
    paymentSessionData,
  }
}

export async function initiatePixPaymentIntent(input: {
  prepared: PreparePixPaymentAttemptResult
  authority: DurablePreProviderAuthority
  cart: PaymentStartCartSnapshot
  actor: PaymentStartActorContext
  sessionActiveCartId?: string | null
  stripeLayer: StripePixInitiationLayer
  at?: Date
}): Promise<StripePaymentIntentLike> {
  const eligibility = assertPaymentStartEligible({
    cart: input.cart,
    actor: input.actor,
    paymentMethod: "pix",
    sessionActiveCartId: input.sessionActiveCartId,
  })
  const durableAuthority = assertDurablePreProviderAuthorityForPixInitiation(
    input.authority,
    {
      cart_id: input.cart.id,
      amount_minor: eligibility.provider_amount_minor,
      payment_attempt_id: input.prepared.attempt.id,
      idempotency_key: input.prepared.idempotencyKey,
    }
  )
  const complete = assertCompleteStripePaymentIntentCreateAuthorityV1(
    readPersistedRequestAuthorityBlob(durableAuthority.attempt.metadata)
  )

  try {
    return await input.stripeLayer.createPixPaymentIntent({
      amount_minor: durableAuthority.amount_minor,
      currency_code: eligibility.currency_code.toLowerCase(),
      cart_id: input.cart.id,
      idempotency_key: durableAuthority.provider_idempotency_key,
      payment_session_id: input.prepared.attempt.payment_session_id,
      payment_attempt_id: durableAuthority.attempt.id,
      canonical_request: complete.canonical_request,
    })
  } catch (error) {
    wrapStripePixInitiationError(error)
  }
}

export async function startPixPaymentAttempt(
  input: StartPixPaymentAttemptInput
): Promise<StartPixPaymentAttemptResult> {
  const prepared = preparePixPaymentAttempt(input)
  if (typeof input.commitAndRereadAuthority !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE
    )
  }

  const authority = await input.commitAndRereadAuthority(prepared)
  const preparedWithAuthority: PreparePixPaymentAttemptResult = {
    ...prepared,
    attempt: authority.attempt,
    idempotencyKey: authority.provider_idempotency_key,
  }
  const rawIntent = await initiatePixPaymentIntent({
    prepared: preparedWithAuthority,
    authority,
    cart: input.cart,
    actor: input.actor,
    sessionActiveCartId: input.sessionActiveCartId,
    stripeLayer: input.stripeLayer,
    at: input.at,
  })

  return finalizePixPaymentAttempt({
    prepared: preparedWithAuthority,
    cart: input.cart,
    actor: input.actor,
    sessionActiveCartId: input.sessionActiveCartId,
    rawIntent,
    at: input.at,
  })
}

export function markPixExpired(
  attempt: PaymentAttemptRecord,
  at: Date = new Date()
): PaymentAttemptRecord {
  assertPaymentAttemptTransition(attempt.status, "pix_expired")

  const updated: PaymentAttemptRecord = {
    ...attempt,
    status: "pix_expired",
    expired_at: at.toISOString(),
    order_id: null,
    updated_at: at.toISOString(),
  }

  assertOrderIdMustStayNull(updated)

  return updated
}

export function markPixFailed(
  attempt: PaymentAttemptRecord,
  at: Date = new Date()
): PaymentAttemptRecord {
  assertPaymentAttemptTransition(attempt.status, "payment_failed")

  const updated: PaymentAttemptRecord = {
    ...attempt,
    status: "payment_failed",
    failed_at: at.toISOString(),
    order_id: null,
    updated_at: at.toISOString(),
  }

  assertOrderIdMustStayNull(updated)

  return updated
}

export function markPixCanceled(
  attempt: PaymentAttemptRecord,
  at: Date = new Date()
): PaymentAttemptRecord {
  assertPaymentAttemptTransition(attempt.status, "payment_canceled")

  const updated: PaymentAttemptRecord = {
    ...attempt,
    status: "payment_canceled",
    canceled_at: at.toISOString(),
    order_id: null,
    updated_at: at.toISOString(),
  }

  assertOrderIdMustStayNull(updated)

  return updated
}

export function serializePixPaymentAttemptResponse(
  response: PixPaymentAttemptResponse
): PixPaymentAttemptResponse {
  return response
}
