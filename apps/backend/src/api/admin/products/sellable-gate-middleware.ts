import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import {
  validateAdminProductCreate,
  validateAdminProductUpdate,
  validateAdminVariantCreate,
  validateAdminVariantUpdate,
  type AdminProductPayload,
  type AdminVariantPayload,
} from "../../../workflows/catalog/validate-sellable-variant"

type ValidatedBodyRequest = MedusaRequest & {
  validatedBody?: AdminProductPayload | AdminVariantPayload
}

export async function sellableGateProductCreateMiddleware(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const body = (req as ValidatedBodyRequest).validatedBody as
    | AdminProductPayload
    | undefined

  if (!body) {
    next()
    return
  }

  await validateAdminProductCreate(req.scope, body)
  next()
}

export async function sellableGateProductUpdateMiddleware(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const body = (req as ValidatedBodyRequest).validatedBody as
    | AdminProductPayload
    | undefined
  const productId = req.params.id

  if (!body || !productId) {
    next()
    return
  }

  await validateAdminProductUpdate(req.scope, productId, body)
  next()
}

export async function sellableGateVariantCreateMiddleware(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const body = (req as ValidatedBodyRequest).validatedBody as
    | AdminVariantPayload
    | undefined
  const productId = req.params.id

  if (!body || !productId) {
    next()
    return
  }

  await validateAdminVariantCreate(req.scope, productId, body)
  next()
}

export async function sellableGateVariantUpdateMiddleware(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction
): Promise<void> {
  const body = (req as ValidatedBodyRequest).validatedBody as
    | AdminVariantPayload
    | undefined
  const productId = req.params.id
  const variantId = req.params.variant_id

  if (!body || !productId || !variantId) {
    next()
    return
  }

  await validateAdminVariantUpdate(req.scope, productId, variantId, body)
  next()
}
