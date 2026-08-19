import type { MedusaContainer } from "@medusajs/framework/types"
import { Resend } from "resend"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import {
  AUTH_NOTIFICATION_OUTBOX_BATCH_SIZE,
  AUTH_NOTIFICATION_OUTBOX_MAX_ATTEMPTS,
  assertNoSensitiveOutboxPayload,
  computeAuthNotificationBackoff,
  validateProviderMessageId,
  type AuthNotificationFailureReason,
  type AuthNotificationOutboxRecord,
} from "../modules/customer-auth/notification-outbox"
import {
  resolveAndVerifyRecipient,
  type CustomIdentityEmailResolution,
  type QueryGraphLike,
} from "../modules/customer-auth/notification-recipient"
import { renderAuthEmailTemplate } from "../modules/customer-auth/auth-email-templates"
import {
  deriveCustomerAuthCapability,
  hashCustomerAuthCapability,
  parseCustomerAuthCapabilityKeyring,
  type CapabilityKeyring,
} from "../modules/customer-auth/security/capabilities"
import { CUSTOMER_AUTH_MODULE } from "../modules/customer-auth"
import { OPERATIONAL_ALERT_MODULE } from "../modules/operational-alert"

export const AUTH_NOTIFICATION_RELAY_BATCH_SIZE =
  AUTH_NOTIFICATION_OUTBOX_BATCH_SIZE
export const AUTH_NOTIFICATION_RELAY_TIMEOUT_MS = 25_000

export type ResendAuthRelayConfig = {
  apiKey: string
  fromEmail: string
  replyTo?: string
  storefrontUrl?: string
}

export type ResendAuthRelaySendPayload = {
  from: string
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string
}

export type ResendAuthRelaySendOptions = {
  idempotencyKey: string
}

export type ResendAuthRelayClient = {
  send: (
    payload: ResendAuthRelaySendPayload,
    options: ResendAuthRelaySendOptions
  ) => Promise<{ providerMessageId: string }>
}

export type AuthNotificationRelayResult = {
  processed: number
  sent: number
  failed: number
  dead_lettered: number
  timed_out: boolean
  skipped_missing_config: boolean
  skipped_disabled: boolean
  noop_reason: "not_worker" | "release_migration" | null
}

type SanitizedJobLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
  info?: (message: string, meta?: Record<string, unknown>) => void
}

type KnexLike = {
  raw: (
    sql: string,
    bindings?: unknown[]
  ) => Promise<{ rows?: Array<Record<string, unknown>> }>
}

export type OperationalAlertPayload = {
  type: "auth_notification_failed" | string
  severity: "low" | "medium" | "high" | "critical"
  entity_type: "auth_notification_outbox" | string
  entity_id: string
  message_code: string
  message: string
  error_code?: string | null
  metadata?: Record<string, unknown> | null
  observed_at: Date
}

export type AuthNotificationRelayDeps = {
  container?: MedusaContainer
  knex?: KnexLike
  client?: ResendAuthRelayClient
  createClient?: (config: ResendAuthRelayConfig) => ResendAuthRelayClient
  config?: ResendAuthRelayConfig | null
  keyring?: CapabilityKeyring
  query?: QueryGraphLike
  now?: () => Date
  workerId?: string
  batchSize?: number
  timeoutMs?: number
  isWorker?: () => boolean
  isReleaseMigration?: () => boolean
  logger?: SanitizedJobLogger
  upsertAlert?: (payload: OperationalAlertPayload) => Promise<unknown>
  resolveEmailByIdentityId?: (
    identityId: string
  ) => Promise<CustomIdentityEmailResolution>
}

function isWorkerMode(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.WORKER_MODE === "worker"
}

function logSafe(
  logger: SanitizedJobLogger | undefined,
  level: "info" | "warn" | "error",
  code: string,
  meta: Record<string, unknown>
) {
  const payload = {
    error_code: code,
    job: "auth-notification-relay",
    ...meta,
  }
  if (level === "error") {
    logger?.error?.(code, payload)
    return
  }
  if (level === "warn") {
    logger?.warn?.(code, payload)
    return
  }
  logger?.info?.(code, payload)
}

