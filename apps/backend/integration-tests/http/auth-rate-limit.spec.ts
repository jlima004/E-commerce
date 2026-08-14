import { createHash } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { createServer, request, type Server } from "node:http"
import Redis from "ioredis"
import {
  type AtomicRateLimitStore,
  AuthRateLimitUnavailableError,
  RedisAtomicRateLimitStore,
  authRateLimitHttpDecision,
  buildAuthenticatedVerificationRequestKeys,
  buildPostLookupRateLimitKey,
  buildPreLookupRateLimitKeys,
  runAuthRateLimitProtocol,
  type AuthRateLimitKeyring,
  type AuthRateLimitResolution,
  type DerivedRateLimitBucket,
  type RateLimitBucketResult,
} from "../../src/modules/customer-auth/security/rate-limit"
import {
  applyAuthTimingEnvelope,
  runAuthDummyWork,
} from "../../src/modules/customer-auth/security/timing"
import {
  createAuthRedisHarness,
  getAuthRedisTestBinding,
  type AuthRedisHarness,
} from "../helpers/auth-redis"

jest.setTimeout(300_000)

const KEYRING: AuthRateLimitKeyring = {
  active: { version: 7, secret: "synthetic-http-rate-secret-32-bytes-minimum" },
}
const IP = "198.51.100.27"
const TOKEN = "synthetic-http-presented-capability"

type ProtocolOperation = "verification-confirm" | "reset-confirm" | "refresh"
type FixtureState =
  | "expired"
  | "used"
  | "superseded"
  | "revoked"
  | "replay"
  | "provider-rejected"
  | "valid"
type Worker = { child: ChildProcess; port: number }
type HttpResponse = {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: Record<string, any>
}
type ProtocolObservation = {
  elapsedMs?: number
  redisOperations?: number
  redisCalls?: number[]
  dummyWorkCalls?: number
  timingEnvelopeCalls?: number
  resolved?: boolean
  resolveCalls: number
  lookupCalls: number
  sinkWrites?: { logs: number; telemetry: number; persistence: number; fingerprints: number }
}

type CapabilityRecord = {
  operation: ProtocolOperation
  subject: { kind: "intent" | "lineage"; opaqueId: string }
  expiresAt: number
  consumedAt: number | null
  supersededAt: number | null
  revokedAt: number | null
  replayed: boolean
  providerRejected: boolean
}

type InvalidPublicOutcome =
  | { status: 400; code: "VERIFICATION_INVALID_OR_EXPIRED" | "RESET_INVALID_OR_EXPIRED" }
  | { status: 401; code: "AUTHENTICATION_REQUIRED" }

function invalidOutcome(operation: ProtocolOperation): InvalidPublicOutcome {
  if (operation === "verification-confirm") {
    return { status: 400, code: "VERIFICATION_INVALID_OR_EXPIRED" }
  }
  if (operation === "reset-confirm") {
    return { status: 400, code: "RESET_INVALID_OR_EXPIRED" }
  }
  return { status: 401, code: "AUTHENTICATION_REQUIRED" }
}

class StatefulCapabilityResolver {
  readonly records = new Map<string, CapabilityRecord>()
  resolveCalls = 0
  lookupCalls = 0
  replayRevocations = 0
  private sequence = 0

  reset(): void {
    this.records.clear()
    this.resolveCalls = 0
    this.lookupCalls = 0
    this.replayRevocations = 0
    this.sequence = 0
  }

  register(operation: ProtocolOperation, state: FixtureState): string {
    this.sequence += 1
    const token = createHash("sha256")
      .update(`opaque-capability-fixture:${this.sequence}`, "utf8")
      .digest("hex")
    const kind = operation === "refresh" ? "lineage" : "intent"
    const record: CapabilityRecord = {
      operation,
      subject: {
        kind,
        opaqueId: createHash("sha256")
          .update(`opaque-subject-fixture:${this.sequence}`, "utf8")
          .digest("hex"),
      },
      expiresAt: state === "expired" ? 9_999 : 20_000,
      consumedAt: state === "used" ? 9_000 : null,
      supersededAt: state === "superseded" ? 9_000 : null,
      revokedAt: state === "revoked" ? 9_000 : null,
      replayed: state === "replay",
      providerRejected: state === "provider-rejected",
    }
    this.records.set(createHash("sha256").update(token, "utf8").digest("hex"), record)
    return token
  }

