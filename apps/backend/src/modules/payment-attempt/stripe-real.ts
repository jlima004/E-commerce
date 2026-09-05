import Stripe from "stripe"
import { RECONCILIATION_REASON_CODE } from "../../reconciliation/reason-codes"
import type {
  StripeCardInitiationLayer,
  StripeCardInitiationRequest,
} from "./card"
import type {
  StripePixInitiationLayer,
  StripePixInitiationRequest,
} from "./pix"
import {
  assertCanonicalRequestMatchesRebuild,
  buildStripeCanonicalPaymentIntentCreateRequest,
  canonicalPaymentIntentCreateRequestsEqual,
  DEFAULT_PIX_EXPIRES_AFTER_SECONDS,
} from "./provider-request-authority"
import type { StripePaymentIntentLike } from "./stripe-safe"

export type StripePaymentIntentSearchPage = {
  data: StripePaymentIntentLike[]
  has_more: boolean
  next_page?: string | null
}

export type StripePaymentIntentSearchParams = {
  query: string
  limit?: number
  page?: string
}

export type StripePaymentIntentsClient = {
  create: (
    params: Stripe.PaymentIntentCreateParams,
    options?: Stripe.RequestOptions
  ) => Promise<StripePaymentIntentLike>
  search: (
    params: StripePaymentIntentSearchParams,
    options?: Stripe.RequestOptions
  ) => Promise<StripePaymentIntentSearchPage>
  retrieve?: (
    id: string,
    options?: Stripe.RequestOptions
  ) => Promise<StripePaymentIntentLike>
  cancel?: (
    id: string,
    params?: Stripe.PaymentIntentCancelParams,
    options?: Stripe.RequestOptions
  ) => Promise<StripePaymentIntentLike>
}

export type RealStripeInitiationLayerConfig = {
  paymentIntents: StripePaymentIntentsClient
  pixExpiresAfterSeconds?: number
}

export type ProviderPaymentIntentDiscoveryResult =
  | {
      matches: []
      unresolved: true
      reason: typeof RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED
    }
  | {
      matches: [StripePaymentIntentLike]
      unresolved: false
    }
  | {
      matches: StripePaymentIntentLike[]
      reconciliation_required: true
      unresolved: false
      reason: "RECONCILIATION_REQUIRED"
    }

export { DEFAULT_PIX_EXPIRES_AFTER_SECONDS }

const MIN_PIX_EXPIRES_AFTER_SECONDS = 10
const MAX_PIX_EXPIRES_AFTER_SECONDS = 1_209_600
export const PROVIDER_PAYMENT_INTENT_SEARCH_PAGE_SIZE = 100
const PROVIDER_PAYMENT_INTENT_SEARCH_MAX_PAGES = 50

function assertPositiveAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("STRIPE_REAL_INVALID_AMOUNT")
  }
}

function assertBrlCurrency(currencyCode: string): "brl" {
  if (currencyCode.toLowerCase() !== "brl") {
    throw new Error("STRIPE_REAL_INVALID_CURRENCY")
  }

  return "brl"
}

function resolvePixExpiresAfterSeconds(value: number | undefined): number {
  const expiresAfter = value ?? DEFAULT_PIX_EXPIRES_AFTER_SECONDS

  if (
    !Number.isInteger(expiresAfter) ||
    expiresAfter < MIN_PIX_EXPIRES_AFTER_SECONDS ||
    expiresAfter > MAX_PIX_EXPIRES_AFTER_SECONDS
  ) {
    throw new Error("STRIPE_REAL_INVALID_PIX_TTL")
  }

  return expiresAfter
}

function assertPaymentAttemptId(
  request: StripeCardInitiationRequest | StripePixInitiationRequest
): string {
  const paymentAttemptId =
    typeof request.payment_attempt_id === "string"
      ? request.payment_attempt_id.trim()
      : ""
  if (!paymentAttemptId) {
    throw new Error("STRIPE_REAL_PAYMENT_ATTEMPT_ID_REQUIRED")
  }
  return paymentAttemptId
}

function assertCanonicalRequestForCreate(
  request: StripeCardInitiationRequest | StripePixInitiationRequest,
  method: "card" | "pix"
): void {
  assertPaymentAttemptId(request)
  const paymentSessionId =
    "payment_session_id" in request ? request.payment_session_id : undefined
  const expected = buildStripeCanonicalPaymentIntentCreateRequest({
    payment_method_type: method,
    amount_minor: request.amount_minor,
    cart_id: request.cart_id,
    payment_attempt_id: request.payment_attempt_id as string,
    payment_session_id: paymentSessionId,
  })
  if (
    !canonicalPaymentIntentCreateRequestsEqual(
      request.canonical_request,
      expected
    )
  ) {
    throw new Error("STRIPE_REAL_CANONICAL_REQUEST_MISMATCH")
  }
  assertCanonicalRequestMatchesRebuild(request.canonical_request, {
    payment_method_type: method,
    amount_minor: request.amount_minor,
    cart_id: request.cart_id,
    payment_attempt_id: request.payment_attempt_id as string,
    payment_session_id: paymentSessionId,
  })
}

