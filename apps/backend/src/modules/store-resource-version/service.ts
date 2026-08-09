import {
  MedusaService,
  generateEntityId,
} from "@medusajs/framework/utils"
import {
  identifyTransactionManager,
  type KnexLike,
  type SharedTransactionContext,
  type TransactionalManagerLike,
} from "../../infrastructure/store-foundation-transaction-compatibility"
import StoreResourceVersion from "./models/store-resource-version"

export const STORE_RESOURCE_VERSION_TRANSACTION_REQUIRED =
  "STORE_RESOURCE_VERSION_TRANSACTION_REQUIRED"
export const STORE_RESOURCE_VERSION_WRITE_FORBIDDEN =
  "STORE_RESOURCE_VERSION_WRITE_FORBIDDEN"

type StoreResourceVersionTransactionManager = TransactionalManagerLike & {
  getTransactionContext?: () => KnexLike | undefined | null
}

export type StoreResourceVersionRow = {
  id: string
  resource_type: string
  resource_id: string
  version: number
  created_at: string
  updated_at: string
}

export type StoreResourceVersionMutationContext = SharedTransactionContext

export type StoreResourceVersionCasResult<T = void> =
  | {
      type: "updated"
      previousVersion: number
      version: number
      mutationResult: T
      transactionManagerIdentity: string
    }
  | {
      type: "stale"
      expectedVersion: number
      actualVersion: number
      transactionManagerIdentity: string
    }

type QueryResult = { rows?: Array<Record<string, unknown>> }

function requireResourcePart(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 255) {
    throw new Error(code)
  }
  return value
}

function requirePositiveVersion(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("STORE_RESOURCE_VERSION_EXPECTED_INVALID")
  }
  return value
}

function requireTransaction(input: {
  sharedContext?: StoreResourceVersionMutationContext
}): {
  knex: KnexLike
  manager: StoreResourceVersionTransactionManager
  identity: string
} {
  const sharedContext = input.sharedContext
  const manager = sharedContext?.transactionManager as
    | StoreResourceVersionTransactionManager
    | undefined

  if (
    sharedContext?.__type !== "MedusaContext" ||
    !manager ||
    (sharedContext.manager !== undefined && sharedContext.manager !== manager)
  ) {
    throw new Error(STORE_RESOURCE_VERSION_TRANSACTION_REQUIRED)
  }

  const knex = manager.getTransactionContext?.()
  if (!knex) {
    throw new Error(STORE_RESOURCE_VERSION_TRANSACTION_REQUIRED)
  }

  return {
    knex,
    manager,
    identity: identifyTransactionManager(manager),
  }
}

function mapRow(row: Record<string, unknown>): StoreResourceVersionRow {
  return {
    id: String(row.id),
    resource_type: String(row.resource_type),
    resource_id: String(row.resource_id),
    version: requirePositiveVersion(Number(row.version)),
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  }
}

async function rows(
  knex: KnexLike,
  sql: string,
  bindings: unknown[] = []
): Promise<Array<Record<string, unknown>>> {
  const result = (await knex.raw(sql, bindings)) as QueryResult
  return result.rows ?? []
}

const BaseStoreResourceVersionService = MedusaService({ StoreResourceVersion })

export class StoreResourceVersionModuleService extends BaseStoreResourceVersionService {
  /**
   * StoreResourceVersion is server-authoritative. MedusaService generates these
   * write methods, so each one is overridden fail-closed: callers must use the
   * transaction-required initialize/increment/CAS primitives below.
   */
  override createStoreResourceVersions = async (
    ..._args: unknown[]
  ): Promise<never> => {
    throw new Error(STORE_RESOURCE_VERSION_WRITE_FORBIDDEN)
  }

  override updateStoreResourceVersions = async (
    ..._args: unknown[]
  ): Promise<never> => {
    throw new Error(STORE_RESOURCE_VERSION_WRITE_FORBIDDEN)
  }

  override deleteStoreResourceVersions = async (
    ..._args: unknown[]
  ): Promise<never> => {
    throw new Error(STORE_RESOURCE_VERSION_WRITE_FORBIDDEN)
  }

  override softDeleteStoreResourceVersions = async (
    ..._args: unknown[]
  ): Promise<never> => {
    throw new Error(STORE_RESOURCE_VERSION_WRITE_FORBIDDEN)
  }

  override restoreStoreResourceVersions = async (
    ..._args: unknown[]
  ): Promise<never> => {
    throw new Error(STORE_RESOURCE_VERSION_WRITE_FORBIDDEN)
  }

