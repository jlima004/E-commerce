import { model } from "@medusajs/framework/utils"
import {
  CHECKOUT_COMPLETION_OPERATION,
  CHECKOUT_COMPLETION_STATUS,
} from "../types"

const CheckoutCompletionLog = model
  .define("checkout_completion_log", {
    id: model.id({ prefix: "chkcpl" }).primaryKey(),
    operation: model
      .enum([CHECKOUT_COMPLETION_OPERATION.COMPLETE_CHECKOUT_CREATE_ORDER])
      .default(CHECKOUT_COMPLETION_OPERATION.COMPLETE_CHECKOUT_CREATE_ORDER),
    idempotency_key: model.text(),
    cart_id: model.text(),
    payment_intent_id: model.text(),
    payment_attempt_id: model.text().nullable(),
    order_id: model.text().nullable(),
    status: model
      .enum([
        CHECKOUT_COMPLETION_STATUS.PROCESSING,
        CHECKOUT_COMPLETION_STATUS.COMPLETED,
        CHECKOUT_COMPLETION_STATUS.FAILED,
      ])
      .default(CHECKOUT_COMPLETION_STATUS.PROCESSING),
    error_code: model.text().nullable(),
    error_message: model.text().nullable(),
    metadata: model.json().nullable(),
    locked_at: model.dateTime().nullable(),
    completed_at: model.dateTime().nullable(),
    failed_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_checkout_completion_log_idempotency_key",
      on: ["idempotency_key"],
      unique: true,
    },
    {
      name: "IDX_checkout_completion_log_payment_intent_id",
      on: ["payment_intent_id"],
    },
    {
      name: "IDX_checkout_completion_log_cart_id",
      on: ["cart_id"],
    },
    {
      name: "IDX_checkout_completion_log_payment_attempt_id",
      on: ["payment_attempt_id"],
    },
    {
      name: "IDX_checkout_completion_log_order_id",
      on: ["order_id"],
    },
    {
      name: "IDX_checkout_completion_log_status_locked_at",
      on: ["status", "locked_at"],
    },
  ])

export default CheckoutCompletionLog
