import {
  ContainerRegistrationKeys,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  assertSellableVariantMetadata,
  isSellableVariant,
} from "../../modules/catalog/gelato-metadata"
import type { CatalogVariantInput } from "../../modules/catalog/types"
import { toSellableVariantMedusaError } from "../../api/admin/products/validators"

export { isSellableVariant }

export type AdminVariantPayload = {
  id?: string
  metadata?: Record<string, unknown> | null
  prices?: CatalogVariantInput["prices"]
}

export type AdminProductPayload = {
  status?: ProductStatus | string | null
  variants?: AdminVariantPayload[]
}

export type ValidateSellableCatalogMutationInput = {
  productStatus: ProductStatus | string
  isPublishing: boolean
  variants: CatalogVariantInput[]
}

const validateSellableCatalogMutationStepId =
  "validate-sellable-catalog-mutation"

export function resolvesPublishedProductStatus(
  status: ProductStatus | string | null | undefined
): boolean {
  return status === ProductStatus.PUBLISHED
}

export function isPublishingProduct(input: {
  currentStatus: ProductStatus | string
  nextStatus?: ProductStatus | string | null
}): boolean {
  const nextStatus = input.nextStatus ?? input.currentStatus

  return (
    input.currentStatus !== ProductStatus.PUBLISHED &&
    nextStatus === ProductStatus.PUBLISHED
  )
}

export function shouldEnforceSellableGate(input: {
  productStatus: ProductStatus | string
  isPublishing: boolean
}): boolean {
  return (
    input.isPublishing || resolvesPublishedProductStatus(input.productStatus)
  )
}

export function mergeVariantForValidation(
  existing: CatalogVariantInput,
  update: AdminVariantPayload
): CatalogVariantInput {
  const mergedMetadata =
    update.metadata !== undefined
      ? update.metadata === null
        ? null
        : {
            ...(existing.metadata ?? {}),
            ...update.metadata,
          }
      : existing.metadata

  return {
    ...existing,
    id: update.id ?? existing.id,
    metadata: mergedMetadata,
    prices: update.prices ?? existing.prices,
  }
}

export function toCatalogVariantInput(
  variant: AdminVariantPayload
): CatalogVariantInput {
  return {
    id: variant.id,
    metadata: variant.metadata,
    prices: variant.prices,
  }
}

export function validateSellableVariants(variants: CatalogVariantInput[]): void {
  for (const variant of variants) {
    assertSellableVariantMetadata(variant)
  }
}

export function validateSellableCatalogMutation(
  input: ValidateSellableCatalogMutationInput
): void {
  if (!shouldEnforceSellableGate(input)) {
    return
  }

  try {
    validateSellableVariants(input.variants)
  } catch (error) {
    throw toSellableVariantMedusaError(error)
  }
}

export const validateSellableCatalogMutationStep = createStep(
  validateSellableCatalogMutationStepId,
  async (input: ValidateSellableCatalogMutationInput) => {
    validateSellableCatalogMutation(input)
    return new StepResponse(undefined)
  }
)

export const validateSellableCatalogMutationWorkflow = createWorkflow(
  "validate-sellable-catalog-mutation",
  (input: ValidateSellableCatalogMutationInput) => {
    validateSellableCatalogMutationStep(input)
    return new WorkflowResponse(undefined)
  }
)

type ProductGraphRow = {
  id: string
  status?: ProductStatus | string
  variants?: Array<{
    id: string
    sku?: string | null
    metadata?: Record<string, unknown> | null
    prices?: CatalogVariantInput["prices"]
  }>
}

type VariantGraphRow = {
  id: string
  sku?: string | null
  metadata?: Record<string, unknown> | null
  prices?: CatalogVariantInput["prices"]
  product?: {
    id: string
    status?: ProductStatus | string
  }
}

async function fetchProductWithVariants(
  container: MedusaContainer,
  productId: string
): Promise<ProductGraphRow | undefined> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "status",
      "variants.id",
      "variants.sku",
      "variants.metadata",
      "variants.prices.*",
    ],
    filters: { id: productId },
  })

  return data?.[0] as ProductGraphRow | undefined
}

async function fetchVariantWithProduct(
  container: MedusaContainer,
  productId: string,
  variantId: string
): Promise<VariantGraphRow | undefined> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "sku",
      "metadata",
      "prices.*",
      "product.id",
      "product.status",
    ],
    filters: { id: variantId, product_id: productId },
  })

  return data?.[0] as VariantGraphRow | undefined
}

function mapGraphVariant(variant: {
  id: string
  sku?: string | null
  metadata?: Record<string, unknown> | null
  prices?: CatalogVariantInput["prices"]
}): CatalogVariantInput {
  return {
    id: variant.id,
    sku: variant.sku ?? undefined,
    metadata: variant.metadata,
    prices: variant.prices,
  }
}

export async function runValidateSellableCatalogMutation(
  container: MedusaContainer,
  input: ValidateSellableCatalogMutationInput
): Promise<void> {
  await validateSellableCatalogMutationWorkflow(container).run({ input })
}

export async function validateAdminProductCreate(
  container: MedusaContainer,
  body: AdminProductPayload
): Promise<void> {
  const status = body.status ?? ProductStatus.DRAFT
  const variants = (body.variants ?? []).map(toCatalogVariantInput)

  await runValidateSellableCatalogMutation(container, {
    productStatus: status,
    isPublishing: status === ProductStatus.PUBLISHED,
    variants,
  })
}

export async function validateAdminProductUpdate(
  container: MedusaContainer,
  productId: string,
  body: AdminProductPayload
): Promise<void> {
  const product = await fetchProductWithVariants(container, productId)

  if (!product) {
    return
  }

  const currentStatus = product.status ?? ProductStatus.DRAFT
  const nextStatus = body.status ?? currentStatus
  const publishing = isPublishingProduct({
    currentStatus,
    nextStatus,
  })

  let variants: CatalogVariantInput[] = []

  if (body.variants?.length) {
    const existingById = new Map(
      (product.variants ?? []).map((variant) => [variant.id, variant])
    )

    variants = body.variants.map((variantPayload) => {
      if (variantPayload.id && existingById.has(variantPayload.id)) {
        return mergeVariantForValidation(
          mapGraphVariant(existingById.get(variantPayload.id)!),
          variantPayload
        )
      }

      return toCatalogVariantInput(variantPayload)
    })
  } else if (publishing || nextStatus === ProductStatus.PUBLISHED) {
    variants = (product.variants ?? []).map(mapGraphVariant)
  }

  await runValidateSellableCatalogMutation(container, {
    productStatus: nextStatus,
    isPublishing: publishing,
    variants,
  })
}

export async function validateAdminVariantCreate(
  container: MedusaContainer,
  productId: string,
  body: AdminVariantPayload
): Promise<void> {
  const product = await fetchProductWithVariants(container, productId)

  if (!product) {
    return
  }

  await runValidateSellableCatalogMutation(container, {
    productStatus: product.status ?? ProductStatus.DRAFT,
    isPublishing: false,
    variants: [toCatalogVariantInput(body)],
  })
}

export async function validateAdminVariantUpdate(
  container: MedusaContainer,
  productId: string,
  variantId: string,
  body: AdminVariantPayload
): Promise<void> {
  const variant = await fetchVariantWithProduct(container, productId, variantId)

  if (!variant?.product) {
    return
  }

  const merged = mergeVariantForValidation(mapGraphVariant(variant), body)

  await runValidateSellableCatalogMutation(container, {
    productStatus: variant.product.status ?? ProductStatus.DRAFT,
    isPublishing: false,
    variants: [merged],
  })
}
