import {
  createCustomerAccountWorkflow,
} from "@medusajs/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules, MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import {
  type CustomerAuthTransactionalRepositoryLike,
} from "../../infrastructure/customer-auth-transaction-compatibility"
import {
  CUSTOMER_AUTH_MODULE,
} from "../../modules/customer-auth/service"
import {
  coordinateCustomerRegistration,
  createRegistrationDatabaseFromRepository,
  createScopedRegistrationDatabase,
  requireActiveRegistrationTransactionRaw,
  type CustomerRegistrationRequest,
  type RegistrationAuth,
  type RegistrationAuthIdentity,
  type RegistrationCustomer,
  type RegistrationCustomerRecord,
  type RegistrationSession,
  type RegistrationSessionInput,
  type RegistrationSessionService,
  type RegistrationVerification,
  type RegistrationVerificationResult,
} from "../../modules/customer-auth/registration"
import { issueCustomerAuthAccessToken } from "../../modules/customer-auth/jwt"
import { deriveAuthRefreshToken } from "../../modules/customer-auth/session"
import type { CapabilityKeyring } from "../../modules/customer-auth/security/capabilities"
import {
  issueInitialAuthSession,
  type AuthSessionDatabase,
} from "../../modules/customer-auth/session"
import {
  autoRequestVerification,
  type AuthVerificationDatabase,
} from "../../modules/customer-auth/verification"

type RegisterCustomerWorkflowInput = CustomerRegistrationRequest

type AuthModuleLike = RegistrationAuth & {
  getAuthIdentityProviderService(provider: string): {
    retrieve(input: { entity_id: string }): Promise<{
      id: string
      app_metadata?: Record<string, unknown> | null
    }>
  }
  authenticate(
    provider: string,
    input: {
      actor_type: string
      body: { email: string; password: string }
    }
  ): Promise<{
    success: boolean
    authIdentity?: RegistrationAuthIdentity
  }>
  register(
    provider: string,
    input: {
      actor_type: string
      body: { email: string; password: string }
    }
  ): Promise<{
    success: boolean
    authIdentity?: RegistrationAuthIdentity
  }>
}

type CustomerModuleLike = {
  retrieveCustomer(id: string): Promise<RegistrationCustomerRecord>
  listCustomers(filters: { email: string }): Promise<RegistrationCustomerRecord[]>
}

type CustomerAuthServiceLike = {
  baseRepository_: CustomerAuthTransactionalRepositoryLike
}

function notFound(error: unknown): boolean {
  return (
    error instanceof MedusaError &&
    error.type === MedusaError.Types.NOT_FOUND
  )
}

function identityFromResponse(
  response: {
    success: boolean
    authIdentity?: RegistrationAuthIdentity
  }
): RegistrationAuthIdentity | null {
  return response.success && response.authIdentity
    ? response.authIdentity
    : null
}

function createAuthAdapter(authModule: AuthModuleLike): RegistrationAuth {
  const provider = authModule.getAuthIdentityProviderService("emailpass")
  return {
    async findIdentity({ normalizedEmail }) {
      try {
        const identity = await provider.retrieve({ entity_id: normalizedEmail })
        return {
          id: identity.id,
          app_metadata: identity.app_metadata,
        }
      } catch (error) {
        if (notFound(error)) {
          return null
        }
        throw error
      }
    },
    async authenticate({ normalizedEmail, password }) {
      return identityFromResponse(
        await authModule.authenticate("emailpass", {
          actor_type: "customer",
          body: { email: normalizedEmail, password },
        })
      )
    },
    async register({ normalizedEmail, password }) {
      return identityFromResponse(
        await authModule.register("emailpass", {
          actor_type: "customer",
          body: { email: normalizedEmail, password },
        })
      )
    },
  }
}

function createCustomerAdapter(
  customerModule: CustomerModuleLike,
  container: unknown
): RegistrationCustomer {
  return {
    async find({ authIdentityId, normalizedEmail, authIdentity }) {
      const customerId = authIdentity.app_metadata?.customer_id
      if (typeof customerId === "string" && customerId.trim() !== "") {
        try {
          const customer = await customerModule.retrieveCustomer(customerId)
          return customer ?? null
        } catch (error) {
          if (notFound(error)) {
            return null
          }
          throw error
        }
      }

      const customers = await customerModule.listCustomers({
        email: normalizedEmail,
      })
      if (customers.length !== 1) {
        return null
      }
      return customers[0] ?? null
    },
    async create({ authIdentityId, normalizedEmail, customerData }) {
      const { result } = await createCustomerAccountWorkflow(
        container as MedusaContainer
      ).run({
        input: {
          authIdentityId,
          customerData: {
            email: normalizedEmail,
            first_name: customerData.first_name,
            last_name: customerData.last_name,
          },
        },
      })
      return result
        ? {
            id: result.id,
            email: result.email,
            first_name: result.first_name,
            last_name: result.last_name,
          }
        : null
    },
  }
}

