import { MedusaService } from "@medusajs/framework/utils"
import PaymentAttempt from "./models/payment-attempt"
import { invalidateActivePaymentAttemptForCartChange } from "./cart-invalidation"
import type { StripeCardInitiationLayer } from "./card"
import type { StripePixInitiationLayer } from "./pix"
import {
  assertNoSensitivePaymentAttemptMetadata,
  assertPaymentAttemptTransition,
  isPaymentAttemptActive,
  markPaymentAttemptCanceled,
  markPaymentAttemptConfirmedByWebhook,
  markPaymentAttemptFailed,
  markPaymentAttemptSuperseded,
} from "./state-machine"
import type {
  CreatePaymentAttemptInput,
  PaymentAttemptRecord,
  PaymentMethodType,
  PaymentAttemptStatus,
} from "./types"

const STRIPE_CARD_INITIATION_LAYER_TOKEN = "stripeCardInitiationLayer"
const STRIPE_PIX_INITIATION_LAYER_TOKEN = "stripePixInitiationLayer"

function isStripeCardInitiationLayer(
  value: unknown
): value is StripeCardInitiationLayer {
  return (
    Boolean(value) &&
    typeof (value as StripeCardInitiationLayer).createCardPaymentIntent ===
      "function"
  )
}

function isStripePixInitiationLayer(
  value: unknown
): value is StripePixInitiationLayer {
  return (
    Boolean(value) &&
    typeof (value as StripePixInitiationLayer).createPixPaymentIntent ===
      "function"
  )
}

function resolveInjectedLayer<T>(
  dependencies: Record<string, unknown>,
  token: string,
  isExpectedLayer: (value: unknown) => value is T
): T | null {
  try {
    const layer = dependencies[token]
    return isExpectedLayer(layer) ? layer : null
  } catch {
    return null
  }
}

class PaymentAttemptModuleService extends MedusaService({
  PaymentAttempt,
}) {
  protected readonly dependencies_: Record<string, unknown>

  constructor(dependencies: Record<string, unknown> = {}) {
    super(...arguments)
    this.dependencies_ = dependencies
  }

  resolveStripeCardInitiationLayer(): StripeCardInitiationLayer | null {
    return resolveInjectedLayer(
      this.dependencies_,
      STRIPE_CARD_INITIATION_LAYER_TOKEN,
      isStripeCardInitiationLayer
    )
  }

  resolveStripePixInitiationLayer(): StripePixInitiationLayer | null {
    return resolveInjectedLayer(
      this.dependencies_,
      STRIPE_PIX_INITIATION_LAYER_TOKEN,
      isStripePixInitiationLayer
    )
  }
}

export default PaymentAttemptModuleService

export type SupersedeActiveAttemptsResult<T extends PaymentAttemptRecord> = {
  superseded: T[]
  remainingActiveCount: number
}

export function findActiveAttemptsForCart<T extends PaymentAttemptRecord>(
  attempts: T[],
  cartId: string
): T[] {
  return attempts.filter(
    (attempt) =>
      attempt.cart_id === cartId && isPaymentAttemptActive(attempt.status)
  )
}

export function assertAtMostOneActiveAttemptPerCart(
  attempts: PaymentAttemptRecord[],
  cartId: string
): void {
  const active = findActiveAttemptsForCart(attempts, cartId)

  if (active.length > 1) {
    throw new Error("PAYMENT_ATTEMPT_MULTIPLE_ACTIVE")
  }
}

export function supersedeActiveAttemptsForCart<T extends PaymentAttemptRecord>(
  attempts: T[],
  cartId: string,
  at: Date = new Date()
): SupersedeActiveAttemptsResult<T> {
  assertAtMostOneActiveAttemptPerCart(attempts, cartId)

  const active = findActiveAttemptsForCart(attempts, cartId)
  const superseded = active.map((attempt) =>
    markPaymentAttemptSuperseded(attempt, at)
  )

  return {
    superseded,
    remainingActiveCount: 0,
  }
}

