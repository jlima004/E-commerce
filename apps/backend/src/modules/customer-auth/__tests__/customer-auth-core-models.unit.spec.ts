import fs from "node:fs"
import path from "node:path"

type ParsedField = {
  dataType: {
    name: string
    options?: {
      choices?: string[]
    }
  }
  nullable: boolean
  defaultValue?: unknown
}

type ParsedModel = {
  tableName: string
  schema: Record<string, { parse: (fieldName: string) => ParsedField }>
  indexes: Array<{
    name?: string
    on: string[]
    unique?: boolean
    where?: string
  }>
  checks: Array<{
    name: string
    expression: (columns: Record<string, string>) => string
  }>
}

const moduleRoot = path.join(__dirname, "..")

function modelPath(fileName: string): string {
  return path.join(moduleRoot, "models", fileName)
}

function parseModel(fileName: string): ParsedModel {
  const target = modelPath(fileName)
  expect(fs.existsSync(target)).toBe(true)

  return require(target).default.parse() as ParsedModel
}

function parsedField(model: ParsedModel, fieldName: string): ParsedField {
  expect(model.schema[fieldName]).toBeDefined()
  return model.schema[fieldName].parse(fieldName)
}

function fieldNames(model: ParsedModel): string[] {
  return Object.keys(model.schema)
}

function enumChoices(model: ParsedModel, fieldName: string): string[] {
  const field = parsedField(model, fieldName)
  expect(field.dataType.name).toBe("enum")
  return field.dataType.options?.choices ?? []
}

function renderedChecks(model: ParsedModel): Map<string, string> {
  const columns = Object.fromEntries(
    fieldNames(model).map((fieldName) => [fieldName, fieldName])
  )

  return new Map(
    model.checks.map((check) => [
      check.name,
      check.expression(columns).replace(/\s+/g, " ").trim(),
    ])
  )
}

function expectNoPlaintextCredentialFields(model: ParsedModel): void {
  expect(fieldNames(model)).not.toEqual(
    expect.arrayContaining([
      "password",
      "current_password",
      "new_password",
      "fingerprint",
      "capability",
      "token",
      "email",
    ])
  )
}

describe("RegistrationIntent model contract", () => {
  it("defines the approved states, CAS version and 24h coordinator fields", () => {
    const model = parseModel("registration-intent.ts")

    expect(model.tableName).toBe("registration_intent")
    expect(enumChoices(model, "status")).toEqual([
      "pending_identity",
      "pending_customer",
      "completed",
      "expired",
      "failed_reconcilable",
    ])
    expect(parsedField(model, "status").defaultValue).toBe("pending_identity")
    expect(parsedField(model, "version").defaultValue).toBe(1)
    expect(fieldNames(model)).toEqual(
      expect.arrayContaining([
        "normalized_email_hash",
        "semantic_payload_hmac",
        "payload_key_version",
        "auth_identity_id",
        "customer_id",
        "expires_at",
        "completed_at",
        "schema_version",
      ])
    )
  })

  it("declares one active normalized hash and the approved lookup indexes", () => {
    const model = parseModel("registration-intent.ts")

    expect(model.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UQ_registration_intent_active_email_hash",
          on: ["normalized_email_hash"],
          unique: true,
          where: expect.stringMatching(
            /pending_identity.*pending_customer.*failed_reconcilable/i
          ),
        }),
        expect.objectContaining({
          name: "IDX_registration_intent_status_expires_at",
          on: ["status", "expires_at"],
        }),
        expect.objectContaining({
          name: "IDX_registration_intent_auth_identity_id",
          on: ["auth_identity_id"],
        }),
        expect.objectContaining({
          name: "IDX_registration_intent_customer_id",
          on: ["customer_id"],
        }),
      ])
    )
  })

  it("declares positive versions, finite TTL and completed-state prerequisites", () => {
    const checks = renderedChecks(parseModel("registration-intent.ts"))

    expect(checks.get("registration_intent_version_positive")).toContain(
      "version >= 1"
    )
    expect(checks.get("registration_intent_expiry_after_creation")).toContain(
      "expires_at > created_at"
    )
    expect(checks.get("registration_intent_completed_requirements")).toMatch(
      /status.*completed.*auth_identity_id.*customer_id.*completed_at/i
    )
  })

  it("stores only normalized/HMAC evidence and no credential plaintext", () => {
    const model = parseModel("registration-intent.ts")

    expectNoPlaintextCredentialFields(model)
    expect(fieldNames(model)).not.toEqual(
      expect.arrayContaining(["normalized_email", "payload", "metadata"])
    )
  })
})

