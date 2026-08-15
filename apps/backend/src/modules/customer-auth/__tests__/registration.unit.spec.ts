import { createHash } from "node:crypto"
import {
  coordinateCustomerRegistration,
  deriveRegistrationSemanticPayloadHmac,
  REGISTRATION_FAULT_POINTS,
  type CustomerRegistrationRequest,
  type RegistrationAuth,
  type RegistrationAuthIdentity,
  type RegistrationCustomer,
  type RegistrationCustomerRecord,
  type RegistrationDatabase,
  type RegistrationIntentClaimResult,
  type RegistrationIntentRecord,
  type RegistrationSession,
  type RegistrationSessionService,
  type RegistrationTransaction,
  type RegistrationVerification,
  type RegistrationVerificationResult,
} from "../registration"
import type { AuthSessionEnvelope } from "../session"

const BASE = new Date("2026-08-15T03:00:00.000Z")
const KEYRING = {
  active: { version: 1, secret: "registration-unit-key".repeat(5) },
  previous: [],
} as const
const JWT_SECRET = "registration-unit-jwt-secret".repeat(3)

type MemoryCredential = {
  id: string
  auth_identity_id: string
  customer_id: string
  credential_version: number
}

type MemoryState = {
  intents: RegistrationIntentRecord[]
  credentials: MemoryCredential[]
  nextIntent: number
  nextCredential: number
}

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value.getTime()) : null
}

function cloneIntent(intent: RegistrationIntentRecord): RegistrationIntentRecord {
  return {
    ...intent,
    expires_at: new Date(intent.expires_at.getTime()),
    completed_at: cloneDate(intent.completed_at),
    created_at: new Date(intent.created_at.getTime()),
    updated_at: new Date(intent.updated_at.getTime()),
  }
}

function cloneState(state: MemoryState): MemoryState {
  return {
    intents: state.intents.map(cloneIntent),
    credentials: state.credentials.map((credential) => ({ ...credential })),
    nextIntent: state.nextIntent,
    nextCredential: state.nextCredential,
  }
}

class MemoryRegistrationDatabase implements RegistrationDatabase {
  state: MemoryState = {
    intents: [],
    credentials: [],
    nextIntent: 1,
    nextCredential: 1,
  }

  private queue = Promise.resolve()

  async transaction<T>(
    callback: (transaction: RegistrationTransaction) => Promise<T>
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const working = cloneState(this.state)
      const transaction: RegistrationTransaction = {
        claimOrCreateIntent: async (input) => {
          const existing = working.intents
            .filter(
              (intent) =>
                intent.normalized_email_hash === input.normalizedEmailHash &&
                intent.status !== "expired"
            )
            .sort(
              (left, right) =>
                right.created_at.getTime() - left.created_at.getTime()
            )[0]

          if (existing && existing.expires_at.getTime() <= input.now.getTime()) {
            existing.status = "expired"
            existing.version += 1
            existing.updated_at = new Date(input.now.getTime())
            this.assertState(existing)
            return {
              created: false,
              expired: true,
              intent: cloneIntent(existing),
            }
          }

          if (existing) {
            return {
              created: false,
              expired: false,
              intent: cloneIntent(existing),
            }
          }

          const createdAt = new Date(input.now.getTime())
          const intent: RegistrationIntentRecord = {
            id: `regint_unit_${working.nextIntent++}`,
            normalized_email_hash: input.normalizedEmailHash,
            semantic_payload_hmac: input.semanticPayloadHmac,
            payload_key_version: input.payloadKeyVersion,
            auth_identity_id: null,
            customer_id: null,
            status: "pending_identity",
            version: 1,
            expires_at: new Date(input.expiresAt.getTime()),
            completed_at: null,
            schema_version: 1,
            created_at: createdAt,
            updated_at: createdAt,
          }
          working.intents.push(intent)
          this.assertState(intent)
          return {
            created: true,
            expired: false,
            intent: cloneIntent(intent),
          }
        },

        transitionIntent: async (input) => {
          const intent = working.intents.find(
            (candidate) => candidate.id === input.id
          )
          if (!intent || intent.version !== input.expectedVersion) {
            throw new Error("REGISTRATION_INTENT_CAS_REJECTED")
          }

          intent.status = input.status
          intent.auth_identity_id = input.authIdentityId
          intent.customer_id = input.customerId
          intent.completed_at = input.completedAt
          intent.version += 1
          intent.updated_at = new Date(input.at.getTime())
          this.assertState(intent)
          return cloneIntent(intent)
        },

        ensureCredentialState: async (input) => {
          const existing = working.credentials.find(
            (credential) =>
              credential.auth_identity_id === input.authIdentityId
          )
          if (existing) {
            if (existing.customer_id !== input.customerId) {
              throw new Error("REGISTRATION_CREDENTIAL_CUSTOMER_MISMATCH")
            }
            return { ...existing }
          }

          const credential: MemoryCredential = {
            id: `authcred_unit_${working.nextCredential++}`,
            auth_identity_id: input.authIdentityId,
            customer_id: input.customerId,
            credential_version: 1,
          }
          working.credentials.push(credential)
          return { ...credential }
        },
      }

      const result = await callback(transaction)
      this.state = working
      return result
    })

    this.queue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private assertState(intent: RegistrationIntentRecord): void {
    if (
      intent.status === "pending_identity" &&
      (intent.auth_identity_id !== null || intent.customer_id !== null)
    ) {
      throw new Error("REGISTRATION_MEMORY_STATE_INVALID")
    }
    if (
      intent.status === "pending_customer" &&
      (!intent.auth_identity_id || intent.customer_id !== null)
    ) {
      throw new Error("REGISTRATION_MEMORY_STATE_INVALID")
    }
    if (
      intent.status === "completed" &&
      (!intent.auth_identity_id ||
        !intent.customer_id ||
        intent.completed_at === null)
    ) {
      throw new Error("REGISTRATION_MEMORY_STATE_INVALID")
    }
    if (intent.customer_id && !intent.auth_identity_id) {
      throw new Error("REGISTRATION_MEMORY_STATE_INVALID")
    }
  }

  activeIntent(): RegistrationIntentRecord | undefined {
    return this.state.intents.find(
      (intent) => intent.status !== "expired"
    )
  }

  completedIntents(): RegistrationIntentRecord[] {
    return this.state.intents.filter((intent) => intent.status === "completed")
  }
}

