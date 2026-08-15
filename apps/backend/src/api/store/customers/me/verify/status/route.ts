import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { runCustomerAuthVerificationStatusRoute } from "../route"

export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  await runCustomerAuthVerificationStatusRoute(req, res)
}