describe("AuthCredentialState model contract", () => {
  it("defines identity/customer ownership and the closed operation state machine", () => {
    const model = parseModel("auth-credential-state.ts")

    expect(model.tableName).toBe("auth_credential_state")
    expect(enumChoices(model, "operation_type")).toEqual([
      "reset",
      "password_change",
    ])
    expect(enumChoices(model, "operation_status")).toEqual([
      "stable",
      "claimed",
      "provider_outcome_ambiguous",
      "credential_proved",
      "credential_updated",
      "revocation_pending",
      "revocation_committed",
      "completed",
    ])
    expect(parsedField(model, "credential_version").defaultValue).toBe(1)
    expect(parsedField(model, "operation_version").defaultValue).toBe(0)
    expect(fieldNames(model)).toEqual(
      expect.arrayContaining([
        "auth_identity_id",
        "customer_id",
        "email_verified_at",
        "operation_id",
        "lease_owner",
        "lease_until",
        "attempt_count",
        "next_retry_at",
        "provider_proved_at",
        "credential_updated_at",
        "revocation_committed_at",
        "completed_at",
      ])
    )
  })

  it("declares identity/operation uniqueness and due-recovery indexes", () => {
    const model = parseModel("auth-credential-state.ts")

    expect(model.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UQ_auth_credential_state_identity",
          on: ["auth_identity_id"],
          unique: true,
        }),
        expect.objectContaining({
          name: "UQ_auth_credential_state_operation_id",
          on: ["operation_id"],
          unique: true,
          where: expect.stringMatching(/operation_id IS NOT NULL/i),
        }),
        expect.objectContaining({
          name: "IDX_auth_credential_state_due_operation",
          on: ["operation_status", "next_retry_at"],
        }),
        expect.objectContaining({
          name: "IDX_auth_credential_state_lease_until",
          on: ["lease_until"],
        }),
      ])
    )
  })

  it("rejects non-positive versions, incomplete leases and partial completion", () => {
    const checks = renderedChecks(parseModel("auth-credential-state.ts"))

    expect(checks.get("auth_credential_state_versions_valid")).toMatch(
      /version >= 1.*credential_version >= 1.*operation_version >= 0/i
    )
    expect(checks.get("auth_credential_state_lease_pair")).toMatch(
      /lease_owner IS NULL.*lease_until IS NULL.*lease_owner IS NOT NULL.*lease_until IS NOT NULL/i
    )
    expect(checks.get("auth_credential_state_completion_order")).toMatch(
      /completed_at.*provider_proved_at.*credential_updated_at.*revocation_committed_at/i
    )
  })

  it("keeps password, fingerprint and capability material outside persistence", () => {
    expectNoPlaintextCredentialFields(parseModel("auth-credential-state.ts"))
  })
})