  async resolve(
    operation: ProtocolOperation,
    presentedToken: unknown,
    now: number
  ): Promise<AuthRateLimitResolution> {
    this.resolveCalls += 1
    if (typeof presentedToken !== "string" || !/^[a-f0-9]{64}$/.test(presentedToken)) {
      return { state: "unresolved", subject: null, publicOutcome: invalidOutcome(operation) }
    }

    this.lookupCalls += 1
    const record = this.records.get(
      createHash("sha256").update(presentedToken, "utf8").digest("hex")
    )
    if (!record || record.operation !== operation) {
      return { state: "unresolved", subject: null, publicOutcome: invalidOutcome(operation) }
    }

    if (record.replayed && operation === "refresh" && record.revokedAt === null) {
      record.revokedAt = now
      this.replayRevocations += 1
    }
    const invalid =
      record.expiresAt <= now ||
      record.consumedAt !== null ||
      record.supersededAt !== null ||
      record.revokedAt !== null ||
      record.providerRejected

    return {
      state: "resolved",
      subject: record.subject,
      publicOutcome: invalid ? invalidOutcome(operation) : { status: 200 },
    }
  }
}

class ObservedAtomicStore implements AtomicRateLimitStore {
  readonly calls: number[] = []

  constructor(private readonly delegate: AtomicRateLimitStore) {}

  async increment(buckets: readonly DerivedRateLimitBucket[]): Promise<RateLimitBucketResult[]> {
    this.calls.push(buckets.length)
    return this.delegate.increment(buckets)
  }
}

class TraversedSinkRecorder {
  readonly logs: string[] = []
  readonly telemetry: string[] = []
  readonly persistence: string[] = []
  readonly fingerprints: string[] = []

  reset(): void {
    this.logs.length = 0
    this.telemetry.length = 0
    this.persistence.length = 0
    this.fingerprints.length = 0
  }

  recordResult(operation: ProtocolOperation, result: Awaited<ReturnType<typeof runAuthRateLimitProtocol>>): void {
    this.logs.push(JSON.stringify({ operation, status: result.status, code: result.code ?? null }))
    this.telemetry.push(JSON.stringify({ operation, allowed: result.status === 200 }))
    if (result.resolved) {
      this.persistence.push(JSON.stringify({ operation, transition: result.status === 200 ? "accepted" : "rejected" }))
    }
  }
}

function percentile(samples: readonly number[], fraction: number): number {
  const ordered = [...samples].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))]
}

const WORKER_SOURCE = String.raw`
const http = require("node:http");
const Redis = require("ioredis");
const { RedisAtomicRateLimitStore, consumeRateLimitBuckets } = require("./src/modules/customer-auth/security/rate-limit");
const redis = new Redis(process.env.P14_REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });
const store = new RedisAtomicRateLimitStore(redis);
const server = http.createServer(async (req, res) => {
  let body = "";
  req.on("data", chunk => { body += chunk.toString("utf8"); });
  req.on("end", async () => {
    try {
      const buckets = JSON.parse(body).buckets;
      const result = await consumeRateLimitBuckets(store, buckets);
      const headers = { "content-type": "application/json" };
      if (!result.allowed) headers["retry-after"] = String(result.blockedBy.retryAfterSeconds);
      res.writeHead(result.allowed ? 200 : 429, headers);
      res.end(JSON.stringify(result.allowed ? {} : { code: "RATE_LIMITED" }));
    } catch {
      res.writeHead(503, { "content-type": "application/json", "retry-after": "60" });
      res.end(JSON.stringify({ code: "AUTH_TEMPORARILY_UNAVAILABLE" }));
    }
  });
});
server.listen(0, "127.0.0.1", () => process.send({ port: server.address().port }));
process.on("message", async message => {
  if (message === "close") {
    server.close(async () => { await redis.quit().catch(() => undefined); process.exit(0); });
  }
});
`

async function startWorker(redisUrl: string): Promise<Worker> {
  const child = spawn(
    process.execPath,
    ["-r", "ts-node/register/transpile-only", "-e", WORKER_SOURCE],
    {
      cwd: process.cwd(),
      env: { ...process.env, P14_REDIS_URL: redisUrl, TS_NODE_PROJECT: "tsconfig.json" },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }
  )
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("worker timeout")), 20_000)
    child.once("message", (message) => {
      clearTimeout(timer)
      resolve(Number((message as { port: number }).port))
    })
    child.once("exit", () => {
      clearTimeout(timer)
      reject(new Error("worker exited"))
    })
  })
  return { child, port }
}

