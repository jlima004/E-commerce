import type { ContractSurface, ContractVersion } from "./contracts"

export const OPENAPI_VERSION = "3.1.2" as const
export const CONTRACT_VERSIONS = {
  store: "1.1.0",
  admin: "1.0.0",
  webhooks: "1.0.0",
} as const satisfies Record<ContractSurface, ContractVersion>
export const MEDUSA_VERSION = "2.16.0" as const

export const CONTRACT_TITLES: Record<ContractSurface, string> = {
  store: "Indicio Cult Store API",
  admin: "Indicio Cult Admin API",
  webhooks: "Indicio Cult Webhooks API",
}

export const CONTRACT_DESCRIPTIONS: Record<ContractSurface, string> = {
  store: "Contrato Store do backend Indicio Cult.",
  admin: "Contrato Admin interno do backend Indicio Cult.",
  webhooks: "Contrato de webhooks internos do backend Indicio Cult.",
}

export const SAME_ORIGIN_SERVER = {
  url: "/",
  description: "Same-origin",
} as const

export const PROJECT_CONTACT = {
  name: "Indicio Cult",
  url: "https://github.com/jlima004/E-commerce",
} as const

export const PROJECT_LICENSE = {
  name: "UNLICENSED",
  url: "https://github.com/jlima004/E-commerce",
} as const
