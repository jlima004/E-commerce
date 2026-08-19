import { createHash, createHmac } from "node:crypto"
import { isIP } from "node:net"
import type Redis from "ioredis"
import { normalizeCustomerAuthEmail } from "./email-normalization"

export type AuthRateLimitOperation =
  | "signup"
  | "login"
  | "reset-request"
  | "reset-resend"
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
  "reset-resend": {
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

function expandIpv6Hextets(address: string): string[] | null {
  const [leftRaw, rightRaw = ""] = address.toLowerCase().split("::")
  const left = leftRaw ? leftRaw.split(":") : []
  const right = rightRaw ? rightRaw.split(":") : []
  const missing = 8 - left.length - right.length
  const parts = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right]
  if (parts.length !== 8 || parts.some((part) => !/^[a-f0-9]{1,4}$/.test(part))) {
    return null
  }
  return parts
}

function isIpv4MappedZeroPrefix(prefix: string): boolean {
  if (prefix === "" || prefix === ":") {
    return true
  }
  const parts = prefix.split(":")
  const numericParts = parts.filter((part) => part !== "")
  return (
    numericParts.length <= 5 &&
    numericParts.every((part) => /^0{1,4}$/.test(part)) &&
    parts.every((part) => part === "" || /^0{1,4}$/.test(part))
  )
}

function canonicalizeIpv4MappedAddress(address: string): string | null {
  const lower = address.toLowerCase()
  const dottedMatch = lower.match(
    /^(.*):ffff:(\d{1,3}(?:\.\d{1,3}){3})$/
  )
  if (dottedMatch) {
    const ipv4 = dottedMatch[2]
    if (isIP(ipv4) !== 4 || !isIpv4MappedZeroPrefix(dottedMatch[1])) {
      return null
    }
    return ipv4
  }

  const hextets = expandIpv6Hextets(lower)
  if (
    !hextets ||
    hextets[0] !== "0" ||
    hextets[1] !== "0" ||
    hextets[2] !== "0" ||
    hextets[3] !== "0" ||
    hextets[4] !== "0" ||
    hextets[5] !== "ffff"
  ) {
    return null
  }

  const hi = Number.parseInt(hextets[6], 16)
  const lo = Number.parseInt(hextets[7], 16)
  if (!Number.isInteger(hi) || !Number.isInteger(lo)) {
    return null
  }
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
}

function normalizeIpv6Prefix(address: string): string {
  const parts = expandIpv6Hextets(address)
  if (!parts) {
    throw new Error("Invalid auth rate limit IP")
  }
  return `${parts.slice(0, 4).map((part) => Number.parseInt(part, 16).toString(16)).join(":")}::/64`
}

export function normalizeAuthRateLimitNetworkPrefix(ip: string): string {
  const version = isIP(ip)
  if (version === 4) return `${ip}/32`
  if (version === 6) {
    const mappedIpv4 = canonicalizeIpv4MappedAddress(ip)
    if (mappedIpv4) return `${mappedIpv4}/32`
    return normalizeIpv6Prefix(ip)
  }
  throw new Error("Invalid auth rate limit IP")
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex")
}

function canonicalPresentedTokenMaterial(presentedToken: string | undefined): string {
  return presentedToken === undefined
    ? "token-presence:missing"
    : `token-presence:present|token-digest:${sha256(presentedToken)}`
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
  operation: "signup" | "login" | "reset-request" | "reset-resend" | "verification-confirm" | "reset-confirm" | "refresh"
  keyring: AuthRateLimitKeyring
  ip: string
  email?: string
  presentedToken?: string
}

export function buildPreLookupRateLimitKeys(input: PreLookupInput): DerivedRateLimitBucket[] {
  const network = normalizeAuthRateLimitNetworkPrefix(input.ip)
  const ipDigest = sha256(network)
  const emailDigest = input.email === undefined
    ? undefined
    : sha256(normalizeCustomerAuthEmail(input.email))
  const tokenMaterial = canonicalPresentedTokenMaterial(input.presentedToken)
  const policy = AUTH_RATE_LIMIT_POLICIES[input.operation].pre
  const keys: DerivedRateLimitBucket[] = []

  for (const [dimension, limitWindow] of Object.entries(policy) as Array<[string, LimitWindow]>) {
    let material: string
    if (dimension === "ip") material = `network-digest:${ipDigest}`
    else if (dimension === "email" && emailDigest) material = `email-digest:${emailDigest}`
    else if (dimension === "ip-email" && emailDigest) material = `network-digest:${ipDigest}|email-digest:${emailDigest}`
    else if (dimension === "ip-token") material = `network-digest:${ipDigest}|${tokenMaterial}`
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
  ip: string
  presentedToken?: string
  resolved: { kind: "intent" | "lineage"; opaqueId: string } | null
}): DerivedRateLimitBucket {
  const dimension = input.operation === "refresh" ? "lineage" : "intent"
  const policy = AUTH_RATE_LIMIT_POLICIES[input.operation].post[dimension]
  let material: string
  if (input.resolved) {
    const opaqueDigest = `${dimension}-digest:${sha256(input.resolved.opaqueId)}`
    material = input.operation === "refresh"
      ? opaqueDigest
      : [
          `network-digest:${sha256(normalizeAuthRateLimitNetworkPrefix(input.ip))}`,
          opaqueDigest,
        ].join("|")
  } else {
    material = [
      `dummy-network-digest:${sha256(normalizeAuthRateLimitNetworkPrefix(input.ip))}`,
      canonicalPresentedTokenMaterial(input.presentedToken),
    ].join("|")
  }
  return deriveBucket({
    keyring: input.keyring,
    operation: input.operation,
    purpose: `post-${dimension}`,
    material,
    policy,
  })
}

