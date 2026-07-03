import { createHmac } from "crypto"
import type { MedusaRequest } from "@medusajs/framework/http"
import { resolveTrackingTokenPepper } from "./service"

export const TRACKING_LOOKUP_RATE_LIMIT_MAX_ATTEMPTS = 10 as const
export const TRACKING_LOOKUP_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

export type TrackingLookupRateLimitConfig = {
  maxAttempts: number
  windowMs: number
}

export type TrackingLookupRateLimitBucketRecord = {
  count: number
  windowStartMs: number
}

export type TrackingLookupRateLimitStore = {
  get: (bucketKey: string) => Promise<TrackingLookupRateLimitBucketRecord | null>
  set: (
    bucketKey: string,
    record: TrackingLookupRateLimitBucketRecord
  ) => Promise<void>
}

export type TrackingLookupRateLimitContext = {
  bucketKey: string
  config: TrackingLookupRateLimitConfig
  store: TrackingLookupRateLimitStore
}

const DEFAULT_RATE_LIMIT_CONFIG: TrackingLookupRateLimitConfig = {
  maxAttempts: TRACKING_LOOKUP_RATE_LIMIT_MAX_ATTEMPTS,
  windowMs: TRACKING_LOOKUP_RATE_LIMIT_WINDOW_MS,
}

let activeRateLimitConfig: TrackingLookupRateLimitConfig = {
  ...DEFAULT_RATE_LIMIT_CONFIG,
}

const inMemoryRateLimitBuckets = new Map<string, TrackingLookupRateLimitBucketRecord>()

export function pruneExpiredTrackingLookupRateLimitBuckets(
  now: Date,
  windowMs: number = TRACKING_LOOKUP_RATE_LIMIT_WINDOW_MS
): void {
  const currentWindowStartMs = buildTrackingLookupRateLimitWindowStartMs(now, windowMs)
  const retentionCutoffMs = currentWindowStartMs - windowMs

  for (const [bucketKey, record] of inMemoryRateLimitBuckets.entries()) {
    if (record.windowStartMs < retentionCutoffMs) {
      inMemoryRateLimitBuckets.delete(bucketKey)
    }
  }
}

export const inMemoryTrackingLookupRateLimitStore: TrackingLookupRateLimitStore = {
  async get(bucketKey) {
    return inMemoryRateLimitBuckets.get(bucketKey) ?? null
  },
  async set(bucketKey, record) {
    inMemoryRateLimitBuckets.set(bucketKey, record)
  },
}

export function summarizeTrackingLookupUserAgent(
  userAgent: string | undefined | null
): string {
  const normalized = (userAgent ?? "").trim().toLowerCase()

  if (!normalized) {
    return "unknown"
  }

  const productToken = normalized.split(/\s+/)[0] ?? "unknown"

  return productToken.slice(0, 48) || "unknown"
}

function readHeaderValue(
  headers: Record<string, unknown> | undefined,
  name: string
): string | undefined {
  const value = headers?.[name]

  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }

  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string" && entry.trim())

    if (typeof first === "string") {
      return first.trim()
    }
  }

  return undefined
}

export function resolveTrackingLookupClientIp(input: {
  headers?: Record<string, unknown>
  ip?: unknown
  socketRemoteAddress?: unknown
}): string {
  const forwarded = readHeaderValue(input.headers, "x-forwarded-for")

  if (forwarded) {
    const firstHop = forwarded.split(",")[0]?.trim()

    if (firstHop) {
      return firstHop
    }
  }

  const realIp = readHeaderValue(input.headers, "x-real-ip")

  if (realIp) {
    return realIp
  }

  if (typeof input.ip === "string" && input.ip.trim()) {
    return input.ip.trim()
  }

  if (typeof input.socketRemoteAddress === "string" && input.socketRemoteAddress.trim()) {
    return input.socketRemoteAddress.trim()
  }

  return "unknown"
}

export function buildTrackingLookupRateLimitWindowStartMs(
  now: Date,
  windowMs: number
): number {
  return Math.floor(now.getTime() / windowMs) * windowMs
}

