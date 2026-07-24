import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import {
  OPERATIONAL_ALERT_MODULE,
  type OperationalAlertModuleService,
} from "../../../../modules/operational-alert"
import { requireAdminActor } from "../../_shared/require-admin-actor"

function requireOperationalAlertId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^opalert_[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "OPERATIONAL_ALERT_ID_INVALID"
    )
  }
  return value
}

function resolveService(req: MedusaRequest): OperationalAlertModuleService {
  try {
    return req.scope.resolve(
      OPERATIONAL_ALERT_MODULE
    ) as OperationalAlertModuleService
  } catch {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "OPERATIONAL_ALERT_MODULE_UNAVAILABLE"
    )
  }
}

export async function handleAdminRetrieveOperationalAlert(
  req: MedusaRequest,
  res: MedusaResponse
): Promise<void> {
  requireAdminActor(
    req as MedusaRequest & {
      auth_context?: { actor_id?: unknown; actor_type?: unknown }
    }
  )
  const id = requireOperationalAlertId(req.params?.id)
  const service = resolveService(req)
  const alert = await service.retrieveSafe(id)

  if (!alert) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "OPERATIONAL_ALERT_NOT_FOUND"
    )
  }

  res.status(200).json({ operational_alert: alert })
}

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  await handleAdminRetrieveOperationalAlert(req, res)
}
