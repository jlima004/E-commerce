import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const LEGACY_PROVIDER_DISPATCH_UNKNOWN = "LEGACY_PROVIDER_DISPATCH_UNKNOWN"

export class Migration20260901130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "payment_attempt"
        ADD COLUMN IF NOT EXISTS "financial_freeze_started_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "provider_canceled_confirmed_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "provider_discovery_started_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "reconciliation_reason_code" text NULL,
        ADD COLUMN IF NOT EXISTS "reconciliation_locked_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "last_reconciliation_at" timestamptz NULL;
    `)

    this.addSql(`
      UPDATE "payment_attempt"
      SET
        "financial_freeze_started_at" = "created_at",
        "reconciliation_reason_code" = '${LEGACY_PROVIDER_DISPATCH_UNKNOWN}'
      WHERE "order_id" IS NULL
        AND "provider_canceled_confirmed_at" IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_attempt_unresolved_financial_freeze"
      ON "payment_attempt" ("cart_id", "financial_freeze_started_at", "id")
      WHERE "financial_freeze_started_at" IS NOT NULL
        AND "provider_canceled_confirmed_at" IS NULL
        AND "order_id" IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_attempt_reconciliation_candidates"
      ON "payment_attempt" (
        COALESCE("last_reconciliation_at", "financial_freeze_started_at"),
        "provider_discovery_started_at",
        "id"
      )
      WHERE "financial_freeze_started_at" IS NOT NULL
        AND "provider_canceled_confirmed_at" IS NULL
        AND "order_id" IS NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "payment_attempt"
          WHERE "financial_freeze_started_at" IS NOT NULL
             OR "provider_canceled_confirmed_at" IS NOT NULL
             OR "provider_discovery_started_at" IS NOT NULL
             OR "reconciliation_reason_code" IS NOT NULL
             OR "reconciliation_locked_at" IS NOT NULL
             OR "last_reconciliation_at" IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'PAYMENT_ATTEMPT_R3_AUTHORITY_IN_USE'
            USING ERRCODE = '55000';
        END IF;
      END $$;
    `)

    this.addSql(
      'DROP INDEX IF EXISTS "IDX_payment_attempt_reconciliation_candidates";'
    )
    this.addSql(
      'DROP INDEX IF EXISTS "IDX_payment_attempt_unresolved_financial_freeze";'
    )
    this.addSql(`
      ALTER TABLE "payment_attempt"
        DROP COLUMN IF EXISTS "financial_freeze_started_at",
        DROP COLUMN IF EXISTS "provider_canceled_confirmed_at",
        DROP COLUMN IF EXISTS "provider_discovery_started_at",
        DROP COLUMN IF EXISTS "reconciliation_reason_code",
        DROP COLUMN IF EXISTS "reconciliation_locked_at",
        DROP COLUMN IF EXISTS "last_reconciliation_at";
    `)
  }
}
