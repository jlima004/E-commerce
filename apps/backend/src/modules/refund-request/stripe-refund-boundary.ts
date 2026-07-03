export type StripeRefundCreateInput = {
  payment_intent_id: string
  amount: number
  currency_code: string
  idempotency_key: string
  reason?: string | null
}

export type StripeRefundCreateResult = {
  stripe_refund_id: string
  status: "pending" | "succeeded" | "failed" | "canceled" | "requires_action"
}

export type StripeRefundCreationLayer = {
  createRefund: (
    input: StripeRefundCreateInput
  ) => Promise<StripeRefundCreateResult>
}

const STRIPE_REFUND_CREATION_LAYER_TOKEN = "stripeRefundCreationLayer"

export function isStripeRefundCreationLayer(
  value: unknown
): value is StripeRefundCreationLayer {
  return (
    Boolean(value) &&
    typeof (value as StripeRefundCreationLayer).createRefund === "function"
  )
}

export function resolveStripeRefundCreationLayer(
  dependencies: Record<string, unknown>
): StripeRefundCreationLayer | null {
  try {
    const layer = dependencies[STRIPE_REFUND_CREATION_LAYER_TOKEN]
    return isStripeRefundCreationLayer(layer) ? layer : null
  } catch {
    return null
  }
}

export function createFakeStripeRefundCreationLayer(input?: {
  createRefund?: StripeRefundCreationLayer["createRefund"]
}): StripeRefundCreationLayer {
  return {
    createRefund:
      input?.createRefund ??
      (async (createInput) => ({
        stripe_refund_id: `re_fake_${createInput.idempotency_key.replace(/[^a-z0-9]/gi, "_").slice(0, 24)}`,
        status: "pending",
      })),
  }
}

export { STRIPE_REFUND_CREATION_LAYER_TOKEN }
