import {
  AUTH_RATE_LIMIT_POLICIES,
  InMemoryAtomicRateLimitStore,
  buildAuthenticatedVerificationRequestKeys,
  buildPostLookupRateLimitKey,
  buildPreLookupRateLimitKeys,
  consumeRateLimitBuckets,
  normalizeAuthRateLimitNetworkPrefix,
  runAuthRateLimitProtocol,
  type AuthRateLimitKeyring,
} from "../security/rate-limit"
import {
  applyAuthTimingEnvelope,
  runAuthDummyWork,
} from "../security/timing"
import { CustomerAuthEmailNormalizationError } from "../security/email-normalization"

const KEYRING: AuthRateLimitKeyring = {
  active: {
    version: 7,
    secret: "synthetic-rate-limit-secret-32-bytes-minimum",
  },
}

const IP = "203.0.113.42"
const IP_OTHER = "198.51.100.99"
const IPV6 = "2001:db8:abcd:1234:5678:90ab:cdef:1234"
const IPV6_SAME_PREFIX = "2001:db8:abcd:1234::9"
const TOKEN = "synthetic-presented-capability"
const INTENT_ID = "intent-synthetic"
const LINEAGE_ID = "lineage-refresh-synthetic"

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

  it.each([
    ["signup", " Person@Example.TEST ", "person@example.test"],
    ["login", "FIRST.LAST+Tag@EXAMPLE.test", "first.last+tag@example.test"],
    ["reset-request", "person@ex\u00e4mple.test", "person@xn--exmple-cua.test"],
    ["reset-resend", " PERSON@EXAMPLE.TEST ", "person@example.test"],
  ] as const)("reuses P14-D12 normalization for equivalent %s email buckets", (operation, variant, canonical) => {
    const variantKeys = buildPreLookupRateLimitKeys({
      operation,
      keyring: KEYRING,
      ip: IP,
      email: variant,
    })
    const canonicalKeys = buildPreLookupRateLimitKeys({
      operation,
      keyring: KEYRING,
      ip: IP,
      email: canonical,
    })
    expect(variantKeys.map((entry) => entry.key)).toEqual(
      canonicalKeys.map((entry) => entry.key)
    )
  })

  it.each([
    "",
    "missing-at.example.test",
    "two@@example.test",
    "person@-example.test",
    "person@example..test",
    "person@",
  ])("fails closed through the approved normalizer for invalid email input", (email) => {
    expect(() => buildPreLookupRateLimitKeys({
      operation: "signup",
      keyring: KEYRING,
      ip: IP,
      email,
    })).toThrow(CustomerAuthEmailNormalizationError)
  })

  it("fails closed through the approved normalizer for non-string email input", () => {
    expect(() => buildPreLookupRateLimitKeys({
      operation: "login",
      keyring: KEYRING,
      ip: IP,
      email: null as unknown as string,
    })).toThrow(CustomerAuthEmailNormalizationError)
  })

  it("canonicalizes IPv4 and IPv4-mapped IPv6 to the same /32 identity", () => {
    expect(normalizeAuthRateLimitNetworkPrefix("127.0.0.1")).toBe("127.0.0.1/32")
    expect(normalizeAuthRateLimitNetworkPrefix("::ffff:127.0.0.1")).toBe(
      "127.0.0.1/32"
    )
    expect(normalizeAuthRateLimitNetworkPrefix("::FFFF:192.168.1.10")).toBe(
      "192.168.1.10/32"
    )
    expect(normalizeAuthRateLimitNetworkPrefix(IP)).toBe(`${IP}/32`)
    expect(normalizeAuthRateLimitNetworkPrefix(`::ffff:${IP}`)).toBe(`${IP}/32`)
  })

  it("keeps equivalent IPv4 and mapped IPv4 in the same rate-limit bucket", () => {
    const ipv4Keys = buildPreLookupRateLimitKeys({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: "127.0.0.1",
      presentedToken: TOKEN,
    })
    const mappedKeys = buildPreLookupRateLimitKeys({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: "::ffff:127.0.0.1",
      presentedToken: TOKEN,
    })
    const uppercaseMappedKeys = buildPreLookupRateLimitKeys({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: "::FFFF:127.0.0.1",
      presentedToken: TOKEN,
    })
    expect(ipv4Keys.map((entry) => entry.key)).toEqual(
      mappedKeys.map((entry) => entry.key)
    )
    expect(ipv4Keys.map((entry) => entry.key)).toEqual(
      uppercaseMappedKeys.map((entry) => entry.key)
    )
    expect(ipv4Keys[0].key).not.toContain("127.0.0.1")
    expect(ipv4Keys[0].key).not.toContain("ffff")
  })

  it("normalizes ordinary IPv6 to /64 without treating it as mapped IPv4", () => {
    expect(normalizeAuthRateLimitNetworkPrefix("2001:db8::1")).toBe(
      "2001:db8:0:0::/64"
    )
    expect(normalizeAuthRateLimitNetworkPrefix(IPV6)).toBe("2001:db8:abcd:1234::/64")
  })

  it.each([
    "not-an-ip",
    "::ffff:127.0.0",
    "127.0.0.1:ffff::1",
    "ffff:127.0.0.1",
    "",
  ])("rejects malformed mixed IP input: %s", (ip) => {
    expect(() => normalizeAuthRateLimitNetworkPrefix(ip)).toThrow(
      "Invalid auth rate limit IP"
    )
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

  it.each(["verification-confirm", "reset-confirm", "refresh"] as const)(
    "encodes a truly missing token without colliding for %s",
    (operation) => {
      const missing = buildPreLookupRateLimitKeys({ operation, keyring: KEYRING, ip: IP })
      const empty = buildPreLookupRateLimitKeys({ operation, keyring: KEYRING, ip: IP, presentedToken: "" })
      const presented = buildPreLookupRateLimitKeys({ operation, keyring: KEYRING, ip: IP, presentedToken: TOKEN })
      const tokenIndex = operation === "verification-confirm" ? 0 : 1

      expect(new Set([
        missing[tokenIndex].key,
        empty[tokenIndex].key,
        presented[tokenIndex].key,
      ]).size).toBe(3)
    }
  )

  it("domain-separates purpose, stage and key version", () => {
    const verification = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: "intent-synthetic" },
    })
    const reset = buildPostLookupRateLimitKey({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: "intent-synthetic" },
    })
    const dummy = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: null,
    })
    const rotated = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: { active: { ...KEYRING.active, version: 8 } },
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: "intent-synthetic" },
    })

    expect(new Set([verification.key, reset.key, dummy.key, rotated.key]).size).toBe(4)
    expect(verification.key).not.toContain("intent-synthetic")
  })

  it("binds verification-confirm real post key to the same IP and same intent", () => {
    const first = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: INTENT_ID },
    })
    const second = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: INTENT_ID },
    })
    expect(first.key).toBe(second.key)
  })

  it("binds verification-confirm real post keys to different IPs with the same intent as distinct keys", () => {
    const first = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: INTENT_ID },
    })
    const second = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      ip: IP_OTHER,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: INTENT_ID },
    })
    expect(first.key).not.toBe(second.key)
  })

  it("binds reset-confirm real post key to the same IP and same intent", () => {
    const first = buildPostLookupRateLimitKey({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: INTENT_ID },
    })
    const second = buildPostLookupRateLimitKey({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: INTENT_ID },
    })
    expect(first.key).toBe(second.key)
  })

  it("binds reset-confirm real post keys to different IPs with the same intent as distinct keys", () => {
    const first = buildPostLookupRateLimitKey({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: INTENT_ID },
    })
    const second = buildPostLookupRateLimitKey({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: IP_OTHER,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: INTENT_ID },
    })
    expect(first.key).not.toBe(second.key)
  })

  it("binds refresh real post key to lineage only across different IPs", () => {
    const first = buildPostLookupRateLimitKey({
      operation: "refresh",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "lineage", opaqueId: LINEAGE_ID },
    })
    const second = buildPostLookupRateLimitKey({
      operation: "refresh",
      keyring: KEYRING,
      ip: IP_OTHER,
      presentedToken: TOKEN,
      resolved: { kind: "lineage", opaqueId: LINEAGE_ID },
    })
    expect(first.key).toBe(second.key)
  })

  it.each(["verification-confirm", "reset-confirm"] as const)(
    "binds %s real post key to the same IPv6 /64 prefix and intent without exposing the address",
    (operation) => {
      const first = buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        ip: IPV6,
        presentedToken: TOKEN,
        resolved: { kind: "intent", opaqueId: INTENT_ID },
      })
      const samePrefix = buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        ip: IPV6_SAME_PREFIX,
        presentedToken: TOKEN,
        resolved: { kind: "intent", opaqueId: INTENT_ID },
      })
      expect(first.key).toBe(samePrefix.key)
      expect(first.key).not.toContain(IPV6)
      expect(first.key).not.toContain(IPV6_SAME_PREFIX)
      expect(first.key).not.toContain("2001:db8")
      expect(first.key).not.toContain(INTENT_ID)
    }
  )

  it.each([
    ["verification-confirm", "intent", INTENT_ID],
    ["reset-confirm", "intent", INTENT_ID],
    ["refresh", "lineage", LINEAGE_ID],
  ] as const)(
    "keeps %s real and dummy post keys free of plaintext IP, intent ID, and lineage ID",
    (operation, kind, opaqueId) => {
      const real = buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        ip: IP,
        presentedToken: TOKEN,
        resolved: { kind, opaqueId },
      })
      const dummy = buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        ip: IP,
        presentedToken: TOKEN,
        resolved: null,
      })
      for (const key of [real.key, dummy.key]) {
        expect(key).not.toContain(IP)
        expect(key).not.toContain(IP_OTHER)
        expect(key).not.toContain(INTENT_ID)
        expect(key).not.toContain(LINEAGE_ID)
        expect(key).not.toContain(opaqueId)
        expect(key).not.toContain(TOKEN)
      }
    }
  )

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
        ip: IP,
        presentedToken: TOKEN,
        resolved: { kind: "intent", opaqueId: "intent-real-synthetic" },
      })
      const dummy = buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        ip: IP,
        presentedToken: TOKEN,
        resolved: null,
      })

      await consumeRateLimitBuckets(store, [real])
      await consumeRateLimitBuckets(store, [dummy])
      expect(store.operations).toEqual([1, 1])
      expect(real.limit).toBe(dummy.limit)
      expect(real.windowSeconds).toBe(dummy.windowSeconds)
    }
  )

  it.each(["reset-confirm", "refresh"] as const)(
    "derives stable token-inclusive dummy keys for %s",
    (operation) => {
      const first = buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        ip: IP,
        presentedToken: "opaque-token-a",
        resolved: null,
      })
      const repeated = buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        ip: IP,
        presentedToken: "opaque-token-a",
        resolved: null,
      })
      const distinct = buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        ip: IP,
        presentedToken: "opaque-token-b",
        resolved: null,
      })

      expect(first.key).toBe(repeated.key)
      expect(first.key).not.toBe(distinct.key)
    }
  )

  it("blocks reset post-intent on hit 11", async () => {
    const store = new InMemoryAtomicRateLimitStore(() => 1_000)
    const key = buildPostLookupRateLimitKey({
      operation: "reset-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: "intent-real-synthetic" },
    })
    let result = await consumeRateLimitBuckets(store, [key])
    for (let hit = 2; hit <= 11; hit += 1) result = await consumeRateLimitBuckets(store, [key])
    expect(result.allowed).toBe(false)
    expect(result.blockedBy?.count).toBe(11)
  })

  it("blocks verification-confirm post-intent on hit 11", async () => {
    const store = new InMemoryAtomicRateLimitStore(() => 1_000)
    const key = buildPostLookupRateLimitKey({
      operation: "verification-confirm",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "intent", opaqueId: INTENT_ID },
    })
    let result = await consumeRateLimitBuckets(store, [key])
    for (let hit = 2; hit <= 11; hit += 1) result = await consumeRateLimitBuckets(store, [key])
    expect(result.allowed).toBe(false)
    expect(result.blockedBy?.count).toBe(11)
  })

  it("blocks refresh post-lineage on hit 11", async () => {
    const store = new InMemoryAtomicRateLimitStore(() => 1_000)
    const key = buildPostLookupRateLimitKey({
      operation: "refresh",
      keyring: KEYRING,
      ip: IP,
      presentedToken: TOKEN,
      resolved: { kind: "lineage", opaqueId: LINEAGE_ID },
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

  it.each([
    [
      "200 unresolved",
      "verification-confirm",
      { state: "unresolved", subject: null, publicOutcome: { status: 200 } },
    ],
    [
      "wrong resolved kind",
      "refresh",
      {
        state: "resolved",
        subject: { kind: "intent", opaqueId: "opaque-subject" },
        publicOutcome: { status: 200 },
      },
    ],
    [
      "wrong public code",
      "reset-confirm",
      {
        state: "resolved",
        subject: { kind: "intent", opaqueId: "opaque-subject" },
        publicOutcome: { status: 400, code: "VERIFICATION_INVALID_OR_EXPIRED" },
      },
    ],
    [
      "unsupported public status",
      "verification-confirm",
      {
        state: "resolved",
        subject: { kind: "intent", opaqueId: "opaque-subject" },
        publicOutcome: { status: 202 },
      },
    ],
    [
      "unknown resolution state",
      "verification-confirm",
      {
        state: "unknown",
        subject: { kind: "intent", opaqueId: "opaque-subject" },
        publicOutcome: { status: 200 },
      },
    ],
  ] as const)("fails closed for adversarial resolution: %s", async (_name, operation, resolution) => {
    const pre = buildPreLookupRateLimitKeys({ operation, keyring: KEYRING, ip: IP })
    await expect(runAuthRateLimitProtocol({
      operation,
      store: new InMemoryAtomicRateLimitStore(() => 1_000),
      preBuckets: pre,
      resolve: async () => resolution as never,
      buildPostBucket: (resolved) => buildPostLookupRateLimitKey({
        operation,
        keyring: KEYRING,
        ip: IP,
        resolved,
      }),
      dummyWork: () => "must-not-run",
      timing: async () => 350,
    })).rejects.toMatchObject({
      code: "AUTH_TEMPORARILY_UNAVAILABLE",
      retryAfterSeconds: 60,
    })
  })
})
