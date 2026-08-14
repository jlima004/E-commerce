import { createHash, createHmac } from "node:crypto"
import { isIP } from "node:net"
import type Redis from "ioredis"

export type AuthRateLimitOperation =
  | "signup"
  | "login"
  | "reset-request"
  | "verification-request"
  | "verification-confirm"
  | "reset-confirm"
  | "refresh"
  | "password-change"

export type AuthRateLimitKeyring = {
  active: { version: number; secret: string }
}

type LimitWindow = readonly [limit: number, windowSeconds: number]
type PolicyStage = Readonly<Record<string, LimitWindow>>
type RateLimitPolicy = {
  pre?: PolicyStage
  authenticated?: PolicyStage
  post?: PolicyStage
  publicFailureMode?: "absorb"
}

export const AUTH_RATE_LIMIT_POLICIES = {
  signup: { pre: { ip: [5, 900], email: [3, 3600] } },
  login: { pre: { "ip-email": [10, 900], ip: [30, 900] } },
  "reset-request": {
    pre: { email: [3, 3600], ip: [10, 3600] },
    publicFailureMode: "absorb",
  },
  "verification-request": {
    authenticated: { lineage: [3, 3600], ip: [10, 3600] },
  },
  "verification-confirm": {
    pre: { "ip-token": [10, 900] },
    post: { intent: [10, 900] },
  },
  "reset-confirm": {
    pre: { ip: [30, 900], "ip-token": [10, 900] },
    post: { intent: [10, 900] },
  },
  refresh: {
    pre: { ip: [60, 900], "ip-token": [10, 60] },
    post: { lineage: [10, 60] },
  },
  "password-change": { authenticated: { lineage: [5, 3600] } },
} as const satisfies Record<AuthRateLimitOperation, RateLimitPolicy>

export type DerivedRateLimitBucket = {
  key: string
  digest: string
  limit: number
  windowSeconds: number
}

export type RateLimitBucketResult = DerivedRateLimitBucket & {
  count: number
  retryAfterSeconds: number
}

export type RateLimitResult = {
  allowed: boolean
  buckets: RateLimitBucketResult[]
  blockedBy?: RateLimitBucketResult
}

export interface AtomicRateLimitStore {
  increment(buckets: readonly DerivedRateLimitBucket[]): Promise<RateLimitBucketResult[]>
}

export class AuthRateLimitUnavailableError extends Error {
  readonly code = "AUTH_TEMPORARILY_UNAVAILABLE"
  readonly retryAfterSeconds = 60

  constructor() {
    super("Customer auth rate limiter unavailable")
    this.name = "AuthRateLimitUnavailableError"
  }
}

function assertKeyring(keyring: AuthRateLimitKeyring): void {
  if (
    !Number.isSafeInteger(keyring.active.version) ||
    keyring.active.version < 1 ||
    keyring.active.secret.length < 32
  ) {
    throw new Error("Invalid auth rate limit keyring")
  }
}

function normalizeIpv6Prefix(address: string): string {
  const [leftRaw, rightRaw = ""] = address.toLowerCase().split("::")
  const left = leftRaw ? leftRaw.split(":") : []
  const right = rightRaw ? rightRaw.split(":") : []
  const missing = 8 - left.length - right.length
  const parts = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right]
  if (parts.length !== 8 || parts.some((part) => !/^[a-f0-9]{1,4}$/.test(part))) {
    throw new Error("Invalid auth rate limit IP")
  }
  return `${parts.slice(0, 4).map((part) => Number.parseInt(part, 16).toString(16)).join(":")}::/64`
}

