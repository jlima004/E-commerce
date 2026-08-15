import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  handleCustomerAuthVerificationConfirm,
  runCustomerAuthVerificationConfirmRoute,
} from "../me/verify/route"

export { handleCustomerAuthVerificationConfirm }

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  await runCustomerAuthVerificationConfirmRoute(req, res)
}
