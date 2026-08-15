import { timingSafeEqual } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  deriveCustomerAuthRecipientHash,
  type AuthNotificationFailureReason,
} from "./notification-outbox"
import {
  normalizeCustomerAuthEmail,
  CustomerAuthEmailNormalizationError,
} from "./security/email-normalization"
import type { CapabilityKeyring } from "./security/capabilities"

export type ResolveRecipientResult =
  | {
      success: true
      normalizedEmail: string
      recipientDomain: string
    }
  | {
      success: false
      reason: AuthNotificationFailureReason
      errorCode: string
    }

export type QueryGraphLike = {
  graph: (query: {
    entity: string
    fields: string[]
    filters: Record<string, unknown>
  }) => Promise<{ data: Array<Record<string, unknown>> }>
}

export type CustomIdentityEmailResolution =
  | string
  | string[]
  | {
      providerEmail?: string | null
      appMetaEmail?: string | null
      userMetaEmail?: string | null
      customerEmail?: string | null
      providerIdentities?: Array<{ entity_id?: string; email?: string }> | null
    }
  | null
  | undefined

export type RecipientResolverDeps = {
  container?: MedusaContainer
  query?: QueryGraphLike
  resolveEmailByIdentityId?: (
    identityId: string
  ) => Promise<CustomIdentityEmailResolution>
}

export type VerifyRecipientInput = {
  recipientIdentityId: string
  expectedRecipientHash: string
  expectedRecipientDomain?: string
  purpose: "verification" | "reset"
  keyring: CapabilityKeyring
  keyVersion: number
}

function resolveQuery(container?: MedusaContainer): QueryGraphLike | null {
  if (!container) {
    return null
  }
  try {
    const query = container.resolve(
      ContainerRegistrationKeys.QUERY
    ) as QueryGraphLike | undefined
    if (query && typeof query.graph === "function") {
      return query
    }
  } catch {
    // query is optional
  }
  return null
}

function extractEmailsFromUnknown(
  value: unknown,
  collected: string[]
): void {
  if (!value) {
    return
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed.includes("@")) {
      collected.push(trimmed)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      extractEmailsFromUnknown(item, collected)
    }
    return
  }
  if (typeof value === "object") {
    for (const val of Object.values(value as Record<string, unknown>)) {
      if (typeof val === "string" && val.includes("@")) {
        collected.push(val.trim())
      }
    }
  }
}

export async function fetchAuthoritativeRawEmailsForIdentity(
  identityId: string,
  deps: RecipientResolverDeps
): Promise<string[]> {
  const collected: string[] = []

  if (deps.resolveEmailByIdentityId) {
    const custom = await deps.resolveEmailByIdentityId(identityId)
    if (custom) {
      extractEmailsFromUnknown(custom, collected)
      return collected
    }
    return collected
  }

  const query = deps.query ?? resolveQuery(deps.container)
  if (!query) {
    return collected
  }

  try {
    const { data } = await query.graph({
      entity: "auth_identity",
      fields: [
        "id",
        "app_metadata",
        "user_metadata",
        "provider_identities.entity_id",
        "provider_identities.provider",
        "customer.email",
      ],
      filters: { id: identityId },
    })

    if (!Array.isArray(data) || data.length !== 1) {
      return collected
    }

    const identity = data[0]
    if (!identity) {
      return collected
    }

    // 1. Provider identities
    const providerIdentities = identity.provider_identities as
      | Array<{ entity_id?: string; email?: string; provider?: string }>
      | undefined
    if (Array.isArray(providerIdentities)) {
      for (const pi of providerIdentities) {
        if (typeof pi.entity_id === "string" && pi.entity_id.includes("@")) {
          collected.push(pi.entity_id.trim())
        }
        if (typeof pi.email === "string" && pi.email.includes("@")) {
          collected.push(pi.email.trim())
        }
      }
    }

    // 2. app_metadata
    const appMeta = identity.app_metadata as Record<string, unknown> | undefined
    if (appMeta && typeof appMeta.email === "string" && appMeta.email.includes("@")) {
      collected.push(appMeta.email.trim())
    }

    // 3. user_metadata
    const userMeta = identity.user_metadata as Record<string, unknown> | undefined
    if (userMeta && typeof userMeta.email === "string" && userMeta.email.includes("@")) {
      collected.push(userMeta.email.trim())
    }

    // 4. linked customer
    const customer = identity.customer as { email?: string } | undefined
    if (customer && typeof customer.email === "string" && customer.email.includes("@")) {
      collected.push(customer.email.trim())
    }

    return collected
  } catch {
    return collected
  }
}

