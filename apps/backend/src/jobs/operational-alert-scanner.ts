import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { isReleaseMigrationMode } from "../infrastructure/release-migration-mode"
import { CHECKOUT_COMPLETION_MODULE } from "../modules/checkout-completion"
import { GELATO_FULFILLMENT_MODULE } from "../modules/gelato-fulfillment"
import {
  detectFulfillmentFailed,
  detectPaymentStuck,
  PIX_EXPIRED_ALERT_STATUSES,
  type CheckoutCompletionAlertCandidate,
  type FulfillmentAlertCandidate,
  type PaymentAttemptAlertCandidate,
  type WebhookEventAlertCandidate,
} from "../modules/operational-alert/detectors"
import {
  OPERATIONAL_ALERT_MODULE,
  type UpsertAlertInput,
} from "../modules/operational-alert"
import { PAYMENT_ATTEMPT_MODULE } from "../modules/payment-attempt"
import { WEBHOOKS_MODULE } from "../modules/webhooks"

export const OPERATIONAL_ALERT_SCANNER_BATCH_SIZE = 100
export const OPERATIONAL_ALERT_SCANNER_MAX_PAGES = 20
export const OPERATIONAL_ALERT_SCANNER_MAX_CANDIDATES_PER_SOURCE = 2000
export const OPERATIONAL_ALERT_SCANNER_TIMEOUT_MS = 25_000

type SanitizedJobLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void
  error?: (message: string, meta?: Record<string, unknown>) => void
  info?: (message: string, meta?: Record<string, unknown>) => void
}

type OperationalAlertModuleLike = {
  upsertAlert: (input: UpsertAlertInput) => Promise<unknown>
}

type PaymentAttemptModuleLike = {
  listPaymentAttempts: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<PaymentAttemptAlertCandidate[]>
}

type CheckoutCompletionModuleLike = {
  listCheckoutCompletionLogs: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<CheckoutCompletionAlertCandidate[]>
}

type WebhooksModuleLike = {
  listWebhookEventLogs: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<WebhookEventAlertCandidate[]>
}

type GelatoFulfillmentModuleLike = {
  listGelatoFulfillments: (
    filters?: Record<string, unknown>,
    config?: Record<string, unknown>
  ) => Promise<FulfillmentAlertCandidate[]>
}

export type OperationalAlertScannerDeps = {
  operationalAlert: OperationalAlertModuleLike
  paymentAttempt?: PaymentAttemptModuleLike | null
  checkoutCompletion?: CheckoutCompletionModuleLike | null
  webhooks?: WebhooksModuleLike | null
  gelatoFulfillment?: GelatoFulfillmentModuleLike | null
  logger?: SanitizedJobLogger
  now?: () => Date
  batchSize?: number
  maxPages?: number
  maxCandidatesPerSource?: number
  timeoutMs?: number
  isWorker?: () => boolean
  isReleaseMigration?: () => boolean
}

export type OperationalAlertScannerResult = {
  processed: number
  upserted: number
  skipped: number
  failed_items: number
  pages: number
  timed_out: boolean
  noop_reason: "not_worker" | "release_migration" | null
  by_source: {
    fulfillment: number
    confirmed_without_order: number
    pix_expired: number
  }
}

function logSafe(
  logger: SanitizedJobLogger | undefined,
  level: "info" | "warn" | "error",
  code: string,
  meta: Record<string, unknown>
) {
  const payload = {
    error_code: code,
    job: "operational-alert-scanner",
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

function isWorkerMode(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.WORKER_MODE === "worker"
}

function asPlainRecord<T extends Record<string, unknown>>(value: unknown): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { id: "" } as unknown as T
  }
  return { ...(value as object) } as T
}

function lastPageId(rows: Array<{ id?: string | null }>): string | null {
  const last = rows[rows.length - 1]
  if (!last?.id || typeof last.id !== "string" || last.id.trim() === "") {
    return null
  }
  return last.id
}

