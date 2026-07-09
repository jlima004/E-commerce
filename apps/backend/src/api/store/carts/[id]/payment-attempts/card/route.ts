import { randomUUID } from "crypto"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { createPaymentCollectionForCartWorkflowId } from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  PaymentSessionStatus,
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
import { assertPaymentStartEligible } from "../../../../../../modules/payment-attempt/eligibility"
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
  resolveStripeCardInitiationLayer?: () => StripeCardInitiationLayer | null
}

type MedusaPaymentSessionRecord = {
  id?: string | null
  status?: string | null
  amount?: unknown
  currency_code?: string | null
  data?: Record<string, unknown> | null
}

type MedusaPaymentCollectionRecord = {
  id?: string | null
  payment_sessions?: MedusaPaymentSessionRecord[] | null
}

type PaymentModuleLike = {
  createPaymentSession_?: (
    paymentCollectionId: string,
    data: {
      provider_id: string
      amount: number
      currency_code: string
      data?: Record<string, unknown>
      context?: Record<string, unknown>
      metadata?: Record<string, unknown>
    }
  ) => Promise<MedusaPaymentSessionRecord>
  updatePaymentSessions?: (
    data:
      | {
          id: string
          status?: string
          data?: Record<string, unknown>
        }
      | Array<{
          id: string
          status?: string
          data?: Record<string, unknown>
        }>
  ) => Promise<MedusaPaymentSessionRecord | MedusaPaymentSessionRecord[]>
}

const PAYMENT_ATTEMPT_LIST_ERROR_MESSAGE =
  "Falha ao consultar tentativas de pagamento."
const MEDUSA_STRIPE_PROVIDER_ID = "pp_stripe_stripe"
const PROCESSABLE_PAYMENT_SESSION_STATUSES = new Set<string>([
  PaymentSessionStatus.PENDING,
  PaymentSessionStatus.REQUIRES_MORE,
  PaymentSessionStatus.AUTHORIZED,
  PaymentSessionStatus.CAPTURED,
])

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
    try {
      const service = req.scope.resolve(
        PAYMENT_ATTEMPT_MODULE
      ) as PaymentAttemptModuleLike
      layer = service.resolveStripeCardInitiationLayer?.()
    } catch {
      layer = null
    }
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

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

async function fetchPaymentCollectionForCart(
  req: SessionCapableRequest,
  cartId: string
): Promise<MedusaPaymentCollectionRecord | null> {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY)
  const queryObject = remoteQueryObjectFromString({
    entryPoint: "cart_payment_collection",
    variables: {
      filters: {
        cart_id: cartId,
      },
    },
    fields: [
      "payment_collection.id",
      "payment_collection.payment_sessions.id",
      "payment_collection.payment_sessions.status",
      "payment_collection.payment_sessions.amount",
      "payment_collection.payment_sessions.currency_code",
      "payment_collection.payment_sessions.data",
    ],
  })

  const [relation] = (await remoteQuery(queryObject)) as Array<{
    payment_collection?: MedusaPaymentCollectionRecord | null
  }>

  return relation?.payment_collection ?? null
}

async function ensurePaymentCollectionForCart(
  req: SessionCapableRequest,
  cartId: string
): Promise<MedusaPaymentCollectionRecord & { id: string }> {
  const existing = await fetchPaymentCollectionForCart(req, cartId)
  const existingId = asNonEmptyString(existing?.id)

  if (existingId) {
    return {
      ...existing,
      id: existingId,
    }
  }

  const workflowEngine = req.scope.resolve(Modules.WORKFLOW_ENGINE) as {
    run?: (
      workflowId: string,
      options: { input: { cart_id: string } }
    ) => Promise<unknown>
  }

  if (!workflowEngine || typeof workflowEngine.run !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao iniciar PaymentCollection Medusa."
    )
  }

  await workflowEngine.run(createPaymentCollectionForCartWorkflowId, {
    input: { cart_id: cartId },
  })

  const created = await fetchPaymentCollectionForCart(req, cartId)
  const createdId = asNonEmptyString(created?.id)

  if (!createdId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PaymentCollection Medusa nao foi associada ao cart."
    )
  }

  return {
    ...created,
    id: createdId,
  }
}

function resolvePaymentModule(req: SessionCapableRequest): PaymentModuleLike {
  try {
    return req.scope.resolve(Modules.PAYMENT) as PaymentModuleLike
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Modulo Payment Medusa indisponivel."
    )
  }
}