export async function emitAuthNotificationOperationalAlert(
  deps: AuthNotificationRelayDeps,
  input: {
    outboxId: string
    intentId: string
    recipientIdentityId: string
    template?: string
    generation?: number
    attemptCount?: number
    reason: "recipient_missing" | "recipient_mismatch" | string
    errorCode: string
    now: Date
  }
): Promise<void> {
  const messageCode =
    input.reason === "recipient_missing"
      ? "RECIPIENT_MISSING"
      : "RECIPIENT_MISMATCH"
  const message = `Auth notification recipient validation failed: ${messageCode}`

  const metadata: Record<string, unknown> = {
    outbox_id: input.outboxId,
    intent_id: input.intentId,
    recipient_identity_id: input.recipientIdentityId,
    detector_code: messageCode,
    failure_reason: input.reason,
  }
  if (input.template) {
    metadata.template = input.template
  }
  if (Number.isInteger(input.generation)) {
    metadata.generation = input.generation
  }
  if (Number.isInteger(input.attemptCount)) {
    metadata.attempt_count = input.attemptCount
  }

  // Ensure absolutely NO plaintext email, token, capability or secret
  assertNoSensitiveOutboxPayload(metadata)

  const alertPayload: OperationalAlertPayload = {
    type: "auth_notification_failed",
    severity: "high",
    entity_type: "auth_notification_outbox",
    entity_id: input.outboxId,
    message_code: messageCode,
    message,
    error_code: input.errorCode,
    metadata,
    observed_at: input.now,
  }

  try {
    if (deps.upsertAlert) {
      await deps.upsertAlert(alertPayload)
      return
    }

    if (deps.container) {
      let opAlertModule:
        | { upsertAlert: (payload: unknown) => Promise<unknown> }
        | undefined
      try {
        opAlertModule = deps.container.resolve(
          OPERATIONAL_ALERT_MODULE
        ) as { upsertAlert: (payload: unknown) => Promise<unknown> } | undefined
      } catch {
        throw new Error("OPERATIONAL_ALERT_MODULE_UNAVAILABLE")
      }

      if (opAlertModule && typeof opAlertModule.upsertAlert === "function") {
        await opAlertModule.upsertAlert(alertPayload)
        return
      }

      throw new Error(
        "OPERATIONAL_ALERT_MODULE_INVALID: upsertAlert method missing"
      )
    }

    throw new Error(
      "OPERATIONAL_ALERT_DISPATCH_UNAVAILABLE: no alert service or container provided"
    )
  } catch (error) {
    // Failure in alert creation must NOT throw, silence, or rollback the already committed dead_letter
    logSafe(deps.logger, "warn", "OPERATIONAL_ALERT_CREATION_FAILED", {
      outbox_id: input.outboxId,
      intent_id: input.intentId,
      recipient_identity_id: input.recipientIdentityId,
      error_code: input.errorCode,
      failure_reason: input.reason,
      error_name: error instanceof Error ? error.name : "unknown",
    })
  }
}

function isProductionAuthEnv(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): boolean {
  return env.NODE_ENV === "production"
}

function parseIpv4Octets(value: string): [number, number, number, number] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value)
  if (!match) {
    return null
  }

  const octets: [number, number, number, number] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  ]
  if (octets.some((octet) => octet > 255)) {
    return null
  }

  return octets
}

function isIpv4LoopbackAddress(value: string): boolean {
  const octets = parseIpv4Octets(value)
  return octets !== null && octets[0] === 127
}

function normalizeIpv6Hextet(value: string): string | null {
  if (!/^[0-9a-f]{1,4}$/.test(value)) {
    return null
  }

  return value.replace(/^0+/, "") || "0"
}

