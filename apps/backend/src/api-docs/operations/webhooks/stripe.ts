import {
  STRIPE_SIGNATURE_SECURITY,
  webhookErrorResponse,
} from "../../components"
import type { ContractRegistryBundle } from "../../registry"
import { webhookJsonResponse } from "./schemas"

const STRIPE_RAW_BODY_DESCRIPTION =
  "The request body must be the exact preserved request bytes used for Stripe signature verification before provider event processing. Parsed or reserialized JSON is not a substitute."

export function registerStripeWebhookOperation(
  registry: ContractRegistryBundle
): void {
  registry.registerOperation({
    surface: "webhooks",
    method: "POST",
    path: "/hooks/stripe",
    operationId: "webhookStripeReceive",
    summary: "Receive a signed Stripe webhook",
    description:
      "Authenticates and records Stripe webhook events. Supported events are payment_intent.succeeded, payment_intent.payment_failed, payment_intent.canceled, refund.created, refund.updated, refund.failed, and charge.refunded. A verified unsupported event is persisted as ignored. payment_intent.succeeded triggers the order-creation entrypoint after the payment-confirmation path; checkout routes are not represented as creating an Order. charge.refunded is informational and is not claimed as the final source of financial truth. Terminal event replays return the stored status with duplicate true and create no new side effect. A same-event nonterminal or concurrent duplicate also returns duplicate true if it completes, but may continue processing; this endpoint does not claim exclusive single-flight behavior.",
    tags: ["Stripe Webhooks"],
    security: [...STRIPE_SIGNATURE_SECURITY],
    parameters: [],
    requestBody: {
      required: true,
      description: STRIPE_RAW_BODY_DESCRIPTION,
      content: {
        "application/json": {
          schema: {
            $ref: "#/components/schemas/StripeWebhookEventRequest",
          },
        },
      },
    },
    responses: {
      "200": webhookJsonResponse(
        "Signed event acknowledged. The terminal result is processed, ignored, or failed; processing failures after persistence are acknowledged as failed and are not retried by replaying that terminal event.",
        "StripeWebhookAcknowledgementResponse"
      ),
      "400": webhookErrorResponse(
        "The exact raw body is missing, the stripe-signature header is missing, or signature verification failed. Codes are stripe_raw_body_required, stripe_signature_required, and stripe_signature_invalid."
      ),
      "503": webhookErrorResponse(
        "Stripe ingestion is disabled or the verification secret is not configured. These pre-verification configuration failures do not persist or process an event. Codes are stripe_webhook_ingestion_disabled and stripe_webhook_secret_not_configured."
      ),
    },
    sourceClassification: "project-custom",
    sourceFiles: [
      "apps/backend/src/api/hooks/stripe/route.ts",
      "apps/backend/src/api/hooks/stripe/refund-events.ts",
    ],
    testEvidence: [
      "apps/backend/src/api/hooks/stripe/__tests__/stripe-webhook-route.unit.spec.ts",
      "apps/backend/integration-tests/http/stripe-webhook-store.spec.ts",
      "apps/backend/integration-tests/http/stripe-refund-webhook.spec.ts",
    ],
    officialReference:
      "https://github.com/jlima004/E-commerce/blob/main/apps/backend/src/api/hooks/stripe/route.ts",
    inclusionReason:
      "Project-owned canonical payment and refund webhook boundary required for reliable post-confirmation processing.",
    interactiveCandidate: false,
    nonInteractive: true,
  })
}
