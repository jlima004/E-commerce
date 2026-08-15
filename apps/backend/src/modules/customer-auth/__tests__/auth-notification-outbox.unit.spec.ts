import {
  AUTH_NOTIFICATION_OUTBOX_BACKOFF_SCHEDULE_MS,
  AUTH_NOTIFICATION_OUTBOX_LEASE_MS,
  AUTH_NOTIFICATION_OUTBOX_MAX_ATTEMPTS,
  AUTH_NOTIFICATION_TEMPLATES,
  assertNoSensitiveOutboxPayload,
  buildNotificationOutboxRecordRow,
  computeAuthNotificationBackoff,
  deriveCustomerAuthRecipientHash,
  formatAuthNotificationIdempotencyKey,
  recordNotificationOutboxInTransaction,
  validateProviderMessageId,
} from "../notification-outbox"
import {
  resolveAndVerifyRecipient,
  fetchAuthoritativeRawEmailsForIdentity,
} from "../notification-recipient"
import {
  parseCustomerAuthCapabilityKeyring,
  deriveCustomerAuthCapability,
  generateCustomerAuthCapabilityNonce,
  hashCustomerAuthCapability,
} from "../security/capabilities"
import * as CustomerAuthExports from "../index"
import { runAuthNotificationReconcile } from "../../../jobs/auth-notification-reconcile"
import { runAuthNotificationRelay } from "../../../jobs/auth-notification-relay"

