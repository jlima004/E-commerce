import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { env } from "../config/env"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import {
  runPaymentAttemptReconciliation,
  type PaymentAttemptReconcilerDeps,
  type PaymentAttemptReconcilerResult,
} from "../reconciliation/payment-attempt-reconciler"
import { createStripePaymentIntentsClient } from "../modules/payment-attempt/stripe-real"
import { runCreateOrderFromConfirmedPaymentAttemptEntrypoint } from "../workflows/order/webhook-order-entrypoint"

export function isWorkerMode(
  inputEnv: Record<string, string | undefined> = process.env
): boolean {
  return (
    inputEnv.WORKER_MODE === "worker" || inputEnv.MEDUSA_WORKER_MODE === "worker"
  )
}

export async function runPaymentAttemptReconciliationJob(
  container: MedusaContainer,
  overrides?: Partial<PaymentAttemptReconcilerDeps>
): Promise<PaymentAttemptReconcilerResult> {
  const connection =
    overrides?.connection ??
    (container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as any)
  const logger =
    overrides?.logger ?? (container.resolve("logger") as any)

  let stripeClient = overrides?.stripeClient
  if (!stripeClient) {
    const stripeKey = env.STRIPE_SECRET_KEY
    if (stripeKey) {
      try {
        stripeClient = createStripePaymentIntentsClient(stripeKey) as any
      } catch (clientErr) {
        logger?.warn?.(
          "Failed to initialize StripePaymentIntentsClient for reconciliation",
          {
            error:
              clientErr instanceof Error
                ? clientErr.message
                : String(clientErr),
          }
        )
      }
    }
  }

  return runPaymentAttemptReconciliation({
    connection,
    stripeClient,
    logger,
    container,
    runOrderEntrypoint: runCreateOrderFromConfirmedPaymentAttemptEntrypoint,
    ...overrides,
  })
}

export default async function paymentAttemptReconciliationJob(
  container: MedusaContainer
) {
  if (!isWorkerMode()) {
    return
  }
  try {
    if (isReleaseMigrationMode()) {
      return
    }
  } catch {
    return
  }

  await runPaymentAttemptReconciliationJob(container)
}

export const config = {
  name: "payment-attempt-reconciliation",
  schedule: "*/5 * * * *",
}
