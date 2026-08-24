import { model } from "@medusajs/framework/utils"

export const CART_REVIEW_STATUSES = [
  "pending",
  "acknowledged",
] as const

export type CartReviewStatus = (typeof CART_REVIEW_STATUSES)[number]

const CartReview = model
  .define("cart_review", {
    id: model.id({ prefix: "cmrev" }).primaryKey(),
    cart_id: model.text(),
    review_ref: model.text(),
    merge_result_id: model.text(),
    produced_cart_version: model.number(),
    status: model.enum([...CART_REVIEW_STATUSES]).default("pending"),
    rejected_items: model.json(),
    acknowledged_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "UQ_cart_review_review_ref",
      on: ["review_ref"],
      unique: true,
    },
    {
      name: "UQ_cart_review_merge_result",
      on: ["merge_result_id"],
      unique: true,
    },
    {
      name: "UQ_cart_review_pending_cart",
      on: ["cart_id"],
      unique: true,
      where: "status = 'pending' AND deleted_at IS NULL",
    },
    {
      name: "IDX_cart_review_cart_status",
      on: ["cart_id", "status"],
    },
  ])

export default CartReview