export function buildTrackingLookupRateLimitBucketKey(input: {
  clientIp: string
  userAgentSummary: string
  now?: Date
  windowMs?: number
  pepper: string
}): string {
  const windowMs = input.windowMs ?? TRACKING_LOOKUP_RATE_LIMIT_WINDOW_MS
  const now = input.now ?? new Date()
  const windowStartMs = buildTrackingLookupRateLimitWindowStartMs(now, windowMs)

  return createHmac("sha256", input.pepper)
    .update(`${input.clientIp}|${input.userAgentSummary}|${windowStartMs}`)
    .digest("hex")
}

export function buildTrackingLookupRateLimitContextFromRequest(
  req: MedusaRequest,
  options: {
    config?: TrackingLookupRateLimitConfig
    store?: TrackingLookupRateLimitStore
    env?: Record<string, string | undefined>
    now?: Date
  } = {}
): TrackingLookupRateLimitContext {
  const config = options.config ?? activeRateLimitConfig
  const store = options.store ?? inMemoryTrackingLookupRateLimitStore
  const now = options.now ?? new Date()
  const pepper = resolveTrackingTokenPepper(options.env)
  const headers = req.headers as Record<string, unknown> | undefined
  const requestWithNetwork = req as MedusaRequest & {
    ip?: string
    socket?: { remoteAddress?: string }
  }

  const bucketKey = buildTrackingLookupRateLimitBucketKey({
    clientIp: resolveTrackingLookupClientIp({
      headers,
      ip: requestWithNetwork.ip,
      socketRemoteAddress: requestWithNetwork.socket?.remoteAddress,
    }),
    userAgentSummary: summarizeTrackingLookupUserAgent(
      readHeaderValue(headers, "user-agent")
    ),
    now,
    windowMs: config.windowMs,
    pepper,
  })

  return {
    bucketKey,
    config,
    store,
  }
}

async function readBucketRecord(
  context: TrackingLookupRateLimitContext,
  now: Date
): Promise<TrackingLookupRateLimitBucketRecord> {
  const windowStartMs = buildTrackingLookupRateLimitWindowStartMs(
    now,
    context.config.windowMs
  )
  const existing = await context.store.get(context.bucketKey)

  if (!existing || existing.windowStartMs !== windowStartMs) {
    return {
      count: 0,
      windowStartMs,
    }
  }

  return existing
}

export async function isTrackingLookupRateLimited(
  context: TrackingLookupRateLimitContext,
  now: Date = new Date()
): Promise<boolean> {
  const record = await readBucketRecord(context, now)

  return record.count >= context.config.maxAttempts
}

export async function recordTrackingLookupRateLimitFailure(
  context: TrackingLookupRateLimitContext,
  now: Date = new Date()
): Promise<{ limited: boolean; count: number }> {
  pruneExpiredTrackingLookupRateLimitBuckets(now, context.config.windowMs)

  const record = await readBucketRecord(context, now)
  const nextCount = record.count + 1
  const nextRecord: TrackingLookupRateLimitBucketRecord = {
    count: nextCount,
    windowStartMs: record.windowStartMs,
  }

  await context.store.set(context.bucketKey, nextRecord)

  pruneExpiredTrackingLookupRateLimitBuckets(now, context.config.windowMs)

  return {
    limited: nextCount >= context.config.maxAttempts,
    count: nextCount,
  }
}

export function configureTrackingLookupRateLimitForTests(
  overrides: Partial<TrackingLookupRateLimitConfig> = {}
): void {
  activeRateLimitConfig = {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    ...overrides,
  }
}

export function resetTrackingLookupRateLimitForTests(): void {
  activeRateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG }
  inMemoryRateLimitBuckets.clear()
}

export function listInMemoryTrackingLookupRateLimitBucketKeysForTests(): string[] {
  return [...inMemoryRateLimitBuckets.keys()]
}

export function listInMemoryTrackingLookupRateLimitBucketsForTests(): Array<{
  bucketKey: string
  record: TrackingLookupRateLimitBucketRecord
}> {
  return [...inMemoryRateLimitBuckets.entries()].map(([bucketKey, record]) => ({
    bucketKey,
    record,
  }))
}