/**
 * Sanctioned recipient resolution boundary.
 *
 * Requirements (P14-D10 / P14-D12):
 * 1. Collect authoritative emails across all identity sources (AuthIdentity, provider identity, Customer, metadata).
 * 2. Normalize each with P14-D12 (`normalizeCustomerAuthEmail`).
 * 3. Boundary invariants:
 *    - zero emails found: recipient_missing (fail-closed, 0 send)
 *    - exactly one canonical value: valid candidate
 *    - >1 distinct canonical values: recipient_mismatch / ambiguous (fail-closed, 0 send)
 * 4. Derive candidate recipient hash with HKDF+HMAC for the exact key_version and purpose.
 * 5. Constant-time comparison (`crypto.timingSafeEqual`) against expected hash.
 * 6. Validate expected recipient domain.
 */
export async function resolveAndVerifyRecipient(
  input: VerifyRecipientInput,
  deps: RecipientResolverDeps
): Promise<ResolveRecipientResult> {
  const rawEmails = await fetchAuthoritativeRawEmailsForIdentity(
    input.recipientIdentityId,
    deps
  )

  if (!rawEmails || rawEmails.length === 0) {
    return {
      success: false,
      reason: "recipient_missing",
      errorCode: "AUTH_NOTIFICATION_RECIPIENT_MISSING",
    }
  }

  const canonicalSet = new Set<string>()

  for (const raw of rawEmails) {
    let normalized: string
    try {
      normalized = normalizeCustomerAuthEmail(raw)
    } catch (error) {
      if (error instanceof CustomerAuthEmailNormalizationError) {
        return {
          success: false,
          reason: "recipient_missing",
          errorCode: "AUTH_NOTIFICATION_RECIPIENT_EMAIL_INVALID",
        }
      }
      return {
        success: false,
        reason: "recipient_missing",
        errorCode: "AUTH_NOTIFICATION_RECIPIENT_MISSING",
      }
    }
    canonicalSet.add(normalized)
  }

  if (canonicalSet.size === 0) {
    return {
      success: false,
      reason: "recipient_missing",
      errorCode: "AUTH_NOTIFICATION_RECIPIENT_MISSING",
    }
  }

  if (canonicalSet.size > 1) {
    // Ambiguous relation: multiple divergent canonical emails associated with identity
    return {
      success: false,
      reason: "recipient_mismatch",
      errorCode: "AUTH_NOTIFICATION_RECIPIENT_MISMATCH",
    }
  }

  const normalizedEmail = Array.from(canonicalSet)[0]

  // Derive candidate recipient hash
  let candidateHash: string
  try {
    candidateHash = deriveCustomerAuthRecipientHash({
      keyring: input.keyring,
      keyVersion: input.keyVersion,
      purpose: input.purpose,
      normalizedEmail,
      recipientIdentityId: input.recipientIdentityId,
    })
  } catch {
    return {
      success: false,
      reason: "recipient_mismatch",
      errorCode: "AUTH_NOTIFICATION_RECIPIENT_KEY_UNAVAILABLE",
    }
  }

  const expectedBuf = Buffer.from(input.expectedRecipientHash, "hex")
  const candidateBuf = Buffer.from(candidateHash, "hex")

  if (
    expectedBuf.length !== 32 ||
    candidateBuf.length !== 32 ||
    !timingSafeEqual(expectedBuf, candidateBuf)
  ) {
    return {
      success: false,
      reason: "recipient_mismatch",
      errorCode: "AUTH_NOTIFICATION_RECIPIENT_MISMATCH",
    }
  }

  const separator = normalizedEmail.indexOf("@")
  const recipientDomain = normalizedEmail.slice(separator + 1)

  if (
    input.expectedRecipientDomain &&
    input.expectedRecipientDomain !== recipientDomain
  ) {
    return {
      success: false,
      reason: "recipient_mismatch",
      errorCode: "AUTH_NOTIFICATION_RECIPIENT_DOMAIN_MISMATCH",
    }
  }

  return {
    success: true,
    normalizedEmail,
    recipientDomain,
  }
}
