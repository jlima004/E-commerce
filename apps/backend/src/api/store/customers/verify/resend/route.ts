import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  handleCustomerAuthVerificationResend,
  runCustomerAuthVerificationResendRoute,
} from "../../me/verify/route"

export { handleCustomerAuthVerificationResend }

export async function POST(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  await runCustomerAuthVerificationResendRoute(req, res)
}