async function stopWorker(worker: Worker): Promise<void> {
  if (worker.child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      worker.child.kill("SIGKILL")
      resolve()
    }, 5_000)
    worker.child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    worker.child.send("close")
  })
}

async function postJson(
  port: number,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
        ...headers,
      },
    }, (res) => {
      let responseBody = ""
      res.on("data", (chunk) => { responseBody += chunk.toString("utf8") })
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: JSON.parse(responseBody),
      }))
    })
    req.once("error", reject)
    req.end(payload)
  })
}

function startProtocolHarness(input: {
  redis: Redis
  resolver: StatefulCapabilityResolver
  sinks: TraversedSinkRecorder
  observations: Map<string, ProtocolObservation>
}): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    let rawBody = ""
    req.on("data", (chunk) => { rawBody += chunk.toString("utf8") })
    req.on("end", async () => {
      const resolveCallsBefore = input.resolver.resolveCalls
      const lookupCallsBefore = input.resolver.lookupCalls
      const sinkCountsBefore = {
        logs: input.sinks.logs.length,
        telemetry: input.sinks.telemetry.length,
        persistence: input.sinks.persistence.length,
        fingerprints: input.sinks.fingerprints.length,
      }
      const observationId = String(req.headers["x-test-observation-id"] ?? "")
      try {
        const body = JSON.parse(rawBody) as {
          operation: ProtocolOperation
          ip: string
          presentedToken?: string
          newPassword?: string
        }
        const pre = buildPreLookupRateLimitKeys({
          operation: body.operation,
          keyring: KEYRING,
          ip: body.ip,
          presentedToken: body.presentedToken,
        })
        const store = new ObservedAtomicStore(
          req.headers["x-test-outage"] === "1"
            ? { increment: async () => { throw new Error("controlled outage") } }
            : new RedisAtomicRateLimitStore(input.redis)
        )
        let now = 10_000
        let dummyWorkCalls = 0
        let timingEnvelopeCalls = 0
        const result = await runAuthRateLimitProtocol({
          operation: body.operation,
          store,
          preBuckets: pre,
          resolve: () => input.resolver.resolve(body.operation, body.presentedToken, now),
          buildPostBucket: (resolved) => buildPostLookupRateLimitKey({
            operation: body.operation,
            keyring: KEYRING,
            ip: body.ip,
            presentedToken: body.presentedToken,
            resolved,
          }),
          dummyWork: () => {
            dummyWorkCalls += 1
            const fingerprint = runAuthDummyWork(KEYRING, body.operation, pre[pre.length - 1].digest)
            input.sinks.fingerprints.push(fingerprint)
            return fingerprint
          },
          timing: () => {
            timingEnvelopeCalls += 1
            return applyAuthTimingEnvelope({
              startedAtMs: now,
              now: () => now,
              sleep: async (milliseconds) => { now += milliseconds },
              randomInt: () => Number(req.headers["x-test-jitter"] ?? 0),
            })
          },
        })
        input.sinks.recordResult(body.operation, result)

        const headers: Record<string, string> = { "content-type": "application/json" }
        if (result.retryAfterSeconds !== undefined) {
          headers["retry-after"] = String(result.retryAfterSeconds)
        }
        input.observations.set(observationId, {
          elapsedMs: result.elapsedMs,
          redisOperations: result.redisOperations,
          redisCalls: store.calls,
          dummyWorkCalls,
          timingEnvelopeCalls,
          resolved: result.resolved,
          resolveCalls: input.resolver.resolveCalls - resolveCallsBefore,
          lookupCalls: input.resolver.lookupCalls - lookupCallsBefore,
        })
        res.writeHead(result.status, headers)
        res.end(JSON.stringify(result.code === undefined ? {} : { code: result.code }))
      } catch (error) {
        const unavailable = error instanceof AuthRateLimitUnavailableError
        input.observations.set(observationId, {
          resolveCalls: input.resolver.resolveCalls - resolveCallsBefore,
          lookupCalls: input.resolver.lookupCalls - lookupCallsBefore,
          sinkWrites: {
            logs: input.sinks.logs.length - sinkCountsBefore.logs,
            telemetry: input.sinks.telemetry.length - sinkCountsBefore.telemetry,
            persistence: input.sinks.persistence.length - sinkCountsBefore.persistence,
            fingerprints: input.sinks.fingerprints.length - sinkCountsBefore.fingerprints,
          },
        })
        res.writeHead(unavailable ? 503 : 500, {
          "content-type": "application/json",
          ...(unavailable ? { "retry-after": "60" } : {}),
        })
        res.end(JSON.stringify({
          code: unavailable ? "AUTH_TEMPORARILY_UNAVAILABLE" : "TEST_HARNESS_ERROR",
        }))
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as { port: number }).port })
    })
  })
}

