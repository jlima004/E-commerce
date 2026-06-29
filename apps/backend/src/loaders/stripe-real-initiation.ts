import type { LoaderOptions } from "@medusajs/framework/types"
import { asValue } from "@medusajs/framework/awilix"
import { env } from "../config/env"
import {
  STRIPE_CARD_INITIATION_LAYER,
} from "../modules/payment-attempt/card"
import {
  STRIPE_PIX_INITIATION_LAYER,
} from "../modules/payment-attempt/pix"
import {
  createStripePaymentIntentsClient,
  RealStripeCardInitiationLayer,
  RealStripePixInitiationLayer,
} from "../modules/payment-attempt/stripe-real"

export default async function stripeRealInitiationLoader({
  container,
}: LoaderOptions) {
  if (!env.STRIPE_REAL_INITIATION_ENABLED) {
    return
  }

  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_REAL_INITIATION_REQUIRES_TEST_SECRET")
  }

  const paymentIntents = createStripePaymentIntentsClient(env.STRIPE_SECRET_KEY)

  container.registerAdd(
    STRIPE_CARD_INITIATION_LAYER,
    asValue(
      new RealStripeCardInitiationLayer({
        paymentIntents,
      })
    )
  )

  container.registerAdd(
    STRIPE_PIX_INITIATION_LAYER,
    asValue(
      new RealStripePixInitiationLayer({
        paymentIntents,
        pixExpiresAfterSeconds: env.STRIPE_PIX_EXPIRES_AFTER_SECONDS,
      })
    )
  )
}
