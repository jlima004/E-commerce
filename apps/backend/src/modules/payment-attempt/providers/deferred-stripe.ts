import type {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  ProviderWebhookPayload,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  WebhookActionResult,
} from "@medusajs/framework/types"
import {
  AbstractPaymentProvider,
  ModuleProvider,
  Modules,
  PaymentSessionStatus,
} from "@medusajs/framework/utils"

/**
 * Side-effect-free Payment provider boundary for PaymentAttempt sessions.
 *
 * PaymentAttempt owns the real Stripe initiation layer. The Medusa Payment
 * module still needs a public provider-backed API to persist a PaymentSession,
 * so this provider persists the local session without making a network request
 * or representing a provider-side payment effect. The real Stripe provider
 * remains registered separately for native Medusa flows.
 */
export class DeferredStripePaymentProvider extends AbstractPaymentProvider {
  static identifier = "stripe"

  constructor(
    cradle: Record<string, unknown>,
    config?: Record<string, unknown>
  ) {
    super(cradle, config)
  }

  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const sessionId =
      typeof input.data?.session_id === "string" && input.data.session_id
        ? input.data.session_id
        : "deferred-payment-session"

    return {
      id: sessionId,
      status: PaymentSessionStatus.PENDING,
      data: {},
    }
  }

  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    return {
      status: PaymentSessionStatus.PENDING,
      data: input.data,
    }
  }

  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    return { data: input.data }
  }

  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    return {
      status: PaymentSessionStatus.PENDING,
      data: input.data,
    }
  }

  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    return { data: input.data }
  }

  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    return { data: input.data }
  }

  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    return { data: input.data }
  }

  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    return { data: input.data }
  }

  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    return {
      status: PaymentSessionStatus.PENDING,
      data: input.data,
    }
  }

  async getWebhookActionAndData(
    _input: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    return { action: "not_supported" }
  }
}

export default ModuleProvider(Modules.PAYMENT, {
  services: [DeferredStripePaymentProvider],
})
