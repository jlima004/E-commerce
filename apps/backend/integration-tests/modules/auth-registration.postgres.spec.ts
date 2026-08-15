import { randomBytes } from "node:crypto"
import { Pool } from "pg"
import scryptKdf from "scrypt-kdf"
import { decideAuthSurfaceAccess } from "../../src/api/auth-surface/guard"
import { decideStoreSurfaceAccess } from "../../src/api/store-surface/guard"
import {
  createAuthPostgresHarness,
  getAuthPostgresTestBinding,
  type AuthPostgresHarness,
} from "../helpers/auth-postgres"
import {
  coordinateCustomerRegistration,
  createPostgresRegistrationDatabase,
  createScopedRegistrationDatabase,
  deriveRegistrationSemanticPayloadHmac,
  hashNormalizedCustomerAuthEmail,
  REGISTRATION_FAULT_POINTS,
  requireActiveRegistrationTransactionRaw,
  type CustomerRegistrationRequest,
  type RegistrationAuth,
  type RegistrationAuthIdentity,
  type RegistrationCustomer,
  type RegistrationCustomerRecord,
  type RegistrationDatabase,
  type RegistrationSessionService,
  type RegistrationVerification,
} from "../../src/modules/customer-auth/registration"
import { issueCustomerAuthAccessToken } from "../../src/modules/customer-auth/jwt"
import {
  deriveAuthRefreshToken,
  issueInitialAuthSession,
  type AuthSessionDatabase,
} from "../../src/modules/customer-auth/session"
import {
  autoRequestVerification,
  type AuthVerificationDatabase,
} from "../../src/modules/customer-auth/verification"
import type { CapabilityKeyring } from "../../src/modules/customer-auth/security/capabilities"
import { CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS } from "../../src/modules/customer-auth/types"

const databaseUrl = process.env.DATABASE_URL
const databaseName = process.env.DB_TEMP_NAME

const BASE = new Date("2026-08-15T03:00:00.000Z")
const JWT_SECRET = "registration-pg-jwt-secret".repeat(3)
const KEYRING: CapabilityKeyring = {
  active: { version: 1, secret: "registration-pg-key".repeat(5) },
  previous: [],
}
const EMAILPASS_HASH_CONFIG = { logN: 4, r: 8, p: 1 } as const