function expandIpv6Hextets(host: string): string[] | null {
  let working = host
  let embeddedHextets: string[] = []

  const dottedSuffix = /^(.+):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host)
  if (dottedSuffix) {
    const octets = parseIpv4Octets(dottedSuffix[2])
    if (!octets) {
      return null
    }

    working = dottedSuffix[1]
    embeddedHextets = [
      ((octets[0] << 8) | octets[1]).toString(16),
      ((octets[2] << 8) | octets[3]).toString(16),
    ]
  }

  const appendNormalized = (groups: string[]): string[] | null => {
    const normalized: string[] = []
    for (const group of groups) {
      const hextet = normalizeIpv6Hextet(group)
      if (hextet === null) {
        return null
      }
      normalized.push(hextet)
    }
    return normalized
  }

  if (working.includes("::")) {
    const parts = working.split("::")
    if (parts.length !== 2) {
      return null
    }

    const left = parts[0] === "" ? [] : parts[0].split(":")
    const right = parts[1] === "" ? [] : parts[1].split(":")
    if (left.includes("") || right.includes("")) {
      return null
    }

    const knownCount = left.length + right.length + embeddedHextets.length
    if (knownCount > 8) {
      return null
    }

    const expanded = appendNormalized([
      ...left,
      ...Array(8 - knownCount).fill("0"),
      ...right,
      ...embeddedHextets,
    ])
    return expanded?.length === 8 ? expanded : null
  }

  const groups = working === "" ? [] : working.split(":")
  if (groups.includes("")) {
    return null
  }

  const expanded = appendNormalized([...groups, ...embeddedHextets])
  return expanded?.length === 8 ? expanded : null
}

function extractIpv4MappedEmbeddedAddress(hextets: string[]): string | null {
  if (
    hextets.length !== 8 ||
    hextets[0] !== "0" ||
    hextets[1] !== "0" ||
    hextets[2] !== "0" ||
    hextets[3] !== "0" ||
    hextets[4] !== "0" ||
    hextets[5] !== "ffff"
  ) {
    return null
  }

  const high = Number.parseInt(hextets[6], 16)
  const low = Number.parseInt(hextets[7], 16)
  if (!Number.isInteger(high) || !Number.isInteger(low)) {
    return null
  }

  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`
}

function isIpv6UnspecifiedOrLoopback(hextets: string[]): boolean {
  const values = hextets.map((hextet) => Number.parseInt(hextet, 16))
  if (values.some((value) => !Number.isInteger(value))) {
    return false
  }

  if (values.every((value) => value === 0)) {
    return true
  }

  return values.slice(0, 7).every((value) => value === 0) && values[7] === 1
}

function isLoopbackAuthStorefrontHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true
  }
  if (host === "0.0.0.0" || isIpv4LoopbackAddress(host)) {
    return true
  }

  const hextets = expandIpv6Hextets(host)
  if (!hextets) {
    return false
  }
  if (isIpv6UnspecifiedOrLoopback(hextets)) {
    return true
  }

  const mappedIpv4 = extractIpv4MappedEmbeddedAddress(hextets)
  return mappedIpv4 !== null && isIpv4LoopbackAddress(mappedIpv4)
}

export function resolveProductionAuthStorefrontUrl(
  raw: string | undefined
): string | null {
  if (typeof raw !== "string") {
    return null
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== "https:") {
    return null
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return null
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    return null
  }
  if (!parsed.hostname || isLoopbackAuthStorefrontHostname(parsed.hostname)) {
    return null
  }

  const path =
    parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "")
  return `${parsed.protocol}//${parsed.host}${path}`
}

function resolveConfiguredStorefrontUrl(
  env: Record<string, string | undefined>
): string | undefined {
  const raw = (env.STOREFRONT_URL ?? env.NEXT_PUBLIC_STOREFRONT_URL)?.trim()
  return raw ? raw.replace(/\/+$/, "") : undefined
}

function bindProductionStorefrontUrl(
  config: ResendAuthRelayConfig,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): ResendAuthRelayConfig | null {
  if (!isProductionAuthEnv(env)) {
    return config
  }

  const storefrontUrl = resolveProductionAuthStorefrontUrl(config.storefrontUrl)
  if (!storefrontUrl) {
    return null
  }

  return {
    ...config,
    storefrontUrl,
  }
}

