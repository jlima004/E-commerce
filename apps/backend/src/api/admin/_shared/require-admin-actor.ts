import { MedusaError } from "@medusajs/framework/utils"

export type AdminActor = {
  actor_type: "user"
  actor_id: string
}

export type AdminAuthContext = {
  actor_id?: unknown
  actor_type?: unknown
}

export type AdminActorRequest = {
  auth_context?: AdminAuthContext | null
}

export type SanitizedSecurityLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
}

function emitSecurityLog(
  logger: SanitizedSecurityLogger | undefined,
  code: string,
  actorType: unknown
) {
  logger?.warn?.(code, {
    error_code: code,
    actor_type:
      typeof actorType === "string" ? actorType.slice(0, 32) : "missing",
  })
}

/**
 * Accepts only authenticated Admin user identity from req.auth_context.
 * Body fields and API keys never define the actor.
 */
export function requireAdminActor(
  req: AdminActorRequest,
  logger?: SanitizedSecurityLogger
): AdminActor {
  const authContext = req.auth_context

  if (!authContext) {
    emitSecurityLog(logger, "ADMIN_ACTOR_REQUIRED", undefined)
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "ADMIN_ACTOR_REQUIRED"
    )
  }

  if (authContext.actor_type !== "user") {
    emitSecurityLog(logger, "ADMIN_ACTOR_TYPE_FORBIDDEN", authContext.actor_type)
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "ADMIN_ACTOR_TYPE_FORBIDDEN"
    )
  }

  if (
    typeof authContext.actor_id !== "string" ||
    authContext.actor_id.trim() === ""
  ) {
    emitSecurityLog(logger, "ADMIN_ACTOR_REQUIRED", authContext.actor_type)
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "ADMIN_ACTOR_REQUIRED"
    )
  }

  return {
    actor_type: "user",
    actor_id: authContext.actor_id.trim(),
  }
}
