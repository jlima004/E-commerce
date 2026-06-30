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

  console.log("[stripe-real-initiation] loader reached")
  console.log("[stripe-real-initiation] enabled:", env.STRIPE_REAL_INITIATION_ENABLED)
  console.log("[stripe-real-initiation] key prefix:", env.STRIPE_SECRET_KEY?.slice(0, 8))

  if (!env.STRIPE_REAL_INITIATION_ENABLED) {
    return
  }

  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_REAL_INITIATION_REQUIRES_TEST_SECRET")
  }

  const paymentIntents = createStripePaymentIntentsClient(env.STRIPE_SECRET_KEY)

  container.register({
    [STRIPE_CARD_INITIATION_LAYER]: asValue(
      new RealStripeCardInitiationLayer({
        paymentIntents,
      })
    ),
    [STRIPE_PIX_INITIATION_LAYER]: asValue(
      new RealStripePixInitiationLayer({
        paymentIntents,
        pixExpiresAfterSeconds: env.STRIPE_PIX_EXPIRES_AFTER_SECONDS,
      })
    ),
  })

  // container.registerAdd(
  //   STRIPE_CARD_INITIATION_LAYER,
  //   asValue(
  //     new RealStripeCardInitiationLayer({
  //       paymentIntents,
  //     })
  //   )
  // )

  // container.registerAdd(
  //   STRIPE_PIX_INITIATION_LAYER,
  //   asValue(
  //     new RealStripePixInitiationLayer({
  //       paymentIntents,
  //       pixExpiresAfterSeconds: env.STRIPE_PIX_EXPIRES_AFTER_SECONDS,
  //     })
  //   )
  // )

  console.log("[stripe-real-initiation] registered card/pix layers")

}
