import { MedusaError } from "@medusajs/framework/utils"
import type { CatalogVariantInput } from "../catalog/types"
import {
  calculateCheckoutDataComplete,
  type CheckoutDataIncompleteReason,
  type CheckoutLineItemSnapshot,
} from "../checkout/checkout-data"
import {
  mapCartShippingAddressToBrazilInput,
  type StoreCartPreOrderRecord,
} from "../../api/store/carts/serializers"
import type { PaymentMethodType } from "./types"
import {
  assertNonNegativeBrlMinorAmount,
  assertPositiveBrlMinorAmount,
  brlMajorToMinor,
  normalizeBrlMajorAmount,
} from "../../utils/money-units"

export type PaymentStartActorContext = {
  actorType: "guest" | "customer"
  actorId: string
  customerId?: string
  sessionId?: string
}

export type PaymentStartCartLineItem = {
  id?: string
  quantity?: number | null
  unit_price?: number | null
  variant_id?: string | null
  variant?: CatalogVariantInput | null
}

export type PaymentStartCartSnapshot = StoreCartPreOrderRecord & {
  total?: number | null
  subtotal?: number | null
  item_total?: number | null
  shipping_total?: number | null
  tax_total?: number | null
  discount_total?: number | null
  order_id?: string | null
  completed_at?: string | Date | null
}

export type PaymentStartEligibilityInput = {
  cart: PaymentStartCartSnapshot
  actor: PaymentStartActorContext
  paymentMethod: PaymentMethodType
  sessionActiveCartId?: string | null
}

export type PaymentStartIneligibilityCode =
  | "CHECKOUT_DATA_INCOMPLETE"
  | "INVALID_CART_TOTAL"
  | "CART_ALREADY_COMPLETED"
  | "CART_ACCESS_DENIED"
  | "UNSUPPORTED_PAYMENT_METHOD"

export type PaymentStartEligibilitySuccess = {
  eligible: true
  checkout_data_complete: true
  medusa_amount_major: number
  provider_amount_minor: number
  currency_code: "BRL"
  cart_id: string
  payment_method_type: PaymentMethodType
}

export type PaymentStartEligibilityFailure = {
  eligible: false
  code: PaymentStartIneligibilityCode
  message: string
  incomplete_reasons?: CheckoutDataIncompleteReason[]
}

export type PaymentStartEligibilityResult =
  | PaymentStartEligibilitySuccess
  | PaymentStartEligibilityFailure

const SUPPORTED_PAYMENT_METHODS = new Set<PaymentMethodType>(["card", "pix"])

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined
}

function resolveRegionCountryCode(cart: PaymentStartCartSnapshot): string | null {
  const country = cart.region?.countries?.[0]?.iso_2
  return asTrimmedString(country)?.toLowerCase() ?? null
}

function resolveCheckoutActorType(
  cart: PaymentStartCartSnapshot
): "guest" | "customer" {
  return cart.customer?.id ? "customer" : "guest"
}

function toLineItemSnapshots(
  items: PaymentStartCartLineItem[] | null | undefined
): CheckoutLineItemSnapshot[] {
  return (items ?? []).map((item) => ({
    id: item.id,
    quantity: item.quantity,
    variant_id: item.variant_id,
    variant: item.variant ?? undefined,
  }))
}

function resolvePositiveBrlMajorToMinor(value: unknown): number | null {
  try {
    return assertPositiveBrlMinorAmount(brlMajorToMinor(value))
  } catch {
    return null
  }
}

function resolveNonNegativeBrlMajorToMinor(value: unknown): number | null {
  try {
    return assertNonNegativeBrlMinorAmount(brlMajorToMinor(value))
  } catch {
    return null
  }
}

function sumLineItemsTotalMinor(
  items: PaymentStartCartLineItem[] | null | undefined
): number | null {
  const lineItems = items ?? []
  if (lineItems.length === 0) {
    return null
  }

  let total = 0

  for (const item of lineItems) {
    const quantity = item.quantity
    const unitPrice = item.unit_price

    if (
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    ) {
      return null
    }

    if (!Number.isSafeInteger(quantity)) {
      return null
    }

    const unitPriceMinor = resolveNonNegativeBrlMajorToMinor(unitPrice)
    if (unitPriceMinor === null) {
      return null
    }

    const lineTotalMinor = unitPriceMinor * quantity
    if (!Number.isSafeInteger(lineTotalMinor) || lineTotalMinor <= 0) {
      return null
    }

    total += lineTotalMinor
    if (!Number.isSafeInteger(total)) {
      return null
    }
  }

  return total > 0 ? total : null
}

function resolveCalculatedItemsTotalMinor(
  cart: PaymentStartCartSnapshot
): number | null {
  for (const value of [cart.item_total, cart.subtotal]) {
    if (value === undefined || value === null) {
      continue
    }

    return resolvePositiveBrlMajorToMinor(value)
  }

  return sumLineItemsTotalMinor(cart.items)
}

function resolveOptionalCartComponentMinor(value: unknown): number | null {
  if (value === undefined || value === null) {
    return 0
  }

  return resolveNonNegativeBrlMajorToMinor(value)
}

