import type { MedusaContainer } from "@medusajs/framework/types"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { PAYMENT_ATTEMPT_MODULE } from "../../modules/payment-attempt"
import { assertPaymentAttemptEligibleForOrderCreation } from "../../modules/payment-attempt/state-machine"
import type { PaymentAttemptRecord } from "../../modules/payment-attempt/types"

export type CreateOrderFromConfirmedPaymentAttemptInput = {
  payment_attempt_id: string
  payment_intent_id: string
  stripe_event_id?: string | null
  correlation_id?: string | null
}

export type CreateOrderFromConfirmedPaymentAttemptResult = {
  status: "stub_no_op"
  payment_attempt_id: string
  payment_intent_id: string
  order_id: null
  stripe_event_id: string | null
  correlation_id: string | null
}

export class OrderCreationEntrypointError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "OrderCreationEntrypointError"
    this.code = code
  }
}

type PaymentAttemptModuleLike = {
  listPaymentAttempts?: (
    filters?: Record<string, unknown>
  ) => Promise<PaymentAttemptRecord[]>
}

function requireNonEmpty(value: string | null | undefined, code: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new OrderCreationEntrypointError(code, code)
  }
  return normalized
}

export function validateCreateOrderFromConfirmedPaymentAttemptInput(
  input: CreateOrderFromConfirmedPaymentAttemptInput
): CreateOrderFromConfirmedPaymentAttemptInput {
  return {
    payment_attempt_id: requireNonEmpty(
      input.payment_attempt_id,
      "ORDER_ENTRYPOINT_PAYMENT_ATTEMPT_ID_REQUIRED"
    ),
    payment_intent_id: requireNonEmpty(
      input.payment_intent_id,
      "ORDER_ENTRYPOINT_PAYMENT_INTENT_ID_REQUIRED"
    ),
    stripe_event_id: input.stripe_event_id?.trim() || null,
    correlation_id: input.correlation_id?.trim() || null,
  }
}

export function processCreateOrderFromConfirmedPaymentAttemptStub(
  attempt: PaymentAttemptRecord,
  input: CreateOrderFromConfirmedPaymentAttemptInput
): CreateOrderFromConfirmedPaymentAttemptResult {
  const validated = validateCreateOrderFromConfirmedPaymentAttemptInput(input)

  if (attempt.id !== validated.payment_attempt_id) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_PAYMENT_ATTEMPT_MISMATCH",
      "PaymentAttempt nao corresponde ao identificador informado."
    )
  }

  if (attempt.provider_payment_intent_id !== validated.payment_intent_id) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_PAYMENT_INTENT_MISMATCH",
      "PaymentIntent nao corresponde a tentativa informada."
    )
  }

  assertPaymentAttemptEligibleForOrderCreation(attempt)

  return {
    status: "stub_no_op",
    payment_attempt_id: attempt.id,
    payment_intent_id: validated.payment_intent_id,
    order_id: null,
    stripe_event_id: validated.stripe_event_id ?? null,
    correlation_id: validated.correlation_id ?? null,
  }
}

async function loadPaymentAttemptById(
  container: MedusaContainer,
  paymentAttemptId: string
): Promise<PaymentAttemptRecord> {
  const module = container.resolve(
    PAYMENT_ATTEMPT_MODULE
  ) as PaymentAttemptModuleLike

  if (!module || typeof module.listPaymentAttempts !== "function") {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_PAYMENT_ATTEMPT_MODULE_UNAVAILABLE",
      "Modulo de tentativa de pagamento nao configurado."
    )
  }

  const attempts =
    (await module.listPaymentAttempts?.({ id: paymentAttemptId })) ?? []
  const attempt = attempts.find((entry) => entry.id === paymentAttemptId)

  if (!attempt) {
    throw new OrderCreationEntrypointError(
      "ORDER_ENTRYPOINT_PAYMENT_ATTEMPT_NOT_FOUND",
      "Tentativa nao encontrada."
    )
  }

  return attempt
}

export async function runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
  container: MedusaContainer,
  input: CreateOrderFromConfirmedPaymentAttemptInput
): Promise<CreateOrderFromConfirmedPaymentAttemptResult> {
  const validated = validateCreateOrderFromConfirmedPaymentAttemptInput(input)
  const attempt = await loadPaymentAttemptById(
    container,
    validated.payment_attempt_id
  )

  return processCreateOrderFromConfirmedPaymentAttemptStub(attempt, validated)
}

const createOrderFromConfirmedPaymentAttemptStep = createStep(
  "create-order-from-confirmed-payment-attempt-stub",
  async (
    input: CreateOrderFromConfirmedPaymentAttemptInput,
    { container }
  ) => {
    const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
      container,
      input
    )
    return new StepResponse(result)
  }
)

export const createOrderFromConfirmedPaymentAttemptWorkflow = createWorkflow(
  "create-order-from-confirmed-payment-attempt",
  (input: CreateOrderFromConfirmedPaymentAttemptInput) => {
    const result = createOrderFromConfirmedPaymentAttemptStep(input)
    return new WorkflowResponse(result)
  }
)

export default createOrderFromConfirmedPaymentAttemptWorkflow
