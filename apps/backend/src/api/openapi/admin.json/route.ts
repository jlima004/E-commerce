import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canExposeApiDocs } from "../../../api-docs/runtime/exposure"
import { getAdminOpenApiDocument } from "../../../api-docs/runtime/documents"
import {
  API_DOCS_CONTENT_TYPE_JSON,
  applyApiDocsSecurityHeaders,
  sendApiDocsNotFound,
} from "../../../api-docs/runtime/security-headers"
import {
  getApiDocsFlagsFromEnv,
  mapAuthContextToApiDocsActor,
} from "../_shared/docs-request"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const flags = getApiDocsFlagsFromEnv()
  const actor = mapAuthContextToApiDocsActor(req)

  if (!canExposeApiDocs(flags, "admin", actor)) {
    sendApiDocsNotFound(res)
    return
  }

  applyApiDocsSecurityHeaders(res, API_DOCS_CONTENT_TYPE_JSON)
  res.status(200).send(JSON.stringify(getAdminOpenApiDocument()))
}
