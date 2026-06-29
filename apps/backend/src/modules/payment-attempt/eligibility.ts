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
  amount: number
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function sumLineItemsTotalCents(
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
      quantity <= 0 ||
      typeof unitPrice !== "number" ||
      !Number.isFinite(unitPrice) ||
      unitPrice < 0
    ) {
      return null
    }

    const lineTotal = Math.round(unitPrice * quantity)
    if (!Number.isInteger(lineTotal) || lineTotal <= 0) {
      return null
    }

    total += lineTotal
  }

  return total > 0 ? total : null
}

function resolveCartTotalCents(cart: PaymentStartCartSnapshot): number | null {
  if (cart.total !== undefined && cart.total !== null) {
    return isPositiveInteger(cart.total) ? cart.total : null
  }

  const lineItemsTotal = sumLineItemsTotalCents(cart.items)
  if (lineItemsTotal === null) {
    return null
  }

  let total = lineItemsTotal

  if (typeof cart.shipping_total === "number" && Number.isFinite(cart.shipping_total)) {
    total += Math.round(cart.shipping_total)
  }

  if (typeof cart.tax_total === "number" && Number.isFinite(cart.tax_total)) {
    total += Math.round(cart.tax_total)
  }

  if (
    typeof cart.discount_total === "number" &&
    Number.isFinite(cart.discount_total)
  ) {
    total -= Math.round(cart.discount_total)
  }

  return total > 0 && Number.isInteger(total) ? total : null
}

export function derivePaymentAmountFromCart(
  cart: PaymentStartCartSnapshot
): { amount: number; currency_code: "BRL" } | null {
  const currency = (cart.currency_code ?? "").toLowerCase()
  if (currency !== "brl") {
    return null
  }

  const amount = resolveCartTotalCents(cart)
  if (amount === null) {
    return null
  }

  return {
    amount,
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
    amount: derived.amount,
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
