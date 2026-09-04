import fs from "fs"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createProductsWorkflow,
  createPaymentCollectionForCartWorkflow,
  completeCartWorkflow,
} from "@medusajs/core-flows"
import { STORE_RESOURCE_VERSION_MODULE } from "../../store-resource-version"
import { PAYMENT_ATTEMPT_MODULE } from "../../payment-attempt"
import {
  acquireCheckoutOrderBirthAuthorityInTransaction,
  markOrderBirthExecutionStartedInTransaction,
} from "../service"
import { ensureCartOrderBirthMarkerDurable } from "../../../workflows/order/order-birth-marker"

// Load bootstrap helper
const { startApp } = require("@medusajs/test-utils/dist/medusa-test-runner-utils/bootstrap-app")

async function runProcessA() {
  const databaseUrl = process.env.DATABASE_URL
  const outputPath = process.env.C1_PROCESS_A_OUTPUT
  const identity = process.env.C1_IDENTITY ?? `c1_proc_a_${Date.now()}`

  if (!databaseUrl || !outputPath) {
    console.error("Missing DATABASE_URL or C1_PROCESS_A_OUTPUT")
    process.exit(1)
  }

  process.env.NODE_ENV = "test"
  process.env.ADMIN_DISABLED = "true"
  process.env.DISABLE_MEDUSA_ADMIN = "true"
  process.env.MEDUSA_ADMIN_DISABLED = "true"
  process.env.RESEND_ORDER_CONFIRMATION_ENABLED = "false"
  process.env.JWT_SECRET = "test-jwt-secret-canonical-proof"
  process.env.COOKIE_SECRET = "test-cookie-secret-canonical-proof"

  // 1. Bootstrap Medusa container
  const { container } = await startApp({
    cwd: process.cwd(),
    env: {
      DATABASE_URL: databaseUrl,
      ADMIN_DISABLED: "true",
      NODE_ENV: "test",
      DISABLE_MEDUSA_ADMIN: "true",
      MEDUSA_ADMIN_DISABLED: "true",
      RESEND_ORDER_CONFIRMATION_ENABLED: "false",
      JWT_SECRET: "test-jwt-secret-canonical-proof",
      COOKIE_SECRET: "test-cookie-secret-canonical-proof",
    },
  })

  const handleIdentity = identity.replace(/_/g, "-")
  const fulfillmentModule = container.resolve(Modules.FULFILLMENT)
  const cartModule = container.resolve(Modules.CART)
  const paymentModule = container.resolve(Modules.PAYMENT)

  // 2. Seed prerequisites
  const shippingProfile = await fulfillmentModule.createShippingProfiles({
    name: `No shipping ${identity}`,
    type: "default",
  })

  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: `C1 Proof Product ${identity}`,
          handle: `c1-proof-${handleIdentity}`,
          shipping_profile_id: shippingProfile.id,
          options: [{ title: "Size", values: ["M"] }],
          variants: [
            {
              title: "M",
              sku: `SKU-${identity}`,
              options: { Size: "M" },
              manage_inventory: false,
              allow_backorder: true,
              metadata: {
                gelato_product_uid: `gelato_${identity}`,
                gelato_template_id: `template_${identity}`,
                gelato_variant_options: { size: "M", color: "Preto" },
                template_mode: "fixed",
              },
              prices: [{ amount: 100, currency_code: "brl" }],
            },
          ],
        },
      ],
    },
  })

  const variant = products[0].variants[0]
  const email = `${identity}@c1-crash-proof.test`
  const cart = await cartModule.createCarts({
    currency_code: "brl",
    email,
    items: [
      {
        title: `C1 item ${identity}`,
        quantity: 1,
        unit_price: 100,
        variant_id: variant.id,
        variant_sku: variant.sku,
        requires_shipping: false,
        is_custom_price: true,
      },
    ],
  })

  const { result: paymentCollection } =
    await createPaymentCollectionForCartWorkflow(container).run({
      input: { cart_id: cart.id },
    })

  const paymentSession = await paymentModule.createPaymentSession(
    paymentCollection.id,
    {
      provider_id: "pp_system_default",
      amount: 100,
      currency_code: "brl",
      data: {},
    }
  )
  await paymentModule.authorizePaymentSession(paymentSession.id, {})

  const resourceVersionModule = container.resolve(STORE_RESOURCE_VERSION_MODULE)
  const cartResourceVersion =
    await resourceVersionModule.baseRepository_.transaction(
      async (transactionManager: unknown) =>
        resourceVersionModule.initialize("cart", cart.id, {
          __type: "MedusaContext",
          transactionManager,
          manager: transactionManager,
        })
    )

  const paymentAttemptId = `payatt_${identity}`
  const paymentIntentId = `pi_${identity}`
  const paymentAttemptModule = container.resolve(PAYMENT_ATTEMPT_MODULE)

  await paymentAttemptModule.createPaymentAttempts({
    id: paymentAttemptId,
    cart_id: cart.id,
    payment_collection_id: paymentCollection.id,
    payment_session_id: paymentSession.id,
    provider: "stripe",
    provider_payment_intent_id: paymentIntentId,
    provider_payment_session_id: `ps_${identity}`,
    payment_method_type: "card",
    status: "payment_confirmed_by_webhook",
    amount: 10000,
    currency_code: "brl",
    metadata: { cart_resource_version: cartResourceVersion.version },
    awaiting_webhook_since: new Date("2026-08-09T12:00:00.000Z"),
  })

  // 3. Acquire CCL and persist Cart marker
  const connection = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
  const authorityResult = await acquireCheckoutOrderBirthAuthorityInTransaction(
    connection,
    {
      cart_id: cart.id,
      payment_attempt_id: paymentAttemptId,
      payment_intent_id: paymentIntentId,
      idempotency_key: `idemp_${identity}`,
      at: new Date(),
    }
  )

  const ccl = authorityResult.authority

  // Persist Cart marker
  await ensureCartOrderBirthMarkerDurable(container, cart.id, ccl.id)

  // CAS execution_started_at
  const casResult = await markOrderBirthExecutionStartedInTransaction(
    connection,
    {
      id: ccl.id,
      cart_id: cart.id,
      payment_attempt_id: paymentAttemptId,
      payment_intent_id: paymentIntentId,
      at: new Date(),
    }
  )

  if (!casResult.won) {
    console.error("CAS lost unexpectedly in Process A")
    process.exit(1)
  }

  // 4. Intercept link.create for REAL C1 failpoint
  // (AFTER createOrdersStep physical commit, BEFORE order_cart link creation)
  const realLink = container.resolve(ContainerRegistrationKeys.LINK) as any
  const realLinkCreate = realLink.create.bind(realLink)

  realLink.create = async (data: any[]) => {
    const hasOrderCart =
      Array.isArray(data) &&
      data.some(
        (item) => item[Modules.ORDER]?.order_id && item[Modules.CART]?.cart_id
      )

    if (hasOrderCart) {
      const orderLink = data.find((item) => item[Modules.ORDER])
      const crashedOrderId = orderLink[Modules.ORDER].order_id

      // Write non-sensitive identifiers to output file for verification and Process B
      fs.writeFileSync(
        outputPath,
        JSON.stringify({
          crashedOrderId,
          cartId: cart.id,
          cclId: ccl.id,
          paymentAttemptId,
          paymentIntentId,
          email,
        })
      )

      // REAL C1 PROCESS CRASH: exit immediately!
      // Order X is committed, order_cart is NOT created, no compensation can run!
      process.exit(42)
    }

    return realLinkCreate(data)
  }

  // 5. Invoke completeCartWorkflow
  await completeCartWorkflow(container).run({
    input: { id: cart.id },
    context: { transactionId: ccl.id },
  })

  // If we reach here, the interceptor did not trigger!
  console.error("C1 crash interceptor did not trigger!")
  process.exit(1)
}

runProcessA().catch((err) => {
  console.error("Process A error:", err)
  process.exit(1)
})
