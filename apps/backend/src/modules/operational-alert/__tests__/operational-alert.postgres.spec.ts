import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  assertDisposableMedusaEnvironment,
  buildDisposableMedusaEnvironment,
  requireDisposableDatabaseName,
} from "../../../../integration-tests/postgres/disposable-postgres-harness"
import {
  OPERATIONAL_ALERT_MODULE,
  type OperationalAlertModuleService,
} from ".."

jest.mock(
  "pg-god",
  () => {
    const { Client } = jest.requireActual("pg") as typeof import("pg")

    function requireSafeName(databaseName: unknown): string {
      if (
        typeof databaseName !== "string" ||
        !/^p12_disposable_[a-z0-9_]+$/.test(databaseName)
      ) {
        throw new Error("P12_DISPOSABLE_DATABASE_NAME_FORBIDDEN")
      }
      return databaseName
    }

    function maintenanceClient() {
      return new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: "postgres",
      })
    }

    return {
      createDatabase: async ({ databaseName }: { databaseName: string }) => {
        const safeName = requireSafeName(databaseName)
        const client = maintenanceClient()
        await client.connect()
        try {
          const existing = await client.query(
            "select 1 from pg_database where datname = $1",
            [safeName]
          )
          if (existing.rowCount === 0) {
            await client.query(`create database "${safeName}"`)
          }
        } finally {
          await client.end()
        }
      },
      dropDatabase: async ({ databaseName }: { databaseName: string }) => {
        const safeName = requireSafeName(databaseName)
        const client = maintenanceClient()
        await client.connect()
        try {
          await client.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
            [safeName]
          )
          await client.query(`drop database if exists "${safeName}"`)
        } finally {
          await client.end()
        }
      },
    }
  },
  { virtual: true }
)

const requestedDatabaseName = process.env.DB_TEMP_NAME

