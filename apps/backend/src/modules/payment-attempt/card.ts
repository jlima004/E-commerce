import { MedusaError } from "@medusajs/framework/utils"
import { REDACTED, sanitizeString } from "../../observability/sanitize"
import {
  assertPaymentStartEligible,
  type PaymentStartActorContext,
  type PaymentStartCartSnapshot,
} from "./eligibility"
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
  amount: number
  currency_code: string
  cart_id: string
  idempotency_key: string
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
  generatePaymentCollectionId: () => string
  at?: Date
}

export type StartCardPaymentAttemptResult = {
  supersededAttempts: PaymentAttemptRecord[]
  attempt: PaymentAttemptRecord
  response: CardPaymentAttemptResponse
  paymentSessionData: Record<string, unknown>
}

const STRIPE_SAFE_PROVIDER = "stripe_safe_layer"
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
    amount: number
    currency_code: string
  }
): void {
  if (
    persistable.amount !== eligibility.amount ||
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

  let rawIntent: StripePaymentIntentLike

  try {
    rawIntent = await input.stripeLayer.createCardPaymentIntent({
      amount: eligibility.amount,
      currency_code: eligibility.currency_code.toLowerCase(),
      cart_id: input.cart.id,
      idempotency_key: idempotencyKey,
    })
  } catch (error) {
    wrapStripeInitiationError(error)
  }

  const { persistable, immediate, paymentSessionData } =
    splitStripeCardPaymentIntent(rawIntent)

  assertStripeCardPaymentIntentMatchesEligibility(persistable, eligibility)

  const paymentCollectionId = input.generatePaymentCollectionId()
  const newAttemptId = input.generateId()

  const { supersededAttempts, newAttempt } = createPaymentAttemptReplacingActive(
    input.existingAttempts,
    {
      cart_id: input.cart.id,
      payment_collection_id: paymentCollectionId,
      payment_session_id: persistable.provider_payment_session_id,
      provider: STRIPE_SAFE_PROVIDER,
      provider_payment_intent_id: persistable.provider_payment_intent_id,
      provider_payment_session_id: persistable.provider_payment_session_id,
      payment_method_type: "card",
      amount: persistable.amount,
      currency_code: persistable.currency_code,
      expires_at: persistable.expires_at,
      metadata: persistable.metadata,
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