function resolveCartAmounts(cart: PaymentStartCartSnapshot): {
  medusa_amount_major: number
  provider_amount_minor: number
} | null {
  if (cart.total !== undefined && cart.total !== null) {
    try {
      const medusaAmountMajor = normalizeBrlMajorAmount(cart.total)
      const providerAmountMinor = assertPositiveBrlMinorAmount(
        brlMajorToMinor(cart.total)
      )

      return {
        medusa_amount_major: medusaAmountMajor,
        provider_amount_minor: providerAmountMinor,
      }
    } catch {
      return null
    }
  }

  const lineItemsTotalMinor = resolveCalculatedItemsTotalMinor(cart)
  if (lineItemsTotalMinor === null) {
    return null
  }

  const shippingTotalMinor = resolveOptionalCartComponentMinor(
    cart.shipping_total
  )
  const taxTotalMinor = resolveOptionalCartComponentMinor(cart.tax_total)
  const discountTotalMinor = resolveOptionalCartComponentMinor(
    cart.discount_total
  )

  if (
    shippingTotalMinor === null ||
    taxTotalMinor === null ||
    discountTotalMinor === null
  ) {
    return null
  }

  const providerAmountMinor =
    lineItemsTotalMinor +
    shippingTotalMinor +
    taxTotalMinor -
    discountTotalMinor

  if (!Number.isSafeInteger(providerAmountMinor) || providerAmountMinor <= 0) {
    return null
  }

  return {
    medusa_amount_major: providerAmountMinor / 100,
    provider_amount_minor: providerAmountMinor,
  }
}

export function derivePaymentAmountFromCart(
  cart: PaymentStartCartSnapshot
): {
  medusa_amount_major: number
  provider_amount_minor: number
  currency_code: "BRL"
} | null {
  const currency = (cart.currency_code ?? "").toLowerCase()
  if (currency !== "brl") {
    return null
  }

  const amounts = resolveCartAmounts(cart)
  if (!amounts) {
    return null
  }

  return {
    ...amounts,
    currency_code: "BRL",
  }
}

function assertCartAccess(
  input: PaymentStartEligibilityInput
): PaymentStartEligibilityFailure | null {
  const { cart, actor, sessionActiveCartId } = input

  if (actor.actorType === "customer") {
    const customerId = actor.customerId ?? actor.actorId
    const cartCustomerId = asTrimmedString(cart.customer?.id)

    if (!cartCustomerId || cartCustomerId !== customerId) {
      return {
        eligible: false,
        code: "CART_ACCESS_DENIED",
        message: "Cart nao pertence ao cliente autenticado.",
      }
    }

    return null
  }

  const activeCartId = asTrimmedString(sessionActiveCartId)
  if (!activeCartId || activeCartId !== cart.id) {
    return {
      eligible: false,
      code: "CART_ACCESS_DENIED",
      message: activeCartId
        ? "Cart nao pertence a sessao atual."
        : "Sessao sem cart ativo vinculado.",
    }
  }

  return null
}

function assertPreOrderCart(
  cart: PaymentStartCartSnapshot
): PaymentStartEligibilityFailure | null {
  if (cart.order_id || cart.completed_at) {
    return {
      eligible: false,
      code: "CART_ALREADY_COMPLETED",
      message: "Cart ja concluido; pagamento pre-Order indisponivel.",
    }
  }

  return null
}

export function evaluatePaymentStartEligibility(
  input: PaymentStartEligibilityInput
): PaymentStartEligibilityResult {
  if (!SUPPORTED_PAYMENT_METHODS.has(input.paymentMethod)) {
    return {
      eligible: false,
      code: "UNSUPPORTED_PAYMENT_METHOD",
      message: "Metodo de pagamento nao suportado.",
    }
  }

  const accessFailure = assertCartAccess(input)
  if (accessFailure) {
    return accessFailure
  }

  const preOrderFailure = assertPreOrderCart(input.cart)
  if (preOrderFailure) {
    return preOrderFailure
  }

  const actorType = resolveCheckoutActorType(input.cart)
  const checkoutResult = calculateCheckoutDataComplete({
    actorType,
    guestEmail: input.cart.email,
    customerEmail: input.cart.customer?.email,
    shippingAddress: mapCartShippingAddressToBrazilInput(
      input.cart.shipping_address
    ),
    lineItems: toLineItemSnapshots(input.cart.items),
    currencyCode: input.cart.currency_code,
    regionCountryCode: resolveRegionCountryCode(input.cart) ?? "",
  })

  if (!checkoutResult.checkout_data_complete) {
    return {
      eligible: false,
      code: "CHECKOUT_DATA_INCOMPLETE",
      message: "Checkout incompleto; pagamento nao pode ser iniciado.",
      incomplete_reasons: checkoutResult.incomplete_reasons,
    }
  }

  const derived = derivePaymentAmountFromCart(input.cart)
  if (!derived) {
    return {
      eligible: false,
      code: "INVALID_CART_TOTAL",
      message: "Total do cart invalido para iniciar pagamento.",
    }
  }

  return {
    eligible: true,
    checkout_data_complete: true,
    medusa_amount_major: derived.medusa_amount_major,
    provider_amount_minor: derived.provider_amount_minor,
    currency_code: derived.currency_code,
    cart_id: input.cart.id,
    payment_method_type: input.paymentMethod,
  }
}

export function assertPaymentStartEligible(
  input: PaymentStartEligibilityInput
): PaymentStartEligibilitySuccess {
  const result = evaluatePaymentStartEligibility(input)

  if (!result.eligible) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, result.message)
  }

  return result
}
