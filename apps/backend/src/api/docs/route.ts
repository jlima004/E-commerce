import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canExposeApiDocs } from "../../api-docs/runtime/exposure"
import { SWAGGER_UI_HTML } from "../../api-docs/runtime/swagger-config"
import {
  API_DOCS_CONTENT_TYPE_HTML,
  applyApiDocsSecurityHeaders,
  sendApiDocsNotFound,
} from "../../api-docs/runtime/security-headers"
import { getApiDocsFlagsFromEnv } from "../openapi/_shared/docs-request"

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const flags = getApiDocsFlagsFromEnv()

  if (!canExposeApiDocs(flags, "ui")) {
    sendApiDocsNotFound(res)
    return
  }

  applyApiDocsSecurityHeaders(res, API_DOCS_CONTENT_TYPE_HTML)
  res.status(200).send(SWAGGER_UI_HTML)
}
