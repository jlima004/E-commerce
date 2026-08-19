import { model } from "@medusajs/framework/utils"
import { GUEST_CART_CAPABILITY_STATUSES } from "../types"

const GuestCartCapability = model
  .define("guest_cart_capability", {
    id: model.id({ prefix: "gccap" }).primaryKey(),
    cart_id: model.text(),
    token_hash: model.text(),
    status: model.enum(GUEST_CART_CAPABILITY_STATUSES).default("active"),
    expires_at: model.dateTime(),
    consumed_at: model.dateTime().nullable(),
    revoked_at: model.dateTime().nullable(),
    last_used_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_guest_cart_capability_token_hash_unique",
      on: ["token_hash"],
      unique: true,
    },
    {
      name: "IDX_guest_cart_capability_cart_id_active_unique",
      on: ["cart_id"],
      unique: true,
      where: "status = 'active' AND deleted_at IS NULL",
    },
    {
      name: "IDX_guest_cart_capability_status_expires_at",
      on: ["status", "expires_at"],
    },
  ])

export default GuestCartCapability