async function upsertPositive(
  deps: OperationalAlertScannerDeps,
  dto: UpsertAlertInput | null,
  counters: OperationalAlertScannerResult
): Promise<void> {
  if (!dto) {
    counters.skipped += 1
    return
  }

  try {
    await deps.operationalAlert.upsertAlert(dto)
    counters.upserted += 1
  } catch {
    counters.failed_items += 1
    logSafe(deps.logger, "warn", "OPERATIONAL_ALERT_SCANNER_UPSERT_FAILED", {
      type: dto.type,
      entity_type: dto.entity_type,
      entity_id: dto.entity_id,
      message_code: dto.message_code,
    })
  }
}

async function scanFulfillments(
  deps: OperationalAlertScannerDeps,
  nowFn: () => Date,
  observedAt: Date,
  counters: OperationalAlertScannerResult,
  startedAt: number
): Promise<void> {
  if (!deps.gelatoFulfillment) {
    return
  }

  const batchSize = deps.batchSize ?? OPERATIONAL_ALERT_SCANNER_BATCH_SIZE
  const maxPages = deps.maxPages ?? OPERATIONAL_ALERT_SCANNER_MAX_PAGES
  const maxCandidates =
    deps.maxCandidatesPerSource ??
    OPERATIONAL_ALERT_SCANNER_MAX_CANDIDATES_PER_SOURCE
  const timeoutMs = deps.timeoutMs ?? OPERATIONAL_ALERT_SCANNER_TIMEOUT_MS

  let sourcePages = 0
  let sourceCandidates = 0
  let previousLastId: string | null = null

  while (sourcePages < maxPages && sourceCandidates < maxCandidates) {
    if (nowFn().getTime() - startedAt >= timeoutMs) {
      counters.timed_out = true
      break
    }

    let page: FulfillmentAlertCandidate[]
    try {
      const listed = await deps.gelatoFulfillment.listGelatoFulfillments(
        {},
        {
          take: batchSize,
          skip: sourcePages * batchSize,
          order: { id: "ASC" },
        }
      )
      page = listed.map((row) => asPlainRecord(row))
    } catch {
      logSafe(deps.logger, "error", "OPERATIONAL_ALERT_SCANNER_PAGE_FAILED", {
        source: "fulfillment",
        page: sourcePages,
      })
      break
    }

    sourcePages += 1
    counters.pages += 1

    if (page.length === 0) {
      break
    }

    const pageLastId = lastPageId(page)
    if (
      page.length === batchSize &&
      previousLastId !== null &&
      (pageLastId === null || pageLastId <= previousLastId)
    ) {
      logSafe(
        deps.logger,
        "warn",
        "OPERATIONAL_ALERT_SCANNER_PAGINATION_STALLED",
        { source: "fulfillment", page: sourcePages }
      )
      break
    }

    for (const fulfillment of page) {
      if (sourceCandidates >= maxCandidates) {
        break
      }
      sourceCandidates += 1
      counters.processed += 1
      counters.by_source.fulfillment += 1

      try {
        const dto = detectFulfillmentFailed(fulfillment, observedAt)
        await upsertPositive(deps, dto, counters)
      } catch {
        counters.failed_items += 1
        logSafe(deps.logger, "warn", "OPERATIONAL_ALERT_SCANNER_ITEM_FAILED", {
          source: "fulfillment",
          entity_id: fulfillment.id,
        })
      }
    }

    if (page.length < batchSize) {
      break
    }

    previousLastId = pageLastId
  }
}

