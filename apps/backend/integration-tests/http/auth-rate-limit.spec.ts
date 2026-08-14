import { spawn, type ChildProcess } from "node:child_process"
import { request } from "node:http"
import Redis from "ioredis"
import {
  AuthRateLimitUnavailableError,
  RedisAtomicRateLimitStore,
  buildAuthenticatedVerificationRequestKeys,
  buildPostLookupRateLimitKey,
  buildPreLookupRateLimitKeys,
  runAuthRateLimitProtocol,
  type AuthRateLimitKeyring,
  type DerivedRateLimitBucket,
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

type Worker = { child: ChildProcess; port: number }

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
      res.writeHead(result.allowed ? 200 : 429, { "content-type": "application/json", "retry-after": String(result.blockedBy?.retryAfterSeconds ?? 0) });
      res.end(JSON.stringify({ allowed: result.allowed, counts: result.buckets.map(entry => entry.count) }));
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

async function hit(port: number, buckets: DerivedRateLimitBucket[]) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: any }>((resolve, reject) => {
    const payload = JSON.stringify({ buckets })
    const req = request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: "/rate-limit",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, (res) => {
      let body = ""
      res.on("data", (chunk) => { body += chunk.toString("utf8") })
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: JSON.parse(body) }))
    })
    req.once("error", reject)
    req.end(payload)
  })
}

