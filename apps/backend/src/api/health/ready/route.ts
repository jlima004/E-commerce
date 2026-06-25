import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { env } from "../../../config/env"
import {
  checkReadiness,
  SERVICE_NAME,
} from "../../../infrastructure/health"

type HealthRequest = MedusaRequest & {
  correlationId?: string
}

export async function GET(req: HealthRequest, res: MedusaResponse) {
  const readiness = await checkReadiness(req.scope, {
    correlationId: req.correlationId,
  })
  const statusCode = readiness.status === "ready" ? 200 : 503

  res.status(statusCode).json({
    status: readiness.status,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    version: env.APP_VERSION,
    checks: readiness.checks,
  })
}