if (!requestedDatabaseName) {
  describe("OperationalAlert PostgreSQL routing", () => {
    it("requires the disposable PostgreSQL runner", () => {
      expect(() => requireDisposableDatabaseName(requestedDatabaseName)).toThrow(
        "P12_DISPOSABLE_DATABASE_NAME_REQUIRED"
      )
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

  const { medusaIntegrationTestRunner } = jest.requireActual(
    "@medusajs/test-utils"
  ) as typeof import("@medusajs/test-utils")
  const databaseName = requireDisposableDatabaseName(requestedDatabaseName)

  jest.setTimeout(120_000)

  medusaIntegrationTestRunner({
    dbName: databaseName,
    env: disposableEnvironment,
    cwd: process.cwd(),
    testSuite: ({ dbConnection, getContainer }) => {
      const resolveService = () =>
        getContainer().resolve(
          OPERATIONAL_ALERT_MODULE
        ) as OperationalAlertModuleService

      const baseInput = (overrides: Record<string, unknown> = {}) => ({
        type: "payment_stuck" as const,
        severity: "low" as const,
        entity_type: "payment_attempt" as const,
        entity_id: "payatt_operational_alert_01",
        message_code: "PAYMENT_CONFIRMED_CHECKOUT_STALE",
        message: "Pagamento confirmado sem pedido",
        error_code: "CHECKOUT_COMPLETION_STALE",
        metadata: {
          payment_attempt_id: "payatt_operational_alert_01",
          detector_code: "checkout_completion_stale",
        },
        observed_at: new Date("2026-07-20T12:00:00.000Z"),
        ...overrides,
      })

      it("discovers the exact table, checks, unique constraint, indexes and defaults", async () => {
        const table = await dbConnection.raw(`
          select table_name
          from information_schema.tables
          where table_schema = 'public' and table_name = 'operational_alert'
        `)
        const constraints = await dbConnection.raw(`
          select conname, pg_get_constraintdef(oid) as definition
          from pg_constraint
          where conrelid = 'operational_alert'::regclass
          order by conname
        `)
        const indexes = await dbConnection.raw(`
          select indexname
          from pg_indexes
          where schemaname = 'public' and tablename = 'operational_alert'
          order by indexname
        `)
        const defaults = await dbConnection.raw(`
          select column_name, column_default
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'operational_alert'
            and column_name in ('status', 'occurrence_count', 'first_seen_at', 'last_seen_at')
          order by column_name
        `)

        expect(table.rows).toEqual([{ table_name: "operational_alert" }])
        expect(constraints.rows.map((row: { conname: string }) => row.conname)).toEqual(
          expect.arrayContaining([
            "CK_operational_alert_type",
            "CK_operational_alert_severity",
            "CK_operational_alert_status",
            "CK_operational_alert_entity_type",
            "CK_operational_alert_entity_id",
            "CK_operational_alert_occurrence_count",
            "UQ_operational_alert_logical_key",
            "operational_alert_pkey",
          ])
        )
        expect(indexes.rows.map((row: { indexname: string }) => row.indexname)).toEqual(
          expect.arrayContaining([
            "IDX_operational_alert_status_severity",
            "IDX_operational_alert_entity",
            "IDX_operational_alert_type_last_seen",
            "IDX_operational_alert_last_seen_id",
          ])
        )
        expect(defaults.rows).toHaveLength(4)
        expect(Object.fromEntries(
          defaults.rows.map((row: { column_name: string; column_default: string }) => [
            row.column_name,
            row.column_default,
          ])
        )).toEqual({
          first_seen_at: "now()",
          last_seen_at: "now()",
          occurrence_count: "1",
          status: "'open'::text",
        })

        const configModule = getContainer().resolve(
          ContainerRegistrationKeys.CONFIG_MODULE
        ) as { modules?: Record<string, unknown> }
        expect(configModule.modules).toHaveProperty(OPERATIONAL_ALERT_MODULE)
      })

      it.each([
        ["type", "unknown_alert"],
        ["severity", "info"],
        ["severity", "warning"],
        ["severity", "urgent"],
        ["status", "closed"],
        ["entity_type", "order"],
      ])("enforces the %s check constraint", async (column, value) => {
        const id = `opalert_check_${column}_${String(value)}`.replace(/[^a-z0-9_]/g, "_")
        const record = {
          type: "payment_stuck",
          severity: "high",
          status: "open",
          entity_type: "payment_attempt",
          [column]: value,
        }
        const at = new Date()

        await expect(
          dbConnection.raw(
            `
              insert into operational_alert (
                id, type, severity, status, entity_type, entity_id,
                message_code, message, occurrence_count,
                first_seen_at, last_seen_at, created_at, updated_at
              ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              id,
              record.type,
              record.severity,
              record.status,
              record.entity_type,
              `payatt_${id}`,
              "PAYMENT_CONFIRMED_CHECKOUT_STALE",
              "Mensagem segura",
              1,
              at,
              at,
              at,
              at,
            ]
          )
        ).rejects.toThrow()
      })

      it("validates all four severities and rejects invalid type/status inputs", async () => {
        const service = resolveService()

        for (const severity of ["low", "medium", "high", "critical"] as const) {
          const alert = await service.upsertAlert(
            baseInput({
              severity,
              entity_id: `payatt_severity_${severity}`,
            })
          )
          expect(alert.severity).toBe(severity)
        }

        await expect(
          service.upsertAlert(baseInput({ severity: "info" }))
        ).rejects.toThrow("OPERATIONAL_ALERT_SEVERITY_INVALID")
        await expect(
          service.upsertAlert(baseInput({ severity: "warning" }))
        ).rejects.toThrow("OPERATIONAL_ALERT_SEVERITY_INVALID")
        await expect(
          service.upsertAlert(baseInput({ type: "other" }))
        ).rejects.toThrow("OPERATIONAL_ALERT_TYPE_INVALID")
        await expect(
          service.listSafe({ limit: 20, offset: 0, status: "closed" as never })
        ).rejects.toThrow("OPERATIONAL_ALERT_STATUS_INVALID")
      })

      it("creates once, increments atomically, preserves first_seen_at and never regresses severity", async () => {
        const service = resolveService()
        const first = await service.upsertAlert(baseInput({ severity: "medium" }))
        const repeated = await service.upsertAlert(
          baseInput({
            severity: "critical",
            observed_at: new Date("2026-07-20T12:05:00.000Z"),
          })
        )
        const lower = await service.upsertAlert(
          baseInput({
            severity: "low",
            observed_at: new Date("2026-07-20T12:04:00.000Z"),
          })
        )

        expect(repeated.id).toBe(first.id)
        expect(lower.id).toBe(first.id)
        expect(lower.occurrence_count).toBe(3)
        expect(lower.severity).toBe("critical")
        expect(lower.first_seen_at).toBe(first.first_seen_at)
        expect(lower.last_seen_at).toBe("2026-07-20T12:05:00.000Z")
      })

      it("handles concurrent upserts with one canonical row, exact count and maximum severity", async () => {
        const service = resolveService()
        const severities = [
          "low",
          "medium",
          "high",
          "critical",
          "medium",
          "low",
          "high",
          "critical",
        ] as const

        const rows = await Promise.all(
          severities.map((severity, index) =>
            service.upsertAlert(
              baseInput({
                entity_id: "payatt_concurrent_01",
                severity,
                observed_at: new Date(Date.UTC(2026, 6, 20, 13, index)),
              })
            )
          )
        )
        const canonical = await service.retrieveSafe(rows[0].id)
        const persisted = await dbConnection.raw(`
          select count(*)::int as cardinality, max(occurrence_count)::int as occurrence_count
          from operational_alert
          where type = 'payment_stuck'
            and entity_type = 'payment_attempt'
            and entity_id = 'payatt_concurrent_01'
        `)

        expect(new Set(rows.map((row) => row.id)).size).toBe(1)
        expect(persisted.rows).toEqual([
          { cardinality: 1, occurrence_count: severities.length },
        ])
        expect(canonical).toMatchObject({
          occurrence_count: severities.length,
          severity: "critical",
          last_seen_at: "2026-07-20T13:07:00.000Z",
        })
      })

      it.each(["resolved", "ignored"] as const)(
        "reopens %s and clears every lifecycle field while preserving first_seen_at",
        async (status) => {
          const service = resolveService()
          const entityId = `payatt_reopen_${status}`
          const first = await service.upsertAlert(baseInput({ entity_id: entityId }))

          await dbConnection.raw(
            `
              update operational_alert set
                status = ?, acknowledged_at = ?, acknowledged_by = ?,
                resolved_at = ?, resolved_by = ?, ignored_at = ?, ignored_by = ?
              where id = ?
            `,
            [
              status,
              new Date("2026-07-20T13:00:00.000Z"),
              "usr_ack",
              new Date("2026-07-20T13:01:00.000Z"),
              "usr_resolve",
              new Date("2026-07-20T13:02:00.000Z"),
              "usr_ignore",
              first.id,
            ]
          )

          const reopened = await service.upsertAlert(
            baseInput({
              entity_id: entityId,
              observed_at: new Date("2026-07-20T14:00:00.000Z"),
            })
          )

          expect(reopened).toMatchObject({
            id: first.id,
            status: "open",
            occurrence_count: 2,
            first_seen_at: first.first_seen_at,
            acknowledged_at: null,
            acknowledged_by: null,
            resolved_at: null,
            resolved_by: null,
            ignored_at: null,
            ignored_by: null,
          })
        }
      )

      it("keeps acknowledged status and lifecycle fields on a repeated occurrence", async () => {
        const service = resolveService()
        const first = await service.upsertAlert(
          baseInput({ entity_id: "payatt_acknowledged_01" })
        )
        await dbConnection.raw(
          `
            update operational_alert set
              status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?
            where id = ?
          `,
          [new Date("2026-07-20T13:00:00.000Z"), "usr_ack", first.id]
        )

        const repeated = await service.upsertAlert(
          baseInput({
            entity_id: "payatt_acknowledged_01",
            observed_at: new Date("2026-07-20T14:00:00.000Z"),
          })
        )

        expect(repeated).toMatchObject({
          status: "acknowledged",
          acknowledged_by: "usr_ack",
          acknowledged_at: "2026-07-20T13:00:00.000Z",
        })
      })

      it("persists only allowlisted metadata and returns a safe DTO", async () => {
        const service = resolveService()
        const alert = await service.upsertAlert(
          baseInput({
            entity_id: "payatt_safe_dto_01",
            message: "Falha sk_test_sensitive cliente@example.com 123.456.789-00",
            metadata: {
              payment_attempt_id: "payatt_safe_dto_01",
              detector_code: "safe_detector",
              source_status: "processing",
              raw_payload: "forbidden",
              client_secret: "forbidden",
              stack: "forbidden",
            },
          })
        )
        const serialized = JSON.stringify(alert)

        expect(alert.metadata).toEqual({
          payment_attempt_id: "payatt_safe_dto_01",
          detector_code: "safe_detector",
          source_status: "processing",
        })
        expect(serialized).toContain("[REDACTED]")
        for (const forbidden of [
          "raw_payload",
          "client_secret",
          "cliente@example.com",
          "123.456.789-00",
          "stack",
          "deleted_at",
        ]) {
          expect(serialized).not.toContain(forbidden)
        }
      })

      it("lists with filters, count, stable default order and an empty result", async () => {
        const service = resolveService()
        await service.upsertAlert(
          baseInput({
            type: "fulfillment_failed",
            severity: "high",
            entity_type: "fulfillment",
            entity_id: "gelful_list_older",
            observed_at: new Date("2026-07-20T15:00:00.000Z"),
          })
        )
        await service.upsertAlert(
          baseInput({
            type: "fulfillment_failed",
            severity: "high",
            entity_type: "fulfillment",
            entity_id: "gelful_list_newer",
            observed_at: new Date("2026-07-20T16:00:00.000Z"),
          })
        )

        const filtered = await service.listSafe({
          type: "fulfillment_failed",
          status: "open",
          severity: "high",
          entity_type: "fulfillment",
          limit: 20,
          offset: 0,
        })
        const empty = await service.listSafe({
          entity_id: "gelful_missing",
          limit: 20,
          offset: 0,
        })

        expect(filtered.count).toBeGreaterThanOrEqual(2)
        expect(filtered.rows.slice(0, 2).map((row) => row.entity_id)).toEqual([
          "gelful_list_newer",
          "gelful_list_older",
        ])
        expect(empty).toEqual({ rows: [], count: 0 })
      })
    },
  })
}