let observationSequence = 0

async function hitProtocol(
  port: number,
  observations: Map<string, ProtocolObservation>,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{ response: HttpResponse; observation: ProtocolObservation }> {
  observationSequence += 1
  const observationId = `observation-${observationSequence}`
  const response = await postJson(port, "/protocol", body, {
    ...headers,
    "x-test-observation-id": observationId,
  })
  const observation = observations.get(observationId)
  observations.delete(observationId)
  if (!observation) throw new Error("Missing internal protocol observation")
  return { response, observation }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

const PUBLIC_MATRIX = {
  "verification-confirm": [
    ["missing", null, 400, "VERIFICATION_INVALID_OR_EXPIRED"],
    ["malformed", "malformed", 400, "VERIFICATION_INVALID_OR_EXPIRED"],
    ["unknown", "unknown", 400, "VERIFICATION_INVALID_OR_EXPIRED"],
    ["expired", "expired", 400, "VERIFICATION_INVALID_OR_EXPIRED"],
    ["used", "used", 400, "VERIFICATION_INVALID_OR_EXPIRED"],
    ["superseded", "superseded", 400, "VERIFICATION_INVALID_OR_EXPIRED"],
    ["revoked", "revoked", 400, "VERIFICATION_INVALID_OR_EXPIRED"],
    ["real", "valid", 200, null],
  ],
  "reset-confirm": [
    ["missing", null, 400, "RESET_INVALID_OR_EXPIRED"],
    ["malformed", "malformed", 400, "RESET_INVALID_OR_EXPIRED"],
    ["unknown", "unknown", 400, "RESET_INVALID_OR_EXPIRED"],
    ["expired", "expired", 400, "RESET_INVALID_OR_EXPIRED"],
    ["used", "used", 400, "RESET_INVALID_OR_EXPIRED"],
    ["superseded", "superseded", 400, "RESET_INVALID_OR_EXPIRED"],
    ["revoked", "revoked", 400, "RESET_INVALID_OR_EXPIRED"],
    ["provider-rejected", "provider-rejected", 400, "RESET_INVALID_OR_EXPIRED"],
    ["real", "valid", 200, null],
  ],
  refresh: [
    ["missing", null, 401, "AUTHENTICATION_REQUIRED"],
    ["malformed", "malformed", 401, "AUTHENTICATION_REQUIRED"],
    ["unknown", "unknown", 401, "AUTHENTICATION_REQUIRED"],
    ["expired", "expired", 401, "AUTHENTICATION_REQUIRED"],
    ["used", "used", 401, "AUTHENTICATION_REQUIRED"],
    ["revoked", "revoked", 401, "AUTHENTICATION_REQUIRED"],
    ["replay", "replay", 401, "AUTHENTICATION_REQUIRED"],
    ["lineage-real-resolved", "valid", 200, null],
  ],
} as const

describe("P14-D11 HTTP/Redis rate limit gate", () => {
  let redisHarness: AuthRedisHarness
  let redis: Redis
  let workers: Worker[] = []
  let protocolServer: Server
  let protocolPort: number
  const resolver = new StatefulCapabilityResolver()
  const sinks = new TraversedSinkRecorder()
  const protocolObservations = new Map<string, ProtocolObservation>()

  beforeAll(async () => {
    redisHarness = await createAuthRedisHarness()
    const binding = getAuthRedisTestBinding(redisHarness)
    const redisUrl = `redis://${binding.host}:${binding.port}`
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
    workers = [await startWorker(redisUrl), await startWorker(redisUrl)]
    const protocol = await startProtocolHarness({
      redis,
      resolver,
      sinks,
      observations: protocolObservations,
    })
    protocolServer = protocol.server
    protocolPort = protocol.port
  })

  afterAll(async () => {
    await closeServer(protocolServer)
    await Promise.all(workers.map(stopWorker))
    await redis?.quit().catch(() => undefined)
    const cleanup = await redisHarness?.cleanup()
    expect(cleanup?.containerRemoved).toBe(true)
  })

  beforeEach(async () => {
    resolver.reset()
    sinks.reset()
    protocolObservations.clear()
    await redisHarness.flushNamespace()
    const keys = await redis.keys("auth-rate:v7:*")
    if (keys.length) await redis.del(...keys)
  })

  it("shares atomic counters across two OS processes and blocks closed thresholds", async () => {
    const [bucket] = buildPreLookupRateLimitKeys({
      operation: "verification-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
    })
    let response: HttpResponse | undefined
    for (let index = 0; index < 11; index += 1) {
      response = await postJson(workers[index % 2].port, "/rate-limit", { buckets: [bucket] })
    }
    expect(workers[0].child.pid).not.toBe(workers[1].child.pid)
    expect(response).toMatchObject({
      status: 429,
      body: { code: "RATE_LIMITED" },
    })
    expect(response?.body).toEqual({ code: "RATE_LIMITED" })
    expect(await redis.get(bucket.key)).toBe("11")
    expect(Number(response?.headers["retry-after"])).toBeGreaterThan(0)
  })

  it.each([
    ["reset-confirm ip", buildPreLookupRateLimitKeys({ operation: "reset-confirm", keyring: KEYRING, ip: IP, presentedToken: TOKEN })[0], 31],
    ["reset-confirm token", buildPreLookupRateLimitKeys({ operation: "reset-confirm", keyring: KEYRING, ip: IP, presentedToken: TOKEN })[1], 11],
    ["reset-confirm intent", buildPostLookupRateLimitKey({ operation: "reset-confirm", keyring: KEYRING, ip: IP, presentedToken: TOKEN, resolved: { kind: "intent", opaqueId: "intent-synthetic" } }), 11],
    ["verification-confirm intent", buildPostLookupRateLimitKey({ operation: "verification-confirm", keyring: KEYRING, ip: IP, presentedToken: TOKEN, resolved: { kind: "intent", opaqueId: "intent-synthetic" } }), 11],
    ["verification-request lineage", buildAuthenticatedVerificationRequestKeys({ keyring: KEYRING, ip: IP, authorizedLineageId: "lineage-synthetic" })[0], 4],
    ["verification-request ip", buildAuthenticatedVerificationRequestKeys({ keyring: KEYRING, ip: IP, authorizedLineageId: "lineage-synthetic" })[1], 11],
    ["refresh ip", buildPreLookupRateLimitKeys({ operation: "refresh", keyring: KEYRING, ip: IP, presentedToken: TOKEN })[0], 61],
    ["refresh token", buildPreLookupRateLimitKeys({ operation: "refresh", keyring: KEYRING, ip: IP, presentedToken: TOKEN })[1], 11],
    ["refresh lineage", buildPostLookupRateLimitKey({ operation: "refresh", keyring: KEYRING, ip: IP, presentedToken: TOKEN, resolved: { kind: "lineage", opaqueId: "lineage-refresh-synthetic" } }), 11],
  ])("enforces %s on its exact blocking hit", async (_name, bucket, blockingHit) => {
    let response: HttpResponse | undefined
    for (let index = 0; index < blockingHit; index += 1) {
      response = await postJson(workers[index % 2].port, "/rate-limit", { buckets: [bucket] })
    }
    expect(response?.status).toBe(429)
    expect(response?.body).toEqual({ code: "RATE_LIMITED" })
    expect(await redis.get(bucket.key)).toBe(String(blockingHit))
    expect(Number(response?.headers["retry-after"])).toBeGreaterThan(0)
  })

  it("binds verification-confirm post keys to IP+intent and refresh post keys to lineage only", () => {
    const otherIp = "198.51.100.99"
    const intent = { kind: "intent" as const, opaqueId: "intent-synthetic" }
    const lineage = { kind: "lineage" as const, opaqueId: "lineage-refresh-synthetic" }
    const verificationSameIntent = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: intent,
    })
    const verificationOtherIp = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      ip: otherIp,
      presentedToken: TOKEN,
      resolved: intent,
    })
    const refreshSameLineage = buildPostLookupRateLimitKey({
      operation: "refresh",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: lineage,
    })
    const refreshOtherIp = buildPostLookupRateLimitKey({
      operation: "refresh",
      keyring: KEYRING,
      ip: otherIp,
      presentedToken: TOKEN,
      resolved: lineage,
    })

    expect(verificationSameIntent.key).not.toBe(verificationOtherIp.key)
    expect(refreshSameLineage.key).toBe(refreshOtherIp.key)
    for (const key of [
      verificationSameIntent.key,
      verificationOtherIp.key,
      refreshSameLineage.key,
      refreshOtherIp.key,
    ]) {
      expect(key).not.toContain(IP)
      expect(key).not.toContain(otherIp)
      expect(key).not.toContain("intent-synthetic")
      expect(key).not.toContain("lineage-refresh-synthetic")
    }
  })

  it.each(Object.entries(PUBLIC_MATRIX) as Array<[
    ProtocolOperation,
    ReadonlyArray<readonly [string, FixtureState | "malformed" | "unknown" | null, 200 | 400 | 401, string | null]>,
  ]>)("keeps the complete public %s state matrix equivalent", async (operation, classes) => {
    const observations: Array<{
      className: string
      response: HttpResponse
      observation: ProtocolObservation
    }> = []
    for (const [classIndex, [className, fixtureState]] of classes.entries()) {
      for (let sample = 0; sample < 40; sample += 1) {
        const presentedToken = fixtureState === null
          ? undefined
          : fixtureState === "malformed"
            ? `x${createHash("sha256").update(`malformed:${classIndex}:${sample}`).digest("hex")}`
            : fixtureState === "unknown"
              ? createHash("sha256").update(`unknown:${classIndex}:${sample}`).digest("hex")
            : resolver.register(operation, fixtureState)
        const hit = await hitProtocol(
          protocolPort,
          protocolObservations,
          {
            operation,
            ip: `198.51.${classIndex + 1}.${sample + 1}`,
            ...(presentedToken === undefined ? {} : { presentedToken }),
          },
          { "x-test-jitter": String(sample % 51) }
        )
        observations.push({ className, ...hit })
      }
    }

    expect(observations).toHaveLength(classes.length * 40)
    expect(new Set(observations.map((entry) => JSON.stringify(entry.observation.redisCalls)))).toEqual(
      new Set([JSON.stringify([operation === "verification-confirm" ? 1 : 2, 1])])
    )
    expect(new Set(observations.map((entry) => entry.observation.dummyWorkCalls))).toEqual(new Set([1]))
    expect(new Set(observations.map((entry) => entry.observation.timingEnvelopeCalls))).toEqual(new Set([1]))
    expect(new Set(observations.map((entry) => entry.response.headers["content-type"]))).toEqual(
      new Set(["application/json"])
    )
    expect(new Set(observations.map((entry) => entry.response.headers["retry-after"]))).toEqual(new Set([undefined]))

    const medians = classes.map(([className]) => percentile(
      observations.filter((entry) => entry.className === className).map((entry) => entry.observation.elapsedMs!),
      0.5
    ))
    expect(Math.max(...medians) - Math.min(...medians)).toBeLessThanOrEqual(50)

    for (const [className, fixtureState, expectedStatus, expectedCode] of classes) {
      const classObservations = observations.filter((entry) => entry.className === className)
      expect(classObservations).toHaveLength(40)
      expect(new Set(classObservations.map((entry) => entry.response.status))).toEqual(new Set([expectedStatus]))
      expect(new Set(classObservations.map((entry) => entry.response.body.code))).toEqual(
        new Set([expectedCode ?? undefined])
      )
      expect(new Set(classObservations.map((entry) => JSON.stringify(entry.response.body)))).toEqual(
        new Set([JSON.stringify(expectedCode === null ? {} : { code: expectedCode })])
      )
      expect(new Set(classObservations.map((entry) => entry.observation.resolved))).toEqual(
        new Set([fixtureState !== null && fixtureState !== "malformed" && fixtureState !== "unknown"])
      )
      expect(percentile(classObservations.map((entry) => entry.observation.elapsedMs!), 0.95) - 350)
        .toBeLessThanOrEqual(75)
    }

    const invalidBodies = observations
      .filter((entry) => entry.response.status !== 200)
      .map((entry) => JSON.stringify(entry.response.body))
    expect(new Set(invalidBodies).size).toBe(1)

    if (operation === "refresh") {
      expect(resolver.replayRevocations).toBe(40)
    }
  })

  it.each(["verification-confirm", "reset-confirm", "refresh"] as const)(
    "runs the truly missing %s token through pre Redis and one dummy post bucket",
    async (operation) => {
      const { response, observation } = await hitProtocol(
        protocolPort,
        protocolObservations,
        { operation, ip: IP }
      )
      expect(response.status).toBe(operation === "refresh" ? 401 : 400)
      expect(response.body).toEqual({
        code: operation === "verification-confirm"
          ? "VERIFICATION_INVALID_OR_EXPIRED"
          : operation === "reset-confirm"
            ? "RESET_INVALID_OR_EXPIRED"
            : "AUTHENTICATION_REQUIRED",
      })
      expect(observation).toMatchObject({
        redisCalls: [operation === "verification-confirm" ? 1 : 2, 1],
        dummyWorkCalls: 1,
        timingEnvelopeCalls: 1,
        resolved: false,
        resolveCalls: 1,
        lookupCalls: 0,
      })
    }
  )

  it.each(["verification-confirm", "reset-confirm", "refresh"] as const)(
    "fails closed for %s outage before lookup, dummy work or sinks",
    async (operation) => {
      const token = resolver.register(operation, "valid")
      const { response, observation } = await hitProtocol(
        protocolPort,
        protocolObservations,
        { operation, ip: IP, presentedToken: token },
        { "x-test-outage": "1" }
      )
      expect(response).toMatchObject({
        status: 503,
        body: { code: "AUTH_TEMPORARILY_UNAVAILABLE" },
      })
      expect(observation).toMatchObject({
          resolveCalls: 0,
          lookupCalls: 0,
          sinkWrites: { logs: 0, telemetry: 0, persistence: 0, fingerprints: 0 },
      })
      expect(response.headers["retry-after"]).toBe("60")
      expect(await redis.keys("auth-rate:v7:*")).toHaveLength(0)
      expect(new AuthRateLimitUnavailableError().code).not.toBe("AUTH_RECOVERY_PENDING")
    }
  )

  it.each(["signup", "login", "verification-request", "password-change"] as const)(
    "uses the same fail-closed 503 envelope for %s pre-stage outage",
    (operation) => {
      expect(authRateLimitHttpDecision({ operation, error: new Error("outage") })).toEqual({
        status: 503,
        code: "AUTH_TEMPORARILY_UNAVAILABLE",
        retryAfterSeconds: 60,
      })
    }
  )

  it.each(["reset-request", "reset-resend"] as const)(
    "absorbs public %s limit and outage as indistinguishable 202",
    (operation) => {
      const limited = authRateLimitHttpDecision({
        operation,
        result: {
          allowed: false,
          buckets: [],
          blockedBy: {
            key: "opaque",
            digest: "opaque",
            limit: 3,
            windowSeconds: 3600,
            count: 4,
            retryAfterSeconds: 60,
          },
        },
      })
      expect(limited).toEqual({ status: 202 })
      expect(authRateLimitHttpDecision({ operation, error: new Error("outage") })).toEqual({ status: 202 })
    }
  )

  it("keeps new password outside every sink traversed by a real reset path", async () => {
    const newPassword = "synthetic-password-canary"
    const token = resolver.register("reset-confirm", "valid")
    const { response, observation } = await hitProtocol(
      protocolPort,
      protocolObservations,
      {
        operation: "reset-confirm",
        ip: IP,
        presentedToken: token,
        newPassword,
      }
    )
    expect(response.status).toBe(200)
    const redisKeys = await redis.keys("auth-rate:v7:*")
    const traversedSinks = {
      response: response.body,
      observation,
      redisKeys,
      logs: sinks.logs,
      telemetry: sinks.telemetry,
      persistence: sinks.persistence,
      fingerprints: sinks.fingerprints,
    }
    expect(redisKeys.length).toBe(3)
    expect(sinks.logs.length).toBeGreaterThan(0)
    expect(sinks.telemetry.length).toBeGreaterThan(0)
    expect(sinks.persistence.length).toBeGreaterThan(0)
    expect(sinks.fingerprints.length).toBeGreaterThan(0)
    expect(JSON.stringify(traversedSinks)).not.toContain(newPassword)
  })
})
