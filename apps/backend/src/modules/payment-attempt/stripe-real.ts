import { createHash } from "crypto"
import Stripe from "stripe"
import type {
  StripeCardInitiationLayer,
  StripeCardInitiationRequest,
} from "./card"
import type {
  StripePixInitiationLayer,
  StripePixInitiationRequest,
} from "./pix"
import type { StripePaymentIntentLike } from "./stripe-safe"

export type StripePaymentIntentsClient = {
  create: (
    params: Stripe.PaymentIntentCreateParams,
    options?: Stripe.RequestOptions
  ) => Promise<StripePaymentIntentLike>
}

export type RealStripeInitiationLayerConfig = {
  paymentIntents: StripePaymentIntentsClient
  pixExpiresAfterSeconds?: number
}

const DEFAULT_PIX_EXPIRES_AFTER_SECONDS = 86_400
const MIN_PIX_EXPIRES_AFTER_SECONDS = 10
const MAX_PIX_EXPIRES_AFTER_SECONDS = 1_209_600

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

function correlationDigest(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 24)
}

function buildMetadata(
  request: StripeCardInitiationRequest | StripePixInitiationRequest,
  method: "card" | "pix"
): Stripe.MetadataParam {
  const digest = correlationDigest(`${method}:${request.idempotency_key}`)
  const paymentSessionId =
    "payment_session_id" in request ? request.payment_session_id : undefined

  return {
    cart_id: request.cart_id,
    session_id: paymentSessionId ?? `payses_${method}_${digest}`,
    correlation_id: digest,
  }
}

function buildRequestOptions(
  request: StripeCardInitiationRequest | StripePixInitiationRequest,
  method: "card" | "pix"
): Stripe.RequestOptions {
  return {
    idempotencyKey: `payment-attempt:${method}:${request.idempotency_key}`,
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
    const currency = assertBrlCurrency(request.currency_code)

    return await this.paymentIntents.create(
      {
        amount: request.amount_minor,
        currency,
        payment_method_types: ["card"],
        capture_method: "automatic",
        metadata: buildMetadata(request, "card"),
      },
      buildRequestOptions(request, "card")
    )
  }
}

export class RealStripePixInitiationLayer implements StripePixInitiationLayer {
  private readonly paymentIntents: StripePaymentIntentsClient
  private readonly pixExpiresAfterSeconds: number

  constructor(config: RealStripeInitiationLayerConfig) {
    this.paymentIntents = config.paymentIntents
    this.pixExpiresAfterSeconds = resolvePixExpiresAfterSeconds(
      config.pixExpiresAfterSeconds
    )
  }

  async createPixPaymentIntent(
    request: StripePixInitiationRequest
  ): Promise<StripePaymentIntentLike> {
    assertPositiveAmount(request.amount_minor)
    const currency = assertBrlCurrency(request.currency_code)

    return await this.paymentIntents.create(
      {
        amount: request.amount_minor,
        currency,
        payment_method_types: ["pix"],
        capture_method: "automatic",
        confirm: true,
        payment_method_data: {
          type: "pix",
        },
        payment_method_options: {
          pix: {
            expires_after_seconds: this.pixExpiresAfterSeconds,
          },
        },
        metadata: buildMetadata(request, "pix"),
      },
      buildRequestOptions(request, "pix")
    )
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
  }
}
