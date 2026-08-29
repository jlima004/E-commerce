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
  findReusablePaymentAttempt,
  withDurablePaymentAttemptIdentity,
} from "./durable-initiation"

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
}

export type StripeCardInitiationLayer = {
  createCardPaymentIntent: (
    request: StripeCardInitiationRequest
  ) => Promise<StripePaymentIntentLike>
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
  const reusableAttempt = findReusablePaymentAttempt(input.existingAttempts, {
    cartId: input.cart.id,
    paymentMethodType: "card",
    cartFingerprint,
  })
  if (reusableAttempt) {
    if (
      !reusableAttempt.payment_collection_id ||
      !reusableAttempt.payment_session_id
    ) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Tentativa provisional de cartao sem PaymentSession duravel."
      )
    }

    return {
      invalidatedAttempts: [],
      supersededAttempts: [],
      attempt: reusableAttempt,
      idempotencyKey: buildPaymentAttemptProviderIdempotencyKey(
        "card",
        reusableAttempt.id
      ),
    }
  }

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
        {
          ...(persistable.metadata ?? {}),
          [STRIPE_SAFE_LAYER_METADATA_KEY]: STRIPE_SAFE_LAYER_LABEL,
        },
        currentAttempt.id
      ),
      cartFingerprint,
      currentAttempt.metadata?.cart_resource_version as
        | number
        | null
        | undefined
    ),
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

  try {
    return await input.stripeLayer.createCardPaymentIntent({
      amount_minor: eligibility.provider_amount_minor,
      currency_code: eligibility.currency_code.toLowerCase(),
      cart_id: input.cart.id,
      idempotency_key: input.prepared.idempotencyKey,
      payment_session_id: input.prepared.attempt.payment_session_id,
      payment_attempt_id: input.prepared.attempt.id,
    })
  } catch (error) {
    wrapStripeInitiationError(error)
  }
}

export async function startCardPaymentAttempt(
  input: StartCardPaymentAttemptInput
): Promise<StartCardPaymentAttemptResult> {
  const prepared = prepareCardPaymentAttempt(input)
  const rawIntent = await initiateCardPaymentIntent({
    prepared,
    cart: input.cart,
    actor: input.actor,
    sessionActiveCartId: input.sessionActiveCartId,
    stripeLayer: input.stripeLayer,
    at: input.at,
  })

  return finalizeCardPaymentAttempt({
    prepared,
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