export function normalizeAuthRateLimitNetworkPrefix(ip: string): string {
  const version = isIP(ip)
  if (version === 4) return `${ip}/32`
  if (version === 6) return normalizeIpv6Prefix(ip)
  throw new Error("Invalid auth rate limit IP")
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function deriveBucket(input: {
  keyring: AuthRateLimitKeyring
  operation: AuthRateLimitOperation
  purpose: string
  material: string
  policy: LimitWindow
}): DerivedRateLimitBucket {
  assertKeyring(input.keyring)
  const version = input.keyring.active.version
  const domain = [
    "auth-rate",
    `key-version:${version}`,
    `operation:${input.operation}`,
    `purpose:${input.purpose}`,
    input.material,
  ].join("|")
  const digest = createHmac("sha256", input.keyring.active.secret)
    .update(domain, "utf8")
    .digest("hex")
  return {
    key: `auth-rate:v${version}:${input.purpose}:${digest}`,
    digest,
    limit: input.policy[0],
    windowSeconds: input.policy[1],
  }
}

type PreLookupInput = {
  operation: "signup" | "login" | "reset-request" | "verification-confirm" | "reset-confirm" | "refresh"
  keyring: AuthRateLimitKeyring
  ip: string
  email?: string
  presentedToken?: string
}

export function buildPreLookupRateLimitKeys(input: PreLookupInput): DerivedRateLimitBucket[] {
  const network = normalizeAuthRateLimitNetworkPrefix(input.ip)
  const ipDigest = sha256(network)
  const emailDigest = input.email === undefined ? undefined : sha256(input.email)
  const tokenDigest = input.presentedToken === undefined ? undefined : sha256(input.presentedToken)
  const policy = AUTH_RATE_LIMIT_POLICIES[input.operation].pre
  const keys: DerivedRateLimitBucket[] = []

  for (const [dimension, limitWindow] of Object.entries(policy) as Array<[string, LimitWindow]>) {
    let material: string
    if (dimension === "ip") material = `network-digest:${ipDigest}`
    else if (dimension === "email" && emailDigest) material = `email-digest:${emailDigest}`
    else if (dimension === "ip-email" && emailDigest) material = `network-digest:${ipDigest}|email-digest:${emailDigest}`
    else if (dimension === "ip-token" && tokenDigest) material = `network-digest:${ipDigest}|token-digest:${tokenDigest}`
    else throw new Error(`Missing auth rate limit input for ${dimension}`)

    keys.push(deriveBucket({
      keyring: input.keyring,
      operation: input.operation,
      purpose: `pre-${dimension}`,
      material,
      policy: limitWindow,
    }))
  }
  return keys
}

export function buildAuthenticatedVerificationRequestKeys(input: {
  keyring: AuthRateLimitKeyring
  ip: string
  authorizedLineageId: string
}): DerivedRateLimitBucket[] {
  if (!input.authorizedLineageId) throw new Error("Authorized lineage is required")
  const policy = AUTH_RATE_LIMIT_POLICIES["verification-request"].authenticated
  return [
    deriveBucket({
      keyring: input.keyring,
      operation: "verification-request",
      purpose: "authenticated-lineage",
      material: `lineage-digest:${sha256(input.authorizedLineageId)}`,
      policy: policy.lineage,
    }),
    deriveBucket({
      keyring: input.keyring,
      operation: "verification-request",
      purpose: "authenticated-ip",
      material: `network-digest:${sha256(normalizeAuthRateLimitNetworkPrefix(input.ip))}`,
      policy: policy.ip,
    }),
  ]
}

export function buildPostLookupRateLimitKey(input: {
  operation: "verification-confirm" | "reset-confirm" | "refresh"
  keyring: AuthRateLimitKeyring
  preDigest: string
  resolved: { kind: "intent" | "lineage"; opaqueId: string } | null
}): DerivedRateLimitBucket {
  const dimension = input.operation === "refresh" ? "lineage" : "intent"
  const policy = AUTH_RATE_LIMIT_POLICIES[input.operation].post[dimension]
  const material = input.resolved
    ? `${dimension}-digest:${sha256(input.resolved.opaqueId)}`
    : `dummy-digest:${sha256(input.preDigest)}`
  return deriveBucket({
    keyring: input.keyring,
    operation: input.operation,
    purpose: `post-${dimension}`,
    material,
    policy,
  })
}

export async function consumeRateLimitBuckets(
  store: AtomicRateLimitStore,
  buckets: readonly DerivedRateLimitBucket[]
): Promise<RateLimitResult> {
  try {
    const results = await store.increment(buckets)
    const blockedBy = results.find((entry) => entry.count > entry.limit)
    return { allowed: !blockedBy, buckets: results, blockedBy }
  } catch {
    throw new AuthRateLimitUnavailableError()
  }
}

export class InMemoryAtomicRateLimitStore implements AtomicRateLimitStore {
  readonly operations: number[] = []
  private readonly counters = new Map<string, { count: number; expiresAt: number }>()

  constructor(private readonly now: () => number = Date.now) {}

  async increment(buckets: readonly DerivedRateLimitBucket[]): Promise<RateLimitBucketResult[]> {
    this.operations.push(buckets.length)
    const now = this.now()
    return buckets.map((bucket) => {
      const prior = this.counters.get(bucket.key)
      const current = !prior || prior.expiresAt <= now
        ? { count: 1, expiresAt: now + bucket.windowSeconds * 1_000 }
        : { ...prior, count: prior.count + 1 }
      this.counters.set(bucket.key, current)
      return {
        ...bucket,
        count: current.count,
        retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - now) / 1_000)),
      }
    })
  }
}

const ATOMIC_INCREMENT_SCRIPT = `
local output = {}
for index = 1, #KEYS do
  local offset = (index - 1) * 2
  local window = tonumber(ARGV[offset + 1])
  local count = redis.call('INCR', KEYS[index])
  if count == 1 then redis.call('EXPIRE', KEYS[index], window) end
  local ttl = redis.call('TTL', KEYS[index])
  output[offset + 1] = count
  output[offset + 2] = ttl
end
return output
`

export class RedisAtomicRateLimitStore implements AtomicRateLimitStore {
  constructor(private readonly redis: Pick<Redis, "eval">) {}

  async increment(buckets: readonly DerivedRateLimitBucket[]): Promise<RateLimitBucketResult[]> {
    if (buckets.length === 0) return []
    const result = await this.redis.eval(
      ATOMIC_INCREMENT_SCRIPT,
      buckets.length,
      ...buckets.map((bucket) => bucket.key),
      ...buckets.flatMap((bucket) => [String(bucket.windowSeconds), String(bucket.limit)])
    )
    if (!Array.isArray(result) || result.length !== buckets.length * 2) {
      throw new Error("Invalid Redis rate limit response")
    }
    return buckets.map((bucket, index) => ({
      ...bucket,
      count: Number(result[index * 2]),
      retryAfterSeconds: Math.max(1, Number(result[index * 2 + 1])),
    }))
  }
}