export type AuthRateLimitPublicOutcome =
  | { status: 200; code?: never }
  | { status: 400; code: "VERIFICATION_INVALID_OR_EXPIRED" | "RESET_INVALID_OR_EXPIRED" }
  | { status: 401; code: "AUTHENTICATION_REQUIRED" }

type AuthRateLimitFailureOutcome = Exclude<AuthRateLimitPublicOutcome, { status: 200 }>

export type AuthRateLimitResolution =
  | {
      state: "unresolved"
      subject: null
      publicOutcome: AuthRateLimitFailureOutcome
    }
  | {
      state: "resolved"
      subject: { kind: "intent" | "lineage"; opaqueId: string }
      publicOutcome: AuthRateLimitPublicOutcome
    }

function assertValidResolution(
  operation: "verification-confirm" | "reset-confirm" | "refresh",
  resolution: AuthRateLimitResolution
): void {
  const expectedKind = operation === "refresh" ? "lineage" : "intent"
  const expectedFailure = operation === "verification-confirm"
    ? { status: 400, code: "VERIFICATION_INVALID_OR_EXPIRED" }
    : operation === "reset-confirm"
      ? { status: 400, code: "RESET_INVALID_OR_EXPIRED" }
      : { status: 401, code: "AUTHENTICATION_REQUIRED" }
  const stateIsValid = resolution.state === "unresolved" || resolution.state === "resolved"
  const subjectIsValid = resolution.state === "unresolved"
    ? resolution.subject === null
    : resolution.subject !== null &&
      resolution.subject.kind === expectedKind &&
      typeof resolution.subject.opaqueId === "string" &&
      resolution.subject.opaqueId.length > 0
  const outcome = resolution.publicOutcome as { status?: unknown; code?: unknown }
  const outcomeIsSuccess = outcome.status === 200 && outcome.code === undefined
  const outcomeIsExpectedFailure =
    outcome.status === expectedFailure.status && outcome.code === expectedFailure.code
  const successHasResolvedSubject =
    !outcomeIsSuccess || (resolution.state === "resolved" && resolution.subject !== null)

  if (
    !stateIsValid ||
    !subjectIsValid ||
    (!outcomeIsSuccess && !outcomeIsExpectedFailure) ||
    !successHasResolvedSubject
  ) {
    throw new AuthRateLimitUnavailableError()
  }
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

export async function runAuthRateLimitProtocol(input: {
  operation: "verification-confirm" | "reset-confirm" | "refresh"
  store: AtomicRateLimitStore
  preBuckets: readonly DerivedRateLimitBucket[]
  resolve: () => Promise<AuthRateLimitResolution>
  buildPostBucket: (
    resolved: { kind: "intent" | "lineage"; opaqueId: string } | null
  ) => DerivedRateLimitBucket
  dummyWork: () => string
  timing: () => Promise<number>
}): Promise<{
  status: 200 | 400 | 401 | 429
  code?: "VERIFICATION_INVALID_OR_EXPIRED" | "RESET_INVALID_OR_EXPIRED" | "AUTHENTICATION_REQUIRED" | "RATE_LIMITED"
  retryAfterSeconds?: number
  redisOperations: number
  elapsedMs: number
  resolved: boolean
}> {
  const pre = await consumeRateLimitBuckets(input.store, input.preBuckets)
  if (!pre.allowed) {
    return {
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: pre.blockedBy?.retryAfterSeconds,
      redisOperations: input.preBuckets.length,
      elapsedMs: 0,
      resolved: false,
    }
  }

  const resolution = await input.resolve()
  assertValidResolution(input.operation, resolution)
  const post = await consumeRateLimitBuckets(input.store, [input.buildPostBucket(resolution.subject)])
  input.dummyWork()
  const elapsedMs = await input.timing()
  return {
    status: post.allowed ? resolution.publicOutcome.status : 429,
    code: post.allowed ? resolution.publicOutcome.code : "RATE_LIMITED",
    retryAfterSeconds: post.allowed ? undefined : post.blockedBy?.retryAfterSeconds,
    redisOperations: input.preBuckets.length + 1,
    elapsedMs,
    resolved: resolution.subject !== null,
  }
}

export function authRateLimitHttpDecision(input: {
  operation: AuthRateLimitOperation
  result?: RateLimitResult
  error?: unknown
}): {
  status: 200 | 202 | 429 | 503
  code?: "RATE_LIMITED" | "AUTH_TEMPORARILY_UNAVAILABLE"
  retryAfterSeconds?: number
} {
  const absorb = input.operation === "reset-request" || input.operation === "reset-resend"
  if (input.error) {
    if (absorb) return { status: 202 }
    return { status: 503, code: "AUTH_TEMPORARILY_UNAVAILABLE", retryAfterSeconds: 60 }
  }
  if (input.result && !input.result.allowed) {
    if (absorb) return { status: 202 }
    return {
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: input.result.blockedBy?.retryAfterSeconds,
    }
  }
  return { status: absorb ? 202 : 200 }
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
