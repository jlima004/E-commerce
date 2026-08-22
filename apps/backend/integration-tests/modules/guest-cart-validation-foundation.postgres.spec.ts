import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../postgres/disposable-postgres-harness"
import {
  assertGuestCartHashOnlyPersistence,
  assertTokenHashUnique,
  createGuestCartPostgresProbeHarness,
  validateGuestCartPostgresUrl,
  type GuestCartPostgresHarness,
} from "../helpers/guest-cart-postgres"
import { createSyntheticGuestCartCanary } from "../../src/modules/guest-cart-capability/__tests__/support/deterministic-guest-cart"

const requestedDatabaseName = process.env.DB_TEMP_NAME

if (!requestedDatabaseName) {
  describe("Guest Cart Validation Foundation PostgreSQL (Task 15-01-02)", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(() =>
        requireDisposableDatabaseName(requestedDatabaseName)
      ).toThrow("P12_DISPOSABLE_DATABASE_NAME_REQUIRED")
    })
  })
} else {
  const disposableEnvironment = buildDisposableMedusaEnvironment(process.env)
  assertDisposableMedusaEnvironment(disposableEnvironment)

  for (const [name, value] of Object.entries(disposableEnvironment)) {
    if (typeof value === "string") {
      process.env[name] = value
    }
  }

  describe("Guest Cart Validation Foundation PostgreSQL Disposable Probe (Task 15-01-02)", () => {
    let harness: GuestCartPostgresHarness

    beforeAll(async () => {
      harness = await createGuestCartPostgresProbeHarness()
    })

    afterAll(async () => {
      if (harness) {
        await harness.cleanup()
      }
    })

    it("proves hash-only persistence and detects plaintext canary leakage", async () => {
      const canary = createSyntheticGuestCartCanary("pg_hash_only")

      await harness.insertProbeRow({
        id: "gccap_probe_01",
        cart_id: "cart_probe_01",
        token_hash: canary.tokenHash,
        status: "active",
      })

      // Must pass: token_hash is present and canary.token plaintext is absent
      await expect(
        harness.assertHashOnly({
          plaintextCanary: canary.token,
          tokenHash: canary.tokenHash,
        })
      ).resolves.toBeUndefined()

      // Insert row with plaintext leak into metadata to prove detection
      await harness.insertProbeRow({
        id: "gccap_probe_leaked",
        cart_id: "cart_probe_leaked",
        token_hash: "safe_hash_leaked_row",
        status: "active",
        metadata: { debug_canary: canary.token },
      })

      // Must fail when plaintext canary is present in any column
      await expect(
        harness.assertHashOnly({
          plaintextCanary: canary.token,
          tokenHash: canary.tokenHash,
        })
      ).rejects.toThrow("GUEST_CART_POSTGRES_PLAINTEXT_LEAKAGE_DETECTED")
    })

    it("enforces UNIQUE constraint on token_hash column", async () => {
      const canary = createSyntheticGuestCartCanary("pg_unique")

      const rowA = {
        id: "gccap_unique_a",
        cart_id: "cart_unique_a",
        token_hash: canary.tokenHash,
      }

      const rowB = {
        id: "gccap_unique_b",
        cart_id: "cart_unique_b",
        token_hash: canary.tokenHash,
      }

      await expect(
        harness.assertUniqueTokenHash(rowA, rowB)
      ).resolves.toBeUndefined()
    })

    it("validates loopback DSN and rejects remote hosts / forbidden protocols", () => {
      expect(() =>
        validateGuestCartPostgresUrl("postgresql://user:pass@127.0.0.1:5432/db")
      ).not.toThrow()
      expect(() =>
        validateGuestCartPostgresUrl("postgres://user:pass@localhost:5432/db")
      ).not.toThrow()
      expect(() =>
        validateGuestCartPostgresUrl("postgres://user:pass@[::1]:5432/db")
      ).not.toThrow()

      expect(() =>
        validateGuestCartPostgresUrl(
          "postgres://postgres:secret@db.supabase.co:5432/postgres"
        )
      ).toThrow("GUEST_CART_POSTGRES_HOST_FORBIDDEN")

      expect(() =>
        validateGuestCartPostgresUrl(
          "https://localhost:5432/db"
        )
      ).toThrow("GUEST_CART_POSTGRES_PROTOCOL_FORBIDDEN")
    })

    it("cleans up probe table safely", async () => {
      const probeTableName = harness.probeTable
      const cleanupResult = await harness.cleanup()
      expect(cleanupResult.droppedTables).toContain(probeTableName)
    })
  })
}
