import { model } from "@medusajs/framework/utils"
import { CART_MERGE_OUTCOMES } from "../types"

const CartMergeResult = model
  .define("cart_merge_result", {
    id: model.id({ prefix: "cmres" }).primaryKey(),
    idempotency_record_id: model.text(),
    customer_id: model.text(),
    guest_cart_id: model.text(),
    customer_cart_id: model.text().nullable(),
    canonical_cart_id: model.text(),
    capability_id: model.text(),
    capability_hash: model.text().nullable(),
    request_fingerprint: model.text(),
    guest_version_before: model.number(),
    customer_version_before: model.number().nullable(),
    guest_version_after: model.number(),
    customer_version_after: model.number().nullable(),
    outcome: model.enum([...CART_MERGE_OUTCOMES]),
    rejected_items: model.json(),
    review_id: model.text().nullable(),
    review_ref: model.text().nullable(),
    original_public_cart_snapshot: model.json(),
    original_review_snapshot: model.json(),
    original_etag: model.text(),
    expires_at: model.dateTime(),
  })
  .indexes([
    {
      name: "UQ_cart_merge_result_idempotency_record",
      on: ["idempotency_record_id"],
      unique: true,
    },
    {
      name: "IDX_cart_merge_result_customer_id",
      on: ["customer_id"],
    },
    {
      name: "IDX_cart_merge_result_guest_cart_id",
      on: ["guest_cart_id"],
    },
    {
      name: "IDX_cart_merge_result_canonical_cart_id",
      on: ["canonical_cart_id"],
    },
    {
      name: "IDX_cart_merge_result_expires_at",
      on: ["expires_at"],
    },
  ])

export default CartMergeResult
