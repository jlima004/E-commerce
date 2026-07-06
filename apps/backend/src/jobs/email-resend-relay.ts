import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import { Resend } from "resend"
import { EMAIL_DELIVERY_LOG_MODULE } from "../modules/email-delivery-log"
import {
  EMAIL_DELIVERY_LOG_STATUS,
  type EmailDeliveryLogRecord,
} from "../modules/email-delivery-log/types"
import {
  buildEmailResendRelayClaimUpdate,
  buildEmailResendRelayFailureUpdate,
  buildEmailResendRelaySendingUpdate,
  buildEmailResendRelaySuccessUpdate,
  buildOrderConfirmationResendSendPayload,
  isEmailResendRelayStaleInFlight,
  isEmailResendRelayDue,
  isEmailResendRelayEligibleStatus,
  resolveOrderRecipientEmail,
  type ResendEmailSendPayload,
} from "../modules/email-delivery-log/service"

export type ResendRelayConfig = {
  apiKey: string
  fromEmail: string
  replyTo?: string
}

export type ResendRelaySendOptions = {
  idempotencyKey: string
}

export type ResendRelayClient = {
  send: (
    payload: ResendEmailSendPayload,
    options: ResendRelaySendOptions
  ) => Promise<{ providerMessageId: string }>
}

export type EmailResendRelayResult = {
  processed: number
  sent: number
  failed: number
  dead_lettered: number
  skipped_missing_config: boolean
  skipped_disabled: boolean
}

type EmailDeliveryLogModule = {
  listEmailDeliveryLogs: (
    filters?: Record<string, unknown>
  ) => Promise<EmailDeliveryLogRecord[]>
  updateEmailDeliveryLogs: (
    input:
      | (Partial<EmailDeliveryLogRecord> & { id: string })
      | Array<Partial<EmailDeliveryLogRecord> & { id: string }>
  ) => Promise<EmailDeliveryLogRecord[]>
}

type OrderModule = {
  listOrders: (
    selector?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<Array<{ id: string; email?: string | null }>>
}

const DEFAULT_BATCH_SIZE = 25

export function resolveResendRelayConfig(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): ResendRelayConfig | null {
  if (env.RESEND_ORDER_CONFIRMATION_ENABLED?.trim() !== "true") {
    return null
  }

  const apiKey = env.RESEND_API_KEY?.trim()
  const fromEmail = env.RESEND_FROM_EMAIL?.trim()

  if (!apiKey || !fromEmail) {
    return null
  }

  const replyTo = env.RESEND_REPLY_TO?.trim()

  return {
    apiKey,
    fromEmail,
    ...(replyTo ? { replyTo } : {}),
  }
}

export function isResendRelayDisabled(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): boolean {
  return env.RESEND_ORDER_CONFIRMATION_ENABLED?.trim() !== "true"
}

export function createResendRelayClient(
  config: ResendRelayConfig
): ResendRelayClient {
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
          ...(payload.reply_to ? { replyTo: payload.reply_to } : {}),
        },
        {
          idempotencyKey: options.idempotencyKey,
        }
      )

      if (response.error) {
        throw new Error(response.error.message || "EMAIL_RESEND_PROVIDER_ERROR")
      }

      if (!response.data?.id) {
        throw new Error("EMAIL_RESEND_PROVIDER_MESSAGE_ID_MISSING")
      }

      return {
        providerMessageId: response.data.id,
      }
    },
  }
}

function resolveEmailDeliveryLogModule(
  container: MedusaContainer
): EmailDeliveryLogModule {
  const runtimeKeys = ["email_delivery_log", EMAIL_DELIVERY_LOG_MODULE]

  for (const key of runtimeKeys) {
    const candidate = container.resolve(key) as EmailDeliveryLogModule | undefined

    if (
      candidate &&
      typeof candidate.listEmailDeliveryLogs === "function" &&
      typeof candidate.updateEmailDeliveryLogs === "function"
    ) {
      return candidate
    }
  }

  throw new Error("EMAIL_DELIVERY_LOG_MODULE_UNAVAILABLE")
}

function resolveOrderModule(container: MedusaContainer): OrderModule {
  const candidate = container.resolve(Modules.ORDER) as OrderModule | undefined

  if (candidate && typeof candidate.listOrders === "function") {
    return candidate
  }

  throw new Error("ORDER_MODULE_UNAVAILABLE")
}

async function listRelayCandidates(
  module: EmailDeliveryLogModule,
  now: Date
): Promise<EmailDeliveryLogRecord[]> {
  const [recorded, failed, queued, sending] = await Promise.all([
    module.listEmailDeliveryLogs({
      status: EMAIL_DELIVERY_LOG_STATUS.RECORDED,
    }),
    module.listEmailDeliveryLogs({
      status: EMAIL_DELIVERY_LOG_STATUS.FAILED,
    }),
    module.listEmailDeliveryLogs({
      status: EMAIL_DELIVERY_LOG_STATUS.QUEUED,
    }),
    module.listEmailDeliveryLogs({
      status: EMAIL_DELIVERY_LOG_STATUS.SENDING,
    }),
  ])

  return [...recorded, ...failed, ...queued, ...sending]
    .filter((event) => {
      if (isEmailResendRelayEligibleStatus(event.status)) {
        return isEmailResendRelayDue(event.next_retry_at, now)
      }

      return isEmailResendRelayStaleInFlight(event, now)
    })
    .sort((left, right) => left.recorded_at.localeCompare(right.recorded_at))
}

