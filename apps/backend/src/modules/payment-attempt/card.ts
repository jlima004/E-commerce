import { MedusaError } from "@medusajs/framework/utils"
import { REDACTED, sanitizeString } from "../../observability/sanitize"
import {
  assertPaymentStartEligible,
  type PaymentStartActorContext,
  type PaymentStartCartSnapshot,
} from "./eligibility"
import {
  reconcileStalePaymentAttemptsForCartFingerprint,
  withPaymentAttemptCartFingerprintMetadata,
} from "./cart-invalidation"
import { resolvePaymentAttemptCartFingerprintFromStoreCart } from "../../api/store/carts/serializers"
import {
  assertPaymentAttemptTransition,
  paymentClientConfirmedIsNonFinancial,
} from "./state-machine"
import {
  createPaymentAttemptReplacingActive,
  withPaymentAttemptStatus,
} from "./service"
import {
  splitStripeCardPaymentIntent,
  type StripePaymentIntentLike,
} from "./stripe-safe"
import type { PaymentAttemptRecord } from "./types"

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

export async function startCardPaymentAttempt(
  input: StartCardPaymentAttemptInput
): Promise<StartCardPaymentAttemptResult> {
  const eligibility = assertPaymentStartEligible({
    cart: input.cart,
    actor: input.actor,
    paymentMethod: "card",
    sessionActiveCartId: input.sessionActiveCartId,
  })

  const at = input.at ?? new Date()
  const idempotencyKey = `${input.cart.id}:${at.getTime()}`
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

  let rawIntent: StripePaymentIntentLike

  try {
    rawIntent = await input.stripeLayer.createCardPaymentIntent({
      amount_minor: eligibility.provider_amount_minor,
      currency_code: eligibility.currency_code.toLowerCase(),
      cart_id: input.cart.id,
      idempotency_key: idempotencyKey,
      payment_session_id: input.paymentSession.payment_session_id,
    })
  } catch (error) {
    wrapStripeInitiationError(error)
  }

  const { persistable, immediate, paymentSessionData } =
    splitStripeCardPaymentIntent(rawIntent)

  assertStripeCardPaymentIntentMatchesEligibility(persistable, eligibility)

  const newAttemptId = input.generateId()

  const { supersededAttempts, newAttempt } = createPaymentAttemptReplacingActive(
    attemptsAfterInvalidation,
    {
      cart_id: input.cart.id,
      payment_collection_id: input.paymentSession.payment_collection_id,
      payment_session_id: input.paymentSession.payment_session_id,
      provider: STRIPE_CANONICAL_PROVIDER,
      provider_payment_intent_id: persistable.provider_payment_intent_id,
      provider_payment_session_id: persistable.provider_payment_session_id,
      payment_method_type: "card",
      amount: persistable.amount,
      currency_code: persistable.currency_code,
      expires_at: persistable.expires_at,
      metadata: withPaymentAttemptCartFingerprintMetadata(
        {
          ...(persistable.metadata ?? {}),
          [STRIPE_SAFE_LAYER_METADATA_KEY]: STRIPE_SAFE_LAYER_LABEL,
        },
        cartFingerprint
      ),
    },
    newAttemptId,
    at
  )

  const attempt = withPaymentAttemptStatus(
    {
      ...newAttempt,
      updated_at: at.toISOString(),
    },
    "card_client_secret_created"
  )

  return {
    invalidatedAttempts: invalidated,
    supersededAttempts,
    attempt,
    response: toCardPaymentAttemptResponse(attempt, immediate.client_secret),
    paymentSessionData,
  }
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