type InitialSessionRow = {
  lineage_id: string
  sid: string
  auth_identity_id: string
  customer_id: string
  credential_version_snapshot: number
  lineage_status: "active" | "revoked" | "expired"
  original_authenticated_at: Date
  absolute_expires_at: Date
  refresh_id: string
  generation: number
  nonce: string
  key_version: number
  refresh_expires_at: Date
  credential_version: number
  operation_status: string
}

function dateValue(value: unknown): Date {
  if (value instanceof Date) {
    return new Date(value.getTime())
  }
  const parsed = new Date(String(value))
  if (Number.isNaN(parsed.getTime())) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "CUSTOMER_REGISTRATION_SESSION_ROW_INVALID"
    )
  }
  return parsed
}

function stringValue(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "CUSTOMER_REGISTRATION_SESSION_ROW_INVALID"
    )
  }
  return value
}

function numberValue(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "CUSTOMER_REGISTRATION_SESSION_ROW_INVALID"
    )
  }
  return parsed
}

function parseInitialSessionRow(
  row: Record<string, unknown>
): InitialSessionRow {
  return {
    lineage_id: stringValue(row.lineage_id),
    sid: stringValue(row.sid),
    auth_identity_id: stringValue(row.auth_identity_id),
    customer_id: stringValue(row.customer_id),
    credential_version_snapshot: numberValue(
      row.credential_version_snapshot
    ),
    lineage_status: row.lineage_status as InitialSessionRow["lineage_status"],
    original_authenticated_at: dateValue(row.original_authenticated_at),
    absolute_expires_at: dateValue(row.absolute_expires_at),
    refresh_id: stringValue(row.refresh_id),
    generation: numberValue(row.generation),
    nonce: stringValue(row.nonce),
    key_version: numberValue(row.key_version),
    refresh_expires_at: dateValue(row.refresh_expires_at),
    credential_version: numberValue(row.credential_version),
    operation_status: stringValue(row.operation_status),
  }
}

async function recoverInitialSession(
  database: AuthSessionDatabase,
  input: RegistrationSessionInput
): Promise<RegistrationSession | null> {
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

    const session = parseInitialSessionRow(row)
    const refreshToken = deriveAuthRefreshToken({
      keyring: input.keyring as CapabilityKeyring,
      credentialId: session.refresh_id,
      lineageId: session.lineage_id,
      generation: session.generation,
      nonce: session.nonce,
      keyVersion: session.key_version,
    })
    const access = issueCustomerAuthAccessToken({
      secret: input.jwtSecret,
      authIdentityId: session.auth_identity_id,
      customerId: session.customer_id,
      sid: session.sid,
      credentialVersion: session.credential_version_snapshot,
      originalAuthenticatedAt: session.original_authenticated_at,
      absoluteExpiresAt: session.absolute_expires_at,
      now: input.now,
    })
    return {
      accessToken: access.token,
      accessExpiresAt: access.expiresAt,
      refreshToken,
      refreshExpiresAt: session.refresh_expires_at,
      originalAuthenticatedAt: session.original_authenticated_at,
      absoluteExpiresAt: session.absolute_expires_at,
      lineageId: session.lineage_id,
      refreshCredentialId: session.refresh_id,
      sid: session.sid,
      generation: session.generation,
      authIdentityId: session.auth_identity_id,
      customerId: session.customer_id,
      credentialVersion: session.credential_version_snapshot,
      rotation: "recovered",
    }
  })
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

function createSessionAdapter(): RegistrationSessionService {
  const database = createSharedModuleDatabase()
  return {
    findInitial: (input) => recoverInitialSession(database, input),
    issueInitial: (input) =>
      issueInitialAuthSession(database, {
        ...input,
        keyring: input.keyring as CapabilityKeyring,
      }),
  }
}

function createVerificationAdapter(): RegistrationVerification {
  const database = createSharedModuleDatabase()
  return {
    async autoRequest(input): Promise<RegistrationVerificationResult> {
      const result = await autoRequestVerification(database, {
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
}

export const registerCustomerStep = createStep(
  "register-customer",
  async (input: RegisterCustomerWorkflowInput, { container }) => {
    const authModule = container.resolve(
      Modules.AUTH
    ) as unknown as AuthModuleLike
    const customerModule = container.resolve(
      Modules.CUSTOMER
    ) as unknown as CustomerModuleLike
    const customerAuthModule = container.resolve(
      CUSTOMER_AUTH_MODULE
    ) as unknown as CustomerAuthServiceLike
    const repository = customerAuthModule.baseRepository_
    const database = createScopedRegistrationDatabase(
      createRegistrationDatabaseFromRepository(repository)
    )

    const result = await coordinateCustomerRegistration({
      request: input,
      database,
      auth: createAuthAdapter(authModule),
      customer: createCustomerAdapter(customerModule, container),
      session: createSessionAdapter(),
      verification: createVerificationAdapter(),
    })
    return new StepResponse(result)
  }
)

export const registerCustomerWorkflow = createWorkflow(
  "register-customer",
  (input: RegisterCustomerWorkflowInput) => {
    const result = registerCustomerStep(input)
    return new WorkflowResponse(result)
  }
)

