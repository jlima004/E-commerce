import type { MedusaRequest } from "@medusajs/framework/http"
import { createPaymentCollectionForCartWorkflowId } from "@medusajs/core-flows"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils"
import type { SharedTransactionContext } from "../../../../../infrastructure/store-foundation-transaction-compatibility"

type SessionCapableRequest = MedusaRequest & {
  session?: {
    id?: string
    active_cart_id?: string
  }
}

export type MedusaPaymentCollectionRecord = {
  id?: string | null
  payment_sessions?: Array<{
    id?: string | null
    status?: string | null
    amount?: unknown
    currency_code?: string | null
    data?: Record<string, unknown> | null
  }> | null
}

export function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null
}

export async function fetchPaymentCollectionForCart(
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

export async function ensurePaymentCollectionForCart(
  req: SessionCapableRequest,
  cartId: string,
  sharedContext?: SharedTransactionContext
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
      options: { input: { cart_id: string } },
      sharedContext?: SharedTransactionContext
    ) => Promise<unknown>
  }

  if (!workflowEngine || typeof workflowEngine.run !== "function") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Falha ao iniciar PaymentCollection Medusa."
    )
  }

  const workflowInput = {
    input: { cart_id: cartId },
  }
  if (sharedContext && workflowEngine.run.length >= 3) {
    await workflowEngine.run(
      createPaymentCollectionForCartWorkflowId,
      workflowInput,
      sharedContext
    )
  } else {
    await workflowEngine.run(createPaymentCollectionForCartWorkflowId, workflowInput)
  }

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