export function buildNewPaymentAttemptRecord(
  input: CreatePaymentAttemptInput,
  id: string,
  at: Date = new Date()
): PaymentAttemptRecord {
  assertNoSensitivePaymentAttemptMetadata(input.metadata ?? null)

  return {
    id,
    cart_id: input.cart_id,
    payment_collection_id: input.payment_collection_id,
    payment_session_id: input.payment_session_id ?? null,
    provider: input.provider,
    provider_payment_intent_id: input.provider_payment_intent_id ?? null,
    provider_payment_session_id: input.provider_payment_session_id ?? null,
    payment_method_type: input.payment_method_type,
    status: "created",
    amount: input.amount,
    currency_code: input.currency_code.toLowerCase(),
    expires_at: input.expires_at ?? null,
    order_id: null,
    metadata: input.metadata ?? null,
    client_confirmed_at: null,
    instructions_displayed_at: null,
    awaiting_webhook_since: null,
    superseded_at: null,
    invalidated_at: null,
    canceled_at: null,
    failed_at: null,
    expired_at: null,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
  }
}

export type CreateAttemptWithSupersedeResult = {
  supersededAttempts: PaymentAttemptRecord[]
  newAttempt: PaymentAttemptRecord
}

export const SUPPORTED_STRIPE_PAYMENT_INTENT_EVENT_TYPES = [
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
] as const

export type SupportedStripePaymentIntentEventType =
  (typeof SUPPORTED_STRIPE_PAYMENT_INTENT_EVENT_TYPES)[number]

export type StripePaymentIntentWebhookObject = {
  id?: string | null
  object?: string | null
  amount?: number | null
  amount_received?: number | null
  currency?: string | null
  metadata?: Record<string, unknown> | null
  payment_method_types?: unknown
}

export class PaymentAttemptWebhookError extends Error {
  readonly code: string
  readonly webhookDisposition: "failed" | "ignored"

  constructor(
    code: string,
    message: string,
    webhookDisposition: "failed" | "ignored" = "failed"
  ) {
    super(message)
    this.name = code
    this.code = code
    this.webhookDisposition = webhookDisposition
  }
}

/**
 * Creates a fresh attempt for the cart, superseding any prior active attempt.
 * Historical attempts remain in the input array for auditability; callers persist
 * both superseded updates and the new row. Requires DB unique partial index
 * (see TBD-payment-attempt migration) before production use.
 */
export function createPaymentAttemptReplacingActive(
  existingAttempts: PaymentAttemptRecord[],
  input: CreatePaymentAttemptInput,
  newAttemptId: string,
  at: Date = new Date()
): CreateAttemptWithSupersedeResult {
  const { superseded } = supersedeActiveAttemptsForCart(
    existingAttempts,
    input.cart_id,
    at
  )

  const newAttempt = buildNewPaymentAttemptRecord(input, newAttemptId, at)

  const merged = [
    ...existingAttempts.map((attempt) => {
      const updated = superseded.find((item) => item.id === attempt.id)
      return updated ?? attempt
    }),
    newAttempt,
  ]

  assertAtMostOneActiveAttemptPerCart(merged, input.cart_id)

  return {
    supersededAttempts: superseded,
    newAttempt,
  }
}

function normalizeCurrencyCode(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") {
    return null
  }

  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function normalizePaymentMethodTypes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

function readPaymentIntentCartId(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const cartId = metadata?.cart_id
  return typeof cartId === "string" && cartId.trim().length > 0
    ? cartId.trim()
    : null
}

function matchesExpectedPaymentMethodType(
  attemptPaymentMethodType: PaymentMethodType,
  paymentMethodTypes: string[]
): boolean {
  return paymentMethodTypes.includes(attemptPaymentMethodType)
}

function resolveTargetStatusForStripeEvent(
  eventType: SupportedStripePaymentIntentEventType
): PaymentAttemptStatus {
  switch (eventType) {
    case "payment_intent.succeeded":
      return "payment_confirmed_by_webhook"
    case "payment_intent.payment_failed":
      return "payment_failed"
    case "payment_intent.canceled":
      return "payment_canceled"
  }
}

function isTargetStatusAlreadyApplied(
  attempt: PaymentAttemptRecord,
  eventType: SupportedStripePaymentIntentEventType
): boolean {
  return attempt.status === resolveTargetStatusForStripeEvent(eventType)
}

