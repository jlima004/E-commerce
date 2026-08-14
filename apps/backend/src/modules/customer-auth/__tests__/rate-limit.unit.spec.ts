import {
  AUTH_RATE_LIMIT_POLICIES,
  InMemoryAtomicRateLimitStore,
  buildAuthenticatedVerificationRequestKeys,
  buildPostLookupRateLimitKey,
  buildPreLookupRateLimitKeys,
  consumeRateLimitBuckets,
  type AuthRateLimitKeyring,
} from "../security/rate-limit"
import {
  applyAuthTimingEnvelope,
  runAuthDummyWork,
} from "../security/timing"

const KEYRING: AuthRateLimitKeyring = {
  active: {
    version: 7,
    secret: "synthetic-rate-limit-secret-32-bytes-minimum",
  },
}

const IP = "203.0.113.42"
const IPV6 = "2001:db8:abcd:1234:5678:90ab:cdef:1234"
const TOKEN = "synthetic-presented-capability"

describe("P14-D11 auth rate limit", () => {
  it("defines the complete nominal policy map", () => {
    expect(AUTH_RATE_LIMIT_POLICIES).toMatchObject({
      signup: { pre: { ip: [5, 900], email: [3, 3600] } },
      login: { pre: { "ip-email": [10, 900], ip: [30, 900] } },
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
    })
  })

  it.each([
    ["signup", { ip: IP, email: "person@example.test" }],
    ["login", { ip: IP, email: "person@example.test" }],
    ["verification-confirm", { ip: IP, presentedToken: TOKEN }],
    ["reset-confirm", { ip: IP, presentedToken: TOKEN }],
    ["refresh", { ip: IP, presentedToken: TOKEN }],
  ] as const)("derives versioned opaque pre keys for %s", (operation, input) => {
    const keys = buildPreLookupRateLimitKeys({ operation, keyring: KEYRING, ...input })
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) {
      expect(key.key).toMatch(/^auth-rate:v7:[a-z-]+:[a-f0-9]{64}$/)
      expect(key.key).not.toContain(IP)
      expect(key.key).not.toContain(TOKEN)
      expect(key.key).not.toContain("person@example.test")
    }
  })

  it("normalizes IPv6 to /64 without exposing the address", () => {
    const [key] = buildPreLookupRateLimitKeys({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: IPV6,
      presentedToken: TOKEN,
    })
    const [samePrefix] = buildPreLookupRateLimitKeys({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: "2001:db8:abcd:1234::9",
      presentedToken: TOKEN,
    })
    expect(key.key).toBe(samePrefix.key)
    expect(key.key).not.toContain("2001:db8")
  })

  it("domain-separates purpose, stage and key version", () => {
    const verification = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      preDigest: "synthetic-pre-digest",
      resolved: { kind: "intent", opaqueId: "intent-synthetic" },
    })
    const reset = buildPostLookupRateLimitKey({
      operation: "reset-confirm",
      keyring: KEYRING,
      preDigest: "synthetic-pre-digest",
      resolved: { kind: "intent", opaqueId: "intent-synthetic" },
    })
    const dummy = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      preDigest: "synthetic-pre-digest",
      resolved: null,
    })
    const rotated = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: { active: { ...KEYRING.active, version: 8 } },
      preDigest: "synthetic-pre-digest",
      resolved: { kind: "intent", opaqueId: "intent-synthetic" },
    })

    expect(new Set([verification.key, reset.key, dummy.key, rotated.key])).toHaveSize(4)
    expect(verification.key).not.toContain("intent-synthetic")
  })

  it("derives authenticated verification request keys only from an authorized lineage", () => {
    const keys = buildAuthenticatedVerificationRequestKeys({
      keyring: KEYRING,
      ip: IP,
      authorizedLineageId: "lineage-authorized-synthetic",
    })
    expect(keys.map((entry) => entry.limit)).toEqual([3, 10])
    expect(keys.every((entry) => !entry.key.includes("lineage-authorized"))).toBe(true)
  })

  it.each([
    ["reset-confirm ip", "reset-confirm", { ip: IP, presentedToken: TOKEN }, 0, 31],
    ["reset-confirm token", "reset-confirm", { ip: IP, presentedToken: TOKEN }, 1, 11],
    ["verification request lineage", "verification-request", { ip: IP, authorizedLineageId: "lineage-a" }, 0, 4],
    ["verification request ip", "verification-request", { ip: IP, authorizedLineageId: "lineage-b" }, 1, 11],
  ] as const)("blocks the closed threshold for %s", async (_name, operation, input, bucketIndex, blockingHit) => {
    const store = new InMemoryAtomicRateLimitStore(() => 1_000)
    const keys = operation === "verification-request"
      ? buildAuthenticatedVerificationRequestKeys({ keyring: KEYRING, ...input })
      : buildPreLookupRateLimitKeys({ keyring: KEYRING, operation, ...input })

    let result = await consumeRateLimitBuckets(store, [keys[bucketIndex]])
    for (let hit = 2; hit <= blockingHit; hit += 1) {
      result = await consumeRateLimitBuckets(store, [keys[bucketIndex]])
    }
    expect(result.allowed).toBe(false)
    expect(result.blockedBy?.count).toBe(blockingHit)
  })

  it.each(["verification-confirm", "reset-confirm"] as const)(
    "uses one equivalent post operation for real and dummy %s paths",
    async (operation) => {
      const pre = buildPreLookupRateLimitKeys({
        operation,
        keyring: KEYRING,
        ip: IP,
        presentedToken: TOKEN,
      })
      const store = new InMemoryAtomicRateLimitStore(() => 1_000)
      const real = buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        preDigest: pre[0].digest,
        resolved: { kind: "intent", opaqueId: "intent-real-synthetic" },
      })
      const dummy = buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        preDigest: pre[0].digest,
        resolved: null,
      })

      await consumeRateLimitBuckets(store, [real])
      await consumeRateLimitBuckets(store, [dummy])
      expect(store.operations).toEqual([1, 1])
      expect(real.limit).toBe(dummy.limit)
      expect(real.windowSeconds).toBe(dummy.windowSeconds)
    }
  )

  it("blocks reset post-intent on hit 11", async () => {
    const store = new InMemoryAtomicRateLimitStore(() => 1_000)
    const key = buildPostLookupRateLimitKey({
      operation: "reset-confirm",
      keyring: KEYRING,
      preDigest: "synthetic-pre-digest",
      resolved: { kind: "intent", opaqueId: "intent-real-synthetic" },
    })
    let result = await consumeRateLimitBuckets(store, [key])
    for (let hit = 2; hit <= 11; hit += 1) result = await consumeRateLimitBuckets(store, [key])
    expect(result.allowed).toBe(false)
    expect(result.blockedBy?.count).toBe(11)
  })

  it("controlled-clock smoke applies 350ms plus deterministic jitter and equal dummy work", async () => {
    let now = 1_000
    const sleeps: number[] = []
    const sleep = async (milliseconds: number) => {
      sleeps.push(milliseconds)
      now += milliseconds
    }
    const first = runAuthDummyWork(KEYRING, "verification-confirm", "digest-a")
    const second = runAuthDummyWork(KEYRING, "verification-confirm", "digest-a")
    expect(first).toBe(second)

    const elapsed = await applyAuthTimingEnvelope({
      startedAtMs: now,
      now: () => now,
      sleep,
      randomInt: () => 17,
    })
    expect(sleeps).toEqual([367])
    expect(elapsed).toBe(367)
  })
})
