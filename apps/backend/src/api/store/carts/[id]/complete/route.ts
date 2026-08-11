/**
 * Defense-in-depth override for native POST /store/carts/{id}/complete.
 *
 * Local route registration replaces the Medusa 2.16.0 native handler
 * (RoutesLoader last-writer-wins). Never invokes completeCartWorkflow or
 * creates an Order. Global store-surface guard is the primary control.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

export const POST = async (_req: MedusaRequest, res: MedusaResponse) => {
  res.status(404).json({
    type: "not_found",
    message: "Not Found",
  })
}