const schemaSql = `
create table if not exists registration_intent (
  id text primary key,
  normalized_email_hash text not null,
  semantic_payload_hmac text not null,
  payload_key_version integer not null,
  auth_identity_id text,
  customer_id text,
  status text check (status in (
    'pending_identity',
    'pending_customer',
    'completed',
    'expired',
    'failed_reconcilable'
  )) not null default 'pending_identity',
  version integer not null default 1,
  expires_at timestamptz not null,
  completed_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint registration_intent_version_positive check (version >= 1),
  constraint registration_intent_key_versions_positive
    check (payload_key_version >= 1 AND schema_version >= 1),
  constraint registration_intent_expiry_after_creation
    check (expires_at > created_at),
  constraint registration_intent_identity_precedes_customer
    check (customer_id IS NULL OR auth_identity_id IS NOT NULL),
  constraint registration_intent_state_requirements check (
    (status <> 'pending_identity' OR (auth_identity_id IS NULL AND customer_id IS NULL))
    AND (status <> 'pending_customer' OR (auth_identity_id IS NOT NULL AND customer_id IS NULL))
  ),
  constraint registration_intent_completed_requirements check (
    (status <> 'completed' OR (
      auth_identity_id IS NOT NULL
      AND customer_id IS NOT NULL
      AND completed_at IS NOT NULL
    ))
    AND (completed_at IS NULL OR status = 'completed')
  )
);
create unique index if not exists "UQ_registration_intent_active_email_hash"
  on registration_intent (normalized_email_hash)
  where status in ('pending_identity', 'pending_customer', 'failed_reconcilable')
    and deleted_at is null;
create unique index if not exists "UQ_registration_intent_active_auth_identity_id"
  on registration_intent (auth_identity_id)
  where auth_identity_id is not null and status <> 'expired' and deleted_at is null;
create unique index if not exists "UQ_registration_intent_active_customer_id"
  on registration_intent (customer_id)
  where customer_id is not null and status <> 'expired' and deleted_at is null;

create table if not exists auth_credential_state (
  id text primary key,
  auth_identity_id text not null,
  customer_id text not null,
  credential_version integer not null default 1,
  email_verified_at timestamptz,
  operation_type text,
  operation_id text,
  operation_status text not null default 'stable',
  operation_version integer not null default 0,
  version integer not null default 1,
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  current_password_verified_at timestamptz,
  provider_proved_at timestamptz,
  credential_updated_at timestamptz,
  revocation_committed_at timestamptz,
  completed_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists "UQ_auth_credential_state_identity"
  on auth_credential_state (auth_identity_id) where deleted_at is null;

create table if not exists auth_session_lineage (
  id text primary key,
  sid text not null,
  auth_identity_id text not null,
  customer_id text not null,
  credential_version_snapshot integer not null,
  status text not null default 'active',
  version integer not null default 1,
  original_authenticated_at timestamptz not null,
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  expired_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint auth_registration_test_absolute_deadline
    check (absolute_expires_at = original_authenticated_at + interval '30 days')
);
create unique index if not exists "UQ_auth_registration_test_sid"
  on auth_session_lineage (sid) where deleted_at is null;

create table if not exists auth_refresh_credential (
  id text primary key,
  lineage_id text not null,
  token_hash text not null,
  generation integer not null default 0,
  status text not null default 'active',
  replacement_id text,
  request_key_hash text,
  nonce text not null,
  key_version integer not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  recovery_until timestamptz,
  replacement_used_at timestamptz,
  replayed_at timestamptz,
  revoked_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists "UQ_auth_registration_test_token_hash"
  on auth_refresh_credential (token_hash) where deleted_at is null;
create unique index if not exists "UQ_auth_registration_test_generation"
  on auth_refresh_credential (lineage_id, generation) where deleted_at is null;
create unique index if not exists "UQ_auth_registration_test_active_lineage"
  on auth_refresh_credential (lineage_id)
  where status = 'active' and deleted_at is null;

create table if not exists auth_verification_intent (
  id text primary key,
  auth_identity_id text not null,
  token_hash text not null,
  nonce text not null,
  key_version integer not null,
  generation integer not null default 0,
  status text not null default 'pending',
  version integer not null default 1,
  expires_at timestamptz not null,
  claimed_at timestamptz,
  confirmed_at timestamptz,
  superseded_at timestamptz,
  expired_at timestamptz,
  dead_lettered_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint auth_registration_test_verification_ttl
    check (expires_at = created_at + interval '30 minutes')
);
create unique index if not exists "UQ_auth_registration_test_verification_hash"
  on auth_verification_intent (token_hash) where deleted_at is null;
create unique index if not exists "UQ_auth_registration_test_verification_active"
  on auth_verification_intent (auth_identity_id)
  where status in ('pending', 'claimed') and deleted_at is null;

create table if not exists auth_notification_outbox (
  id text primary key,
  template text not null,
  intent_type text not null,
  intent_id text not null,
  generation integer not null default 0,
  idempotency_key text not null,
  status text not null default 'recorded',
  recipient_identity_id text not null,
  recipient_hash text not null,
  recipient_domain text not null,
  key_version integer not null,
  version integer not null default 1,
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  failure_reason text,
  provider_message_id text,
  recorded_at timestamptz not null,
  claimed_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  dead_lettered_at timestamptz,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index if not exists "UQ_auth_registration_test_outbox_key"
  on auth_notification_outbox (idempotency_key) where deleted_at is null;

create table if not exists order_side_effect_canary (id text primary key);
create table if not exists payment_side_effect_canary (id text primary key);
create table if not exists stripe_side_effect_canary (id text primary key);
create table if not exists gelato_side_effect_canary (id text primary key);
create table if not exists cart_side_effect_canary (id text primary key);
create table if not exists checkout_side_effect_canary (id text primary key);
create table if not exists fulfillment_side_effect_canary (id text primary key);
`

