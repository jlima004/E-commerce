import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { env } from "../../../config/env"
import { SERVICE_NAME } from "../../../infrastructure/health"

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  res.status(200).json({
    status: "live",
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    version: env.APP_VERSION,
  })
}