describe("AuthSessionLineage model contract", () => {
  it("defines a closed lifecycle, closed revocation reasons and credential snapshot", () => {
    const model = parseModel("auth-session-lineage.ts")

    expect(model.tableName).toBe("auth_session_lineage")
    expect(enumChoices(model, "status")).toEqual([
      "active",
      "revoked",
      "expired",
    ])
    expect(enumChoices(model, "revocation_reason")).toEqual([
      "logout",
      "refresh_replay",
      "password_reset",
      "password_change",
      "security_revocation",
    ])
    expect(parsedField(model, "status").defaultValue).toBe("active")
    expect(parsedField(model, "version").defaultValue).toBe(1)
    expect(fieldNames(model)).toEqual(
      expect.arrayContaining([
        "sid",
        "auth_identity_id",
        "customer_id",
        "credential_version_snapshot",
        "original_authenticated_at",
        "absolute_expires_at",
        "revoked_at",
        "revocation_reason",
        "expired_at",
      ])
    )
  })

  it("declares unique sid and authoritative lineage lookup indexes", () => {
    const model = parseModel("auth-session-lineage.ts")

    expect(model.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UQ_auth_session_lineage_sid",
          on: ["sid"],
          unique: true,
        }),
        expect.objectContaining({
          name: "IDX_auth_session_lineage_identity_status",
          on: ["auth_identity_id", "status"],
        }),
        expect.objectContaining({
          name: "IDX_auth_session_lineage_customer_status",
          on: ["customer_id", "status"],
        }),
        expect.objectContaining({
          name: "IDX_auth_session_lineage_absolute_expires_at",
          on: ["absolute_expires_at"],
        }),
      ])
    )
  })

  it("pins the original absolute deadline to 30d and keeps terminal markers coherent", () => {
    const checks = renderedChecks(parseModel("auth-session-lineage.ts"))

    expect(checks.get("auth_session_lineage_versions_positive")).toMatch(
      /version >= 1.*credential_version_snapshot >= 1/i
    )
    expect(checks.get("auth_session_lineage_absolute_deadline")).toMatch(
      /absolute_expires_at = original_authenticated_at \+ INTERVAL '30 days'/i
    )
    expect(checks.get("auth_session_lineage_revocation_state")).toMatch(
      /status.*revoked.*revoked_at.*revocation_reason/i
    )
    expect(checks.get("auth_session_lineage_expiry_state")).toMatch(
      /status.*expired.*expired_at/i
    )
  })

  it("persists no session credential or capability plaintext", () => {
    const model = parseModel("auth-session-lineage.ts")

    expectNoPlaintextCredentialFields(model)
    expect(fieldNames(model)).not.toEqual(
      expect.arrayContaining(["access_token", "refresh_token", "idempotency_key"])
    )
  })
})

describe("AuthRefreshCredential model contract", () => {
  it("defines hash-only single-use rotation and lost-response recovery fields", () => {
    const model = parseModel("auth-refresh-credential.ts")

    expect(model.tableName).toBe("auth_refresh_credential")
    expect(enumChoices(model, "status")).toEqual([
      "active",
      "consumed",
      "replayed",
      "revoked",
    ])
    expect(parsedField(model, "status").defaultValue).toBe("active")
    expect(parsedField(model, "generation").defaultValue).toBe(0)
    expect(fieldNames(model)).toEqual(
      expect.arrayContaining([
        "lineage_id",
        "token_hash",
        "generation",
        "replacement_id",
        "request_key_hash",
        "nonce",
        "key_version",
        "expires_at",
        "consumed_at",
        "recovery_until",
        "replacement_used_at",
        "replayed_at",
        "revoked_at",
      ])
    )
  })

  it("declares unique hash/generation and at most one active per lineage", () => {
    const model = parseModel("auth-refresh-credential.ts")

    expect(model.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UQ_auth_refresh_credential_token_hash",
          on: ["token_hash"],
          unique: true,
        }),
        expect.objectContaining({
          name: "UQ_auth_refresh_credential_lineage_generation",
          on: ["lineage_id", "generation"],
          unique: true,
        }),
        expect.objectContaining({
          name: "UQ_auth_refresh_credential_active_lineage",
          on: ["lineage_id"],
          unique: true,
          where: expect.stringMatching(/status = 'active'/i),
        }),
        expect.objectContaining({
          name: "IDX_auth_refresh_credential_status_expires_at",
          on: ["status", "expires_at"],
        }),
      ])
    )
  })

  it("requires non-negative generation and an exact 45s consumed recovery window", () => {
    const checks = renderedChecks(parseModel("auth-refresh-credential.ts"))

    expect(checks.get("auth_refresh_credential_generation_valid")).toContain(
      "generation >= 0"
    )
    expect(checks.get("auth_refresh_credential_expiry_after_creation")).toContain(
      "expires_at > created_at"
    )
    expect(checks.get("auth_refresh_credential_consumed_recovery")).toMatch(
      /consumed_at.*replacement_id.*request_key_hash.*recovery_until = consumed_at \+ INTERVAL '45 seconds'/i
    )
  })

  it("stores hashes/nonces only and no refresh capability or request key", () => {
    const model = parseModel("auth-refresh-credential.ts")

    expectNoPlaintextCredentialFields(model)
    expect(fieldNames(model)).not.toEqual(
      expect.arrayContaining([
        "refresh_token",
        "refresh_capability",
        "idempotency_key",
        "request_key",
      ])
    )
  })
})
