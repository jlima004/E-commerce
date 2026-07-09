import { defineConfig } from "@medusajs/framework/utils"
import { env } from "./src/config/env"
import {
  buildRedisModules,
  redisOptionsForUrl,
  resolveProjectRedisUrl,
} from "./src/infrastructure/redis-config"
import { buildStorageModule } from "./src/infrastructure/storage-config"
import { medusaLogger } from "./src/observability/medusa-logger"

const projectRedisUrl = resolveProjectRedisUrl(env)
const projectRedisOptions = redisOptionsForUrl(projectRedisUrl)
const stripePaymentModule =
  env.STRIPE_REAL_INITIATION_ENABLED && env.STRIPE_SECRET_KEY
    ? [
        {
          resolve: "@medusajs/medusa/payment",
          options: {
            providers: [
              {
                resolve: "@medusajs/medusa/payment-stripe",
                id: "stripe",
                options: {
                  apiKey: env.STRIPE_SECRET_KEY,
                  webhookSecret: env.STRIPE_WEBHOOK_SECRET,
                  capture: true,
                },
              },
            ],
          },
        },
      ]
    : []

module.exports = defineConfig({
  logger: medusaLogger,
  admin: {
    path: "/app",
    backendUrl: env.API_PUBLIC_URL,
    disable: env.ADMIN_DISABLED,
  },
  projectConfig: {
    databaseUrl: env.DATABASE_URL,
    workerMode: env.WORKER_MODE,
    ...(projectRedisUrl ? { redisUrl: projectRedisUrl } : {}),
    ...(projectRedisOptions ? { redisOptions: projectRedisOptions } : {}),
    http: {
      storeCors: env.STORE_CORS,
      adminCors: env.ADMIN_CORS,
      authCors: env.AUTH_CORS,
      jwtSecret: env.JWT_SECRET,
      cookieSecret: env.COOKIE_SECRET,
    },
  },
  modules: [
    ...stripePaymentModule,
    ...buildRedisModules(env),
    ...buildStorageModule(env),
    {
      key: "webhooks",
      resolve: "./src/modules/webhooks",
    },
    {
      key: "checkoutCompletion",
      resolve: "./src/modules/checkout-completion",
    },
    {
      key: "analytics_event_log",
      resolve: "./src/modules/analytics-event-log",
    },
    {
      key: "email_delivery_log",
      resolve: "./src/modules/email-delivery-log",
    },
    {
      key: "gelato_fulfillment",
      resolve: "./src/modules/gelato-fulfillment",
    },
    {
      key: "tracking_access_token",
      resolve: "./src/modules/tracking-access-token",
    },
    {
      resolve: "./src/modules/payment-attempt",
    },
    {
      key: "refund_request",
      resolve: "./src/modules/refund-request",
    },
    {
      key: "exchange_request",
      resolve: "./src/modules/exchange-request",
    },
  ],
})
