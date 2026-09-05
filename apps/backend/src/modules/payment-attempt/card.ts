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
  assertPaymentAttemptTransition,
  isPaymentAttemptActive,
  paymentClientConfirmedIsNonFinancial,
} from "./state-machine"
import {
  createPaymentAttemptReplacingActive,
} from "./service"
import {
  splitStripeCardPaymentIntent,
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

export type CardPaymentAttemptResponse = {
  payment_attempt_id: string
  payment_method_type: "card"
  status: PaymentAttemptRecord["status"]
  amount: number
  currency_code: "BRL"
  provider_payment_intent_id: string | null
  client_secret: string
}

export type StripeCardInitiationRequest = {
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

export type StripeCardInitiationLayer = {
  createCardPaymentIntent: (
    request: StripeCardInitiationRequest
  ) => Promise<StripePaymentIntentLike>
  discoverPaymentIntentsByPaymentAttemptId?: (
    paymentAttemptId: string
  ) => Promise<StripeProviderDiscoveryResult>
}

export type StartCardPaymentAttemptInput = {
  cart: PaymentStartCartSnapshot
  actor: PaymentStartActorContext
  sessionActiveCartId?: string | null
  existingAttempts: PaymentAttemptRecord[]
  stripeLayer: StripeCardInitiationLayer
  generateId: () => string
  cartResourceVersion?: number | null
  paymentSession: {
    payment_collection_id: string
    payment_session_id: string
  }
  commitAndRereadAuthority?: (
    prepared: PrepareCardPaymentAttemptResult
  ) => Promise<DurablePreProviderAuthority>
  at?: Date
}

export type StartCardPaymentAttemptResult = {
  invalidatedAttempts: PaymentAttemptRecord[]
  supersededAttempts: PaymentAttemptRecord[]
  attempt: PaymentAttemptRecord
  response: CardPaymentAttemptResponse
  paymentSessionData: Record<string, unknown>
}

export type PrepareCardPaymentAttemptResult = {
  invalidatedAttempts: PaymentAttemptRecord[]
  supersededAttempts: PaymentAttemptRecord[]
  attempt: PaymentAttemptRecord
  idempotencyKey: string
}

const STRIPE_CANONICAL_PROVIDER = "stripe"
const STRIPE_SAFE_LAYER_METADATA_KEY = "stripe_initiation_layer"
const STRIPE_SAFE_LAYER_LABEL = "stripe_safe_layer"
export const STRIPE_CARD_INITIATION_LAYER = "stripeCardInitiationLayer"

function toCardPaymentAttemptResponse(
  attempt: PaymentAttemptRecord,
  clientSecret: string
): CardPaymentAttemptResponse {
  return {
    payment_attempt_id: attempt.id,
    payment_method_type: "card",
    status: attempt.status,
    amount: attempt.amount,
    currency_code: "BRL",
    provider_payment_intent_id: attempt.provider_payment_intent_id,
    client_secret: clientSecret,
  }
}

function sanitizeCardInitiationErrorMessage(message: string): string {
  const withoutSecrets = message.replace(
    /pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9]+/g,
    REDACTED
  )

  return sanitizeString(withoutSecrets)
}

function wrapStripeInitiationError(error: unknown): never {
  const message =
    error instanceof Error
      ? sanitizeCardInitiationErrorMessage(error.message)
      : "Falha ao iniciar pagamento com cartao."

  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    message || "Falha ao iniciar pagamento com cartao."
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

export function assertDurablePreProviderAuthorityForInitiation(
  authority: DurablePreProviderAuthority | null | undefined,
  expected: {
    cart_id: string
    payment_method_type: "card" | "pix"
    amount_minor: number
    payment_attempt_id: string
    idempotency_key: string
  }
): DurablePreProviderAuthority {
  if (
    !authority ||
    authority.financial_freeze_started_at == null ||
    authority.currency_code !== "brl" ||
    authority.payment_method_type !== expected.payment_method_type ||
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
    complete.payment_method_type !== expected.payment_method_type ||
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
    payment_method_type: "card",
    amount_minor: complete.amount_minor,
    cart_id: complete.cart_id,
    payment_attempt_id: complete.payment_attempt_id,
    payment_session_id: complete.payment_session_id,
  })

  return authority
}

function assertStripeCardPaymentIntentMatchesEligibility(
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

export function prepareCardPaymentAttempt(
  input: Omit<StartCardPaymentAttemptInput, "stripeLayer">
): PrepareCardPaymentAttemptResult {
  const eligibility = assertPaymentStartEligible({
    cart: input.cart,
    actor: input.actor,
    paymentMethod: "card",
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
  const { supersededAttempts, newAttempt } = createPaymentAttemptReplacingActive(
    attemptsAfterInvalidation,
    {
      cart_id: input.cart.id,
      payment_collection_id: input.paymentSession.payment_collection_id,
      payment_session_id: input.paymentSession.payment_session_id,
      provider: STRIPE_CANONICAL_PROVIDER,
      provider_payment_intent_id: null,
      provider_payment_session_id: null,
      payment_method_type: "card",
      amount: eligibility.provider_amount_minor,
      currency_code: eligibility.currency_code,
      expires_at: null,
      metadata: withPaymentAttemptCartFingerprintMetadata(
        withDurablePaymentAttemptIdentity(
          {
            [STRIPE_SAFE_LAYER_METADATA_KEY]: STRIPE_SAFE_LAYER_LABEL,
          },
          newAttemptId
        ),
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
      "card",
      newAttempt.id
    ),
  }
}

function resolveCardFinalStatus(
  currentStatus: PaymentAttemptRecord["status"]
): PaymentAttemptRecord["status"] {
  if (currentStatus === "created") {
    assertPaymentAttemptTransition(currentStatus, "card_client_secret_created")
    return "card_client_secret_created"
  }

  if (!isPaymentAttemptActive(currentStatus)) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Tentativa de cartao nao esta mais ativa."
    )
  }

  return currentStatus
}

export async function finalizeCardPaymentAttempt(input: {
  prepared: PrepareCardPaymentAttemptResult
  cart: PaymentStartCartSnapshot
  actor: PaymentStartActorContext
  sessionActiveCartId?: string | null
  rawIntent: StripePaymentIntentLike
  currentAttempt?: PaymentAttemptRecord
  at?: Date
}): Promise<StartCardPaymentAttemptResult> {
  const eligibility = assertPaymentStartEligible({
    cart: input.cart,
    actor: input.actor,
    paymentMethod: "card",
    sessionActiveCartId: input.sessionActiveCartId,
  })
  const currentAttempt = input.currentAttempt ?? input.prepared.attempt
  if (
    currentAttempt.id !== input.prepared.attempt.id ||
    currentAttempt.cart_id !== input.cart.id ||
    currentAttempt.payment_method_type !== "card"
  ) {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      "Tentativa de cartao divergente do cart."
    )
  }

  const { persistable, immediate, paymentSessionData } =
    splitStripeCardPaymentIntent(input.rawIntent)
  assertStripeCardPaymentIntentMatchesEligibility(persistable, eligibility)

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
      "Carrinho mudou antes da finalizacao da tentativa de cartao."
    )
  }
  const attempt: PaymentAttemptRecord = {
    ...currentAttempt,
    provider: STRIPE_CANONICAL_PROVIDER,
    provider_payment_intent_id: persistable.provider_payment_intent_id,
    provider_payment_session_id:
      persistable.provider_payment_session_id ??
      currentAttempt.provider_payment_session_id,
    amount: persistable.amount,
    currency_code: persistable.currency_code,
    expires_at: persistable.expires_at,
    metadata: withPaymentAttemptCartFingerprintMetadata(
      withDurablePaymentAttemptIdentity(
        mergeFinalizeMetadataPreservingPreProviderAuthority(
          currentAttempt.metadata,
          {
            ...(persistable.metadata ?? {}),
            [STRIPE_SAFE_LAYER_METADATA_KEY]: STRIPE_SAFE_LAYER_LABEL,
          }
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
    status: resolveCardFinalStatus(currentAttempt.status),
    order_id: null,
    updated_at: at.toISOString(),
  }

  return {
    invalidatedAttempts: input.prepared.invalidatedAttempts,
    supersededAttempts: input.prepared.supersededAttempts,
    attempt,
    response: toCardPaymentAttemptResponse(attempt, immediate.client_secret),
    paymentSessionData,
  }
}

export async function initiateCardPaymentIntent(input: {
  prepared: PrepareCardPaymentAttemptResult
  authority: DurablePreProviderAuthority
  cart: PaymentStartCartSnapshot
  actor: PaymentStartActorContext
  sessionActiveCartId?: string | null
  stripeLayer: StripeCardInitiationLayer
  at?: Date
}): Promise<StripePaymentIntentLike> {
  const eligibility = assertPaymentStartEligible({
    cart: input.cart,
    actor: input.actor,
    paymentMethod: "card",
    sessionActiveCartId: input.sessionActiveCartId,
  })
  const durableAuthority = assertDurablePreProviderAuthorityForInitiation(
    input.authority,
    {
      cart_id: input.cart.id,
      payment_method_type: "card",
      amount_minor: eligibility.provider_amount_minor,
      payment_attempt_id: input.prepared.attempt.id,
      idempotency_key: input.prepared.idempotencyKey,
    }
  )
  const complete = assertCompleteStripePaymentIntentCreateAuthorityV1(
    readPersistedRequestAuthorityBlob(durableAuthority.attempt.metadata)
  )

  try {
    return await input.stripeLayer.createCardPaymentIntent({
      amount_minor: durableAuthority.amount_minor,
      currency_code: eligibility.currency_code.toLowerCase(),
      cart_id: input.cart.id,
      idempotency_key: durableAuthority.provider_idempotency_key,
      payment_session_id: input.prepared.attempt.payment_session_id,
      payment_attempt_id: durableAuthority.attempt.id,
      canonical_request: complete.canonical_request,
    })
  } catch (error) {
    wrapStripeInitiationError(error)
  }
}

export async function startCardPaymentAttempt(
  input: StartCardPaymentAttemptInput
): Promise<StartCardPaymentAttemptResult> {
  const prepared = prepareCardPaymentAttempt(input)
  if (typeof input.commitAndRereadAuthority !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_PRE_PROVIDER_AUTHORITY_INCOMPLETE
    )
  }

  const authority = await input.commitAndRereadAuthority(prepared)
  const preparedWithAuthority: PrepareCardPaymentAttemptResult = {
    ...prepared,
    attempt: authority.attempt,
    idempotencyKey: authority.provider_idempotency_key,
  }
  const rawIntent = await initiateCardPaymentIntent({
    prepared: preparedWithAuthority,
    authority,
    cart: input.cart,
    actor: input.actor,
    sessionActiveCartId: input.sessionActiveCartId,
    stripeLayer: input.stripeLayer,
    at: input.at,
  })

  return finalizeCardPaymentAttempt({
    prepared: preparedWithAuthority,
    cart: input.cart,
    actor: input.actor,
    sessionActiveCartId: input.sessionActiveCartId,
    rawIntent,
    at: input.at,
  })
}

export function markCardClientConfirmed(
  attempt: PaymentAttemptRecord,
  at: Date = new Date()
): PaymentAttemptRecord {
  paymentClientConfirmedIsNonFinancial()

  assertPaymentAttemptTransition(attempt.status, "payment_client_confirmed")

  return {
    ...attempt,
    status: "payment_client_confirmed",
    client_confirmed_at: at.toISOString(),
    order_id: null,
    updated_at: at.toISOString(),
  }
}

export function serializeCardPaymentAttemptResponse(
  response: CardPaymentAttemptResponse
): CardPaymentAttemptResponse {
  return response
}
