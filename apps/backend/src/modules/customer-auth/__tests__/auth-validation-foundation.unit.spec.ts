import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  createDeterministicAuthClock,
  createDeterministicAuthEntropy,
  createSyntheticIdempotencyKey,
  deriveSyntheticCapability,
} from "./support/deterministic-auth"
import {
  AUTH_PROVIDER_OUTCOMES,
  createAuthProviderMock,
} from "../../../../integration-tests/helpers/auth-providers"
import {
  AUTH_FAULT_POINTS,
  createAuthFaultInjector,
} from "../../../../integration-tests/helpers/auth-faults"
import {
  AUTH_CANARIES,
  AUTH_LEAKAGE_SINKS,
  assertAuthSinksHaveNoCanaries,
  assertSafeAuthSink,
  buildSafeAuthSink,
  createAuthLeakageCollector,
} from "../../../../integration-tests/helpers/auth-leakage"

const DETERMINISTIC_AUTH_SOURCE = readFileSync(
  resolve(__dirname, "./support/deterministic-auth.ts"),
  "utf8"
)

const HARNESS_MODULES = [
  "./support/deterministic-auth",
  "../../../../integration-tests/helpers/auth-providers",
  "../../../../integration-tests/helpers/auth-faults",
  "../../../../integration-tests/helpers/auth-leakage",
  "../../../../integration-tests/helpers/auth-postgres",
  "../../../../integration-tests/helpers/auth-redis",
  "../../../../integration-tests/helpers/auth-multiprocess",
] as const

const CAPABILITY_INPUT = {
  secret: "p14w0-test-secret-not-for-production",
  keyVersion: 1,
  type: "verification",
  intentId: "intent_p14w0_001",
  generation: 2,
  nonce: "nonce_p14w0_aaa",
} as const

function expectHarnessForbidden(error: unknown): void {
  expect(error).toBeInstanceOf(Error)
  const thrown = error as Error & { code?: string }
  expect(thrown.message).toContain("AUTH_TEST_HARNESS_FORBIDDEN")
  expect(thrown.code).toBe("AUTH_TEST_HARNESS_FORBIDDEN")
}

function loadHarnessModule(modulePath: string): unknown {
  let loaded: unknown
  jest.isolateModules(() => {
    loaded = require(modulePath)
  })
  return loaded
}