async function scanPaymentAttempts(
  deps: OperationalAlertScannerDeps,
  nowFn: () => Date,
  observedAt: Date,
  counters: OperationalAlertScannerResult,
  startedAt: number
): Promise<void> {
  if (!deps.paymentAttempt) {
    return
  }

  const batchSize = deps.batchSize ?? OPERATIONAL_ALERT_SCANNER_BATCH_SIZE
  const maxPages = deps.maxPages ?? OPERATIONAL_ALERT_SCANNER_MAX_PAGES
  const maxCandidates =
    deps.maxCandidatesPerSource ??
    OPERATIONAL_ALERT_SCANNER_MAX_CANDIDATES_PER_SOURCE
  const timeoutMs = deps.timeoutMs ?? OPERATIONAL_ALERT_SCANNER_TIMEOUT_MS

  let sourcePages = 0
  let sourceCandidates = 0
  let previousLastId: string | null = null

  while (sourcePages < maxPages && sourceCandidates < maxCandidates) {
    if (nowFn().getTime() - startedAt >= timeoutMs) {
      counters.timed_out = true
      break
    }

    let page: PaymentAttemptAlertCandidate[]
    try {
      const listed = await deps.paymentAttempt.listPaymentAttempts(
        {},
        {
          take: batchSize,
          skip: sourcePages * batchSize,
          order: { id: "ASC" },
        }
      )
      page = listed.map((row) => asPlainRecord(row))
    } catch {
      logSafe(deps.logger, "error", "OPERATIONAL_ALERT_SCANNER_PAGE_FAILED", {
        source: "payment_attempt",
        page: sourcePages,
      })
      break
    }

    sourcePages += 1
    counters.pages += 1

    if (page.length === 0) {
      break
    }

    const pageLastId = lastPageId(page)
    if (
      page.length === batchSize &&
      previousLastId !== null &&
      (pageLastId === null || pageLastId <= previousLastId)
    ) {
      logSafe(
        deps.logger,
        "warn",
        "OPERATIONAL_ALERT_SCANNER_PAGINATION_STALLED",
        { source: "payment_attempt", page: sourcePages }
      )
      break
    }

    for (const attempt of page) {
      if (sourceCandidates >= maxCandidates) {
        break
      }
      sourceCandidates += 1
      counters.processed += 1

      try {
        const checkoutCompletion = await loadCheckoutCompletionForAttempt(
          deps,
          attempt
        )
        const webhookCandidates = await loadWebhookCandidatesForAttempt(
          deps,
          attempt
        )
        const dto = detectPaymentStuck({
          paymentAttempt: attempt,
          checkoutCompletion,
          webhookCandidates,
          now: observedAt,
        })

        if (dto?.message_code === "PIX_PAYMENT_EXPIRED_WITHOUT_ORDER") {
          counters.by_source.pix_expired += 1
        } else if (dto) {
          counters.by_source.confirmed_without_order += 1
        }

        await upsertPositive(deps, dto, counters)
      } catch {
        counters.failed_items += 1
        logSafe(deps.logger, "warn", "OPERATIONAL_ALERT_SCANNER_ITEM_FAILED", {
          source: "payment_attempt",
          entity_id: attempt.id,
        })
      }
    }

    if (page.length < batchSize) {
      break
    }

    previousLastId = pageLastId
  }
}

async function loadCheckoutCompletionForAttempt(
  deps: OperationalAlertScannerDeps,
  attempt: PaymentAttemptAlertCandidate
): Promise<CheckoutCompletionAlertCandidate | null> {
  if (!deps.checkoutCompletion) {
    return null
  }

  const byAttempt = await deps.checkoutCompletion.listCheckoutCompletionLogs({
    payment_attempt_id: attempt.id,
  })
  if (byAttempt[0]) {
    return asPlainRecord<CheckoutCompletionAlertCandidate>(byAttempt[0])
  }

  if (!attempt.provider_payment_intent_id) {
    return null
  }

  const byIntent = await deps.checkoutCompletion.listCheckoutCompletionLogs({
    payment_intent_id: attempt.provider_payment_intent_id,
  })
  return byIntent[0]
    ? asPlainRecord<CheckoutCompletionAlertCandidate>(byIntent[0])
    : null
}

async function loadWebhookCandidatesForAttempt(
  deps: OperationalAlertScannerDeps,
  attempt: PaymentAttemptAlertCandidate
): Promise<WebhookEventAlertCandidate[]> {
  if (!deps.webhooks || !attempt.provider_payment_intent_id) {
    return []
  }

  const listed = await deps.webhooks.listWebhookEventLogs({
    provider: "stripe",
    event_type: "payment_intent.succeeded",
  })

  return listed.map((row) => asPlainRecord(row))
}

