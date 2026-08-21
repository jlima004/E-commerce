import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { executeLineItemMutation } from "../../../line-item-mutation"

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  await executeLineItemMutation(
    req as Parameters<typeof executeLineItemMutation>[0],
    res,
    "update"
  )
}