async function cancelProcessablePaymentSessions(
  paymentModule: PaymentModuleLike,
  paymentCollection: MedusaPaymentCollectionRecord
): Promise<void> {
  const processableSessions = (paymentCollection.payment_sessions ?? []).filter(
    (session) => {
      const sessionId = asNonEmptyString(session.id)
      const status = asNonEmptyString(session.status)

      return (
        Boolean(sessionId) &&
        Boolean(status) &&
        PROCESSABLE_PAYMENT_SESSION_STATUSES.has(status as string)
      )
    }
  )

  if (!processableSessions.length) {
    return
  }

  if (typeof paymentModule.updatePaymentSessions !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao substituir PaymentSession Medusa anterior."
    )
  }

  await paymentModule.updatePaymentSessions(
    processableSessions.map((session) => ({
      id: asNonEmptyString(session.id) as string,
      status: PaymentSessionStatus.CANCELED,
    }))
  )
}

async function createMedusaCardPaymentSession(input: {
  req: SessionCapableRequest
  paymentCollection: MedusaPaymentCollectionRecord & { id: string }
  amount: number
  currencyCode: "BRL"
}): Promise<{ payment_collection_id: string; payment_session_id: string }> {
  const paymentModule = resolvePaymentModule(input.req)

  if (typeof paymentModule.createPaymentSession_ !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao iniciar PaymentSession Medusa."
    )
  }

  await cancelProcessablePaymentSessions(paymentModule, input.paymentCollection)

  const session = await paymentModule.createPaymentSession_(
    input.paymentCollection.id,
    {
      provider_id: MEDUSA_STRIPE_PROVIDER_ID,
      amount: input.amount,
      currency_code: input.currencyCode.toLowerCase(),
      data: {},
    }
  )
  const sessionId = asNonEmptyString(session?.id)

  if (!sessionId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PaymentSession Medusa nao foi criada."
    )
  }

  return {
    payment_collection_id: input.paymentCollection.id,
    payment_session_id: sessionId,
  }
}

function buildSafeMedusaPaymentSessionData(
  result: Awaited<ReturnType<typeof startCardPaymentAttempt>>
): Record<string, unknown> {
  const providerPaymentIntentId = result.attempt.provider_payment_intent_id

  if (!providerPaymentIntentId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "PaymentIntent Stripe ausente na tentativa de pagamento."
    )
  }

  return {
    id: providerPaymentIntentId,
    ...result.paymentSessionData,
  }
}

async function updateMedusaPaymentSessionAfterStripeInitiation(
  req: SessionCapableRequest,
  result: Awaited<ReturnType<typeof startCardPaymentAttempt>>
): Promise<void> {
  const paymentModule = resolvePaymentModule(req)

  if (typeof paymentModule.updatePaymentSessions !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao atualizar PaymentSession Medusa."
    )
  }

  await paymentModule.updatePaymentSessions({
    id: result.attempt.payment_session_id as string,
    status: PaymentSessionStatus.PENDING,
    data: buildSafeMedusaPaymentSessionData(result),
  })
}

async function cancelMedusaPaymentSession(
  req: SessionCapableRequest,
  paymentSessionId: string
): Promise<void> {
  try {
    const paymentModule = resolvePaymentModule(req)
    await paymentModule.updatePaymentSessions?.({
      id: paymentSessionId,
      status: PaymentSessionStatus.CANCELED,
    })
  } catch {
    return
  }
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
  const eligibility = assertPaymentStartEligible({
    cart,
    actor,
    paymentMethod: "card",
    sessionActiveCartId: request.session?.active_cart_id,
  })
  const existingAttempts = await listExistingAttemptsForCart(request, cartId)
  const stripeLayer = resolveStripeCardInitiationLayer(request)
  const paymentCollection = await ensurePaymentCollectionForCart(request, cartId)
  const paymentSession = await createMedusaCardPaymentSession({
    req: request,
    paymentCollection,
    amount: eligibility.amount,
    currencyCode: eligibility.currency_code,
  })

  let result: Awaited<ReturnType<typeof startCardPaymentAttempt>>

  try {
    result = await startCardPaymentAttempt({
      cart,
      actor,
      sessionActiveCartId: request.session?.active_cart_id,
      existingAttempts,
      stripeLayer,
      generateId: () => `payatt_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      paymentSession,
    })

    await updateMedusaPaymentSessionAfterStripeInitiation(request, result)
  } catch (error) {
    await cancelMedusaPaymentSession(request, paymentSession.payment_session_id)
    throw error
  }

  await persistCardPaymentAttemptResult(request, result)

  res.status(201).json({
    payment_attempt: serializeCardPaymentAttemptResponse(result.response),
  })
}
