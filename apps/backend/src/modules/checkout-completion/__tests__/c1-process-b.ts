import fs from "fs"
import { runCreateOrderFromConfirmedPaymentAttemptEntrypoint } from "../../../workflows/order/webhook-order-entrypoint"

const { startApp } = require("@medusajs/test-utils/dist/medusa-test-runner-utils/bootstrap-app")

async function runProcessB() {
  const databaseUrl = process.env.DATABASE_URL
  const inputPath = process.env.C1_PROCESS_B_INPUT
  const outputPath = process.env.C1_PROCESS_B_OUTPUT

  if (!databaseUrl || !inputPath || !outputPath) {
    console.error("Missing DATABASE_URL, C1_PROCESS_B_INPUT or C1_PROCESS_B_OUTPUT")
    process.exit(1)
  }

  const input = JSON.parse(fs.readFileSync(inputPath, "utf8"))

  process.env.NODE_ENV = "test"
  process.env.ADMIN_DISABLED = "true"
  process.env.DISABLE_MEDUSA_ADMIN = "true"
  process.env.MEDUSA_ADMIN_DISABLED = "true"
  process.env.RESEND_ORDER_CONFIRMATION_ENABLED = "false"
  process.env.JWT_SECRET = "test-jwt-secret-canonical-proof"
  process.env.COOKIE_SECRET = "test-cookie-secret-canonical-proof"

  // 1. Fresh Node process, fresh container, completely unshared memory with Process A
  const { container, shutdown } = await startApp({
    cwd: process.cwd(),
    env: {
      DATABASE_URL: databaseUrl,
      ADMIN_DISABLED: "true",
      NODE_ENV: "test",
      DISABLE_MEDUSA_ADMIN: "true",
      MEDUSA_ADMIN_DISABLED: "true",
      RESEND_ORDER_CONFIRMATION_ENABLED: "false",
      JWT_SECRET: "test-jwt-secret-canonical-proof",
      COOKIE_SECRET: "test-cookie-secret-canonical-proof",
    },
  })

  // 2. Instrument completeCart to prove it is NEVER called during recovery
  let completeCartInvocations = 0

  // 3. Run canonical recovery coordinator
  const result = await runCreateOrderFromConfirmedPaymentAttemptEntrypoint(
    container,
    {
      payment_attempt_id: input.paymentAttemptId,
      payment_intent_id: input.paymentIntentId,
      stripe_event_id: `evt_c1_proc_b_${Date.now()}`,
      correlation_id: `corr_c1_proc_b_${Date.now()}`,
    },
    {
      runCompleteCart: async () => {
        completeCartInvocations += 1
        throw new Error("COMPLETE_CART_MUST_NOT_BE_INVOKED_DURING_C1_RECOVERY")
      },
    }
  )

  // 4. Write recovery result for parent verification
  fs.writeFileSync(
    outputPath,
    JSON.stringify({
      recoveredOrderId: result.order_id,
      status: result.status,
      checkoutCompletionStatus: result.checkout_completion_status,
      completeCartInvocations,
    })
  )

  // 5. Clean shutdown and exit 0
  if (shutdown) {
    await shutdown()
  }

  process.exit(0)
}

runProcessB().catch((err) => {
  console.error("Process B error:", err)
  process.exit(1)
})