type MemoryIdentity = RegistrationAuthIdentity & {
  email: string
  password: string
}

type RegistrationHarness = {
  database: MemoryRegistrationDatabase
  auth: RegistrationAuth & {
    registerCalls: number
    authenticateCalls: number
  }
  customer: RegistrationCustomer & {
    createCalls: number
    findCalls: number
    customers: Map<string, RegistrationCustomerRecord>
  }
  session: RegistrationSessionService & {
    issueCalls: number
    recoverCalls: number
    sessions: Map<string, RegistrationSession>
  }
  verification: RegistrationVerification & {
    calls: number
    results: RegistrationVerificationResult[]
  }
  commerce: {
    order: number
    payment: number
    stripe: number
    gelato: number
    cart: number
    checkout: number
    fulfillment: number
  }
  identity: MemoryIdentity | null
}

function sessionEnvelope(
  authIdentityId: string,
  customerId: string,
  lineageId: string
): AuthSessionEnvelope {
  const originalAuthenticatedAt = new Date(BASE.getTime())
  const absoluteExpiresAt = new Date(
    BASE.getTime() + 30 * 24 * 60 * 60 * 1000
  )
  return {
    accessToken: `access_${lineageId}`,
    accessExpiresAt: new Date(BASE.getTime() + 10 * 60 * 1000),
    refreshToken: `refresh_${lineageId}`,
    refreshExpiresAt: new Date(BASE.getTime() + 7 * 24 * 60 * 60 * 1000),
    originalAuthenticatedAt,
    absoluteExpiresAt,
    lineageId,
    refreshCredentialId: `refresh_credential_${lineageId}`,
    sid: `sid_${lineageId}`,
    generation: 0,
    authIdentityId,
    customerId,
    credentialVersion: 1,
    rotation: "initial",
  }
}

function request(
  overrides: Partial<CustomerRegistrationRequest> = {}
): CustomerRegistrationRequest {
  return {
    email: "  Alice@Example.com ",
    password: "correct-password",
    customerData: {
      first_name: "Alice",
      last_name: "Example",
    },
    keyring: KEYRING,
    jwtSecret: JWT_SECRET,
    now: BASE,
    ...overrides,
  }
}

