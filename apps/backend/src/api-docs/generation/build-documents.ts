import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi"
import {
  CONTRACT_SURFACES,
  type BuiltContract,
  type ContractSurface,
  type OpenApiDocument,
} from "../contracts"
import {
  CONTRACT_DESCRIPTIONS,
  CONTRACT_TITLES,
  CONTRACT_VERSIONS,
  MEDUSA_VERSION,
  OPENAPI_VERSION,
  PROJECT_CONTACT,
  PROJECT_LICENSE,
  SAME_ORIGIN_SERVER,
} from "../document"
import {
  ContractRegistryBundle,
  createFoundationRegistry,
} from "../registry"
import { serializeDocument } from "./serialize"

function ensureStructuralComponents(
  document: Record<string, unknown>
): OpenApiDocument["components"] {
  const components = (document.components ?? {}) as Record<string, unknown>
  return {
    headers: (components.headers ?? {}) as Record<string, unknown>,
    parameters: (components.parameters ?? {}) as Record<string, unknown>,
    responses: (components.responses ?? {}) as Record<string, unknown>,
    schemas: (components.schemas ?? {}) as Record<string, unknown>,
    securitySchemes: (components.securitySchemes ?? {}) as Record<string, unknown>,
  }
}

function collectDocumentTags(
  registry: ContractRegistryBundle,
  surface: ContractSurface
): Array<{ name: string }> {
  const names = new Set<string>()
  for (const operation of registry.getOperations(surface)) {
    for (const tag of operation.tags) {
      names.add(tag)
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right)).map((name) => ({
    name,
  }))
}

export function buildDocument(
  registry: ContractRegistryBundle,
  surface: ContractSurface
): OpenApiDocument {
  const generator = new OpenApiGeneratorV31(
    registry.surfaces[surface].openapi.definitions
  )
  const tags = collectDocumentTags(registry, surface)
  const generated = generator.generateDocument({
    openapi: OPENAPI_VERSION,
    info: {
      title: CONTRACT_TITLES[surface],
      version: CONTRACT_VERSIONS[surface],
      description: CONTRACT_DESCRIPTIONS[surface],
      contact: PROJECT_CONTACT,
      license: PROJECT_LICENSE,
    },
    servers: [SAME_ORIGIN_SERVER],
    ...(tags.length > 0 ? { tags } : {}),
    "x-medusa-version": MEDUSA_VERSION,
  } as never) as unknown as Record<string, unknown>
  delete generated.webhooks

  if (tags.length > 0) {
    generated.tags = tags
  } else {
    delete generated.tags
  }

  return {
    ...(generated as Omit<OpenApiDocument, "components" | "openapi">),
    openapi: OPENAPI_VERSION,
    paths: (generated.paths ?? {}) as OpenApiDocument["paths"],
    components: ensureStructuralComponents(generated),
    "x-medusa-version": MEDUSA_VERSION,
  }
}

export function buildContracts(
  registry: ContractRegistryBundle = createFoundationRegistry()
): BuiltContract[] {
  return CONTRACT_SURFACES.map((surface) => {
    const document = buildDocument(registry, surface)
    return {
      surface,
      fileName: `${surface}.openapi.json`,
      document,
      bytes: serializeDocument(document),
    }
  })
}
