import { createHash } from "node:crypto"

export function hashBffSecret(secret: unknown): string {
  if (typeof secret !== "string" || secret.trim().length === 0) {
    return createHash("sha256").update("anonymous_bff", "utf8").digest("hex")
  }
  return createHash("sha256").update(secret.trim(), "utf8").digest("hex")
}

export type GuestCartCreateActorScope = {
  actor_type: "guest_create"
  bff_key_hash: string
}

export type GuestCartCapabilityActorScope = {
  actor_type: "guest"
  token_hash: string
}

export type CustomerActorScope = {
  actor_type: "customer"
  customer_id: string
}

export type CartResourceScope = {
  resource_type: "cart"
  cart_id: string
  operation: string
}

export function guestCartCreateActorScope(input: {
  bffKeyHash: string
}): GuestCartCreateActorScope {
  return {
    actor_type: "guest_create",
    bff_key_hash: input.bffKeyHash,
  }
}

export function guestCartCapabilityActorScope(input: {
  tokenHash: string
}): GuestCartCapabilityActorScope {
  return {
    actor_type: "guest",
    token_hash: input.tokenHash,
  }
}

export function customerActorScope(input: {
  customerId: string
}): CustomerActorScope {
  return {
    actor_type: "customer",
    customer_id: input.customerId,
  }
}

export function cartResourceScope(input: {
  cartId: string
  operation?: string
}): CartResourceScope {
  return {
    resource_type: "cart",
    cart_id: input.cartId,
    operation: input.operation ?? "store.carts",
  }
}
