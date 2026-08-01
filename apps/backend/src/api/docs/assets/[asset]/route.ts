import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { canExposeApiDocs } from "../../../../api-docs/runtime/exposure"
import { resolveSwaggerAsset } from "../../../../api-docs/runtime/swagger-assets"
import {
  applyApiDocsSecurityHeaders,
  sendApiDocsNotFound,
} from "../../../../api-docs/runtime/security-headers"
import { getApiDocsFlagsFromEnv } from "../../../openapi/_shared/docs-request"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const flags = getApiDocsFlagsFromEnv()

  if (!canExposeApiDocs(flags, "ui")) {
    sendApiDocsNotFound(res)
    return
  }

  const asset = resolveSwaggerAsset(req.params.asset)

  if (!asset) {
    sendApiDocsNotFound(res)
    return
  }

  applyApiDocsSecurityHeaders(res, asset.contentType)
  res.status(200).send(asset.body)
}
