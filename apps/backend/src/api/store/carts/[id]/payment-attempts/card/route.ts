import { randomUUID } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  MedusaError,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import { rejectClientMoneyFields } from "../../../payment-attempts/validators"
import { storeCartPreOrderFields } from "../../../query-config"
import type { StoreCartPreOrderRecord } from "../../../serializers"
import {
  serializeCardPaymentAttemptResponse,
  STRIPE_CARD_INITIATION_LAYER,
  startCardPaymentAttempt,
  type StripeCardInitiationLayer,
} from "../../../../../../modules/payment-attempt/card"
import { resolveActiveCartIdentity } from "../../../../../../modules/checkout/active-cart"
import { PAYMENT_ATTEMPT_MODULE } from "../../../../../../modules/payment-attempt"
import type { PaymentAttemptRecord } from "../../../../../../modules/payment-attempt/types"

type SessionCapableRequest = MedusaRequest & {
  auth_context?: {
    actor_id?: string
    actor_type?: string
  }
  session?: {
    id?: string
    active_cart_id?: string
  }
  params?: {
    id?: string
  }
}

type PaymentAttemptModuleLike = {
  listPaymentAttempts?: (filters?: { cart_id?: string }) => Promise<PaymentAttemptRecord[]>
  createPaymentAttempts?: (
    data: PaymentAttemptRecord | PaymentAttemptRecord[]
  ) => Promise<PaymentAttemptRecord[]>
  updatePaymentAttempts?: (
    data: PaymentAttemptRecord | PaymentAttemptRecord[]
  ) => Promise<PaymentAttemptRecord[]>
}

const PAYMENT_ATTEMPT_LIST_ERROR_MESSAGE =
  "Falha ao consultar tentativas de pagamento."

function isStripeCardInitiationLayer(
  value: unknown
): value is StripeCardInitiationLayer {
  return (
    Boolean(value) &&
    typeof (value as StripeCardInitiationLayer).createCardPaymentIntent ===
      "function"
  )
}

function resolveStripeCardInitiationLayer(
  req: SessionCapableRequest
): StripeCardInitiationLayer {
  let layer: unknown

  try {
    layer = req.scope.resolve(STRIPE_CARD_INITIATION_LAYER)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Camada Stripe para cartao nao configurada."
    )
  }

  if (!isStripeCardInitiationLayer(layer)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Camada Stripe para cartao nao configurada."
    )
  }

  return layer
}

async function fetchCartById(
  req: SessionCapableRequest,
  cartId: string
): Promise<StoreCartPreOrderRecord & { total?: number | null }> {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart",
    variables: {
      filters: {
        id: cartId,
      },
    },
    fields: [...storeCartPreOrderFields, "total"],
  })

  const [cart] = (await remoteQuery(queryObject)) as Array<
    StoreCartPreOrderRecord & { total?: number | null }
  >

  if (!cart) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Cart with id '${cartId}' not found`
    )
  }

  return cart
}

async function listExistingAttemptsForCart(
  req: SessionCapableRequest,
  cartId: string
): Promise<PaymentAttemptRecord[]> {
  let service: PaymentAttemptModuleLike

  try {
    service = req.scope.resolve(
      PAYMENT_ATTEMPT_MODULE
    ) as PaymentAttemptModuleLike
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_LIST_ERROR_MESSAGE
    )
  }

  if (!service || typeof service.listPaymentAttempts !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_LIST_ERROR_MESSAGE
    )
  }

  try {
    return (await service.listPaymentAttempts({ cart_id: cartId })) ?? []
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      PAYMENT_ATTEMPT_LIST_ERROR_MESSAGE
    )
  }
}

async function persistCardPaymentAttemptResult(
  req: SessionCapableRequest,
  result: Awaited<ReturnType<typeof startCardPaymentAttempt>>
): Promise<void> {
  let service: PaymentAttemptModuleLike

  try {
    service = req.scope.resolve(PAYMENT_ATTEMPT_MODULE) as PaymentAttemptModuleLike
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao registrar tentativa de pagamento."
    )
  }

  if (!service || typeof service !== "object") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao registrar tentativa de pagamento."
    )
  }

  if (
    (result.supersededAttempts.length > 0 ||
      result.invalidatedAttempts.length > 0) &&
    typeof service.updatePaymentAttempts !== "function"
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao registrar tentativa de pagamento."
    )
  }

  if (typeof service.createPaymentAttempts !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao registrar tentativa de pagamento."
    )
  }

  try {
    for (const invalidated of result.invalidatedAttempts) {
      await service.updatePaymentAttempts?.(invalidated)
    }

    for (const superseded of result.supersededAttempts) {
      await service.updatePaymentAttempts?.(superseded)
    }

    await service.createPaymentAttempts(result.attempt)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao registrar tentativa de pagamento."
    )
  }
}

function resolvePaymentStartActor(req: SessionCapableRequest) {
  const identity = resolveActiveCartIdentity({
    auth_context: req.auth_context,
    session: req.session,
  })

  if (identity.actorType === "customer") {
    return {
      actorType: "customer" as const,
      actorId: identity.customerId,
      customerId: identity.customerId,
    }
  }

  return {
    actorType: "guest" as const,
    actorId: identity.sessionId ?? identity.actorId,
    sessionId: identity.sessionId,
  }
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const request = req as SessionCapableRequest
  const cartId = request.params?.id

  if (!cartId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Cart id obrigatorio.")
  }

  rejectClientMoneyFields(request.body)

  const cart = await fetchCartById(request, cartId)
  const actor = resolvePaymentStartActor(request)
  const existingAttempts = await listExistingAttemptsForCart(request, cartId)
  const stripeLayer = resolveStripeCardInitiationLayer(request)

  const result = await startCardPaymentAttempt({
    cart,
    actor,
    sessionActiveCartId: request.session?.active_cart_id,
    existingAttempts,
    stripeLayer,
    generateId: () => `payatt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    generatePaymentCollectionId: () =>
      `paycol_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
  })

  await persistCardPaymentAttemptResult(request, result)

  res.status(201).json({
    payment_attempt: serializeCardPaymentAttemptResponse(result.response),
  })
}
