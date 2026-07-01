import type { MedusaContainer } from "@medusajs/framework/types"
import { PostHog } from "posthog-node"
import {
  ANALYTICS_EVENT_LOG_MODULE,
} from "../modules/analytics-event-log"
import {
  ANALYTICS_EVENT_STATUS,
  type AnalyticsEventLogRecord,
} from "../modules/analytics-event-log/types"
import {
  buildAnalyticsRelayClaimUpdate,
  buildAnalyticsRelayFailureUpdate,
  buildAnalyticsRelaySendingUpdate,
  buildAnalyticsRelaySuccessUpdate,
  buildPostHogCaptureFromAnalyticsEvent,
  isAnalyticsRelayDue,
  isAnalyticsRelayEligibleStatus,
  type PostHogCaptureInput,
} from "../modules/analytics-event-log/service"

export type PostHogRelayConfig = {
  apiKey: string
  host?: string
}

export type PostHogRelayClient = {
  capture: (input: PostHogCaptureInput) => void | Promise<void>
  shutdown?: () => Promise<void>
}

export type AnalyticsPosthogRelayResult = {
  processed: number
  sent: number
  failed: number
  dead_lettered: number
  skipped_missing_config: boolean
}

type AnalyticsEventLogModule = {
  listAnalyticsEventLogs: (
    filters?: Record<string, unknown>
  ) => Promise<AnalyticsEventLogRecord[]>
  updateAnalyticsEventLogs: (
    input:
      | (Partial<AnalyticsEventLogRecord> & { id: string })
      | Array<Partial<AnalyticsEventLogRecord> & { id: string }>
  ) => Promise<AnalyticsEventLogRecord[]>
}

const DEFAULT_BATCH_SIZE = 25

export function resolvePostHogRelayConfig(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): PostHogRelayConfig | null {
  const apiKey = env.POSTHOG_API_KEY?.trim()

  if (!apiKey) {
    return null
  }

  const host = env.POSTHOG_HOST?.trim()

  return {
    apiKey,
    ...(host ? { host } : {}),
  }
}

export function createPostHogRelayClient(
  config: PostHogRelayConfig
): PostHogRelayClient {
  const client = new PostHog(config.apiKey, {
    ...(config.host ? { host: config.host } : {}),
    flushAt: 1,
    flushInterval: 0,
  })

  return {
    capture(input) {
      client.capture({
        event: input.event,
        distinctId: input.distinctId,
        properties: input.properties,
      })
    },
    async shutdown() {
      await client.shutdown()
    },
  }
}

function resolveAnalyticsEventLogModule(
  container: MedusaContainer
): AnalyticsEventLogModule {
  const runtimeKeys = ["analytics_event_log", ANALYTICS_EVENT_LOG_MODULE]

  for (const key of runtimeKeys) {
    const candidate = container.resolve(key) as AnalyticsEventLogModule | undefined

    if (
      candidate &&
      typeof candidate.listAnalyticsEventLogs === "function" &&
      typeof candidate.updateAnalyticsEventLogs === "function"
    ) {
      return candidate
    }
  }

  throw new Error("ANALYTICS_EVENT_LOG_MODULE_UNAVAILABLE")
}

async function listRelayCandidates(
  module: AnalyticsEventLogModule,
  now: Date
): Promise<AnalyticsEventLogRecord[]> {
  const [recorded, failed] = await Promise.all([
    module.listAnalyticsEventLogs({
      status: ANALYTICS_EVENT_STATUS.RECORDED,
    }),
    module.listAnalyticsEventLogs({
      status: ANALYTICS_EVENT_STATUS.FAILED,
    }),
  ])

  return [...recorded, ...failed]
    .filter((event) => isAnalyticsRelayEligibleStatus(event.status))
    .filter((event) => isAnalyticsRelayDue(event.next_retry_at, now))
    .sort((left, right) => left.recorded_at.localeCompare(right.recorded_at))
}

async function relaySingleEvent(
  module: AnalyticsEventLogModule,
  client: PostHogRelayClient,
  event: AnalyticsEventLogRecord,
  now: Date,
  maxAttempts: number
): Promise<"sent" | "failed" | "dead_lettered"> {
  const claimUpdate = buildAnalyticsRelayClaimUpdate(now)

  await module.updateAnalyticsEventLogs({
    id: event.id,
    ...claimUpdate,
  })

  await module.updateAnalyticsEventLogs({
    id: event.id,
    ...buildAnalyticsRelaySendingUpdate(now),
  })

  try {
    const capture = buildPostHogCaptureFromAnalyticsEvent(event)
    await client.capture(capture)

    await module.updateAnalyticsEventLogs({
      id: event.id,
      ...buildAnalyticsRelaySuccessUpdate(now),
    })

    return "sent"
  } catch (error) {
    const failureUpdate = buildAnalyticsRelayFailureUpdate(
      error,
      event.attempt_count,
      {
        maxAttempts,
        at: now,
      }
    )

    await module.updateAnalyticsEventLogs({
      id: event.id,
      ...failureUpdate,
    })

    return failureUpdate.status === ANALYTICS_EVENT_STATUS.DEAD_LETTER
      ? "dead_lettered"
      : "failed"
  }
}

export async function runAnalyticsPosthogRelay(
  container: MedusaContainer,
  deps: {
    now?: () => Date
    config?: PostHogRelayConfig | null
    createClient?: (config: PostHogRelayConfig) => PostHogRelayClient
    maxAttempts?: number
    batchSize?: number
  } = {}
): Promise<AnalyticsPosthogRelayResult> {
  const now = deps.now?.() ?? new Date()
  const config =
    deps.config === undefined
      ? resolvePostHogRelayConfig()
      : deps.config

  if (!config) {
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_missing_config: true,
    }
  }

  const module = resolveAnalyticsEventLogModule(container)
  const createClient = deps.createClient ?? createPostHogRelayClient
  const client = createClient(config)
  const maxAttempts = deps.maxAttempts ?? 5
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE

  const candidates = (await listRelayCandidates(module, now)).slice(
    0,
    batchSize
  )

  let sent = 0
  let failed = 0
  let deadLettered = 0

  try {
    for (const event of candidates) {
      const outcome = await relaySingleEvent(
        module,
        client,
        event,
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
  } finally {
    if (client.shutdown) {
      await client.shutdown()
    }
  }

  return {
    processed: candidates.length,
    sent,
    failed,
    dead_lettered: deadLettered,
    skipped_missing_config: false,
  }
}

export default async function analyticsPosthogRelayJob(
  container: MedusaContainer
) {
  await runAnalyticsPosthogRelay(container)
}

export const config = {
  name: "analytics-posthog-relay",
  schedule: "* * * * *",
}