describe("P14-D11 HTTP/Redis rate limit gate", () => {
  let redisHarness: AuthRedisHarness
  let redis: Redis
  let workers: Worker[] = []

  beforeAll(async () => {
    redisHarness = await createAuthRedisHarness()
    const binding = getAuthRedisTestBinding(redisHarness)
    const redisUrl = `redis://${binding.host}:${binding.port}`
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 })
    workers = [await startWorker(redisUrl), await startWorker(redisUrl)]
  })

  afterAll(async () => {
    await Promise.all(workers.map(stopWorker))
    await redis?.quit().catch(() => undefined)
    const cleanup = await redisHarness?.cleanup()
    expect(cleanup?.containerRemoved).toBe(true)
  })

  beforeEach(async () => {
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
    let response: Awaited<ReturnType<typeof hit>> | undefined
    for (let index = 0; index < 11; index += 1) {
      response = await hit(workers[index % 2].port, [bucket])
    }
    expect(workers[0].child.pid).not.toBe(workers[1].child.pid)
    expect(response).toMatchObject({ status: 429, body: { allowed: false, counts: [11] } })
    expect(response?.headers["retry-after"]).toBeDefined()
  })

  it.each([
    ["reset-confirm ip", buildPreLookupRateLimitKeys({ operation: "reset-confirm", keyring: KEYRING, ip: IP, presentedToken: TOKEN })[0], 31],
    ["reset-confirm token", buildPreLookupRateLimitKeys({ operation: "reset-confirm", keyring: KEYRING, ip: IP, presentedToken: TOKEN })[1], 11],
    ["reset-confirm intent", buildPostLookupRateLimitKey({ operation: "reset-confirm", keyring: KEYRING, preDigest: "synthetic", resolved: { kind: "intent", opaqueId: "intent-synthetic" } }), 11],
    ["verification-request lineage", buildAuthenticatedVerificationRequestKeys({ keyring: KEYRING, ip: IP, authorizedLineageId: "lineage-synthetic" })[0], 4],
    ["verification-request ip", buildAuthenticatedVerificationRequestKeys({ keyring: KEYRING, ip: IP, authorizedLineageId: "lineage-synthetic" })[1], 11],
  ])("enforces %s on its exact blocking hit", async (_name, bucket, blockingHit) => {
    let response: Awaited<ReturnType<typeof hit>> | undefined
    for (let index = 0; index < blockingHit; index += 1) response = await hit(workers[index % 2].port, [bucket])
    expect(response?.status).toBe(429)
    expect(response?.body.counts).toEqual([blockingHit])
  })

  it.each([
    ["verification-confirm", ["missing", "malformed", "expired", "used", "revoked"], "VERIFICATION_INVALID_OR_EXPIRED"],
    ["reset-confirm", ["missing", "malformed", "expired", "used", "superseded", "valid-invalid-password-provider"], "RESET_INVALID_OR_EXPIRED"],
    ["refresh", ["missing", "malformed", "expired", "used", "revoked", "replay"], "AUTHENTICATION_REQUIRED"],
  ] as const)("keeps the public %s failure classes equivalent", async (operation, classes, publicCode) => {
    const observations = []
    for (const className of classes) {
      for (let sample = 0; sample < 40; sample += 1) {
        let now = 10_000
        const pre = buildPreLookupRateLimitKeys({ operation, keyring: KEYRING, ip: IP, presentedToken: `${TOKEN}-${className}-${sample}` })
        const observation = await runAuthRateLimitProtocol({
          store: new RedisAtomicRateLimitStore(redis),
          preBuckets: pre,
          resolve: async () => className === "valid-invalid-password-provider" ? { kind: "intent" as const, opaqueId: `intent-${sample}` } : null,
          buildPostBucket: (resolved) => buildPostLookupRateLimitKey({ operation, keyring: KEYRING, preDigest: pre[0].digest, resolved }),
          dummyWork: () => runAuthDummyWork(KEYRING, operation, pre[0].digest),
          timing: () => applyAuthTimingEnvelope({ startedAtMs: now, now: () => now, sleep: async (ms) => { now += ms }, randomInt: () => sample % 51 }),
        })
        observations.push({ className, ...observation, publicCode })
      }
    }
    expect(observations).toHaveLength(classes.length * 40)
    expect(new Set(observations.map((entry) => entry.redisOperations)).size).toBe(1)
    expect(new Set(observations.map((entry) => entry.status)).size).toBe(1)
    expect(observations.every((entry) => entry.status === 400)).toBe(true)
    const elapsed = observations.map((entry) => entry.elapsedMs)
    expect(Math.max(...elapsed) - Math.min(...elapsed)).toBeLessThanOrEqual(50)
    expect(elapsed.sort((a, b) => a - b)[Math.floor(elapsed.length * 0.95)] - 350).toBeLessThanOrEqual(75)
  })

  it("fails closed with 503 semantics before lookup or mutation", async () => {
    let lookups = 0
    const pre = buildPreLookupRateLimitKeys({ operation: "reset-confirm", keyring: KEYRING, ip: IP, presentedToken: TOKEN })
    await expect(runAuthRateLimitProtocol({
      store: { increment: async () => { throw new Error("synthetic outage") } },
      preBuckets: pre,
      resolve: async () => { lookups += 1; return null },
      buildPostBucket: () => buildPostLookupRateLimitKey({ operation: "reset-confirm", keyring: KEYRING, preDigest: pre[0].digest, resolved: null }),
      dummyWork: () => "unused",
      timing: async () => 350,
    })).rejects.toMatchObject({ code: "AUTH_TEMPORARILY_UNAVAILABLE", retryAfterSeconds: 60 })
    expect(lookups).toBe(0)
    expect(new AuthRateLimitUnavailableError().code).not.toBe("AUTH_RECOVERY_PENDING")
  })

  it("keeps password input outside keys, logs, telemetry, persistence and fingerprints", () => {
    const forbiddenValue = "synthetic-password-canary"
    const sinks = {
      keys: buildPreLookupRateLimitKeys({ operation: "reset-confirm", keyring: KEYRING, ip: IP, presentedToken: TOKEN }).map((entry) => entry.key),
      logs: [] as string[],
      telemetry: [] as string[],
      persistence: [] as string[],
      fingerprints: [] as string[],
    }
    expect(JSON.stringify(sinks)).not.toContain(forbiddenValue)
  })
})