describe("Phase 14 Wave 0 auth validation foundation", () => {
  describe("deterministic clock", () => {
    it("freezes at start and advances deterministically for the same seed", () => {
      const startMs = 1_700_000_000_000
      const clockA = createDeterministicAuthClock({
        seed: "clock-seed-alpha",
        startMs,
      })
      const clockB = createDeterministicAuthClock({
        seed: "clock-seed-alpha",
        startMs,
      })

      clockA.freeze()
      clockB.freeze()

      expect(clockA.nowMs()).toBe(startMs)
      expect(clockB.nowMs()).toBe(startMs)
      expect(clockA.now().toISOString()).toBe(new Date(startMs).toISOString())

      clockA.advance(1_500)
      clockB.advance(1_500)

      expect(clockA.nowMs()).toBe(startMs + 1_500)
      expect(clockB.nowMs()).toBe(startMs + 1_500)
      expect(clockA.now().toISOString()).toBe(
        new Date(startMs + 1_500).toISOString()
      )
    })
  })

  describe("deterministic entropy", () => {
    it("returns the same 32 bytes for the same seed and diverges otherwise", () => {
      const entropyA = createDeterministicAuthEntropy("entropy-seed-alpha")
      const entropyB = createDeterministicAuthEntropy("entropy-seed-alpha")
      const entropyC = createDeterministicAuthEntropy("entropy-seed-bravo")

      const bytesA = entropyA.bytes()
      const bytesB = entropyB.bytes()
      const bytesC = entropyC.bytes()

      expect(Buffer.isBuffer(bytesA)).toBe(true)
      expect(bytesA).toHaveLength(32)
      expect(bytesA.equals(bytesB)).toBe(true)
      expect(bytesA.equals(bytesC)).toBe(false)

      const replacement = Buffer.alloc(32, 7)
      entropyA.replace(replacement)
      expect(entropyA.bytes().equals(replacement)).toBe(true)
      expect(entropyB.bytes().equals(bytesB)).toBe(true)
    })
  })

  describe("HMAC/HKDF synthetic capabilities", () => {
    it("derives the same capability for the same inputs and only persists hash/nonce/key_version", () => {
      const first = deriveSyntheticCapability(CAPABILITY_INPUT)
      const second = deriveSyntheticCapability(CAPABILITY_INPUT)

      expect(first.capability).toBe(second.capability)
      expect(first.capability.length).toBeGreaterThan(16)
      expect(first.material).toEqual({
        hash: first.material.hash,
        nonce: CAPABILITY_INPUT.nonce,
        key_version: CAPABILITY_INPUT.keyVersion,
      })
      expect(first.material.hash).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(first.material)).not.toContain(first.capability)
      expect(Object.keys(first.material).sort()).toEqual([
        "hash",
        "key_version",
        "nonce",
      ])
    })

    it("diverges when seed material or versioned key inputs change", () => {
      const baseline = deriveSyntheticCapability(CAPABILITY_INPUT).capability

      expect(
        deriveSyntheticCapability({
          ...CAPABILITY_INPUT,
          secret: "p14w0-other-secret-not-for-production",
        }).capability
      ).not.toBe(baseline)
      expect(
        deriveSyntheticCapability({ ...CAPABILITY_INPUT, keyVersion: 2 })
          .capability
      ).not.toBe(baseline)
      expect(
        deriveSyntheticCapability({ ...CAPABILITY_INPUT, type: "reset" })
          .capability
      ).not.toBe(baseline)
      expect(
        deriveSyntheticCapability({
          ...CAPABILITY_INPUT,
          intentId: "intent_p14w0_002",
        }).capability
      ).not.toBe(baseline)
      expect(
        deriveSyntheticCapability({ ...CAPABILITY_INPUT, generation: 3 })
          .capability
      ).not.toBe(baseline)
      expect(
        deriveSyntheticCapability({
          ...CAPABILITY_INPUT,
          nonce: "nonce_p14w0_bbb",
        }).capability
      ).not.toBe(baseline)

      expect(
        deriveSyntheticCapability({ ...CAPABILITY_INPUT, keyVersion: 2 })
          .material.key_version
      ).toBe(2)
    })

    it("uses Node crypto HMAC/HKDF/hash primitives and no Math.random", () => {
      expect(DETERMINISTIC_AUTH_SOURCE).toContain("createHmac")
      expect(DETERMINISTIC_AUTH_SOURCE).toContain("hkdfSync")
      expect(DETERMINISTIC_AUTH_SOURCE).toContain("createHash")
      expect(DETERMINISTIC_AUTH_SOURCE).not.toContain("Math.random")
    })
  })

  describe("synthetic Idempotency-Key", () => {
    it("is stable for the same seed and operation and diverges otherwise", () => {
      const first = createSyntheticIdempotencyKey({
        seed: "idem-seed-alpha",
        operation: "refresh_rotate",
      })
      const second = createSyntheticIdempotencyKey({
        seed: "idem-seed-alpha",
        operation: "refresh_rotate",
      })
      const otherSeed = createSyntheticIdempotencyKey({
        seed: "idem-seed-bravo",
        operation: "refresh_rotate",
      })
      const otherOperation = createSyntheticIdempotencyKey({
        seed: "idem-seed-alpha",
        operation: "password_change",
      })

      expect(first).toBe(second)
      expect(first).not.toBe(otherSeed)
      expect(first).not.toBe(otherOperation)
      expect(first.startsWith("idem_p14w0_")).toBe(true)
      expect(first).not.toMatch(/sk_live|pi_|pix_/i)
    })
  })

  describe("provider mocks", () => {
    it("repeats emailpass and Resend success/timeout/5xx/ambiguous outcomes", () => {
      expect(AUTH_PROVIDER_OUTCOMES).toEqual([
        "success",
        "timeout",
        "5xx",
        "ambiguous",
      ])

      for (const provider of ["emailpass", "resend"] as const) {
        for (const outcome of AUTH_PROVIDER_OUTCOMES) {
          const mock = createAuthProviderMock({
            provider,
            seed: "provider-seed-alpha",
            outcome,
          })
          const first = mock.invoke()
          const second = mock.invoke()
          const otherSeed = createAuthProviderMock({
            provider,
            seed: "provider-seed-bravo",
            outcome,
          }).invoke()

          expect(first).toEqual(second)
          expect(first.provider).toBe(provider)
          expect(first.outcome).toBe(outcome)
          expect(first.mockRequestId).not.toBe(otherSeed.mockRequestId)
          expect(JSON.stringify(first)).not.toMatch(
            /resend\.com|stripe\.com|gelato|posthog|sentry\.io|correios/i
          )

          if (outcome === "success") {
            expect(first.ok).toBe(true)
            expect(first.statusCode).toBe(200)
            expect(first.retryable).toBe(false)
            expect(first.ambiguous).toBe(false)
          } else if (outcome === "timeout") {
            expect(first.ok).toBe(false)
            expect(first.statusCode).toBeNull()
            expect(first.retryable).toBe(true)
            expect(first.ambiguous).toBe(false)
          } else if (outcome === "5xx") {
            expect(first.ok).toBe(false)
            expect(first.statusCode).toBe(503)
            expect(first.retryable).toBe(true)
            expect(first.ambiguous).toBe(false)
          } else {
            expect(first.ok).toBe(false)
            expect(first.statusCode).toBeNull()
            expect(first.retryable).toBe(true)
            expect(first.ambiguous).toBe(true)
          }
        }
      }
    })
  })

  describe("named fault points", () => {
    it("stays off by default and fires repeatably when enabled", () => {
      expect(Object.values(AUTH_FAULT_POINTS).sort()).toEqual([
        "identity_to_customer",
        "password_proof_to_revoke",
        "password_update_to_revocation",
        "refresh_commit_to_response",
      ])

      const idle = createAuthFaultInjector({ seed: "fault-seed-alpha" })
      for (const id of Object.values(AUTH_FAULT_POINTS)) {
        const event = idle.fire(id)
        expect(event.fired).toBe(false)
        expect(event.id).toBe(id)
      }

      for (const id of Object.values(AUTH_FAULT_POINTS)) {
        const first = createAuthFaultInjector({
          seed: "fault-seed-alpha",
          enabled: [id],
        })
        const second = createAuthFaultInjector({
          seed: "fault-seed-alpha",
          enabled: [id],
        })
        const otherSeed = createAuthFaultInjector({
          seed: "fault-seed-bravo",
          enabled: [id],
        })

        const firstEvent = first.fire(id)
        const secondEvent = second.fire(id)
        const otherEvent = otherSeed.fire(id)

        expect(firstEvent.fired).toBe(true)
        expect(firstEvent).toEqual(secondEvent)
        expect(firstEvent.fingerprint).not.toBe(otherEvent.fingerprint)
      }
    })
  })

  describe("leakage canaries", () => {
    it("keeps synthetic canaries distinct and unlike real credentials", () => {
      expect(Object.keys(AUTH_CANARIES).sort()).toEqual([
        "access",
        "email",
        "password",
        "refresh",
        "reset",
        "verification",
      ])

      const values = Object.values(AUTH_CANARIES)
      expect(new Set(values).size).toBe(values.length)

      for (const canary of values) {
        expect(canary).not.toMatch(/sk_live/i)
        expect(canary).not.toMatch(/\bpi_[A-Za-z0-9]+/)
        expect(canary).not.toMatch(/pix_|000201/i)
        expect(canary).not.toMatch(/track(ing)?_token/i)
        expect(canary).not.toMatch(/@gmail\.|@yahoo\.|@hotmail\./i)
      }
    })

    it("fails when a canary appears in any forbidden sink and passes hash/nonce/key_version", () => {
      expect([...AUTH_LEAKAGE_SINKS]).toEqual([
        "db_plaintext",
        "redis_keys_jobs",
        "logs",
        "sentry",
        "openapi",
        "fixtures_snapshots",
        "analytics",
        "persisted_provider_payload",
      ])

      const derived = deriveSyntheticCapability(CAPABILITY_INPUT)
      const safe = buildSafeAuthSink(derived.material)
      expect(safe).toEqual({
        hash: derived.material.hash,
        nonce: derived.material.nonce,
        key_version: derived.material.key_version,
      })
      assertSafeAuthSink(safe)

      const safeSnapshots = Object.fromEntries(
        AUTH_LEAKAGE_SINKS.map((sink) => [sink, safe])
      ) as Record<(typeof AUTH_LEAKAGE_SINKS)[number], typeof safe>

      assertAuthSinksHaveNoCanaries(safeSnapshots)
      for (const snapshot of Object.values(safeSnapshots)) {
        const serialized = JSON.stringify(snapshot)
        for (const canary of Object.values(AUTH_CANARIES)) {
          expect(serialized).not.toContain(canary)
        }
        expect(serialized).not.toContain(derived.capability)
      }

      const collector = createAuthLeakageCollector()
      for (const sink of AUTH_LEAKAGE_SINKS) {
        collector.record(sink, safe)
      }
      collector.assertNoCanaries()

      const canaryBySink = {
        db_plaintext: AUTH_CANARIES.access,
        redis_keys_jobs: AUTH_CANARIES.refresh,
        logs: AUTH_CANARIES.verification,
        sentry: AUTH_CANARIES.reset,
        openapi: AUTH_CANARIES.password,
        fixtures_snapshots: AUTH_CANARIES.email,
        analytics: AUTH_CANARIES.access,
        persisted_provider_payload: AUTH_CANARIES.refresh,
      } as const

      for (const sink of AUTH_LEAKAGE_SINKS) {
        const dirty = { ...safe, leaked: canaryBySink[sink] }
        expect(() => assertAuthSinksHaveNoCanaries({ [sink]: dirty })).toThrow()
        expect(JSON.stringify(dirty)).toContain(canaryBySink[sink])
      }

      expect(() =>
        assertSafeAuthSink({
          ...safe,
          capability: derived.capability,
        })
      ).toThrow()
    })
  })

  describe("test-only boundary", () => {
    const originalNodeEnv = process.env.NODE_ENV

    afterEach(() => {
      process.env.NODE_ENV = originalNodeEnv ?? "test"
      jest.resetModules()
    })

    it.each(HARNESS_MODULES)(
      "throws AUTH_TEST_HARNESS_FORBIDDEN when loading %s outside test",
      (modulePath) => {
        process.env.NODE_ENV = "production"
        jest.resetModules()

        try {
          loadHarnessModule(modulePath)
          throw new Error("expected harness import to fail")
        } catch (error) {
          expectHarnessForbidden(error)
        }
      }
    )

    it("does not export a production runtime test hook", () => {
      expect(
        resolve(__dirname, "./support/deterministic-auth.ts")
      ).toContain("/__tests__/support/")
      expect(DETERMINISTIC_AUTH_SOURCE).toContain("AUTH_TEST_HARNESS_FORBIDDEN")
      expect(DETERMINISTIC_AUTH_SOURCE).not.toMatch(
        /installProduction|enableProdTestHook|productionTestHook/i
      )
    })
  })
})