const truncateSql = `
delete from auth_notification_outbox;
delete from auth_verification_intent;
delete from auth_refresh_credential;
delete from auth_session_lineage;
delete from auth_credential_state;
delete from registration_intent;
delete from order_side_effect_canary;
delete from payment_side_effect_canary;
delete from stripe_side_effect_canary;
delete from gelato_side_effect_canary;
delete from cart_side_effect_canary;
delete from checkout_side_effect_canary;
delete from fulfillment_side_effect_canary;
`

const dropSql = `
drop table if exists fulfillment_side_effect_canary;
drop table if exists checkout_side_effect_canary;
drop table if exists cart_side_effect_canary;
drop table if exists gelato_side_effect_canary;
drop table if exists stripe_side_effect_canary;
drop table if exists payment_side_effect_canary;
drop table if exists order_side_effect_canary;
drop table if exists auth_notification_outbox;
drop table if exists auth_verification_intent;
drop table if exists auth_refresh_credential;
drop table if exists auth_session_lineage;
drop table if exists auth_credential_state;
drop table if exists registration_intent;
`

type StoredIdentity = RegistrationAuthIdentity & {
  email: string
  passwordHash: string
}

type CommerceCounters = {
  order: number
  payment: number
  stripe: number
  gelato: number
  cart: number
  checkout: number
  fulfillment: number
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

function createSharedModuleDatabase(): AuthSessionDatabase &
  AuthVerificationDatabase {
  return {
    async transaction<T>(callback) {
      const raw = requireActiveRegistrationTransactionRaw()
      return callback({
        raw(sql, bindings = []) {
          return raw(sql, bindings)
        },
      })
    },
  }
}

async function hashEmailpassPassword(password: string): Promise<string> {
  const digest = await scryptKdf.kdf(password, EMAILPASS_HASH_CONFIG)
  return digest.toString("base64")
}

async function verifyEmailpassPassword(
  passwordHash: string,
  password: string
): Promise<boolean> {
  return scryptKdf.verify(Buffer.from(passwordHash, "base64"), password)
}

function createHarnessAdapters() {
  const identities = new Map<string, StoredIdentity>()
  const customers = new Map<string, RegistrationCustomerRecord>()
  const commerce: CommerceCounters = {
    order: 0,
    payment: 0,
    stripe: 0,
    gelato: 0,
    cart: 0,
    checkout: 0,
    fulfillment: 0,
  }
  let registerCalls = 0
  let authenticateCalls = 0
  let createCalls = 0
  let findCalls = 0
  let issueCalls = 0
  let recoverCalls = 0
  let verificationCalls = 0
  let identitySequence = 0
  let customerSequence = 0

  const auth: RegistrationAuth & {
    registerCalls: number
    authenticateCalls: number
    identities: Map<string, StoredIdentity>
  } = {
    get registerCalls() {
      return registerCalls
    },
    get authenticateCalls() {
      return authenticateCalls
    },
    identities,
    async findIdentity({ normalizedEmail }) {
      return identities.get(normalizedEmail) ?? null
    },
    async authenticate({ normalizedEmail, password }) {
      authenticateCalls += 1
      const identity = identities.get(normalizedEmail)
      if (!identity) {
        return null
      }
      const matches = await verifyEmailpassPassword(
        identity.passwordHash,
        password
      )
      return matches ? { id: identity.id, app_metadata: identity.app_metadata } : null
    },
    async register({ normalizedEmail, password }) {
      registerCalls += 1
      const existing = identities.get(normalizedEmail)
      if (existing) {
        throw new Error("EMAILPASS_REGISTER_WOULD_OVERWRITE")
      }
      identitySequence += 1
      const identity: StoredIdentity = {
        id: `authid_pg_${identitySequence}`,
        email: normalizedEmail,
        passwordHash: await hashEmailpassPassword(password),
        app_metadata: {},
      }
      identities.set(normalizedEmail, identity)
      return { id: identity.id, app_metadata: identity.app_metadata }
    },
  }

  const customer: RegistrationCustomer & {
    createCalls: number
    findCalls: number
    customers: Map<string, RegistrationCustomerRecord>
  } = {
    get createCalls() {
      return createCalls
    },
    get findCalls() {
      return findCalls
    },
    customers,
    async find({ normalizedEmail, authIdentity }) {
      findCalls += 1
      const customerId = authIdentity.app_metadata?.customer_id
      if (typeof customerId === "string" && customerId.trim() !== "") {
        return customers.get(customerId) ?? null
      }
      return (
        [...customers.values()].find((record) => record.email === normalizedEmail) ??
        null
      )
    },
    async create({ authIdentityId, normalizedEmail, customerData }) {
      createCalls += 1
      customerSequence += 1
      const record = {
        id: `customer_pg_${customerSequence}`,
        email: normalizedEmail,
        first_name: customerData.first_name,
        last_name: customerData.last_name,
      }
      customers.set(record.id, record)
      const identity = [...identities.values()].find(
        (candidate) => candidate.id === authIdentityId
      )
      if (identity) {
        identity.app_metadata = {
          ...(identity.app_metadata ?? {}),
          customer_id: record.id,
        }
      }
      return record
    },
  }

  const moduleDatabase = createSharedModuleDatabase()
  const session: RegistrationSessionService & {
    issueCalls: number
    recoverCalls: number
  } = {
    get issueCalls() {
      return issueCalls
    },
    get recoverCalls() {
      return recoverCalls
    },
    findInitial: (input) => {
      recoverCalls += 1
      return recoverInitial(moduleDatabase, input)
    },
    issueInitial: (input) => {
      issueCalls += 1
      return issueInitialAuthSession(moduleDatabase, {
        ...input,
        keyring: input.keyring as CapabilityKeyring,
      })
    },
  }

  const verification: RegistrationVerification & { calls: number } = {
    get calls() {
      return verificationCalls
    },
    async autoRequest(input) {
      verificationCalls += 1
      const result = await autoRequestVerification(moduleDatabase, {
        authIdentityId: input.authIdentityId,
        recipientIdentityId: input.authIdentityId,
        normalizedEmail: input.normalizedEmail,
        keyring: input.keyring as CapabilityKeyring,
        now: input.now,
      })
      return {
        state: result.state,
        intentId: result.intent?.id ?? null,
        outboxId: result.outbox?.id ?? null,
      }
    },
  }

  return { auth, customer, session, verification, commerce }
}

async function recoverInitial(
  database: AuthSessionDatabase,
  input: Parameters<RegistrationSessionService["findInitial"]>[0]
) {
  return database.transaction(async (transaction) => {
    const result = await transaction.raw(
      `select
         lineage.id as lineage_id,
         lineage.sid,
         lineage.auth_identity_id,
         lineage.customer_id,
         lineage.credential_version_snapshot,
         lineage.status as lineage_status,
         lineage.original_authenticated_at,
         lineage.absolute_expires_at,
         refresh.id as refresh_id,
         refresh.generation,
         refresh.nonce,
         refresh.key_version,
         refresh.expires_at as refresh_expires_at,
         credential.credential_version,
         credential.operation_status
       from auth_session_lineage lineage
       join auth_refresh_credential refresh
         on refresh.lineage_id = lineage.id
        and refresh.status = 'active'
        and refresh.deleted_at is null
       join auth_credential_state credential
         on credential.auth_identity_id = lineage.auth_identity_id
        and credential.deleted_at is null
       where lineage.auth_identity_id = ?
         and lineage.customer_id = ?
         and lineage.status = 'active'
         and credential.operation_status = 'stable'
         and credential.credential_version =
             lineage.credential_version_snapshot
         and lineage.deleted_at is null
       order by lineage.created_at asc, lineage.id asc
       limit 1
       for update`,
      [input.authIdentityId, input.customerId]
    )
    const row = result.rows?.[0]
    if (!row) {
      return null
    }
    const refreshToken = deriveAuthRefreshToken({
      keyring: input.keyring as CapabilityKeyring,
      credentialId: String(row.refresh_id),
      lineageId: String(row.lineage_id),
      generation: Number(row.generation),
      nonce: String(row.nonce),
      keyVersion: Number(row.key_version),
    })
    const access = issueCustomerAuthAccessToken({
      secret: input.jwtSecret,
      authIdentityId: String(row.auth_identity_id),
      customerId: String(row.customer_id),
      sid: String(row.sid),
      credentialVersion: Number(row.credential_version_snapshot),
      originalAuthenticatedAt: new Date(String(row.original_authenticated_at)),
      absoluteExpiresAt: new Date(String(row.absolute_expires_at)),
      now: input.now,
    })
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken,
      refreshExpiresAt: new Date(String(row.refresh_expires_at)),
      originalAuthenticatedAt: new Date(String(row.original_authenticated_at)),
      absoluteExpiresAt: new Date(String(row.absolute_expires_at)),
      lineageId: String(row.lineage_id),
      refreshCredentialId: String(row.refresh_id),
      sid: String(row.sid),
      generation: Number(row.generation),
      authIdentityId: String(row.auth_identity_id),
      customerId: String(row.customer_id),
      credentialVersion: Number(row.credential_version_snapshot),
      rotation: "recovered" as const,
    }
  })
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

if (!databaseUrl || !databaseName) {
  describe("customer auth PostgreSQL registration coordinator", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(databaseName).toMatch(/^p12_disposable_/)
    })
  })
} else {
  jest.setTimeout(180_000)
  let harness: AuthPostgresHarness
  let pool: Pool
  let innerDatabase: RegistrationDatabase

  describe("customer auth PostgreSQL registration coordinator", () => {
    beforeAll(async () => {
      harness = await createAuthPostgresHarness()
      const binding = getAuthPostgresTestBinding(harness)
      pool = new Pool({ connectionString: binding.databaseUrl })
      innerDatabase = createPostgresRegistrationDatabase(pool)
      await pool.query(schemaSql)
    })

    beforeEach(async () => {
      await pool.query(truncateSql)
    })

    afterAll(async () => {
      try {
        await pool?.query(dropSql)
      } finally {
        await pool?.end()
        await harness?.cleanup()
      }
    })

    function createRuntime() {
      return {
        database: createScopedRegistrationDatabase(innerDatabase),
        ...createHarnessAdapters(),
      }
    }

    async function run(
      runtime: ReturnType<typeof createRuntime>,
      overrides: Partial<CustomerRegistrationRequest> = {},
      extra: Partial<Parameters<typeof coordinateCustomerRegistration>[0]> = {}
    ) {
      return coordinateCustomerRegistration({
        request: request(overrides),
        database: runtime.database,
        auth: runtime.auth,
        customer: runtime.customer,
        session: runtime.session,
        verification: runtime.verification,
        idFactory: (prefix) => `${prefix}_${randomBytes(6).toString("hex")}`,
        ...extra,
      })
    }

    async function snapshot() {
      const result = await pool.query(
        `select
           (select count(*)::int from registration_intent) as intents,
           (select count(*)::int from registration_intent where status = 'completed') as completed,
           (select count(*)::int from auth_credential_state) as credentials,
           (select count(*)::int from auth_session_lineage) as lineages,
           (select count(*)::int from auth_refresh_credential) as refresh_credentials,
           (select count(*)::int from auth_verification_intent) as verifications,
           (select count(*)::int from auth_notification_outbox) as outboxes,
           (select coalesce(string_agg(status, ',' order by created_at, id), '') from registration_intent) as intent_statuses,
           (select coalesce(string_agg(semantic_payload_hmac, ',' order by created_at, id), '') from registration_intent) as intent_hmacs
        `
      )
      return result.rows[0] as Record<string, string | number>
    }

    async function completionTruth() {
      const result = await pool.query(
        `select
           (select count(*)::int from registration_intent) as intents,
           (select count(*)::int from registration_intent where status = 'completed') as completed,
           (select version from registration_intent order by created_at, id limit 1) as intent_version,
           (select completed_at from registration_intent order by created_at, id limit 1) as completed_at,
           (select updated_at from registration_intent order by created_at, id limit 1) as updated_at,
           (select count(*)::int from auth_credential_state) as credentials,
           (select count(*)::int from auth_session_lineage) as lineages,
           (select count(*)::int from auth_refresh_credential) as refresh_credentials,
           (select count(*)::int from auth_verification_intent) as verifications,
           (select count(*)::int from auth_notification_outbox) as outboxes
        `
      )
      return result.rows[0] as Record<string, string | number | Date>
    }

    function adapterCounters(runtime: ReturnType<typeof createRuntime>) {
      return {
        registerCalls: runtime.auth.registerCalls,
        authenticateCalls: runtime.auth.authenticateCalls,
        createCalls: runtime.customer.createCalls,
        findCalls: runtime.customer.findCalls,
        issueCalls: runtime.session.issueCalls,
        recoverCalls: runtime.session.recoverCalls,
        verificationCalls: runtime.verification.calls,
      }
    }

    async function commerceCounts() {
      const result = await pool.query(
        `select
           (select count(*)::int from order_side_effect_canary) as order_count,
           (select count(*)::int from payment_side_effect_canary) as payment_count,
           (select count(*)::int from stripe_side_effect_canary) as stripe_count,
           (select count(*)::int from gelato_side_effect_canary) as gelato_count,
           (select count(*)::int from cart_side_effect_canary) as cart_count,
           (select count(*)::int from checkout_side_effect_canary) as checkout_count,
           (select count(*)::int from fulfillment_side_effect_canary) as fulfillment_count
        `
      )
      return result.rows[0]
    }

    it("keeps signup and login HTTP surfaces DENY", () => {
      expect(
        decideAuthSurfaceAccess("POST", "/auth/customer/emailpass/register")
      ).toMatchObject({ action: "deny" })
      expect(
        decideAuthSurfaceAccess("POST", "/auth/customer/emailpass")
      ).toMatchObject({ action: "deny" })
      expect(
        decideStoreSurfaceAccess("POST", "/store/customers")
      ).toMatchObject({ action: "deny" })
    })

    it("converges concurrent compatible registrations to one identity, Customer, lineage, and result", async () => {
      const barrier = await harness.contendForExclusiveClaim("registration-claim", [
        "contestant-a",
        "contestant-b",
      ])
      expect(barrier.winnerCount).toBe(1)
      expect(barrier.acquired.filter(Boolean)).toHaveLength(1)

      const runtime = createRuntime()
      const outcomes = await Promise.allSettled(
        Array.from({ length: 3 }, () => run(runtime))
      )
      const succeeded = outcomes.flatMap((outcome) =>
        outcome.status === "fulfilled" ? [outcome.value] : []
      )
      const rejected = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [outcome.reason] : []
      )

      expect(succeeded).toHaveLength(1)
      expect(succeeded[0]?.status).toBe("completed")
      expect(rejected).toHaveLength(2)
      expect(
        rejected.every(
          (error) =>
            error?.code === "CUSTOMER_REGISTRATION_ALREADY_COMPLETED"
        )
      ).toBe(true)
      expect(runtime.auth.registerCalls).toBe(1)
      expect(runtime.auth.authenticateCalls).toBe(0)
      expect(runtime.customer.createCalls).toBe(1)
      expect(runtime.auth.identities.size).toBe(1)

      const counts = await snapshot()
      expect(counts.completed).toBe(1)
      expect(counts.credentials).toBe(1)
      expect(counts.lineages).toBe(1)
      expect(counts.verifications).toBe(1)
      expect(counts.outboxes).toBe(1)
      expect(await commerceCounts()).toEqual({
        order_count: 0,
        payment_count: 0,
        stripe_count: 0,
        gelato_count: 0,
        cart_count: 0,
        checkout_count: 0,
        fulfillment_count: 0,
      })
      expect(runtime.commerce).toEqual({
        order: 0,
        payment: 0,
        stripe: 0,
        gelato: 0,
        cart: 0,
        checkout: 0,
        fulfillment: 0,
      })
    })

    it("recovers a partial identity into exactly one Customer within 24h", async () => {
      const runtime = createRuntime()
      await expect(
        run(runtime, {}, {
          faultInjector: faultOnce(
            REGISTRATION_FAULT_POINTS.AFTER_IDENTITY_BEFORE_CUSTOMER
          ),
        })
      ).rejects.toMatchObject({
        code: "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED",
      })

      const partial = await pool.query(
        "select status, auth_identity_id, customer_id from registration_intent"
      )
      expect(partial.rows).toEqual([
        expect.objectContaining({
          status: "pending_customer",
          customer_id: null,
        }),
      ])
      expect(runtime.auth.registerCalls).toBe(1)
      expect(runtime.customer.createCalls).toBe(0)

      const result = await run(runtime)
      expect(result.status).toBe("completed")
      expect(result.authIdentityId).toBe(partial.rows[0]?.auth_identity_id)
      expect(runtime.auth.registerCalls).toBe(1)
      expect(runtime.customer.createCalls).toBe(1)
      expect((await snapshot()).completed).toBe(1)
      expect((await snapshot()).lineages).toBe(1)
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
        const runtime = createRuntime()
        await expect(
          run(runtime, {}, { faultInjector: faultOnce(point) })
        ).rejects.toMatchObject({
          code: "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED",
        })

        const before = await pool.query(
          "select status, auth_identity_id, customer_id from registration_intent"
        )
        expect(before.rows[0]?.status).toBe(expectedStatus)
        const identityId = before.rows[0]?.auth_identity_id
        const customerId = before.rows[0]?.customer_id

        const result = await run(runtime)
        expect(result.status).toBe("completed")
        expect(result.authIdentityId).toBe(identityId ?? result.authIdentityId)
        expect(result.customerId).toBe(customerId ?? result.customerId)
        expect(runtime.auth.identities.size).toBe(1)
        expect(runtime.customer.createCalls).toBeLessThanOrEqual(1)
        expect((await snapshot()).completed).toBe(1)
        expect((await snapshot()).lineages).toBe(1)
        expect((await snapshot()).verifications).toBe(1)
        expect((await snapshot()).outboxes).toBe(1)
      }
    )

    it("does zero mutation on semantic mismatch", async () => {
      const runtime = createRuntime()
      await expect(
        run(runtime, {}, {
          faultInjector: faultOnce(
            REGISTRATION_FAULT_POINTS.AFTER_IDENTITY_BEFORE_CUSTOMER
          ),
        })
      ).rejects.toMatchObject({
        code: "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED",
      })
      const before = await snapshot()
      const registerCalls = runtime.auth.registerCalls

      await expect(
        run(runtime, {
          customerData: { first_name: "Alice", last_name: "Changed" },
        })
      ).rejects.toMatchObject({
        code: "CUSTOMER_REGISTRATION_SEMANTIC_MISMATCH",
      })

      expect(await snapshot()).toEqual(before)
      expect(runtime.auth.registerCalls).toBe(registerCalls)
      expect(runtime.customer.createCalls).toBe(0)
    })

    it("does zero mutation on password mismatch and never replaces the pending credential", async () => {
      const runtime = createRuntime()
      await expect(
        run(runtime, {}, {
          faultInjector: faultOnce(
            REGISTRATION_FAULT_POINTS.AFTER_IDENTITY_BEFORE_CUSTOMER
          ),
        })
      ).rejects.toMatchObject({
        code: "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED",
      })
      const before = await snapshot()
      const identity = [...runtime.auth.identities.values()][0]
      expect(identity).toBeDefined()
      const originalHash = identity!.passwordHash
      const registerCalls = runtime.auth.registerCalls

      await expect(
        run(runtime, { password: "wrong-password" })
      ).rejects.toMatchObject({
        code: "CUSTOMER_REGISTRATION_PASSWORD_MISMATCH",
      })

      expect(await snapshot()).toEqual(before)
      expect(runtime.auth.registerCalls).toBe(registerCalls)
      expect(identity!.passwordHash).toBe(originalHash)
      expect(
        await verifyEmailpassPassword(identity!.passwordHash, "correct-password")
      ).toBe(true)
      expect(
        await verifyEmailpassPassword(identity!.passwordHash, "wrong-password")
      ).toBe(false)
    })

    it("expires a 24h intent without reusing the old password or payload", async () => {
      const runtime = createRuntime()
      await expect(
        run(runtime, {}, {
          faultInjector: faultOnce(
            REGISTRATION_FAULT_POINTS.AFTER_IDENTITY_BEFORE_CUSTOMER
          ),
        })
      ).rejects.toMatchObject({
        code: "CUSTOMER_REGISTRATION_RECOVERY_REQUIRED",
      })
      const registerCalls = runtime.auth.registerCalls
      const identity = [...runtime.auth.identities.values()][0]

      await expect(
        run(runtime, {
          now: new Date(
            BASE.getTime() + CUSTOMER_AUTH_REGISTRATION_TTL_SECONDS * 1000 + 1
          ),
          password: "new-password",
        })
      ).rejects.toMatchObject({
        code: "CUSTOMER_REGISTRATION_EXPIRED",
      })

      expect(runtime.auth.registerCalls).toBe(registerCalls)
      expect(runtime.customer.createCalls).toBe(0)
      const expired = await pool.query(
        "select status from registration_intent"
      )
      expect(expired.rows).toEqual([{ status: "expired" }])
      expect(
        await verifyEmailpassPassword(identity!.passwordHash, "correct-password")
      ).toBe(true)
    })

    it("rejects a compatible completed retry without authentication or writes", async () => {
      const runtime = createRuntime()
      const first = await run(runtime)
      expect(first.status).toBe("completed")
      expect(first.verification.state).toBe("pending")
      expect(first.verification.intentId).toBeTruthy()
      expect(first.verification.outboxId).toBeTruthy()

      const beforeTruth = await completionTruth()
      const beforeAdapters = adapterCounters(runtime)
      const identity = [...runtime.auth.identities.values()][0]
      const originalHash = identity!.passwordHash

      await expect(run(runtime)).rejects.toMatchObject({
        code: "CUSTOMER_REGISTRATION_ALREADY_COMPLETED",
      })

      expect(await completionTruth()).toEqual(beforeTruth)
      expect(adapterCounters(runtime)).toEqual(beforeAdapters)
      expect(runtime.auth.authenticateCalls).toBe(0)
      expect(identity!.passwordHash).toBe(originalHash)
      expect(
        await verifyEmailpassPassword(originalHash, "correct-password")
      ).toBe(true)
      expect(await snapshot()).toMatchObject({
        intents: 1,
        completed: 1,
        credentials: 1,
        lineages: 1,
        refresh_credentials: 1,
        verifications: 1,
        outboxes: 1,
      })
      expect(await commerceCounts()).toEqual({
        order_count: 0,
        payment_count: 0,
        stripe_count: 0,
        gelato_count: 0,
        cart_count: 0,
        checkout_count: 0,
        fulfillment_count: 0,
      })
    })

    it("keeps completion valid when synthetic provider delivery fails", async () => {
      const runtime = createRuntime()
      let providerDeliveryCalls = 0
      const result = await run(runtime, {}, {
        providerDelivery: async () => {
          providerDeliveryCalls += 1
          throw new Error("synthetic-provider-failure")
        },
      })

      expect(result.status).toBe("completed")
      expect(providerDeliveryCalls).toBe(0)
      expect((await snapshot()).completed).toBe(1)
      expect((await snapshot()).verifications).toBe(1)
      expect((await snapshot()).outboxes).toBe(1)
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
        customerData: request({ password: "other-password" }).customerData,
      })
      expect(first.hmac).toBe(second.hmac)
      expect(first.hmac).not.toContain("correct-password")
      expect(hashNormalizedCustomerAuthEmail("alice@example.com")).toHaveLength(64)
    })
  })
}
