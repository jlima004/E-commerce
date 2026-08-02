import type { MedusaRequest } from "@medusajs/framework/http"
import { env } from "../../../config/env"
import type {
  ApiDocsActor,
  ApiDocsFlags,
} from "../../../api-docs/runtime/exposure"

export function getApiDocsFlagsFromEnv(): ApiDocsFlags {
  return {
    API_DOCS_ENABLED: env.API_DOCS_ENABLED,
    API_DOCS_UI_ENABLED: env.API_DOCS_UI_ENABLED,
    API_DOCS_PUBLIC_ENABLED: env.API_DOCS_PUBLIC_ENABLED,
    API_DOCS_INTERNAL_ENABLED: env.API_DOCS_INTERNAL_ENABLED,
  }
}

type AuthContextLike = {
  actor_id?: unknown
  actor_type?: unknown
  auth_identity_id?: unknown
}

/**
 * Map Medusa auth_context to ApiDocsActor.
 * authenticated:true only when actor_type==="user" AND non-empty actor_id.
 * Otherwise unauthenticated / hide actor identity.
 */
export function mapAuthContextToApiDocsActor(
  req: MedusaRequest
): ApiDocsActor {
  const authContext = (req as MedusaRequest & {
    auth_context?: AuthContextLike | null
  }).auth_context

  if (!authContext || typeof authContext !== "object") {
    return { authenticated: false }
  }

  const actorType =
    typeof authContext.actor_type === "string" ? authContext.actor_type : null
  const actorIdRaw =
    typeof authContext.actor_id === "string" ? authContext.actor_id.trim() : ""

  if (actorType === "user" && actorIdRaw.length > 0) {
    return {
      authenticated: true,
      actor_type: "user",
      actor_id: actorIdRaw,
    }
  }

  return { authenticated: false }
}