function buildRequestOptions(
  request: StripeCardInitiationRequest | StripePixInitiationRequest
): Stripe.RequestOptions {
  return {
    idempotencyKey: request.idempotency_key,
  }
}

export class RealStripeCardInitiationLayer
  implements StripeCardInitiationLayer
{
  private readonly paymentIntents: StripePaymentIntentsClient

  constructor(config: RealStripeInitiationLayerConfig) {
    this.paymentIntents = config.paymentIntents
  }

  async createCardPaymentIntent(
    request: StripeCardInitiationRequest
  ): Promise<StripePaymentIntentLike> {
    assertPositiveAmount(request.amount_minor)
    assertBrlCurrency(request.currency_code)
    assertCanonicalRequestForCreate(request, "card")

    return await this.paymentIntents.create(
      request.canonical_request,
      buildRequestOptions(request)
    )
  }

  async discoverPaymentIntentsByPaymentAttemptId(
    paymentAttemptId: string
  ): Promise<ProviderPaymentIntentDiscoveryResult> {
    return discoverPaymentIntentsByPaymentAttemptId(
      this.paymentIntents,
      paymentAttemptId
    )
  }
}

export class RealStripePixInitiationLayer implements StripePixInitiationLayer {
  private readonly paymentIntents: StripePaymentIntentsClient

  constructor(config: RealStripeInitiationLayerConfig) {
    this.paymentIntents = config.paymentIntents
    resolvePixExpiresAfterSeconds(config.pixExpiresAfterSeconds)
  }

  async createPixPaymentIntent(
    request: StripePixInitiationRequest
  ): Promise<StripePaymentIntentLike> {
    assertPositiveAmount(request.amount_minor)
    assertBrlCurrency(request.currency_code)
    assertCanonicalRequestForCreate(request, "pix")

    return await this.paymentIntents.create(
      request.canonical_request,
      buildRequestOptions(request)
    )
  }

  async discoverPaymentIntentsByPaymentAttemptId(
    paymentAttemptId: string
  ): Promise<ProviderPaymentIntentDiscoveryResult> {
    return discoverPaymentIntentsByPaymentAttemptId(
      this.paymentIntents,
      paymentAttemptId
    )
  }
}

function buildPaymentAttemptMetadataSearchQuery(paymentAttemptId: string): string {
  const normalized = paymentAttemptId.trim()
  if (!normalized) {
    throw new Error("PAYMENT_ATTEMPT_ID_REQUIRED")
  }
  return `metadata["payment_attempt_id"]:"${normalized.replace(/"/g, "")}"`
}

export async function discoverPaymentIntentsByPaymentAttemptId(
  paymentIntents: StripePaymentIntentsClient,
  paymentAttemptId: string
): Promise<ProviderPaymentIntentDiscoveryResult> {
  const query = buildPaymentAttemptMetadataSearchQuery(paymentAttemptId)
  const matches: StripePaymentIntentLike[] = []
  let page: string | undefined

  for (let pageCount = 0; pageCount < PROVIDER_PAYMENT_INTENT_SEARCH_MAX_PAGES; pageCount += 1) {
    const result = await paymentIntents.search({
      query,
      limit: PROVIDER_PAYMENT_INTENT_SEARCH_PAGE_SIZE,
      ...(page ? { page } : {}),
    })
    matches.push(...(result.data ?? []))

    if (!result.has_more) {
      break
    }

    const nextPage =
      typeof result.next_page === "string" && result.next_page.trim().length > 0
        ? result.next_page
        : null
    if (!nextPage) {
      return {
        matches,
        reconciliation_required: true,
        unresolved: false,
        reason: "RECONCILIATION_REQUIRED",
      }
    }
    page = nextPage

    if (pageCount === PROVIDER_PAYMENT_INTENT_SEARCH_MAX_PAGES - 1) {
      return {
        matches,
        reconciliation_required: true,
        unresolved: false,
        reason: "RECONCILIATION_REQUIRED",
      }
    }
  }

  if (matches.length === 0) {
    return {
      matches: [],
      unresolved: true,
      reason: RECONCILIATION_REASON_CODE.PROVIDER_DISCOVERY_UNRESOLVED,
    }
  }

  if (matches.length === 1) {
    return {
      matches: [matches[0]],
      unresolved: false,
    }
  }

  return {
    matches,
    reconciliation_required: true,
    unresolved: false,
    reason: "RECONCILIATION_REQUIRED",
  }
}

export function createStripePaymentIntentsClient(
  secretKey: string
): StripePaymentIntentsClient {
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("STRIPE_REAL_SECRET_KEY_MUST_BE_TEST_MODE")
  }

  const stripe = new Stripe(secretKey, {
    maxNetworkRetries: 2,
  })

  return {
    create: async (params, options) =>
      (await stripe.paymentIntents.create(
        params,
        options
      )) as unknown as StripePaymentIntentLike,
    search: async (params, options) => {
      const result = await stripe.paymentIntents.search(params, options)
      return {
        data: result.data as unknown as StripePaymentIntentLike[],
        has_more: result.has_more,
        next_page: result.next_page ?? null,
      }
    },
    retrieve: async (id, options) =>
      (await stripe.paymentIntents.retrieve(
        id,
        options
      )) as unknown as StripePaymentIntentLike,
  }
}