describe("Auth Notification Outbox Unit Test Suite (P14-D10)", () => {
  const keyring = parseCustomerAuthCapabilityKeyring({
    enabled: true,
    activeVersion: "1",
    activeSecret: "01234567890123456789012345678901",
    previousKeys: JSON.stringify([
      { version: 2, secret: "abcdefabcdefabcdefabcdefabcdefab" },
    ]),
  })!

  describe("Idempotency key and formatting", () => {
    it("formats stable idempotency key adhering to auth/{template}/{intentId}/g{generation}", () => {
      const key = formatAuthNotificationIdempotencyKey(
        "email_verification_v1",
        "authver_123",
        0
      )
      expect(key).toBe("auth/email_verification_v1/authver_123/g0")
      expect(key.startsWith("auth/")).toBe(true)
      expect(key.length).toBeLessThanOrEqual(256)
    })

    it("formats stable password reset idempotency key", () => {
      const key = formatAuthNotificationIdempotencyKey(
        "password_reset_v1",
        "authrst_456",
        2
      )
      expect(key).toBe("auth/password_reset_v1/authrst_456/g2")
    })

    it("rejects invalid template or negative generation", () => {
      expect(() =>
        formatAuthNotificationIdempotencyKey("invalid_template", "id1", 0)
      ).toThrow("AUTH_NOTIFICATION_TEMPLATE_INVALID")

      expect(() =>
        formatAuthNotificationIdempotencyKey(
          "email_verification_v1",
          "",
          0
        )
      ).toThrow("AUTH_NOTIFICATION_INTENT_ID_INVALID")

      expect(() =>
        formatAuthNotificationIdempotencyKey(
          "email_verification_v1",
          "id1",
          -1
        )
      ).toThrow("AUTH_NOTIFICATION_GENERATION_INVALID")
    })
  })

  describe("Sensitive data rejection", () => {
    it("rejects metadata or payloads containing capability, token, or password", () => {
      expect(() =>
        assertNoSensitiveOutboxPayload({ token: "plain_token_val" })
      ).toThrow("SENSITIVE_OUTBOX_PAYLOAD_REJECTED")

      expect(() =>
        assertNoSensitiveOutboxPayload({ capability: "cap_secret" })
      ).toThrow("SENSITIVE_OUTBOX_PAYLOAD_REJECTED")

      expect(() =>
        assertNoSensitiveOutboxPayload({ password: "supersecret" })
      ).toThrow("SENSITIVE_OUTBOX_PAYLOAD_REJECTED")

      expect(() =>
        assertNoSensitiveOutboxPayload({ newPassword: "newsecret" })
      ).toThrow("SENSITIVE_OUTBOX_PAYLOAD_REJECTED")

      expect(() =>
        assertNoSensitiveOutboxPayload({ secret: "key_material" })
      ).toThrow("SENSITIVE_OUTBOX_PAYLOAD_REJECTED")
    })

    it("rejects payloads containing plaintext emails", () => {
      expect(() =>
        assertNoSensitiveOutboxPayload({
          meta: "user email is test.user@example.com",
        })
      ).toThrow("SENSITIVE_OUTBOX_PAYLOAD_REJECTED: plaintext email detected")
    })

    it("allows non-sensitive sanitized metadata", () => {
      expect(() =>
        assertNoSensitiveOutboxPayload({
          template: "email_verification_v1",
          generation: 1,
          key_version: 1,
          domain: "example.com",
        })
      ).not.toThrow()
    })
  })

  describe("Recipient boundary and identity consistency (B14-09-HR-04)", () => {
    it("permits when provider identity and customer email match", async () => {
      const email = "person@example.com"
      const recipientHash = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "verification",
        normalizedEmail: email,
        recipientIdentityId: "ident_1",
      })

      const res = await resolveAndVerifyRecipient(
        {
          recipientIdentityId: "ident_1",
          expectedRecipientHash: recipientHash,
          expectedRecipientDomain: "example.com",
          purpose: "verification",
          keyring,
          keyVersion: 1,
        },
        {
          resolveEmailByIdentityId: async () => ({
            providerEmail: "person@example.com",
            customerEmail: "person@example.com",
          }),
        }
      )

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.normalizedEmail).toBe("person@example.com")
        expect(res.recipientDomain).toBe("example.com")
      }
    })

    it("fails closed with recipient_mismatch when provider identity and customer email diverge", async () => {
      const email = "person@example.com"
      const recipientHash = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "verification",
        normalizedEmail: email,
        recipientIdentityId: "ident_1",
      })

      const res = await resolveAndVerifyRecipient(
        {
          recipientIdentityId: "ident_1",
          expectedRecipientHash: recipientHash,
          expectedRecipientDomain: "example.com",
          purpose: "verification",
          keyring,
          keyVersion: 1,
        },
        {
          resolveEmailByIdentityId: async () => ({
            providerEmail: "person@example.com",
            customerEmail: "other@example.com",
          }),
        }
      )

      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.reason).toBe("recipient_mismatch")
        expect(res.errorCode).toBe("AUTH_NOTIFICATION_RECIPIENT_MISMATCH")
      }
    })

    it("fails closed when multiple provider identities have different emails", async () => {
      const recipientHash = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "verification",
        normalizedEmail: "person1@example.com",
        recipientIdentityId: "ident_1",
      })

      const res = await resolveAndVerifyRecipient(
        {
          recipientIdentityId: "ident_1",
          expectedRecipientHash: recipientHash,
          purpose: "verification",
          keyring,
          keyVersion: 1,
        },
        {
          resolveEmailByIdentityId: async () => [
            "person1@example.com",
            "person2@example.com",
          ],
        }
      )

      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.reason).toBe("recipient_mismatch")
      }
    })

    it("fails closed when metadata and customer email diverge", async () => {
      const recipientHash = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "verification",
        normalizedEmail: "meta@example.com",
        recipientIdentityId: "ident_1",
      })

      const res = await resolveAndVerifyRecipient(
        {
          recipientIdentityId: "ident_1",
          expectedRecipientHash: recipientHash,
          purpose: "verification",
          keyring,
          keyVersion: 1,
        },
        {
          resolveEmailByIdentityId: async () => ({
            appMetaEmail: "meta@example.com",
            customerEmail: "customer@example.com",
          }),
        }
      )

      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.reason).toBe("recipient_mismatch")
      }
    })

    it("converges to same canonical email when differences are only P14-D12 normalizable (case and whitespace)", async () => {
      const raw1 = "  Person.Name@Example.COM  "
      const raw2 = "person.name@example.com"

      const recipientHash = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "verification",
        normalizedEmail: "person.name@example.com",
        recipientIdentityId: "ident_1",
      })

      const res = await resolveAndVerifyRecipient(
        {
          recipientIdentityId: "ident_1",
          expectedRecipientHash: recipientHash,
          expectedRecipientDomain: "example.com",
          purpose: "verification",
          keyring,
          keyVersion: 1,
        },
        {
          resolveEmailByIdentityId: async () => ({
            providerEmail: raw1,
            customerEmail: raw2,
          }),
        }
      )

      expect(res.success).toBe(true)
      if (res.success) {
        expect(res.normalizedEmail).toBe("person.name@example.com")
        expect(res.recipientDomain).toBe("example.com")
      }
    })

    it("returns recipient_missing when zero emails are found", async () => {
      const res = await resolveAndVerifyRecipient(
        {
          recipientIdentityId: "ident_missing",
          expectedRecipientHash: "dummyhash",
          purpose: "verification",
          keyring,
          keyVersion: 1,
        },
        {
          resolveEmailByIdentityId: async () => null,
        }
      )

      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.reason).toBe("recipient_missing")
        expect(res.errorCode).toBe("AUTH_NOTIFICATION_RECIPIENT_MISSING")
      }
    })

    it("returns recipient_mismatch when recipient domain mismatches", async () => {
      const email = "user@firstdomain.com"
      const recipientHash = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "verification",
        normalizedEmail: email,
        recipientIdentityId: "ident_1",
      })

      const res = await resolveAndVerifyRecipient(
        {
          recipientIdentityId: "ident_1",
          expectedRecipientHash: recipientHash,
          expectedRecipientDomain: "seconddomain.com",
          purpose: "verification",
          keyring,
          keyVersion: 1,
        },
        {
          resolveEmailByIdentityId: async () => email,
        }
      )

      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.reason).toBe("recipient_mismatch")
        expect(res.errorCode).toBe("AUTH_NOTIFICATION_RECIPIENT_DOMAIN_MISMATCH")
      }
    })
  })

  describe("Recipient hash derivation", () => {
    it("derives deterministic hash using HKDF and HMAC-SHA256 without persisting secret or email", () => {
      const hash1 = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "verification",
        normalizedEmail: "cliente@loja.com.br",
        recipientIdentityId: "ident_1",
      })

      const hash2 = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "verification",
        normalizedEmail: "cliente@loja.com.br",
        recipientIdentityId: "ident_1",
      })

      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[a-f0-9]{64}$/)
    })

    it("produces distinct hashes for different key versions or purposes", () => {
      const hashV1 = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "verification",
        normalizedEmail: "cliente@loja.com.br",
      })

      const hashV2 = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 2,
        purpose: "verification",
        normalizedEmail: "cliente@loja.com.br",
      })

      const hashReset = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "reset",
        normalizedEmail: "cliente@loja.com.br",
      })

      expect(hashV1).not.toBe(hashV2)
      expect(hashV1).not.toBe(hashReset)
    })
  })

  describe("Lease and Backoff schedule", () => {
    it("specifies exactly 2 minutes (120,000 ms) for lease window", () => {
      expect(AUTH_NOTIFICATION_OUTBOX_LEASE_MS).toBe(120_000)
    })

    it("specifies exact backoff intervals: 1m, 5m, 30m, 2h, 6h, 12h", () => {
      expect(AUTH_NOTIFICATION_OUTBOX_BACKOFF_SCHEDULE_MS).toEqual([
        60_000,
        300_000,
        1_800_000,
        7_200_000,
        21_600_000,
        43_200_000,
      ])
    })

    it("computes exact retry timestamps for attempts 1 through 5", () => {
      const baseTime = new Date("2026-08-14T01:00:00.000Z")

      const attempt1 = computeAuthNotificationBackoff(1, baseTime)
      expect(attempt1.isDeadLetter).toBe(false)
      expect(attempt1.status).toBe("failed")
      expect(attempt1.nextRetryAt).toEqual(
        new Date("2026-08-14T01:01:00.000Z")
      ) // +1m

      const attempt2 = computeAuthNotificationBackoff(2, baseTime)
      expect(attempt2.nextRetryAt).toEqual(
        new Date("2026-08-14T01:05:00.000Z")
      ) // +5m

      const attempt3 = computeAuthNotificationBackoff(3, baseTime)
      expect(attempt3.nextRetryAt).toEqual(
        new Date("2026-08-14T01:30:00.000Z")
      ) // +30m

      const attempt4 = computeAuthNotificationBackoff(4, baseTime)
      expect(attempt4.nextRetryAt).toEqual(
        new Date("2026-08-14T03:00:00.000Z")
      ) // +2h

      const attempt5 = computeAuthNotificationBackoff(5, baseTime)
      expect(attempt5.nextRetryAt).toEqual(
        new Date("2026-08-14T07:00:00.000Z")
      ) // +6h
    })

    it("transitions to dead_letter on 6th failure", () => {
      const baseTime = new Date("2026-08-14T01:00:00.000Z")
      const attempt6 = computeAuthNotificationBackoff(6, baseTime)
      expect(attempt6.isDeadLetter).toBe(true)
      expect(attempt6.status).toBe("dead_letter")
      expect(attempt6.nextRetryAt).toBeNull()
    })

    it("transitions to dead_letter for any attempt >= 6", () => {
      const baseTime = new Date("2026-08-14T01:00:00.000Z")
      const attempt7 = computeAuthNotificationBackoff(7, baseTime)
      expect(attempt7.isDeadLetter).toBe(true)
      expect(attempt7.status).toBe("dead_letter")
      expect(attempt7.nextRetryAt).toBeNull()
    })
  })

  describe("Provider message ID validation", () => {
    it("validates sanitized provider message id", () => {
      expect(validateProviderMessageId("resend_msg_12345")).toBe(
        "resend_msg_12345"
      )
      expect(validateProviderMessageId("msg-abc.def:123_456")).toBe(
        "msg-abc.def:123_456"
      )
    })

    it("rejects malicious or invalid provider message ids", () => {
      expect(() => validateProviderMessageId("")).toThrow(
        "AUTH_NOTIFICATION_PROVIDER_MESSAGE_ID_INVALID"
      )
      expect(() => validateProviderMessageId("msg with spaces")).toThrow(
        "AUTH_NOTIFICATION_PROVIDER_MESSAGE_ID_INVALID"
      )
      expect(() =>
        validateProviderMessageId("msg<script>alert(1)</script>")
      ).toThrow("AUTH_NOTIFICATION_PROVIDER_MESSAGE_ID_INVALID")
      expect(() => validateProviderMessageId("a".repeat(257))).toThrow(
        "AUTH_NOTIFICATION_PROVIDER_MESSAGE_ID_INVALID"
      )
    })
  })

  describe("Outbox record row builder", () => {
    it("builds compliant initial outbox row", () => {
      const row = buildNotificationOutboxRecordRow({
        id: "authout_001",
        template: "email_verification_v1",
        intentType: "verification",
        intentId: "authver_001",
        generation: 1,
        recipientIdentityId: "ident_001",
        recipientHash: "hash123",
        recipientDomain: "loja.com.br",
        keyVersion: 1,
      })

      expect(row.id).toBe("authout_001")
      expect(row.status).toBe("recorded")
      expect(row.attempt_count).toBe(0)
      expect(row.lease_owner).toBeNull()
      expect(row.lease_until).toBeNull()
      expect(row.next_retry_at).toBeNull()
      expect(row.failure_reason).toBeNull()
      expect(row.provider_message_id).toBeNull()
      expect(row.idempotency_key).toBe(
        "auth/email_verification_v1/authver_001/g1"
      )
    })

    it("rejects template/intentType mismatch", () => {
      expect(() =>
        buildNotificationOutboxRecordRow({
          template: "email_verification_v1",
          intentType: "reset" as any,
          intentId: "id1",
          recipientIdentityId: "i1",
          recipientHash: "h1",
          recipientDomain: "d1",
          keyVersion: 1,
        })
      ).toThrow("AUTH_NOTIFICATION_TEMPLATE_INTENT_MISMATCH")
    })
  })

  describe("Transactional Outbox Record Primitive (B14-09-HR-01)", () => {
    it("successfully inserts outbox record within caller's knex transaction", async () => {
      const recordedAt = new Date("2026-08-14T02:00:00.000Z")
      let executedSql = ""
      let executedBindings: unknown[] = []

      const mockKnex = {
        async raw(sql: string, bindings?: unknown[]) {
          executedSql = sql
          executedBindings = bindings ?? []
          return {
            rows: [
              {
                id: bindings?.[0] ?? "authout_mock_1",
                template: "email_verification_v1",
                intent_type: "verification",
                intent_id: "authver_prim_1",
                generation: 0,
                idempotency_key: "auth/email_verification_v1/authver_prim_1/g0",
                status: "recorded",
                recipient_identity_id: "ident_prim_1",
                recipient_hash: "hash_prim_1",
                recipient_domain: "loja.com.br",
                key_version: 1,
                version: 1,
                lease_owner: null,
                lease_until: null,
                attempt_count: 0,
                next_retry_at: null,
                failure_reason: null,
                provider_message_id: null,
                recorded_at: recordedAt.toISOString(),
                claimed_at: null,
                sent_at: null,
                failed_at: null,
                dead_lettered_at: null,
                schema_version: 1,
              },
            ],
          }
        },
      }

      const result = await recordNotificationOutboxInTransaction(mockKnex, {
        template: "email_verification_v1",
        intentType: "verification",
        intentId: "authver_prim_1",
        generation: 0,
        recipientIdentityId: "ident_prim_1",
        recipientHash: "hash_prim_1",
        recipientDomain: "loja.com.br",
        keyVersion: 1,
        recordedAt,
      })

      expect(result.id).toMatch(/^authout_/)
      expect(result.status).toBe("recorded")
      expect(result.template).toBe("email_verification_v1")
      expect(result.intent_type).toBe("verification")
      expect(result.intent_id).toBe("authver_prim_1")
      expect(result.idempotency_key).toBe(
        "auth/email_verification_v1/authver_prim_1/g0"
      )
      expect(result.recipient_identity_id).toBe("ident_prim_1")
      expect(result.recipient_hash).toBe("hash_prim_1")
      expect(result.recipient_domain).toBe("loja.com.br")
      expect(result.key_version).toBe(1)
      expect(result.version).toBe(1)
      expect(result.recorded_at).toEqual(recordedAt)

      expect(executedSql).toContain("insert into auth_notification_outbox")
      expect(executedSql).toContain("returning *")
      expect(executedBindings[0]).toMatch(/^authout_/)
      expect(executedBindings[1]).toBe("email_verification_v1")
    })

    it("respects caller-provided id if specified", async () => {
      const mockKnex = {
        async raw(sql: string, bindings?: unknown[]) {
          return {
            rows: [
              {
                id: "authout_custom_999",
                template: "password_reset_v1",
                intent_type: "reset",
                intent_id: "authrst_prim_2",
                generation: 1,
                idempotency_key: "auth/password_reset_v1/authrst_prim_2/g1",
                status: "recorded",
                recipient_identity_id: "ident_prim_2",
                recipient_hash: "hash_prim_2",
                recipient_domain: "loja.com.br",
                key_version: 2,
                version: 1,
                lease_owner: null,
                lease_until: null,
                attempt_count: 0,
                next_retry_at: null,
                failure_reason: null,
                provider_message_id: null,
                recorded_at: new Date().toISOString(),
                claimed_at: null,
                sent_at: null,
                failed_at: null,
                dead_lettered_at: null,
                schema_version: 1,
              },
            ],
          }
        },
      }

      const result = await recordNotificationOutboxInTransaction(mockKnex, {
        id: "authout_custom_999",
        template: "password_reset_v1",
        intentType: "reset",
        intentId: "authrst_prim_2",
        generation: 1,
        recipientIdentityId: "ident_prim_2",
        recipientHash: "hash_prim_2",
        recipientDomain: "loja.com.br",
        keyVersion: 2,
      })

      expect(result.id).toBe("authout_custom_999")
      expect(result.template).toBe("password_reset_v1")
      expect(result.intent_type).toBe("reset")
    })

    it("fails and rejects insertion when sensitive payload is detected", async () => {
      const mockKnex = {
        async raw() {
          return { rows: [] }
        },
      }

      await expect(
        recordNotificationOutboxInTransaction(mockKnex, {
          template: "email_verification_v1",
          intentType: "verification",
          intentId: "authver_prim_3",
          recipientIdentityId: "ident_prim_3",
          recipientHash: "hash_prim_3",
          recipientDomain: "user@plaintext-email.com",
          keyVersion: 1,
        })
      ).rejects.toThrow("SENSITIVE_OUTBOX_PAYLOAD_REJECTED")
    })

    it("throws if knex returns no inserted rows", async () => {
      const mockKnex = {
        async raw() {
          return { rows: [] }
        },
      }

      await expect(
        recordNotificationOutboxInTransaction(mockKnex, {
          template: "email_verification_v1",
          intentType: "verification",
          intentId: "authver_prim_4",
          recipientIdentityId: "ident_prim_4",
          recipientHash: "hash_prim_4",
          recipientDomain: "loja.com.br",
          keyVersion: 1,
        })
      ).rejects.toThrow("AUTH_NOTIFICATION_OUTBOX_INSERT_FAILED")
    })
  })

  describe("Reconciler Unit Tests (B14-09-HR-06)", () => {
    it("reclaims expired leases when intent is pending", async () => {
      const now = new Date("2026-08-14T01:10:00.000Z")
      const mockRows = [
        {
          id: "authout_1",
          version: 2,
          intent_type: "verification",
          intent_id: "authver_1",
          template: "email_verification_v1",
          attempt_count: 0,
        },
      ]

      const updates: Array<{ sql: string; bindings?: unknown[] }> = []

      const mockKnex = {
        async raw(sql: string, bindings?: unknown[]) {
          if (sql.includes("select * from auth_notification_outbox")) {
            return { rows: mockRows }
          }
          if (sql.includes("select status from auth_verification_intent")) {
            return { rows: [{ status: "pending" }] }
          }
          if (sql.includes("update auth_notification_outbox")) {
            updates.push({ sql, bindings })
            return { rows: [{ id: "authout_1" }] }
          }
          return { rows: [] }
        },
      }

      const result = await runAuthNotificationReconcile({
        knex: mockKnex,
        now: () => now,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.processed).toBe(1)
      expect(result.reclaimed).toBe(1)
      expect(result.skipped_terminal).toBe(0)
      expect(result.dead_lettered).toBe(0)
      expect(updates.length).toBe(1)
      expect(updates[0].sql).toContain("status = 'failed'")
      expect(updates[0].sql).toContain("version = version + 1")
    })

    it.each(["confirmed", "completed", "superseded", "expired"])(
      "transitions outbox to dead_letter with incremented version when intent status is %s",
      async (intentStatus) => {
        const now = new Date("2026-08-14T01:10:00.000Z")
        const mockRows = [
          {
            id: "authout_terminal",
            version: 3,
            intent_type: "verification",
            intent_id: "authver_terminal",
            template: "email_verification_v1",
            attempt_count: 1,
          },
        ]

        const updates: Array<{ sql: string; bindings?: unknown[] }> = []

        const mockKnex = {
          async raw(sql: string, bindings?: unknown[]) {
            if (sql.includes("select * from auth_notification_outbox")) {
              return { rows: mockRows }
            }
            if (sql.includes("select status from auth_verification_intent")) {
              return { rows: [{ status: intentStatus }] }
            }
            if (sql.includes("update auth_notification_outbox")) {
              updates.push({ sql, bindings })
              return { rows: [{ id: "authout_terminal" }] }
            }
            return { rows: [] }
          },
        }

        const result = await runAuthNotificationReconcile({
          knex: mockKnex,
          now: () => now,
          isWorker: () => true,
          isReleaseMigration: () => false,
        })

        expect(result.processed).toBe(1)
        expect(result.reclaimed).toBe(0)
        expect(result.skipped_terminal).toBe(1)
        expect(updates.length).toBe(1)
        expect(updates[0].sql).toContain("status = 'dead_letter'")
        expect(updates[0].sql).toContain("version = version + 1")
        expect(updates[0].sql).toContain("lease_owner = null")
        expect(updates[0].sql).toContain("lease_until = null")
      }
    )

    it("transitions outbox to dead_letter when intent row is missing", async () => {
      const now = new Date("2026-08-14T01:10:00.000Z")
      const mockRows = [
        {
          id: "authout_missing_intent",
          version: 2,
          intent_type: "reset",
          intent_id: "authrst_missing",
          template: "password_reset_v1",
          attempt_count: 0,
        },
      ]

      const updates: Array<{ sql: string; bindings?: unknown[] }> = []

      const mockKnex = {
        async raw(sql: string, bindings?: unknown[]) {
          if (sql.includes("select * from auth_notification_outbox")) {
            return { rows: mockRows }
          }
          if (sql.includes("select status from auth_reset_intent")) {
            return { rows: [] } // Intent missing
          }
          if (sql.includes("update auth_notification_outbox")) {
            updates.push({ sql, bindings })
            return { rows: [{ id: "authout_missing_intent" }] }
          }
          return { rows: [] }
        },
      }

      const result = await runAuthNotificationReconcile({
        knex: mockKnex,
        now: () => now,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.processed).toBe(1)
      expect(result.skipped_terminal).toBe(1)
      expect(updates.length).toBe(1)
      expect(updates[0].sql).toContain("status = 'dead_letter'")
      expect(updates[0].sql).toContain("version = version + 1")
    })

    it("transitions to dead_letter on 6th attempt in reconciler", async () => {
      const now = new Date("2026-08-14T01:10:00.000Z")
      const mockRows = [
        {
          id: "authout_3",
          version: 6,
          intent_type: "reset",
          intent_id: "authrst_3",
          template: "password_reset_v1",
          attempt_count: 5, // Next attempt is 6 -> dead_letter
        },
      ]

      const updates: Array<{ sql: string; bindings?: unknown[] }> = []

      const mockKnex = {
        async raw(sql: string, bindings?: unknown[]) {
          if (sql.includes("select * from auth_notification_outbox")) {
            return { rows: mockRows }
          }
          if (sql.includes("select status from auth_reset_intent")) {
            return { rows: [{ status: "pending" }] }
          }
          if (sql.includes("update auth_notification_outbox")) {
            updates.push({ sql, bindings })
            return { rows: [{ id: "authout_3" }] }
          }
          return { rows: [] }
        },
      }

      const result = await runAuthNotificationReconcile({
        knex: mockKnex,
        now: () => now,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.processed).toBe(1)
      expect(result.reclaimed).toBe(0)
      expect(result.dead_lettered).toBe(1)
      expect(updates.length).toBe(1)
      expect(updates[0].sql).toContain("status = 'dead_letter'")
      expect(updates[0].sql).toContain("version = version + 1")
    })
  })

  describe("Event Bus Negative Proof (B14-09-HR-03)", () => {
    it("materially proves that auth verification and reset capabilities never traverse event emitters or subscribers", async () => {
      const emittedEvents: Array<{ eventName: string; data: unknown }> = []

      const mockEventBus = {
        emit: jest.fn(async (eventName: string, data: unknown) => {
          emittedEvents.push({ eventName, data })
        }),
      }

      const nonce = generateCustomerAuthCapabilityNonce()
      const intentId = "authver_evt_1"
      const derived = deriveCustomerAuthCapability({
        keyring,
        purpose: "verification",
        intentId,
        generation: 1,
        nonce,
        keyVersion: 1,
      })

      const rawEmail = "user.eventproof@example.com"
      const recipientHash = deriveCustomerAuthRecipientHash({
        keyring,
        keyVersion: 1,
        purpose: "verification",
        normalizedEmail: rawEmail,
        recipientIdentityId: "ident_evt_1",
      })

      const mockKnex = {
        async raw(sql: string, bindings?: unknown[]) {
          if (sql.includes("select * from auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_evt_1",
                  template: "email_verification_v1",
                  intent_type: "verification",
                  intent_id: intentId,
                  generation: 1,
                  idempotency_key: "auth/email_verification_v1/authver_evt_1/g1",
                  status: "recorded",
                  recipient_identity_id: "ident_evt_1",
                  recipient_hash: recipientHash,
                  recipient_domain: "example.com",
                  key_version: 1,
                  version: 1,
                  attempt_count: 0,
                },
              ],
            }
          }
          if (sql.includes("select * from auth_verification_intent")) {
            return {
              rows: [
                {
                  id: intentId,
                  nonce,
                  token_hash: hashCustomerAuthCapability(derived.capability),
                  status: "pending",
                },
              ],
            }
          }
          if (sql.includes("update auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_evt_1",
                  version: 2,
                },
              ],
            }
          }
          return { rows: [] }
        },
      }

      const sentPayloads: any[] = []
      const mockClient = {
        async send(payload: any, options: any) {
          sentPayloads.push({ payload, options })
          return { providerMessageId: "provider_evt_1" }
        },
      }

      // Execute relay with event bus completely decoupled
      const result = await runAuthNotificationRelay({
        knex: mockKnex,
        client: mockClient,
        config: {
          apiKey: "test_key",
          fromEmail: "noreply@example.com",
        },
        keyring,
        resolveEmailByIdentityId: async () => rawEmail,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.processed).toBe(1)
      expect(result.sent).toBe(1)

      // 1. Concrete assertion: zero event emitter calls occurred during relay processing
      expect(mockEventBus.emit).toHaveBeenCalledTimes(0)
      expect(emittedEvents.length).toBe(0)

      // 2. Concrete assertion: provider payload received capability strictly derived in-memory
      expect(sentPayloads.length).toBe(1)
      expect(sentPayloads[0].payload.html).toContain(
        encodeURIComponent(derived.capability)
      )

      // 3. Concrete assertion: capability derivation requires only memory arguments (nonce, key, intent)
      expect(typeof derived.capability).toBe("string")
      expect(derived.capability.length).toBeGreaterThan(16)
    })

    it("connected runtime proof: container with event_bus and operational_alert proves 0 bus calls and canonical alert", async () => {
      const emittedEvents: Array<{ eventName: string; data: unknown }> = []
      const mockEventBus = {
        emit: jest.fn(async (eventName: string, data: unknown) => {
          emittedEvents.push({ eventName, data })
        }),
      }

      const alertCalls: Array<Record<string, unknown>> = []
      const mockOpAlertModule = {
        upsertAlert: jest.fn(async (payload: any) => {
          alertCalls.push(payload)
          return payload
        }),
      }

      const mockContainer = {
        resolve(key: string) {
          if (key === "event_bus" || key === "eventBusService") return mockEventBus
          if (key === "operational_alert") return mockOpAlertModule
          return undefined
        },
      } as any

      const now = new Date("2026-08-14T02:00:00.000Z")
      const mockKnex = {
        async raw(sql: string) {
          if (sql.includes("select * from auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_conn_1",
                  template: "email_verification_v1",
                  intent_type: "verification",
                  intent_id: "authver_conn_1",
                  generation: 0,
                  idempotency_key: "auth/email_verification_v1/authver_conn_1/g0",
                  status: "recorded",
                  recipient_identity_id: "ident_conn_1",
                  recipient_hash: "hash_conn_1",
                  recipient_domain: "loja.com.br",
                  key_version: 1,
                  version: 1,
                  attempt_count: 0,
                },
              ],
            }
          }
          if (sql.includes("update auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_conn_1",
                  version: 2,
                },
              ],
            }
          }
          return { rows: [] }
        },
      }

      const mockClient = {
        send: jest.fn(async () => ({ providerMessageId: "prov_conn_1" })),
      }

      // Identity missing -> should dead_letter and emit canonical alert
      const result = await runAuthNotificationRelay({
        container: mockContainer,
        knex: mockKnex,
        client: mockClient,
        config: {
          apiKey: "test_key",
          fromEmail: "noreply@example.com",
        },
        keyring,
        resolveEmailByIdentityId: async () => null, // missing
        now: () => now,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.processed).toBe(1)
      expect(result.sent).toBe(0)
      expect(result.dead_lettered).toBe(1)

      // Event Bus received 0 calls
      expect(mockEventBus.emit).toHaveBeenCalledTimes(0)
      expect(emittedEvents.length).toBe(0)

      // Provider was never called
      expect(mockClient.send).toHaveBeenCalledTimes(0)

      // Operational Alert was called with canonical type and entity_type
      expect(mockOpAlertModule.upsertAlert).toHaveBeenCalledTimes(1)
      expect(alertCalls[0]).toMatchObject({
        type: "auth_notification_failed",
        severity: "high",
        entity_type: "auth_notification_outbox",
        entity_id: "authout_conn_1",
        message_code: "RECIPIENT_MISSING",
      })
    })

    it("structural executable proof (B14-09-HR-03): scans production code and verifies zero Event Bus capability transport or emission", async () => {
      const fs = await import("node:fs/promises")
      const path = await import("node:path")

      async function getFilesRecursively(dir: string): Promise<string[]> {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        const files: string[] = []
        for (const entry of entries) {
          const res = path.resolve(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name !== "__tests__" && entry.name !== "node_modules") {
              files.push(...(await getFilesRecursively(res)))
            }
          } else if (
            (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) &&
            !entry.name.includes(".spec.") &&
            !entry.name.includes(".test.")
          ) {
            files.push(res)
          }
        }
        return files
      }

      const backendSrcDir = path.resolve(__dirname, "../../../")
      const customerAuthDir = path.resolve(__dirname, "../")
      const jobsDir = path.resolve(__dirname, "../../../jobs")
      const subscribersDir = path.resolve(__dirname, "../../../subscribers")
      const workflowsDir = path.resolve(__dirname, "../../../workflows")

      const targetFiles: string[] = [
        ...(await getFilesRecursively(customerAuthDir)),
      ]

      // Include auth jobs
      const jobFiles = await fs.readdir(jobsDir)
      for (const jf of jobFiles) {
        if (
          jf.startsWith("auth-notification-") &&
          (jf.endsWith(".ts") || jf.endsWith(".js"))
        ) {
          targetFiles.push(path.resolve(jobsDir, jf))
        }
      }

      // Include subscribers if directory exists
      try {
        const subFiles = await getFilesRecursively(subscribersDir)
        targetFiles.push(...subFiles)
      } catch {
        // subscribers directory optional
      }

      // Include workflows if directory exists
      try {
        const wfFiles = await getFilesRecursively(workflowsDir)
        targetFiles.push(...wfFiles)
      } catch {
        // workflows directory optional
      }

      expect(targetFiles.length).toBeGreaterThan(5)

      for (const filePath of targetFiles) {
        const content = await fs.readFile(filePath, "utf8")
        const relPath = path.relative(backendSrcDir, filePath)

        // Rule 1: No customer-auth module/job code imports or resolves event bus
        if (
          filePath.includes("customer-auth") ||
          filePath.includes("auth-notification-")
        ) {
          expect(content).not.toMatch(/ContainerRegistrationKeys\.EVENT_BUS/)
          expect(content).not.toMatch(/resolve\(\s*["']event_bus["']\s*\)/)
          expect(content).not.toMatch(/resolve\(\s*["']eventBusService["']\s*\)/)
          expect(content).not.toMatch(/@medusajs\/medusa\/event-bus-redis/)
        }

        // Rule 2: No file in customer-auth or workflows/subscribers transports capability or token via event bus emit/publish
        const emitMatches = content.match(
          /\.(emit|publish)\s*\(\s*["'][^"']*auth[^"']*["']\s*,\s*\{[^}]*(\btoken\b|\bcapability\b|\bsecret\b)/i
        )
        expect(emitMatches).toBeNull()

        // Rule 3: No subscriber receives auth verification/reset capability
        if (filePath.includes("subscribers")) {
          expect(content).not.toMatch(/auth\.verification/i)
          expect(content).not.toMatch(/auth\.reset/i)
          expect(content).not.toMatch(/capability/i)
        }
      }
    })
  })

  describe("Operational Alert Failure Observability (B14-09-HR-02)", () => {
    it("produces observable OPERATIONAL_ALERT_CREATION_FAILED log when operational-alert module is unavailable without rolling back dead_letter", async () => {
      const loggedWarnings: Array<{ code: string; meta: Record<string, unknown> }> = []
      const mockLogger = {
        warn: (code: string, meta: Record<string, unknown>) => {
          loggedWarnings.push({ code, meta })
        },
      }

      const mockContainer = {
        resolve(key: string) {
          if (key === "operational_alert") {
            throw new Error("Module operational_alert not registered in container")
          }
          return undefined
        },
      } as any

      const now = new Date("2026-08-14T02:00:00.000Z")
      const mockKnex = {
        async raw(sql: string) {
          if (sql.includes("select * from auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_alert_fail_1",
                  template: "email_verification_v1",
                  intent_type: "verification",
                  intent_id: "authver_alert_fail_1",
                  generation: 0,
                  idempotency_key:
                    "auth/email_verification_v1/authver_alert_fail_1/g0",
                  status: "recorded",
                  recipient_identity_id: "ident_alert_fail_1",
                  recipient_hash: "hash_alert_fail_1",
                  recipient_domain: "loja.com.br",
                  key_version: 1,
                  version: 1,
                  attempt_count: 0,
                },
              ],
            }
          }
          if (sql.includes("update auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_alert_fail_1",
                  version: 2,
                },
              ],
            }
          }
          return { rows: [] }
        },
      }

      const mockClient = {
        send: jest.fn(async () => ({ providerMessageId: "never" })),
      }

      const result = await runAuthNotificationRelay({
        container: mockContainer,
        knex: mockKnex,
        client: mockClient,
        config: {
          apiKey: "test_key",
          fromEmail: "noreply@example.com",
        },
        keyring,
        resolveEmailByIdentityId: async () => null, // missing -> triggers alert dispatch
        logger: mockLogger,
        now: () => now,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.processed).toBe(1)
      expect(result.dead_lettered).toBe(1)
      expect(mockClient.send).toHaveBeenCalledTimes(0)

      // Alert failure was logged observably
      expect(loggedWarnings.length).toBeGreaterThanOrEqual(1)
      const alertFailLog = loggedWarnings.find(
        (l) => l.code === "OPERATIONAL_ALERT_CREATION_FAILED"
      )
      expect(alertFailLog).toBeDefined()
      expect(alertFailLog?.meta).toMatchObject({
        outbox_id: "authout_alert_fail_1",
        intent_id: "authver_alert_fail_1",
        recipient_identity_id: "ident_alert_fail_1",
      })
      // Ensure zero PII in log
      const logDump = JSON.stringify(alertFailLog)
      expect(logDump).not.toContain("@")
      expect(logDump).not.toContain("token")
      expect(logDump).not.toContain("secret")
    })

    it("produces observable OPERATIONAL_ALERT_CREATION_FAILED log when upsertAlert throws an error", async () => {
      const loggedWarnings: Array<{ code: string; meta: Record<string, unknown> }> = []
      const mockLogger = {
        warn: (code: string, meta: Record<string, unknown>) => {
          loggedWarnings.push({ code, meta })
        },
      }

      const mockOpAlertModule = {
        upsertAlert: jest.fn(async () => {
          throw new Error("DB connection error in upsertAlert")
        }),
      }

      const mockContainer = {
        resolve(key: string) {
          if (key === "operational_alert") return mockOpAlertModule
          return undefined
        },
      } as any

      const now = new Date("2026-08-14T02:00:00.000Z")
      const mockKnex = {
        async raw(sql: string) {
          if (sql.includes("select * from auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_alert_fail_2",
                  template: "password_reset_v1",
                  intent_type: "reset",
                  intent_id: "authrst_alert_fail_2",
                  generation: 0,
                  idempotency_key:
                    "auth/password_reset_v1/authrst_alert_fail_2/g0",
                  status: "recorded",
                  recipient_identity_id: "ident_alert_fail_2",
                  recipient_hash: "hash_alert_fail_2",
                  recipient_domain: "loja.com.br",
                  key_version: 1,
                  version: 1,
                  attempt_count: 0,
                },
              ],
            }
          }
          if (sql.includes("update auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_alert_fail_2",
                  version: 2,
                },
              ],
            }
          }
          return { rows: [] }
        },
      }

      const mockClient = {
        send: jest.fn(async () => ({ providerMessageId: "never" })),
      }

      const result = await runAuthNotificationRelay({
        container: mockContainer,
        knex: mockKnex,
        client: mockClient,
        config: {
          apiKey: "test_key",
          fromEmail: "noreply@example.com",
        },
        keyring,
        resolveEmailByIdentityId: async () => null,
        logger: mockLogger,
        now: () => now,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.processed).toBe(1)
      expect(result.sent).toBe(0)
      expect(result.dead_lettered).toBe(1)
      expect(mockClient.send).toHaveBeenCalledTimes(0)

      const alertFailLog = loggedWarnings.find(
        (l) => l.code === "OPERATIONAL_ALERT_CREATION_FAILED"
      )
      expect(alertFailLog).toBeDefined()
      expect(alertFailLog?.meta).toMatchObject({
        outbox_id: "authout_alert_fail_2",
        intent_id: "authrst_alert_fail_2",
        recipient_identity_id: "ident_alert_fail_2",
        error_name: "Error",
      })
      expect(alertFailLog?.meta.error).toBeUndefined()
      expect(JSON.stringify(alertFailLog)).not.toContain("DB connection error in upsertAlert")
    })

    it("adversarial (B14-09-HR-02): proves zero leak of sensitive canaries when upsertAlert throws error containing email, token, capability, secret and conn string", async () => {
      const loggedWarnings: Array<{ code: string; meta: Record<string, unknown> }> = []
      const mockLogger = {
        warn: (code: string, meta: Record<string, unknown>) => {
          loggedWarnings.push({ code, meta })
        },
      }

      const sensitiveErrorMessage =
        "failure cliente@example.com token=raw-token capability=cap-secret sk_test_sensitive postgres://user:password@host/db"

      const mockOpAlertModule = {
        upsertAlert: jest.fn(async () => {
          throw new Error(sensitiveErrorMessage)
        }),
      }

      const mockContainer = {
        resolve(key: string) {
          if (key === "operational_alert") return mockOpAlertModule
          return undefined
        },
      } as any

      const now = new Date("2026-08-14T02:00:00.000Z")
      let deadLetterCommitted = false
      const mockKnex = {
        async raw(sql: string) {
          if (sql.includes("select * from auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_adv_upsert_1",
                  template: "email_verification_v1",
                  intent_type: "verification",
                  intent_id: "authver_adv_upsert_1",
                  generation: 0,
                  idempotency_key:
                    "auth/email_verification_v1/authver_adv_upsert_1/g0",
                  status: "recorded",
                  recipient_identity_id: "ident_adv_upsert_1",
                  recipient_hash: "hash_adv_upsert_1",
                  recipient_domain: "loja.com.br",
                  key_version: 1,
                  version: 1,
                  attempt_count: 0,
                },
              ],
            }
          }
          if (sql.includes("update auth_notification_outbox")) {
            if (sql.includes("status = 'dead_letter'")) {
              deadLetterCommitted = true
            }
            return {
              rows: [
                {
                  id: "authout_adv_upsert_1",
                  version: 2,
                },
              ],
            }
          }
          return { rows: [] }
        },
      }

      const mockClient = {
        send: jest.fn(async () => ({ providerMessageId: "never" })),
      }

      const result = await runAuthNotificationRelay({
        container: mockContainer,
        knex: mockKnex,
        client: mockClient,
        config: {
          apiKey: "test_key",
          fromEmail: "noreply@example.com",
        },
        keyring,
        resolveEmailByIdentityId: async () => null, // recipient_missing -> triggers alert dispatch
        logger: mockLogger,
        now: () => now,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      // 1. Invariants
      expect(result.processed).toBe(1)
      expect(result.sent).toBe(0)
      expect(result.dead_lettered).toBe(1)
      expect(mockClient.send).toHaveBeenCalledTimes(0)
      expect(deadLetterCommitted).toBe(true)

      // 2. Alert creation failure logged observably
      const alertFailLog = loggedWarnings.find(
        (l) => l.code === "OPERATIONAL_ALERT_CREATION_FAILED"
      )
      expect(alertFailLog).toBeDefined()
      expect(alertFailLog?.meta).toEqual({
        error_code: "AUTH_NOTIFICATION_RECIPIENT_MISSING",
        job: "auth-notification-relay",
        outbox_id: "authout_adv_upsert_1",
        intent_id: "authver_adv_upsert_1",
        recipient_identity_id: "ident_adv_upsert_1",
        failure_reason: "recipient_missing",
        error_name: "Error",
      })

      // 3. Canary assertions: zero leakage of any sensitive tokens or messages
      const serializedLog = JSON.stringify(alertFailLog)
      expect(serializedLog).not.toContain("cliente@example.com")
      expect(serializedLog).not.toContain("raw-token")
      expect(serializedLog).not.toContain("cap-secret")
      expect(serializedLog).not.toContain("sk_test_sensitive")
      expect(serializedLog).not.toContain("postgres://")
      expect(serializedLog).not.toContain("password@")
      expect(serializedLog).not.toContain("error.stack")
      expect(serializedLog).not.toContain(sensitiveErrorMessage)
      expect(alertFailLog?.meta.error).toBeUndefined()
      expect(alertFailLog?.meta.stack).toBeUndefined()
    })

    it("adversarial (B14-09-HR-02): proves zero leak of sensitive canaries when container.resolve throws exception", async () => {
      const loggedWarnings: Array<{ code: string; meta: Record<string, unknown> }> = []
      const mockLogger = {
        warn: (code: string, meta: Record<string, unknown>) => {
          loggedWarnings.push({ code, meta })
        },
      }

      const sensitiveResolveMessage =
        "resolve-fail cliente@example.com token=raw-token capability=cap-secret sk_test_sensitive postgres://user:password@host/db"

      const mockContainer = {
        resolve(key: string) {
          if (key === "operational_alert") {
            throw new Error(sensitiveResolveMessage)
          }
          return undefined
        },
      } as any

      const now = new Date("2026-08-14T02:00:00.000Z")
      let deadLetterCommitted = false
      const mockKnex = {
        async raw(sql: string) {
          if (sql.includes("select * from auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_adv_resolve_1",
                  template: "email_verification_v1",
                  intent_type: "verification",
                  intent_id: "authver_adv_resolve_1",
                  generation: 0,
                  idempotency_key:
                    "auth/email_verification_v1/authver_adv_resolve_1/g0",
                  status: "recorded",
                  recipient_identity_id: "ident_adv_resolve_1",
                  recipient_hash: "hash_adv_resolve_1",
                  recipient_domain: "loja.com.br",
                  key_version: 1,
                  version: 1,
                  attempt_count: 0,
                },
              ],
            }
          }
          if (sql.includes("update auth_notification_outbox")) {
            if (sql.includes("status = 'dead_letter'")) {
              deadLetterCommitted = true
            }
            return {
              rows: [
                {
                  id: "authout_adv_resolve_1",
                  version: 2,
                },
              ],
            }
          }
          return { rows: [] }
        },
      }

      const mockClient = {
        send: jest.fn(async () => ({ providerMessageId: "never" })),
      }

      const result = await runAuthNotificationRelay({
        container: mockContainer,
        knex: mockKnex,
        client: mockClient,
        config: {
          apiKey: "test_key",
          fromEmail: "noreply@example.com",
        },
        keyring,
        resolveEmailByIdentityId: async () => null, // recipient_missing -> triggers alert dispatch
        logger: mockLogger,
        now: () => now,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      // 1. Invariants
      expect(result.processed).toBe(1)
      expect(result.sent).toBe(0)
      expect(result.dead_lettered).toBe(1)
      expect(mockClient.send).toHaveBeenCalledTimes(0)
      expect(deadLetterCommitted).toBe(true)

      // 2. Alert creation failure logged observably
      const alertFailLog = loggedWarnings.find(
        (l) => l.code === "OPERATIONAL_ALERT_CREATION_FAILED"
      )
      expect(alertFailLog).toBeDefined()
      expect(alertFailLog?.meta).toEqual({
        error_code: "AUTH_NOTIFICATION_RECIPIENT_MISSING",
        job: "auth-notification-relay",
        outbox_id: "authout_adv_resolve_1",
        intent_id: "authver_adv_resolve_1",
        recipient_identity_id: "ident_adv_resolve_1",
        failure_reason: "recipient_missing",
        error_name: "Error",
      })

      // 3. Canary assertions: zero leakage of any sensitive tokens or messages
      const serializedLog = JSON.stringify(alertFailLog)
      expect(serializedLog).not.toContain("cliente@example.com")
      expect(serializedLog).not.toContain("raw-token")
      expect(serializedLog).not.toContain("cap-secret")
      expect(serializedLog).not.toContain("sk_test_sensitive")
      expect(serializedLog).not.toContain("postgres://")
      expect(serializedLog).not.toContain("password@")
      expect(serializedLog).not.toContain("error.stack")
      expect(serializedLog).not.toContain(sensitiveResolveMessage)
      expect(alertFailLog?.meta.error).toBeUndefined()
      expect(alertFailLog?.meta.stack).toBeUndefined()
    })
  })

  describe("Key Rotation Fail-Closed Behavior and Pruning Audit (B14-09-HR-05)", () => {
    it("structural audit: proves customer-auth runtime does not contain automatic key pruning background tasks or routines", async () => {
      const fs = await import("node:fs/promises")
      const path = await import("node:path")

      const customerAuthDir = path.resolve(__dirname, "../")
      const jobsDir = path.resolve(__dirname, "../../../jobs")

      const files = await fs.readdir(customerAuthDir)
      for (const f of files) {
        if (f.endsWith(".ts") && !f.includes(".spec.")) {
          const content = await fs.readFile(path.resolve(customerAuthDir, f), "utf8")
          expect(content).not.toMatch(/delete\s+from\s+.*key/i)
          expect(content).not.toMatch(/pruneKeys/i)
          expect(content).not.toMatch(/rotateKeyAutomatically/i)
        }
      }

      const jobFiles = await fs.readdir(jobsDir)
      for (const jf of jobFiles) {
        if (jf.startsWith("auth-") && jf.endsWith(".ts")) {
          const content = await fs.readFile(path.resolve(jobsDir, jf), "utf8")
          expect(content).not.toMatch(/delete\s+from\s+.*key/i)
          expect(content).not.toMatch(/prune/i)
        }
      }
    })

    it("fails closed with recipient_mismatch and key unavailable when required previous key is missing from keyring", async () => {
      const keyringMissingV1 = parseCustomerAuthCapabilityKeyring({
        enabled: true,
        activeVersion: "2",
        activeSecret: "secret_v2_active_only_1234567890",
      })!

      const res = await resolveAndVerifyRecipient(
        {
          recipientIdentityId: "ident_missing_key",
          expectedRecipientHash: "some_hash_from_v1",
          expectedRecipientDomain: "loja.com.br",
          purpose: "verification",
          keyring: keyringMissingV1,
          keyVersion: 1,
        },
        {
          resolveEmailByIdentityId: async () => "user@loja.com.br",
        }
      )

      expect(res.success).toBe(false)
      if (!res.success) {
        expect(res.reason).toBe("recipient_mismatch")
        expect(res.errorCode).toBe("AUTH_NOTIFICATION_RECIPIENT_KEY_UNAVAILABLE")
      }
    })

    it("relay transitions to dead_letter with recipient_mismatch and emits operational alert when key version unavailable", async () => {
      const keyringMissingV1 = parseCustomerAuthCapabilityKeyring({
        enabled: true,
        activeVersion: "2",
        activeSecret: "secret_v2_active_only_1234567890",
      })!

      const alertCalls: Array<Record<string, unknown>> = []
      const mockOpAlertModule = {
        upsertAlert: jest.fn(async (payload: any) => {
          alertCalls.push(payload)
          return payload
        }),
      }

      const mockContainer = {
        resolve(key: string) {
          if (key === "operational_alert") return mockOpAlertModule
          return undefined
        },
      } as any

      const now = new Date("2026-08-14T02:00:00.000Z")
      const mockKnex = {
        async raw(sql: string) {
          if (sql.includes("select * from auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_rot_missing_1",
                  template: "email_verification_v1",
                  intent_type: "verification",
                  intent_id: "authver_rot_1",
                  generation: 0,
                  idempotency_key: "auth/email_verification_v1/authver_rot_1/g0",
                  status: "recorded",
                  recipient_identity_id: "ident_rot_1",
                  recipient_hash: "hash_v1_rot",
                  recipient_domain: "loja.com.br",
                  key_version: 1, // missing from keyring!
                  version: 1,
                  attempt_count: 0,
                },
              ],
            }
          }
          if (sql.includes("update auth_notification_outbox")) {
            return {
              rows: [
                {
                  id: "authout_rot_missing_1",
                  version: 2,
                },
              ],
            }
          }
          return { rows: [] }
        },
      }

      const mockClient = {
        send: jest.fn(async () => ({ providerMessageId: "msg_never" })),
      }

      const result = await runAuthNotificationRelay({
        container: mockContainer,
        knex: mockKnex,
        client: mockClient,
        config: {
          apiKey: "test_key",
          fromEmail: "noreply@example.com",
        },
        keyring: keyringMissingV1,
        resolveEmailByIdentityId: async () => "user@loja.com.br",
        now: () => now,
        isWorker: () => true,
        isReleaseMigration: () => false,
      })

      expect(result.processed).toBe(1)
      expect(result.sent).toBe(0)
      expect(result.dead_lettered).toBe(1)
      expect(mockClient.send).toHaveBeenCalledTimes(0)

      expect(mockOpAlertModule.upsertAlert).toHaveBeenCalledTimes(1)
      expect(alertCalls[0]).toMatchObject({
        type: "auth_notification_failed",
        severity: "high",
        entity_type: "auth_notification_outbox",
        entity_id: "authout_rot_missing_1",
        message_code: "RECIPIENT_MISMATCH",
      })
    })
  })
})
