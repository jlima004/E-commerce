import { model } from "@medusajs/framework/utils"
import { PAYMENT_ATTEMPT_STATUS } from "../types"

const PaymentAttempt = model
  .define("payment_attempt", {
    id: model.id({ prefix: "payatt" }).primaryKey(),
    cart_id: model.text(),
    payment_collection_id: model.text(),
    payment_session_id: model.text().nullable(),
    provider: model.text(),
    provider_payment_intent_id: model.text().nullable(),
    provider_payment_session_id: model.text().nullable(),
    payment_method_type: model.enum(["card", "pix"]),
    status: model
      .enum(PAYMENT_ATTEMPT_STATUS)
      .default(PAYMENT_ATTEMPT_STATUS.CREATED),
    amount: model.number(),
    currency_code: model.text(),
    expires_at: model.dateTime().nullable(),
    order_id: model.text().nullable(),
    metadata: model.json().nullable(),
    client_confirmed_at: model.dateTime().nullable(),
    instructions_displayed_at: model.dateTime().nullable(),
    awaiting_webhook_since: model.dateTime().nullable(),
    superseded_at: model.dateTime().nullable(),
    invalidated_at: model.dateTime().nullable(),
    canceled_at: model.dateTime().nullable(),
    failed_at: model.dateTime().nullable(),
    expired_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_payment_attempt_cart_id",
      on: ["cart_id"],
    },
    {
      name: "IDX_payment_attempt_status",
      on: ["status"],
    },
    {
      name: "IDX_payment_attempt_cart_provider_pi",
      on: ["cart_id", "provider_payment_intent_id"],
    },
    {
      name: "IDX_payment_attempt_provider_pi",
      on: ["provider_payment_intent_id"],
    },
  ])

export default PaymentAttempt