export function resolveAuthRelayConfig(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): ResendAuthRelayConfig | null {
  if (env.RESEND_AUTH_ENABLED?.trim() === "false") {
    return null
  }

  const apiKey = (env.RESEND_API_KEY ?? env.RESEND_AUTH_API_KEY)?.trim()
  const fromEmail = (
    env.RESEND_AUTH_FROM_EMAIL ?? env.RESEND_FROM_EMAIL
  )?.trim()

  if (!apiKey || !fromEmail) {
    return null
  }

  const replyTo = (
    env.RESEND_AUTH_REPLY_TO ?? env.RESEND_REPLY_TO
  )?.trim()
  const storefrontUrl = resolveConfiguredStorefrontUrl(env)
  const config: ResendAuthRelayConfig = {
    apiKey,
    fromEmail,
    ...(replyTo ? { replyTo } : {}),
    ...(storefrontUrl ? { storefrontUrl } : {}),
  }

  return bindProductionStorefrontUrl(config, env)
}

export function createResendAuthRelayClient(
  config: ResendAuthRelayConfig
): ResendAuthRelayClient {
  const client = new Resend(config.apiKey)

  return {
    async send(payload, options) {
      const response = await client.emails.send(
        {
          from: payload.from,
          to: payload.to,
          subject: payload.subject,
          html: payload.html,
          text: payload.text,
          ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
        },
        {
          idempotencyKey: options.idempotencyKey,
        }
      )

      if (response.error) {
        throw new Error(
          response.error.message || "AUTH_RESEND_PROVIDER_ERROR"
        )
      }

      if (!response.data?.id) {
        throw new Error("AUTH_RESEND_PROVIDER_MESSAGE_ID_MISSING")
      }

      return {
        providerMessageId: response.data.id,
      }
    },
  }
}

function resolveKnex(
  container?: MedusaContainer,
  injectedKnex?: KnexLike
): KnexLike {
  if (injectedKnex) {
    return injectedKnex
  }
  if (!container) {
    throw new Error("AUTH_NOTIFICATION_RELAY_CONTAINER_OR_KNEX_REQUIRED")
  }
  try {
    const manager = container.resolve("__pg_connection__") as
      | KnexLike
      | undefined
    if (manager && typeof manager.raw === "function") {
      return manager
    }
  } catch {
    // fallback
  }

  const customerAuth = container.resolve(
    CUSTOMER_AUTH_MODULE
  ) as {
    baseRepository_?: {
      getActiveManager: () => { getKnex: () => KnexLike }
    }
  }
  const knex = customerAuth?.baseRepository_?.getActiveManager()?.getKnex()
  if (!knex || typeof knex.raw !== "function") {
    throw new Error("AUTH_NOTIFICATION_RELAY_KNEX_UNAVAILABLE")
  }
  return knex
}

function resolveKeyring(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): CapabilityKeyring {
  const parsed = parseCustomerAuthCapabilityKeyring({
    enabled: true,
    activeVersion: env.CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY_VERSION ?? "1",
    activeSecret:
      env.CUSTOMER_AUTH_CAPABILITY_ACTIVE_KEY ??
      "01234567890123456789012345678901_dev_default",
    previousKeys: env.CUSTOMER_AUTH_CAPABILITY_PREVIOUS_KEYS,
  })
  if (!parsed) {
    throw new Error("AUTH_NOTIFICATION_RELAY_KEYRING_UNAVAILABLE")
  }
  return parsed
}

