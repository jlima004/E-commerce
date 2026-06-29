import { MedusaError } from "@medusajs/framework/utils"
import { REDACTED, sanitizeString } from "../../observability/sanitize"
import {
  assertPaymentStartEligible,
  type PaymentStartActorContext,
  type PaymentStartCartSnapshot,
} from "./eligibility"
import {
  assertOrderIdMustStayNull,
  assertPaymentAttemptTransition,
} from "./state-machine"
import {
  createPaymentAttemptReplacingActive,
  withPaymentAttemptStatus,
} from "./service"
import {
  splitStripePixPaymentIntent,
  type SafeStripeImmediatePixAction,
  type StripePaymentIntentLike,
} from "./stripe-safe"
import type { PaymentAttemptRecord } from "./types"

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
  amount: number
  currency_code: string
  cart_id: string
  idempotency_key: string
}

export type StripePixInitiationLayer = {
  createPixPaymentIntent: (
    request: StripePixInitiationRequest
  ) => Promise<StripePaymentIntentLike>
}

export type StartPixPaymentAttemptInput = {
  cart: PaymentStartCartSnapshot
  actor: PaymentStartActorContext
  sessionActiveCartId?: string | null
  existingAttempts: PaymentAttemptRecord[]
  stripeLayer: StripePixInitiationLayer
  generateId: () => string
  generatePaymentCollectionId: () => string
  at?: Date
}

export type StartPixPaymentAttemptResult = {
  supersededAttempts: PaymentAttemptRecord[]
  attempt: PaymentAttemptRecord
  response: PixPaymentAttemptResponse
  paymentSessionData: Record<string, unknown>
}

const STRIPE_SAFE_PROVIDER = "stripe_safe_layer"
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

function assertStripePixPaymentIntentMatchesEligibility(
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

export async function startPixPaymentAttempt(
  input: StartPixPaymentAttemptInput
): Promise<StartPixPaymentAttemptResult> {
  const eligibility = assertPaymentStartEligible({
    cart: input.cart,
    actor: input.actor,
    paymentMethod: "pix",
    sessionActiveCartId: input.sessionActiveCartId,
  })

  const at = input.at ?? new Date()
  const idempotencyKey = `${input.cart.id}:pix:${at.getTime()}`

  let rawIntent: StripePaymentIntentLike

  try {
    rawIntent = await input.stripeLayer.createPixPaymentIntent({
      amount: eligibility.amount,
      currency_code: eligibility.currency_code.toLowerCase(),
      cart_id: input.cart.id,
      idempotency_key: idempotencyKey,
    })
  } catch (error) {
    wrapStripePixInitiationError(error)
  }

  const { persistable, immediate, paymentSessionData } =
    splitStripePixPaymentIntent(rawIntent)

  assertStripePixPaymentIntentMatchesEligibility(persistable, eligibility)

  if (!persistable.expires_at) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Stripe nao retornou expires_at para Pix."
    )
  }

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
      payment_method_type: "pix",
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
      expires_at: persistable.expires_at,
      instructions_displayed_at: at.toISOString(),
      updated_at: at.toISOString(),
    },
    "awaiting_pix_payment"
  )

  assertOrderIdMustStayNull(attempt)

  return {
    supersededAttempts,
    attempt,
    response: toPixPaymentAttemptResponse(
      attempt,
      immediate,
      persistable.expires_at
    ),
    paymentSessionData,
  }
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
