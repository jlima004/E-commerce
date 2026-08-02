import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  canExposeApiDocs,
  listAuthorizedApiDocsSelectorUrls,
} from "../../../../api-docs/runtime/exposure"
import { resolveSwaggerAsset } from "../../../../api-docs/runtime/swagger-assets"
import {
  applyApiDocsSecurityHeaders,
  sendApiDocsNotFound,
} from "../../../../api-docs/runtime/security-headers"
import { env } from "../../../../config/env"
import {
  getApiDocsFlagsFromEnv,
  mapAuthContextToApiDocsActor,
} from "../../../openapi/_shared/docs-request"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const flags = getApiDocsFlagsFromEnv()

  if (!canExposeApiDocs(flags, "ui")) {
    sendApiDocsNotFound(res)
    return
  }

  const assetParam = req.params.asset

  if (assetParam === "api-docs-initializer.js") {
    const actor = mapAuthContextToApiDocsActor(req)
    const initializerUrls = listAuthorizedApiDocsSelectorUrls(
      flags,
      actor,
      env.GELATO_WEBHOOK_AUTH_HEADER_NAME
    )
    const asset = resolveSwaggerAsset(assetParam, { initializerUrls })

    if (!asset) {
      sendApiDocsNotFound(res)
      return
    }

    applyApiDocsSecurityHeaders(res, asset.contentType)
    res.status(200).send(asset.body)
    return
  }

  const asset = resolveSwaggerAsset(assetParam)

  if (!asset) {
    sendApiDocsNotFound(res)
    return
  }

  applyApiDocsSecurityHeaders(res, asset.contentType)
  res.status(200).send(asset.body)
}