export function validatePaymentIntentForAttempt(
  attempt: PaymentAttemptRecord,
  paymentIntent: StripePaymentIntentWebhookObject,
  eventType: SupportedStripePaymentIntentEventType
): void {
  if (!paymentIntent.id || paymentIntent.id.trim().length === 0) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_INTENT_ID_REQUIRED",
      "PaymentIntent sem identificador."
    )
  }

  const targetStatus = resolveTargetStatusForStripeEvent(eventType)

  if (!isTargetStatusAlreadyApplied(attempt, eventType)) {
    try {
      assertPaymentAttemptTransition(attempt.status, targetStatus)
    } catch {
      throw new PaymentAttemptWebhookError(
        "PAYMENT_ATTEMPT_WEBHOOK_STALE",
        "Tentativa nao pode ser atualizada pelo webhook atual.",
        "ignored"
      )
    }
  }

  const comparableAmounts = [paymentIntent.amount_received, paymentIntent.amount]
    .filter((value): value is number => typeof value === "number")
  const amountMatches = comparableAmounts.some((value) => value === attempt.amount)

  if (!amountMatches) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_AMOUNT_MISMATCH",
      "Amount do PaymentIntent divergente da tentativa."
    )
  }

  const normalizedCurrency = normalizeCurrencyCode(paymentIntent.currency)
  if (!normalizedCurrency || normalizedCurrency !== attempt.currency_code) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_CURRENCY_MISMATCH",
      "Currency do PaymentIntent divergente da tentativa."
    )
  }

  const paymentIntentCartId = readPaymentIntentCartId(paymentIntent.metadata)
  if (paymentIntentCartId && paymentIntentCartId !== attempt.cart_id) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_CART_MISMATCH",
      "Cart do PaymentIntent divergente da tentativa."
    )
  }

  const paymentMethodTypes = normalizePaymentMethodTypes(
    paymentIntent.payment_method_types
  )
  if (
    paymentMethodTypes.length === 0 ||
    !matchesExpectedPaymentMethodType(
      attempt.payment_method_type,
      paymentMethodTypes
    )
  ) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_METHOD_MISMATCH",
      "Metodo de pagamento do PaymentIntent incompativel com a tentativa."
    )
  }
}

export function findPaymentAttemptForWebhook(
  attempts: PaymentAttemptRecord[],
  paymentIntentId: string
): PaymentAttemptRecord {
  const attempt = attempts.find(
    (entry) => entry.provider_payment_intent_id === paymentIntentId
  )

  if (!attempt) {
    throw new PaymentAttemptWebhookError(
      "PAYMENT_ATTEMPT_NOT_FOUND",
      "Tentativa nao encontrada para o PaymentIntent."
    )
  }

  return attempt
}

export function applyStripePaymentIntentWebhookToAttempt<
  T extends PaymentAttemptRecord,
>(
  attempt: T,
  paymentIntent: StripePaymentIntentWebhookObject,
  eventType: SupportedStripePaymentIntentEventType,
  at: Date = new Date()
): T {
  validatePaymentIntentForAttempt(attempt, paymentIntent, eventType)

  if (isTargetStatusAlreadyApplied(attempt, eventType)) {
    return attempt
  }

  switch (eventType) {
    case "payment_intent.succeeded":
      return markPaymentAttemptConfirmedByWebhook(attempt)
    case "payment_intent.payment_failed":
      return markPaymentAttemptFailed(attempt, at)
    case "payment_intent.canceled":
      return markPaymentAttemptCanceled(attempt, at)
  }
}

export function linkPaymentAttemptToOrder<T extends PaymentAttemptRecord>(
  attempt: T,
  orderId: string,
  at: Date = new Date()
): T {
  const normalizedOrderId = orderId.trim()

  if (!normalizedOrderId) {
    throw new Error("PAYMENT_ATTEMPT_ORDER_ID_REQUIRED")
  }

  if (attempt.status !== "payment_confirmed_by_webhook") {
    throw new Error("PAYMENT_ATTEMPT_ORDER_LINK_STATUS_INVALID")
  }

  if (attempt.order_id && attempt.order_id !== normalizedOrderId) {
    throw new Error("PAYMENT_ATTEMPT_ORDER_LINK_CONFLICT")
  }

  return {
    ...attempt,
    order_id: normalizedOrderId,
    updated_at: at.toISOString(),
  }
}

export function invalidateActiveAttemptsForCartChange<
  T extends PaymentAttemptRecord,
>(attempts: T[], cartId: string, at: Date = new Date()): T[] {
  assertAtMostOneActiveAttemptPerCart(attempts, cartId)

  const { attempts: updated } = invalidateActivePaymentAttemptForCartChange(
    attempts,
    cartId,
    at
  )

  return updated
}

export { assertPaymentAttemptEligibleForOrderCreation } from "./state-machine"

export function withPaymentAttemptStatus<T extends PaymentAttemptRecord>(
  attempt: T,
  status: PaymentAttemptStatus
): T {
  return {
    ...attempt,
    status,
    order_id: null,
  }
}