  async initialize(
    resourceType: string,
    resourceId: string,
    sharedContext?: StoreResourceVersionMutationContext
  ): Promise<StoreResourceVersionRow> {
    const type = requireResourcePart(
      resourceType,
      "STORE_RESOURCE_VERSION_RESOURCE_TYPE_INVALID"
    )
    const id = requireResourcePart(
      resourceId,
      "STORE_RESOURCE_VERSION_RESOURCE_ID_INVALID"
    )
    const { knex } = requireTransaction({ sharedContext })

    await knex.raw(
      `
        insert into store_resource_version (
          id, resource_type, resource_id, version, created_at, updated_at
        ) values (?, ?, ?, 1, now(), now())
        on conflict (resource_type, resource_id)
        where deleted_at is null
        do nothing
      `,
      [generateEntityId(undefined, "strver"), type, id]
    )

    const initialized = await rows(
      knex,
      `
        select id, resource_type, resource_id, version,
               created_at, updated_at
        from store_resource_version
        where resource_type = ? and resource_id = ? and deleted_at is null
        for update
      `,
      [type, id]
    )

    if (initialized.length !== 1) {
      throw new Error("STORE_RESOURCE_VERSION_INITIALIZATION_FAILED")
    }
    return mapRow(initialized[0])
  }

  async loadForUpdate(
    resourceType: string,
    resourceId: string,
    sharedContext?: StoreResourceVersionMutationContext
  ): Promise<StoreResourceVersionRow | null> {
    const type = requireResourcePart(
      resourceType,
      "STORE_RESOURCE_VERSION_RESOURCE_TYPE_INVALID"
    )
    const id = requireResourcePart(
      resourceId,
      "STORE_RESOURCE_VERSION_RESOURCE_ID_INVALID"
    )
    const { knex } = requireTransaction({ sharedContext })
    const found = await rows(
      knex,
      `
        select id, resource_type, resource_id, version,
               created_at, updated_at
        from store_resource_version
        where resource_type = ? and resource_id = ? and deleted_at is null
        for update
      `,
      [type, id]
    )
    return found[0] ? mapRow(found[0]) : null
  }

  async increment(
    resourceType: string,
    resourceId: string,
    expectedVersion: number,
    sharedContext?: StoreResourceVersionMutationContext
  ): Promise<StoreResourceVersionCasResult> {
    const expected = requirePositiveVersion(expectedVersion)
    const current = await this.initialize(
      resourceType,
      resourceId,
      sharedContext
    )
    const { knex, identity } = requireTransaction({ sharedContext })

    if (current.version !== expected) {
      return {
        type: "stale",
        expectedVersion: expected,
        actualVersion: current.version,
        transactionManagerIdentity: identity,
      }
    }

    const updated = await rows(
      knex,
      `
        update store_resource_version
        set version = version + 1, updated_at = now()
        where resource_type = ? and resource_id = ?
          and version = ? and deleted_at is null
        returning version
      `,
      [resourceType, resourceId, expected]
    )

    if (updated.length !== 1) {
      const actual = await this.loadForUpdate(
        resourceType,
        resourceId,
        sharedContext
      )
      if (!actual) {
        throw new Error("STORE_RESOURCE_VERSION_ROW_MISSING")
      }
      return {
        type: "stale",
        expectedVersion: expected,
        actualVersion: actual.version,
        transactionManagerIdentity: identity,
      }
    }

    return {
      type: "updated",
      previousVersion: expected,
      version: requirePositiveVersion(Number(updated[0].version)),
      mutationResult: undefined,
      transactionManagerIdentity: identity,
    }
  }

  async compareAndSwapWithMutation<T>(input: {
    resourceType: string
    resourceId: string
    expectedVersion: number
    sharedContext?: StoreResourceVersionMutationContext
    mutate: (sharedContext: StoreResourceVersionMutationContext) => Promise<T>
  }): Promise<StoreResourceVersionCasResult<T>> {
    const expected = requirePositiveVersion(input.expectedVersion)
    const sharedContext = input.sharedContext
    const current = await this.initialize(
      input.resourceType,
      input.resourceId,
      sharedContext
    )
    const { knex, identity } = requireTransaction({ sharedContext })

    if (current.version !== expected) {
      return {
        type: "stale",
        expectedVersion: expected,
        actualVersion: current.version,
        transactionManagerIdentity: identity,
      }
    }

    const mutationResult = await input.mutate(sharedContext!)
    const updated = await rows(
      knex,
      `
        update store_resource_version
        set version = version + 1, updated_at = now()
        where resource_type = ? and resource_id = ?
          and version = ? and deleted_at is null
        returning version
      `,
      [input.resourceType, input.resourceId, expected]
    )

    if (updated.length !== 1) {
      throw new Error("STORE_RESOURCE_VERSION_CAS_CONFLICT_AFTER_MUTATION")
    }

    return {
      type: "updated",
      previousVersion: expected,
      version: requirePositiveVersion(Number(updated[0].version)),
      mutationResult,
      transactionManagerIdentity: identity,
    }
  }
}

export default StoreResourceVersionModuleService
