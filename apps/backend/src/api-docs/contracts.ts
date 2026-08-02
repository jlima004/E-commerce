import type { RouteConfig } from "@asteasolutions/zod-to-openapi"

export const CONTRACT_SURFACES = ["store", "admin", "webhooks"] as const
export type ContractSurface = (typeof CONTRACT_SURFACES)[number]

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export type SourceClassification =
  | "project-custom"
  | "project-extension"
  | "project-override"
  | "native-consumed"
  | "synthetic-test"

export type SecurityRequirement = Readonly<Record<string, readonly string[]>>

export type OperationMetadata = {
  surface: ContractSurface
  method: HttpMethod
  path: string
  operationId: string
  summary: string
  description?: string
  tags: string[]
  security: readonly SecurityRequirement[]
  parameters: unknown[]
  requestBody: RouteConfig["request"] extends { body?: infer T } ? T | null : unknown
  responses: RouteConfig["responses"]
  sourceClassification: SourceClassification
  sourceFiles: string[]
  testEvidence: string[]
  officialReference: string
  inclusionReason: string
  interactiveCandidate: boolean
  nonInteractive: true
}

export type JsonObject = Record<string, unknown>

export type OpenApiDocument = {
  openapi: "3.1.2"
  info: {
    title: string
    version: "1.0.0"
    description: string
    contact: {
      name: string
      url: string
    }
    license: {
      name: string
      url: string
    }
  }
  servers: Array<{ url: string; description: string }>
  paths: Record<string, JsonObject>
  components: {
    headers: Record<string, unknown>
    parameters: Record<string, unknown>
    responses: Record<string, unknown>
    schemas: Record<string, unknown>
    securitySchemes: Record<string, unknown>
  }
  "x-medusa-version": "2.16.0"
}

export type BuiltContract = {
  surface: ContractSurface
  fileName: `${ContractSurface}.openapi.json`
  document: OpenApiDocument
  bytes: string
}