function createHarness(): RegistrationHarness {
  const database = new MemoryRegistrationDatabase()
  let identity: MemoryIdentity | null = null
  const customers = new Map<string, RegistrationCustomerRecord>()
  const sessions = new Map<string, RegistrationSession>()
  const verificationResults: RegistrationVerificationResult[] = []
  let registerCalls = 0
  let authenticateCalls = 0
  let createCalls = 0
  let findCalls = 0
  let issueCalls = 0
  let recoverCalls = 0
  let verificationCalls = 0

  const auth: RegistrationHarness["auth"] = {
    registerCalls: 0,
    authenticateCalls: 0,
    async findIdentity() {
      return identity
    },
    async register(input) {
      registerCalls += 1
      auth.registerCalls = registerCalls
      if (!identity) {
        identity = {
          id: "auth_identity_unit_1",
          email: input.email,
          password: input.password,
          app_metadata: {},
        }
      }
      return { ...identity }
    },
    async authenticate(input) {
      authenticateCalls += 1
      auth.authenticateCalls = authenticateCalls
      if (!identity || identity.password !== input.password) {
        return null
      }
      return { ...identity }
    },
  }

  const customer: RegistrationHarness["customer"] = {
    createCalls: 0,
    findCalls: 0,
    customers,
    async find() {
      findCalls += 1
      customer.findCalls = findCalls
      if (!identity?.app_metadata?.customer_id) {
        return null
      }
      return customers.get(String(identity.app_metadata.customer_id)) ?? null
    },
    async create(input) {
      createCalls += 1
      customer.createCalls = createCalls
      const record = {
        id: "customer_unit_1",
        email: input.normalizedEmail,
        first_name: input.customerData.first_name,
        last_name: input.customerData.last_name,
      }
      customers.set(record.id, record)
      if (identity) {
        identity.app_metadata = {
          ...(identity.app_metadata ?? {}),
          customer_id: record.id,
        }
      }
      return record
    },
  }

  const session: RegistrationHarness["session"] = {
    issueCalls: 0,
    recoverCalls: 0,
    sessions,
    async findInitial(input) {
      recoverCalls += 1
      session.recoverCalls = recoverCalls
      return sessions.get(input.authIdentityId) ?? null
    },
    async issueInitial(input) {
      issueCalls += 1
      session.issueCalls = issueCalls
      const result = sessionEnvelope(
        input.authIdentityId,
        input.customerId,
        `lineage_unit_${issueCalls}`
      )
      sessions.set(input.authIdentityId, result)
      return result
    },
  }

  const verification: RegistrationHarness["verification"] = {
    calls: 0,
    results: verificationResults,
    async autoRequest(input) {
      verificationCalls += 1
      verification.calls = verificationCalls
      const existing = verificationResults[0]
      if (existing) {
        return existing
      }
      const result = {
        state: "pending" as const,
        intentId: "authver_unit_1",
        outboxId: "authout_unit_1",
      }
      verificationResults.push(result)
      return result
    },
  }

  return {
    database,
    auth,
    customer,
    session,
    verification,
    commerce: {
      order: 0,
      payment: 0,
      stripe: 0,
      gelato: 0,
      cart: 0,
      checkout: 0,
      fulfillment: 0,
    },
    identity,
  }
}

async function run(
  harness: RegistrationHarness,
  overrides: Partial<CustomerRegistrationRequest> = {},
  extra: Partial<Parameters<typeof coordinateCustomerRegistration>[0]> = {}
) {
  const result = await coordinateCustomerRegistration({
    request: request(overrides),
    database: harness.database,
    auth: harness.auth,
    customer: harness.customer,
    session: harness.session,
    verification: harness.verification,
    idFactory: (prefix) => `${prefix}_unit_fixed`,
    ...extra,
  })
  harness.identity = harness.identity
  return result
}

function faultOnce(
  point: (typeof REGISTRATION_FAULT_POINTS)[keyof typeof REGISTRATION_FAULT_POINTS]
) {
  let armed = true
  return {
    fire(candidate: string) {
      const fired = armed && candidate === point
      if (fired) {
        armed = false
      }
      return { fired }
    },
  }
}

function stateDigest(harness: RegistrationHarness): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        intents: harness.database.state.intents,
        credentials: harness.database.state.credentials,
        registerCalls: harness.auth.registerCalls,
        authenticateCalls: harness.auth.authenticateCalls,
        createCalls: harness.customer.createCalls,
        issueCalls: harness.session.issueCalls,
        verificationCalls: harness.verification.calls,
      })
    )
    .digest("hex")
}

