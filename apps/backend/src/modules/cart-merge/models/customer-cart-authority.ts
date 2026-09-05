import { model } from "@medusajs/framework/utils"

export const CUSTOMER_CART_AUTHORITY_STATES = [
  "active",
  "superseded",
] as const

export type CustomerCartAuthorityState =
  (typeof CUSTOMER_CART_AUTHORITY_STATES)[number]

const CustomerCartAuthority = model
  .define("customer_cart_authority", {
    id: model.id({ prefix: "ccauth" }).primaryKey(),
    customer_id: model.text(),
    cart_id: model.text(),
    state: model
      .enum([...CUSTOMER_CART_AUTHORITY_STATES])
      .default("active"),
  })
  .indexes([
    {
      name: "UQ_customer_cart_authority_active_customer",
      on: ["customer_id"],
      unique: true,
      where: "state = 'active' AND deleted_at IS NULL",
    },
    {
      name: "UQ_customer_cart_authority_active_cart",
      on: ["cart_id"],
      unique: true,
      where: "state = 'active' AND deleted_at IS NULL",
    },
    {
      name: "IDX_customer_cart_authority_state",
      on: ["state"],
    },
  ])

export default CustomerCartAuthority