export async function runOperationalAlertScanner(
  deps: OperationalAlertScannerDeps
): Promise<OperationalAlertScannerResult> {
  const isWorker = deps.isWorker ?? (() => isWorkerMode())
  const isReleaseMigration =
    deps.isReleaseMigration ?? (() => isReleaseMigrationMode())

  if (!isWorker()) {
    return {
      processed: 0,
      upserted: 0,
      skipped: 0,
      failed_items: 0,
      pages: 0,
      timed_out: false,
      noop_reason: "not_worker",
      by_source: {
        fulfillment: 0,
        confirmed_without_order: 0,
        pix_expired: 0,
      },
    }
  }

  if (isReleaseMigration()) {
    return {
      processed: 0,
      upserted: 0,
      skipped: 0,
      failed_items: 0,
      pages: 0,
      timed_out: false,
      noop_reason: "release_migration",
      by_source: {
        fulfillment: 0,
        confirmed_without_order: 0,
        pix_expired: 0,
      },
    }
  }

  const nowFn = deps.now ?? (() => new Date())
  const observedAt = nowFn()
  const startedAt = observedAt.getTime()
  const counters: OperationalAlertScannerResult = {
    processed: 0,
    upserted: 0,
    skipped: 0,
    failed_items: 0,
    pages: 0,
    timed_out: false,
    noop_reason: null,
    by_source: {
      fulfillment: 0,
      confirmed_without_order: 0,
      pix_expired: 0,
    },
  }

  await scanFulfillments(deps, nowFn, observedAt, counters, startedAt)
  if (!counters.timed_out) {
    await scanPaymentAttempts(deps, nowFn, observedAt, counters, startedAt)
  }

  logSafe(deps.logger, "info", "OPERATIONAL_ALERT_SCANNER_COMPLETE", {
    processed: counters.processed,
    upserted: counters.upserted,
    skipped: counters.skipped,
    failed_items: counters.failed_items,
    pages: counters.pages,
    timed_out: counters.timed_out,
    fulfillment: counters.by_source.fulfillment,
    confirmed_without_order: counters.by_source.confirmed_without_order,
    pix_expired: counters.by_source.pix_expired,
    pix_status_allowlist_size: PIX_EXPIRED_ALERT_STATUSES.length,
  })

  return counters
}

function resolveOptionalModule<T>(
  container: MedusaContainer,
  key: string
): T | null {
  try {
    return container.resolve(key) as T
  } catch {
    return null
  }
}

export async function runOperationalAlertScannerJob(
  container: MedusaContainer
): Promise<OperationalAlertScannerResult> {
  const operationalAlert = container.resolve(
    OPERATIONAL_ALERT_MODULE
  ) as OperationalAlertModuleLike
  const logger = resolveOptionalModule<SanitizedJobLogger>(
    container,
    ContainerRegistrationKeys.LOGGER
  )

  return runOperationalAlertScanner({
    operationalAlert,
    paymentAttempt: resolveOptionalModule<PaymentAttemptModuleLike>(
      container,
      PAYMENT_ATTEMPT_MODULE
    ),
    checkoutCompletion: resolveOptionalModule<CheckoutCompletionModuleLike>(
      container,
      CHECKOUT_COMPLETION_MODULE
    ),
    webhooks: resolveOptionalModule<WebhooksModuleLike>(
      container,
      WEBHOOKS_MODULE
    ),
    gelatoFulfillment: resolveOptionalModule<GelatoFulfillmentModuleLike>(
      container,
      GELATO_FULFILLMENT_MODULE
    ),
    logger: logger ?? undefined,
  })
}

export default async function operationalAlertScannerJob(
  container: MedusaContainer
) {
  if (!isWorkerMode()) {
    return
  }
  if (isReleaseMigrationMode()) {
    return
  }

  await runOperationalAlertScannerJob(container)
}

export const config = {
  name: "operational-alert-scanner",
  schedule: "*/5 * * * *",
}