export async function runAuthNotificationRelay(
  deps: AuthNotificationRelayDeps
): Promise<AuthNotificationRelayResult> {
  const isWorker = deps.isWorker ?? (() => isWorkerMode())
  const isReleaseMigration =
    deps.isReleaseMigration ?? (() => isReleaseMigrationMode())

  if (!isWorker()) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      dead_lettered: 0,
      timed_out: false,
      skipped_missing_config: false,
      skipped_disabled: false,
      noop_reason: "not_worker",
    }
  }

  if (isReleaseMigration()) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      dead_lettered: 0,
      timed_out: false,
      skipped_missing_config: false,
      skipped_disabled: false,
      noop_reason: "release_migration",
    }
  }

  const resolvedConfig =
    deps.config !== undefined
      ? deps.config
      : resolveAuthRelayConfig()
  const config = resolvedConfig
    ? bindProductionStorefrontUrl(resolvedConfig)
    : null

  if (!config) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      dead_lettered: 0,
      timed_out: false,
      skipped_missing_config: true,
      skipped_disabled: false,
      noop_reason: null,
    }
  }

  const knex = resolveKnex(deps.container, deps.knex)
  const keyring = deps.keyring ?? resolveKeyring()
  const createClient = deps.createClient ?? createResendAuthRelayClient
  const client = deps.client ?? createClient(config)
  const nowFn = deps.now ?? (() => new Date())
  const now = nowFn()
  const workerId =
    deps.workerId ?? `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const batchSize = deps.batchSize ?? AUTH_NOTIFICATION_RELAY_BATCH_SIZE
  const timeoutMs = deps.timeoutMs ?? AUTH_NOTIFICATION_RELAY_TIMEOUT_MS
  const startedAt = now.getTime()

  // 1. Query due candidates
  const candidatesResult = await knex.raw(
    `select * from auth_notification_outbox
     where status in ('recorded', 'failed')
       and (next_retry_at is null or next_retry_at <= ?)
       and (lease_until is null or lease_until < ?)
       and deleted_at is null
     order by recorded_at asc, id asc
     limit ?`,
    [now.toISOString(), now.toISOString(), batchSize]
  )

  const candidates = (candidatesResult.rows ??
    []) as unknown as AuthNotificationOutboxRecord[]

  let processed = 0
  let sent = 0
  let failed = 0
  let deadLettered = 0
  let timedOut = false

  for (const candidate of candidates) {
    if (nowFn().getTime() - startedAt >= timeoutMs) {
      timedOut = true
      break
    }

    processed += 1
    const currentNow = nowFn()
    const leaseUntil = new Date(currentNow.getTime() + 2 * 60 * 1000)

    // 2. CAS Claim
    const claimResult = await knex.raw(
      `update auth_notification_outbox
       set status = 'claimed',
           claimed_at = ?,
           lease_owner = ?,
           lease_until = ?,
           failed_at = null,
           failure_reason = null,
           next_retry_at = null,
           version = version + 1,
           updated_at = now()
       where id = ?
         and version = ?
         and status in ('recorded', 'failed')
         and deleted_at is null
       returning *`,
      [
        currentNow.toISOString(),
        workerId,
        leaseUntil.toISOString(),
        candidate.id,
        candidate.version,
      ]
    )

    const claimedRecord = claimResult.rows?.[0] as
      | AuthNotificationOutboxRecord
      | undefined

    if (!claimedRecord) {
      // Stale / claimed by concurrent worker
      continue
    }

    const claimedVersion = Number(claimedRecord.version)

    // 3. Recipient Resolution & Verification via sanctioned boundary
    const recipientResult = await resolveAndVerifyRecipient(
      {
        recipientIdentityId: candidate.recipient_identity_id,
        expectedRecipientHash: candidate.recipient_hash,
        expectedRecipientDomain: candidate.recipient_domain,
        purpose: candidate.intent_type,
        keyring,
        keyVersion: candidate.key_version,
      },
      {
        container: deps.container,
        query: deps.query,
        resolveEmailByIdentityId: deps.resolveEmailByIdentityId,
      }
    )

    if (!recipientResult.success) {
      const newAttemptCount = Number(candidate.attempt_count) + 1
      await knex.raw(
        `update auth_notification_outbox
         set status = 'dead_letter',
             dead_lettered_at = ?,
             failure_reason = ?,
             attempt_count = ?,
             lease_owner = null,
             lease_until = null,
             next_retry_at = null,
             version = version + 1,
             updated_at = now()
         where id = ? and version = ? and status = 'claimed'`,
        [
          currentNow.toISOString(),
          recipientResult.reason,
          newAttemptCount,
          candidate.id,
          claimedVersion,
        ]
      )
      deadLettered += 1

      // Emit sanitized operational alert (B14-09-HR-02)
      await emitAuthNotificationOperationalAlert(deps, {
        outboxId: candidate.id,
        intentId: candidate.intent_id,
        recipientIdentityId: candidate.recipient_identity_id,
        template: candidate.template,
        generation: Number(candidate.generation),
        attemptCount: newAttemptCount,
        reason: recipientResult.reason,
        errorCode: recipientResult.errorCode,
        now: currentNow,
      })

      logSafe(deps.logger, "warn", recipientResult.errorCode, {
        outbox_id: candidate.id,
        intent_id: candidate.intent_id,
        recipient_identity_id: candidate.recipient_identity_id,
        failure_reason: recipientResult.reason,
      })
      continue
    }

    // 4. In-memory capability rederivation from intent table
    const intentTable =
      candidate.intent_type === "verification"
        ? "auth_verification_intent"
        : "auth_reset_intent"

    const intentResult = await knex.raw(
      `select * from ${intentTable} where id = ? and deleted_at is null limit 1`,
      [candidate.intent_id]
    )

    const intentRow = intentResult.rows?.[0] as
      | {
          id: string
          nonce: string
          token_hash: string
          status: string
        }
      | undefined

    if (!intentRow) {
      const newAttemptCount = Number(candidate.attempt_count) + 1
      await knex.raw(
        `update auth_notification_outbox
         set status = 'dead_letter',
             dead_lettered_at = ?,
             failure_reason = 'recipient_missing',
             attempt_count = ?,
             lease_owner = null,
             lease_until = null,
             next_retry_at = null,
             version = version + 1,
             updated_at = now()
         where id = ? and version = ? and status = 'claimed'`,
        [
          currentNow.toISOString(),
          newAttemptCount,
          candidate.id,
          claimedVersion,
        ]
      )
      deadLettered += 1

      await emitAuthNotificationOperationalAlert(deps, {
        outboxId: candidate.id,
        intentId: candidate.intent_id,
        recipientIdentityId: candidate.recipient_identity_id,
        template: candidate.template,
        generation: Number(candidate.generation),
        attemptCount: newAttemptCount,
        reason: "recipient_missing",
        errorCode: "AUTH_NOTIFICATION_INTENT_MISSING",
        now: currentNow,
      })

      logSafe(deps.logger, "warn", "AUTH_NOTIFICATION_INTENT_MISSING", {
        outbox_id: candidate.id,
        intent_id: candidate.intent_id,
      })
      continue
    }

    // Check if intent was already confirmed/superseded/expired (B14-09-HR-06: Explicit terminal transition)
    if (
      intentRow.status === "confirmed" ||
      intentRow.status === "completed" ||
      intentRow.status === "superseded" ||
      intentRow.status === "expired"
    ) {
      await knex.raw(
        `update auth_notification_outbox
         set status = 'dead_letter',
             dead_lettered_at = ?,
             failure_reason = 'provider_permanent',
             lease_owner = null,
             lease_until = null,
             next_retry_at = null,
             version = version + 1,
             updated_at = now()
         where id = ? and version = ? and status = 'claimed'`,
        [currentNow.toISOString(), candidate.id, claimedVersion]
      )
      deadLettered += 1
      continue
    }

    let capability: string
    try {
      const derived = deriveCustomerAuthCapability({
        keyring,
        purpose: candidate.intent_type,
        intentId: candidate.intent_id,
        generation: Number(candidate.generation),
        nonce: intentRow.nonce,
        keyVersion: Number(candidate.key_version),
      })

      if (hashCustomerAuthCapability(derived.capability) !== intentRow.token_hash) {
        throw new Error("AUTH_CAPABILITY_RECONFIRMATION_HASH_MISMATCH")
      }
      capability = derived.capability
    } catch {
      const newAttemptCount = Number(candidate.attempt_count) + 1
      await knex.raw(
        `update auth_notification_outbox
         set status = 'dead_letter',
             dead_lettered_at = ?,
             failure_reason = 'provider_permanent',
             attempt_count = ?,
             lease_owner = null,
             lease_until = null,
             next_retry_at = null,
             version = version + 1,
             updated_at = now()
         where id = ? and version = ? and status = 'claimed'`,
        [
          currentNow.toISOString(),
          newAttemptCount,
          candidate.id,
          claimedVersion,
        ]
      )
      deadLettered += 1
      logSafe(deps.logger, "error", "AUTH_CAPABILITY_REDERIVATION_FAILED", {
        outbox_id: candidate.id,
        intent_id: candidate.intent_id,
      })
      continue
    }

    // 5. Render email template
    const rendered = renderAuthEmailTemplate(candidate.template, {
      capability,
      intentId: candidate.intent_id,
      recipientEmail: recipientResult.normalizedEmail,
      storefrontUrl: config.storefrontUrl,
    })

    // 6. Send via provider
    try {
      const sendResult = await client.send(
        {
          from: config.fromEmail,
          to: rendered.to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          replyTo: config.replyTo,
        },
        {
          idempotencyKey: candidate.idempotency_key,
        }
      )

      const providerMessageId = validateProviderMessageId(
        sendResult.providerMessageId
      )

      await knex.raw(
        `update auth_notification_outbox
         set status = 'sent',
             sent_at = ?,
             provider_message_id = ?,
             lease_owner = null,
             lease_until = null,
             next_retry_at = null,
             version = version + 1,
             updated_at = now()
         where id = ? and version = ? and status = 'claimed'`,
        [
          currentNow.toISOString(),
          providerMessageId,
          candidate.id,
          claimedVersion,
        ]
      )
      sent += 1
    } catch (providerError) {
      const newAttemptCount = Number(candidate.attempt_count) + 1
      const errorMessage =
        providerError instanceof Error ? providerError.message : ""
      const isPermanent =
        errorMessage.includes("400") ||
        errorMessage.includes("invalid_recipient") ||
        errorMessage.includes("unregistered") ||
        newAttemptCount >= AUTH_NOTIFICATION_OUTBOX_MAX_ATTEMPTS

      const failureReason: AuthNotificationFailureReason = isPermanent
        ? "provider_permanent"
        : "provider_transient"

      if (isPermanent) {
        await knex.raw(
          `update auth_notification_outbox
           set status = 'dead_letter',
               dead_lettered_at = ?,
               failure_reason = ?,
               attempt_count = ?,
               lease_owner = null,
               lease_until = null,
               next_retry_at = null,
               version = version + 1,
               updated_at = now()
           where id = ? and version = ? and status = 'claimed'`,
          [
            currentNow.toISOString(),
            failureReason,
            newAttemptCount,
            candidate.id,
            claimedVersion,
          ]
        )
        deadLettered += 1
        logSafe(deps.logger, "warn", "AUTH_NOTIFICATION_PROVIDER_DEAD_LETTER", {
          outbox_id: candidate.id,
          intent_id: candidate.intent_id,
          attempt_count: newAttemptCount,
          failure_reason: failureReason,
        })
      } else {
        const { nextRetryAt } = computeAuthNotificationBackoff(
          newAttemptCount,
          currentNow
        )
        await knex.raw(
          `update auth_notification_outbox
           set status = 'failed',
               failed_at = ?,
               failure_reason = ?,
               attempt_count = ?,
               next_retry_at = ?,
               lease_owner = null,
               lease_until = null,
               version = version + 1,
               updated_at = now()
           where id = ? and version = ? and status = 'claimed'`,
          [
            currentNow.toISOString(),
            failureReason,
            newAttemptCount,
            nextRetryAt?.toISOString(),
            candidate.id,
            claimedVersion,
          ]
        )
        failed += 1
      }
    }
  }

  return {
    processed,
    sent,
    failed,
    dead_lettered: deadLettered,
    timed_out: timedOut,
    skipped_missing_config: false,
    skipped_disabled: false,
    noop_reason: null,
  }
}

export async function runAuthNotificationRelayJob(
  container: MedusaContainer
): Promise<AuthNotificationRelayResult> {
  const knex = resolveKnex(container)
  let logger: SanitizedJobLogger | undefined
  try {
    logger = container.resolve("logger") as SanitizedJobLogger
  } catch {
    // optional logger
  }

  return runAuthNotificationRelay({
    container,
    knex,
    logger,
  })
}

export default async function authNotificationRelayJob(
  container: MedusaContainer
) {
  if (!isWorkerMode()) {
    return
  }
  if (isReleaseMigrationMode()) {
    return
  }

  await runAuthNotificationRelayJob(container)
}

export const config = {
  name: "auth-notification-relay",
  schedule: "* * * * *",
}