async function resolveOrderEmail(
  orderModule: OrderModule,
  orderId: string
): Promise<string> {
  const orders = await orderModule.listOrders({ id: orderId })

  return resolveOrderRecipientEmail(orders[0])
}

async function relaySingleEvent(
  emailModule: EmailDeliveryLogModule,
  orderModule: OrderModule,
  client: ResendRelayClient,
  event: EmailDeliveryLogRecord,
  config: ResendRelayConfig,
  now: Date,
  maxAttempts: number
): Promise<"sent" | "failed" | "dead_lettered"> {
  await emailModule.updateEmailDeliveryLogs({
    id: event.id,
    ...buildEmailResendRelayClaimUpdate(now),
  })

  await emailModule.updateEmailDeliveryLogs({
    id: event.id,
    ...buildEmailResendRelaySendingUpdate(now),
  })

  let recipientEmail: string

  try {
    recipientEmail = await resolveOrderEmail(orderModule, event.order_id)
  } catch (error) {
    const failureUpdate = buildEmailResendRelayFailureUpdate(
      error,
      event.attempt_count,
      {
        maxAttempts,
        at: now,
      }
    )

    await emailModule.updateEmailDeliveryLogs({
      id: event.id,
      ...failureUpdate,
    })

    return failureUpdate.status === EMAIL_DELIVERY_LOG_STATUS.DEAD_LETTER
      ? "dead_lettered"
      : "failed"
  }

  const sendPayload = buildOrderConfirmationResendSendPayload({
    payload: event.payload,
    recipientEmail,
    fromEmail: config.fromEmail,
    replyTo: config.replyTo,
  })

  try {
    const result = await client.send(sendPayload, {
      idempotencyKey: event.idempotency_key,
    })

    await emailModule.updateEmailDeliveryLogs({
      id: event.id,
      ...buildEmailResendRelaySuccessUpdate(result.providerMessageId, now),
    })

    return "sent"
  } catch (error) {
    const failureUpdate = buildEmailResendRelayFailureUpdate(
      error,
      event.attempt_count,
      {
        maxAttempts,
        at: now,
      }
    )

    await emailModule.updateEmailDeliveryLogs({
      id: event.id,
      ...failureUpdate,
    })

    return failureUpdate.status === EMAIL_DELIVERY_LOG_STATUS.DEAD_LETTER
      ? "dead_lettered"
      : "failed"
  }
}

export async function runEmailResendRelay(
  container: MedusaContainer,
  deps: {
    now?: () => Date
    config?: ResendRelayConfig | null
    env?: Record<string, string | undefined>
    createClient?: (config: ResendRelayConfig) => ResendRelayClient
    maxAttempts?: number
    batchSize?: number
  } = {}
): Promise<EmailResendRelayResult> {
  const now = deps.now?.() ?? new Date()
  const env = deps.env ?? (process.env as Record<string, string | undefined>)

  if (deps.config === undefined && isResendRelayDisabled(env)) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: false,
      skipped_disabled: true,
    }
  }

  const config =
    deps.config === undefined ? resolveResendRelayConfig(env) : deps.config

  if (!config) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: true,
      skipped_disabled: false,
    }
  }

  const emailModule = resolveEmailDeliveryLogModule(container)
  const orderModule = resolveOrderModule(container)
  const createClient = deps.createClient ?? createResendRelayClient
  const client = createClient(config)
  const maxAttempts = deps.maxAttempts ?? 5
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE

  const candidates = (await listRelayCandidates(emailModule, now)).slice(
    0,
    batchSize
  )

  let sent = 0
  let failed = 0
  let deadLettered = 0

  for (const event of candidates) {
    const outcome = await relaySingleEvent(
      emailModule,
      orderModule,
      client,
      event,
      config,
      now,
      maxAttempts
    )

    if (outcome === "sent") {
      sent += 1
    } else if (outcome === "dead_lettered") {
      deadLettered += 1
    } else {
      failed += 1
    }
  }

  return {
    processed: candidates.length,
    sent,
    failed,
    dead_lettered: deadLettered,
    skipped_missing_config: false,
    skipped_disabled: false,
  }
}

export default async function emailResendRelayJob(container: MedusaContainer) {
  if (isReleaseMigrationMode()) {
    return
  }

  await runEmailResendRelay(container)
}

export const config = {
  name: "email-resend-relay",
  schedule: "* * * * *",
}
