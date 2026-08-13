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

function expectNoPlaintextCapabilityFields(model: ParsedModel): void {
  expect(fieldNames(model)).not.toEqual(
    expect.arrayContaining([
      "email",
      "recipient",
      "password",
      "current_password",
      "new_password",
      "capability",
      "token",
      "code",
      "body",
      "payload",
      "metadata",
      "idempotency_key_plaintext",
    ])
  )
}

describe("AuthVerificationIntent model contract", () => {
  it("defines the approved latest-wins states and 30 minute expiry", () => {
    const model = parseModel("auth-verification-intent.ts")

    expect(model.tableName).toBe("auth_verification_intent")
    expect(enumChoices(model, "status")).toEqual([
      "pending",
      "claimed",
      "confirmed",
      "superseded",
      "expired",
      "dead_letter",
    ])
    expect(parsedField(model, "status").defaultValue).toBe("pending")
    expect(parsedField(model, "generation").defaultValue).toBe(0)
    expect(parsedField(model, "version").defaultValue).toBe(1)
    expect(fieldNames(model)).toEqual(
      expect.arrayContaining([
        "auth_identity_id",
        "token_hash",
        "nonce",
        "key_version",
        "generation",
        "expires_at",
        "claimed_at",
        "confirmed_at",
        "superseded_at",
        "expired_at",
        "dead_lettered_at",
        "schema_version",
      ])
    )

    expect(
      renderedChecks(model).get("auth_verification_intent_exact_ttl")
    ).toMatch(/expires_at = created_at \+ INTERVAL '30 minutes'/i)
  })

  it("declares unique hash/generation and at most one pending or claimed intent", () => {
    const model = parseModel("auth-verification-intent.ts")

    expect(model.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UQ_auth_verification_intent_token_hash",
          on: ["token_hash"],
          unique: true,
        }),
        expect.objectContaining({
          name: "UQ_auth_verification_intent_identity_generation",
          on: ["auth_identity_id", "generation"],
          unique: true,
        }),
        expect.objectContaining({
          name: "UQ_auth_verification_intent_active_identity",
          on: ["auth_identity_id"],
          unique: true,
          where: expect.stringMatching(/pending.*claimed/i),
        }),
        expect.objectContaining({
          name: "IDX_auth_verification_intent_status_expires_at",
          on: ["status", "expires_at"],
        }),
      ])
    )
  })

  it("keeps terminal markers conditional and capability plaintext impossible", () => {
    const model = parseModel("auth-verification-intent.ts")
    const checks = renderedChecks(model)

    expect(checks.get("auth_verification_intent_state_markers")).toMatch(
      /status.*claimed.*claimed_at.*confirmed.*confirmed_at.*superseded.*superseded_at.*expired.*expired_at.*dead_letter.*dead_lettered_at/i
    )
    expectNoPlaintextCapabilityFields(model)
  })
})

describe("AuthResetIntent model contract", () => {
  it("defines the approved composed reset states and 15 minute expiry", () => {
    const model = parseModel("auth-reset-intent.ts")

    expect(model.tableName).toBe("auth_reset_intent")
    expect(enumChoices(model, "status")).toEqual([
      "pending",
      "claimed",
      "credential_updated",
      "revocation_committed",
      "completed",
      "superseded",
      "expired",
      "failed_reconcilable",
    ])
    expect(parsedField(model, "status").defaultValue).toBe("pending")
    expect(parsedField(model, "generation").defaultValue).toBe(0)
    expect(parsedField(model, "version").defaultValue).toBe(1)
    expect(parsedField(model, "attempt_count").defaultValue).toBe(0)
    expect(fieldNames(model)).toEqual(
      expect.arrayContaining([
        "auth_identity_id",
        "token_hash",
        "nonce",
        "key_version",
        "generation",
        "operation_id",
        "lease_owner",
        "lease_until",
        "attempt_count",
        "next_retry_at",
        "expires_at",
        "claimed_at",
        "provider_proved_at",
        "credential_updated_at",
        "revocation_committed_at",
        "completed_at",
        "superseded_at",
        "expired_at",
        "failed_reconcilable_at",
        "schema_version",
      ])
    )

    expect(renderedChecks(model).get("auth_reset_intent_exact_ttl")).toMatch(
      /expires_at = created_at \+ INTERVAL '15 minutes'/i
    )
  })

  it("declares one active reset, unique hash/generation and unique operation", () => {
    const model = parseModel("auth-reset-intent.ts")

    expect(model.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "UQ_auth_reset_intent_token_hash",
          on: ["token_hash"],
          unique: true,
        }),
        expect.objectContaining({
          name: "UQ_auth_reset_intent_identity_generation",
          on: ["auth_identity_id", "generation"],
          unique: true,
        }),
        expect.objectContaining({
          name: "UQ_auth_reset_intent_operation_id",
          on: ["operation_id"],
          unique: true,
          where: expect.stringMatching(/operation_id IS NOT NULL/i),
        }),
        expect.objectContaining({
          name: "UQ_auth_reset_intent_active_identity",
          on: ["auth_identity_id"],
          unique: true,
          where: expect.stringMatching(/pending.*claimed.*credential_updated/i),
        }),
        expect.objectContaining({
          name: "IDX_auth_reset_intent_status_next_retry_at",
          on: ["status", "next_retry_at"],
        }),
      ])
    )
  })

  it("requires claim, provider proof, credential update and revocation before completion", () => {
    const checks = renderedChecks(parseModel("auth-reset-intent.ts"))

    expect(checks.get("auth_reset_intent_completion_order")).toMatch(
      /completed_at.*claimed_at.*provider_proved_at.*credential_updated_at.*revocation_committed_at/i
    )
    expect(checks.get("auth_reset_intent_completed_status")).toMatch(
      /status.*completed.*completed_at/i
    )
    expect(checks.get("auth_reset_intent_lease_pair")).toMatch(
      /lease_owner IS NULL.*lease_until IS NULL.*lease_owner IS NOT NULL.*lease_until IS NOT NULL/i
    )
  })

  it("keeps token, password, email and Idempotency-Key plaintext out of persistence", () => {
    const model = parseModel("auth-reset-intent.ts")

    expectNoPlaintextCapabilityFields(model)
    expect(fieldNames(model)).not.toEqual(
      expect.arrayContaining(["idempotency_key", "operation_key", "request_body"])
    )
  })
})
