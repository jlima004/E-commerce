import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canExposeApiDocs } from "../../../api-docs/runtime/exposure"
import { getStoreOpenApiDocument } from "../../../api-docs/runtime/documents"
import {
  API_DOCS_CONTENT_TYPE_JSON,
  applyApiDocsSecurityHeaders,
  sendApiDocsNotFound,
} from "../../../api-docs/runtime/security-headers"
import { getApiDocsFlagsFromEnv } from "../_shared/docs-request"

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const flags = getApiDocsFlagsFromEnv()

  if (!canExposeApiDocs(flags, "store")) {
    sendApiDocsNotFound(res)
    return
  }

  applyApiDocsSecurityHeaders(res, API_DOCS_CONTENT_TYPE_JSON)
  res.status(200).send(JSON.stringify(getStoreOpenApiDocument()))
}