describe("customer registration coordinator", () => {
  it("creates one identity, one Customer, one lineage, and verification/outbox artifacts", async () => {
    const harness = createHarness()

    const result = await run(harness)

    expect(result.status).toBe("completed")
    expect(result.authIdentityId).toBe("auth_identity_unit_1")
    expect(result.customerId).toBe("customer_unit_1")
    expect(result.session.lineageId).toBe("lineage_unit_1")
    expect(result.verification).toEqual({
      state: "pending",
      intentId: "authver_unit_1",
      outboxId: "authout_unit_1",
    })
    expect(harness.database.completedIntents()).toHaveLength(1)
    expect(harness.database.state.credentials).toHaveLength(1)
    expect(harness.customer.createCalls).toBe(1)
    expect(harness.session.issueCalls).toBe(1)
    expect(harness.verification.calls).toBe(1)
    expect(harness.commerce).toEqual({
      order: 0,
      payment: 0,
      stripe: 0,
      gelato: 0,
      cart: 0,
      checkout: 0,
      fulfillment: 0,
    })
  })

  it("keeps the semantic HMAC independent from password material", () => {
    const first = deriveRegistrationSemanticPayloadHmac({
      keyring: KEYRING,
      normalizedEmail: "alice@example.com",
      customerData: request().customerData,
    })
    const second = deriveRegistrationSemanticPayloadHmac({
      keyring: KEYRING,
      normalizedEmail: "alice@example.com",
      customerData: request({ password: "a-different-password" }).customerData,
    })

    expect(first.hmac).toBe(second.hmac)
    expect(first.hmac).not.toContain("correct-password")
    expect(first.hmac).not.toContain("different-password")
  })

  it("recovers a compatible retry after identity creation without duplicating anything", async () => {
    const harness = createHarness()
    const fault = faultOnce(
      REGISTRATION_FAULT_POINTS.AFTER_IDENTITY_BEFORE_CUSTOMER
    )

    await expect(run(harness, {}, { faultInjector: fault })).rejects.toMatchObject(
      { code: "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED" }
    )
    const partial = harness.database.activeIntent()
    expect(partial?.status).toBe("pending_customer")
    const registerCalls = harness.auth.registerCalls

    const result = await run(harness)

    expect(result.status).toBe("completed")
    expect(result.authIdentityId).toBe(partial?.auth_identity_id)
    expect(harness.auth.registerCalls).toBe(registerCalls)
    expect(harness.customer.createCalls).toBe(1)
    expect(harness.database.completedIntents()).toHaveLength(1)
  })

  it("returns the canonical result for a compatible completed retry", async () => {
    const harness = createHarness()
    const first = await run(harness)
    const second = await run(harness)

    expect(second).toEqual(first)
    expect(harness.auth.registerCalls).toBe(1)
    expect(harness.customer.createCalls).toBe(1)
    expect(harness.session.issueCalls).toBe(1)
    expect(harness.database.completedIntents()).toHaveLength(1)
  })

  it("does zero writes on semantic mismatch and preserves the original intent", async () => {
    const harness = createHarness()
    const fault = faultOnce(
      REGISTRATION_FAULT_POINTS.AFTER_IDENTITY_BEFORE_CUSTOMER
    )
    await expect(run(harness, {}, { faultInjector: fault })).rejects.toMatchObject(
      { code: "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED" }
    )
    const before = stateDigest(harness)
    const original = harness.database.activeIntent()
    const registerCalls = harness.auth.registerCalls

    await expect(
      run(harness, {
        customerData: {
          first_name: "Alice",
          last_name: "Changed",
        },
      })
    ).rejects.toMatchObject({
      code: "CUSTOMER_REGISTRATION_SEMANTIC_MISMATCH",
    })

    expect(stateDigest(harness)).toBe(before)
    expect(harness.auth.registerCalls).toBe(registerCalls)
    expect(harness.database.activeIntent()).toEqual(original)
  })

  it("does zero writes on password mismatch and never overwrites the pending credential", async () => {
    const harness = createHarness()
    const fault = faultOnce(
      REGISTRATION_FAULT_POINTS.AFTER_IDENTITY_BEFORE_CUSTOMER
    )
    await expect(run(harness, {}, { faultInjector: fault })).rejects.toMatchObject(
      { code: "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED" }
    )
    const before = stateDigest(harness)
    const original = harness.identity?.password
    const registerCalls = harness.auth.registerCalls

    await expect(
      run(harness, { password: "wrong-password" })
    ).rejects.toMatchObject({
      code: "CUSTOMER_REGISTRATION_PASSWORD_MISMATCH",
    })

    expect(stateDigest(harness)).toBe(before)
    expect(harness.identity?.password).toBe(original)
    expect(harness.auth.registerCalls).toBe(registerCalls)
    expect(harness.database.activeIntent()).toMatchObject({
      status: "pending_customer",
      customer_id: null,
    })
  })

  it("fails closed for an expired intent and never reuses the old registration", async () => {
    const harness = createHarness()
    const fault = faultOnce(
      REGISTRATION_FAULT_POINTS.AFTER_IDENTITY_BEFORE_CUSTOMER
    )
    await expect(run(harness, {}, { faultInjector: fault })).rejects.toMatchObject(
      { code: "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED" }
    )
    const beforeRegisterCalls = harness.auth.registerCalls

    await expect(
      run(harness, {
        now: new Date(BASE.getTime() + 24 * 60 * 60 * 1000 + 1),
        password: "new-password",
      })
    ).rejects.toMatchObject({
      code: "CUSTOMER_REGISTRATION_EXPIRED",
    })

    expect(harness.auth.registerCalls).toBe(beforeRegisterCalls)
    expect(harness.customer.createCalls).toBe(0)
    expect(harness.database.activeIntent()).toBeUndefined()
    expect(
      harness.database.state.intents.filter(
        (intent) => intent.status === "expired"
      )
    ).toHaveLength(1)
    expect(harness.identity?.password).toBe("correct-password")
  })

  it.each([
    [
      "before identity",
      REGISTRATION_FAULT_POINTS.BEFORE_IDENTITY,
      "pending_identity",
    ],
    [
      "after identity",
      REGISTRATION_FAULT_POINTS.AFTER_IDENTITY_BEFORE_CUSTOMER,
      "pending_customer",
    ],
    [
      "after Customer",
      REGISTRATION_FAULT_POINTS.AFTER_CUSTOMER_BEFORE_LINEAGE,
      "failed_reconcilable",
    ],
    [
      "after lineage",
      REGISTRATION_FAULT_POINTS.AFTER_LINEAGE_BEFORE_VERIFICATION,
      "failed_reconcilable",
    ],
    [
      "after verification/outbox",
      REGISTRATION_FAULT_POINTS.AFTER_VERIFICATION_BEFORE_COMPLETION,
      "failed_reconcilable",
    ],
  ])(
    "recovers from the %s boundary without deleting canonical effects",
    async (_label, point, expectedStatus) => {
      const harness = createHarness()
      const fault = faultOnce(point)

      await expect(
        run(harness, {}, { faultInjector: fault })
      ).rejects.toMatchObject({
        code: "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED",
      })
      const firstIntent = harness.database.state.intents[0]
      expect(firstIntent?.status).toBe(expectedStatus)
      const firstIdentityId = firstIntent?.auth_identity_id
      const firstCustomerId = firstIntent?.customer_id
      const firstLineage = harness.session.sessions.get(
        "auth_identity_unit_1"
      )?.lineageId
      const firstVerificationCount = harness.verification.calls

      const result = await run(harness)

      expect(result.status).toBe("completed")
      expect(result.authIdentityId).toBe(firstIdentityId)
      expect(result.customerId).toBe(firstCustomerId ?? "customer_unit_1")
      expect(result.session.lineageId).toBe(
        firstLineage ?? "lineage_unit_1"
      )
      expect(harness.database.completedIntents()).toHaveLength(1)
      expect(harness.customer.createCalls).toBeLessThanOrEqual(1)
      expect(harness.session.issueCalls).toBeLessThanOrEqual(1)
      expect(harness.verification.calls).toBeLessThanOrEqual(
        firstVerificationCount + 1
      )
    }
  )

  it("converges concurrent compatible calls to one identity, Customer, lineage, and result", async () => {
    const harness = createHarness()

    const results = await Promise.all(
      Array.from({ length: 4 }, () => run(harness))
    )

    expect(results.every((result) => result.status === "completed")).toBe(true)
    expect(new Set(results.map((result) => result.authIdentityId)).size).toBe(
      1
    )
    expect(new Set(results.map((result) => result.customerId)).size).toBe(1)
    expect(new Set(results.map((result) => result.session.lineageId)).size).toBe(
      1
    )
    expect(new Set(results.map((result) => result.registrationIntentId)).size).toBe(
      1
    )
    expect(harness.database.completedIntents()).toHaveLength(1)
    expect(harness.database.state.credentials).toHaveLength(1)
    expect(harness.customer.createCalls).toBe(1)
    expect(harness.session.issueCalls).toBe(1)
    expect(harness.verification.calls).toBe(1)
  })

  it("keeps completion valid when synthetic notification delivery fails", async () => {
    const harness = createHarness()
    let providerDeliveryCalls = 0

    const result = await run(harness, {}, {
      providerDelivery: async () => {
        providerDeliveryCalls += 1
        throw new Error("synthetic-provider-failure")
      },
    })

    expect(result.status).toBe("completed")
    expect(providerDeliveryCalls).toBe(0)
    expect(harness.database.completedIntents()).toHaveLength(1)
    expect(harness.verification.results[0]).toMatchObject({
      state: "pending",
    })
  })
})
