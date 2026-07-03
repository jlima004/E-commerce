import { model } from "@medusajs/framework/utils"
import { REFUND_REQUEST_STATUSES } from "../types"

const RefundRequest = model
  .define("refund_request", {
    id: model.id({ prefix: "refreq" }).primaryKey(),
    order_id: model.text(),
    payment_intent_id: model.text(),
    payment_attempt_id: model.text(),
    stripe_refund_id: model.text().nullable(),
    idempotency_key: model.text(),
    amount: model.number(),
    currency_code: model.text(),
    reason: model.text().nullable(),
    operator_note: model.text().nullable(),
    status: model.enum(REFUND_REQUEST_STATUSES).default("requested"),
    failure_code: model.text().nullable(),
    failure_message: model.text().nullable(),
    requested_by_operator_id: model.text().nullable(),
    confirmed_at: model.dateTime().nullable(),
    failed_at: model.dateTime().nullable(),
    canceled_at: model.dateTime().nullable(),
    rejected_at: model.dateTime().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      name: "IDX_refund_request_idempotency_key_unique",
      on: ["idempotency_key"],
      unique: true,
    },
    {
      name: "IDX_refund_request_stripe_refund_id_unique",
      on: ["stripe_refund_id"],
      unique: true,
    },
    {
      name: "IDX_refund_request_order_id",
      on: ["order_id"],
    },
    {
      name: "IDX_refund_request_payment_intent_id",
      on: ["payment_intent_id"],
    },
    {
      name: "IDX_refund_request_status",
      on: ["status"],
    },
  ])

export default RefundRequest
