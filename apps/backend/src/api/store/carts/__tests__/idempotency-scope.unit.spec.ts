import {
  guestCartCreateActorScope,
  guestCartCapabilityActorScope,
  customerActorScope,
  cartResourceScope,
  hashBffSecret,
} from "../idempotency-scope"
import {
  assertNoSensitiveStoreIdempotencyPersistence,
  hashStoreIdempotencyScope,
} from "../../../../modules/store-idempotency"

describe("Cart Idempotency Scopes (P15-D04 / P15-D07 / P15-D09)", () => {
  it("generates safe guestCartCreateActorScope with bff key hash", () => {
    const bffHash = hashBffSecret("test_bff_secret_val")
    const scope = guestCartCreateActorScope({ bffKeyHash: bffHash })

    expect(scope).toEqual({
      actor_type: "guest_create",
      bff_key_hash: bffHash,
    })

    // Must not contain forbidden keys or sensitive text
    expect(() => assertNoSensitiveStoreIdempotencyPersistence(scope)).not.toThrow()
    expect(scope).not.toHaveProperty("idempotency_key")
    expect(scope).not.toHaveProperty("token")
    expect(scope).not.toHaveProperty("secret")
  })

  it("generates safe guestCartCapabilityActorScope with token hash", () => {
    const tokenHash = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
    const scope = guestCartCapabilityActorScope({ tokenHash })

    expect(scope).toEqual({
      actor_type: "guest",
      token_hash: tokenHash,
    })

    expect(() => assertNoSensitiveStoreIdempotencyPersistence(scope)).not.toThrow()
    expect(scope).not.toHaveProperty("plaintext_token")
    expect(scope).not.toHaveProperty("token")
  })

  it("generates safe customerActorScope with customer id", () => {
    const scope = customerActorScope({ customerId: "cus_01HXYZ" })

    expect(scope).toEqual({
      actor_type: "customer",
      customer_id: "cus_01HXYZ",
    })

    expect(() => assertNoSensitiveStoreIdempotencyPersistence(scope)).not.toThrow()
    expect(scope).not.toHaveProperty("authorization")
    expect(scope).not.toHaveProperty("token")
  })

  it("generates safe cartResourceScope", () => {
    const scope = cartResourceScope({
      cartId: "cart_01HXYZ",
      operation: "store.carts.active.create",
    })

    expect(scope).toEqual({
      resource_type: "cart",
      cart_id: "cart_01HXYZ",
      operation: "store.carts.active.create",
    })

    expect(() => assertNoSensitiveStoreIdempotencyPersistence(scope)).not.toThrow()
  })

  it("hashes bff secrets into 64-char hex sha256 strings", () => {
    const hash1 = hashBffSecret("secret1")
    const hash2 = hashBffSecret("secret2")
    const hashEmpty = hashBffSecret("")

    expect(hash1).toMatch(/^[a-f0-9]{64}$/)
    expect(hash2).toMatch(/^[a-f0-9]{64}$/)
    expect(hash1).not.toBe(hash2)
    expect(hashEmpty).toMatch(/^[a-f0-9]{64}$/)
  })

  it("computes deterministic scope hashes for idempotent equality", () => {
    const scopeA1 = guestCartCreateActorScope({ bffKeyHash: "hash1" })
    const scopeA2 = guestCartCreateActorScope({ bffKeyHash: "hash1" })
    const scopeB = guestCartCreateActorScope({ bffKeyHash: "hash2" })

    expect(hashStoreIdempotencyScope(scopeA1)).toBe(hashStoreIdempotencyScope(scopeA2))
    expect(hashStoreIdempotencyScope(scopeA1)).not.toBe(hashStoreIdempotencyScope(scopeB))
  })
})
