import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const ORDER_BIRTH_EXECUTION_AMBIGUOUS = "ORDER_BIRTH_EXECUTION_AMBIGUOUS"
const ORDER_RECOVERY_INCOMPLETE = "ORDER_RECOVERY_INCOMPLETE"

export class Migration20260901130100 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "checkout_completion_log"
        ADD COLUMN IF NOT EXISTS "execution_started_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "last_reconciliation_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "reconciliation_reason_code" text NULL;
    `)

    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM (
            SELECT "operation", "idempotency_key"
            FROM "checkout_completion_log"
            GROUP BY "operation", "idempotency_key"
            HAVING COUNT(*) > 1
          ) duplicates
        ) THEN
          RAISE EXCEPTION 'CHECKOUT_COMPLETION_DUPLICATE_IDEMPOTENCY_KEY'
            USING ERRCODE = '23505';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM (
            SELECT "operation", "cart_id"
            FROM "checkout_completion_log"
            GROUP BY "operation", "cart_id"
            HAVING COUNT(*) > 1
          ) duplicates
        ) THEN
          RAISE EXCEPTION 'CHECKOUT_COMPLETION_DUPLICATE_CART_ID'
            USING ERRCODE = '23505';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM (
            SELECT "operation", "payment_intent_id"
            FROM "checkout_completion_log"
            GROUP BY "operation", "payment_intent_id"
            HAVING COUNT(*) > 1
          ) duplicates
        ) THEN
          RAISE EXCEPTION 'CHECKOUT_COMPLETION_DUPLICATE_PAYMENT_INTENT_ID'
            USING ERRCODE = '23505';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM (
            SELECT "operation", "payment_attempt_id"
            FROM "checkout_completion_log"
            WHERE "payment_attempt_id" IS NOT NULL
            GROUP BY "operation", "payment_attempt_id"
            HAVING COUNT(*) > 1
          ) duplicates
        ) THEN
          RAISE EXCEPTION 'CHECKOUT_COMPLETION_DUPLICATE_PAYMENT_ATTEMPT_ID'
            USING ERRCODE = '23505';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM (
            SELECT "operation", "order_id"
            FROM "checkout_completion_log"
            WHERE "order_id" IS NOT NULL
            GROUP BY "operation", "order_id"
            HAVING COUNT(*) > 1
          ) duplicates
        ) THEN
          RAISE EXCEPTION 'CHECKOUT_COMPLETION_DUPLICATE_ORDER_ID'
            USING ERRCODE = '23505';
        END IF;
      END $$;
    `)

    this.addSql(
      'ALTER TABLE "checkout_completion_log" DROP CONSTRAINT IF EXISTS "checkout_completion_log_status_check";'
    )

    this.addSql(`
      UPDATE "checkout_completion_log"
      SET
        "status" = 'reconciliation_required',
        "reconciliation_reason_code" = CASE
          WHEN "status" = 'completed' AND "order_id" IS NULL
            THEN '${ORDER_RECOVERY_INCOMPLETE}'
          WHEN "status" IN ('processing', 'failed')
            THEN '${ORDER_BIRTH_EXECUTION_AMBIGUOUS}'
          ELSE "reconciliation_reason_code"
        END
      WHERE ("status" = 'completed' AND "order_id" IS NULL)
         OR "status" IN ('processing', 'failed');
    `)

    this.addSql(`
      ALTER TABLE "checkout_completion_log"
        ADD CONSTRAINT "CK_checkout_completion_log_status"
        CHECK ("status" IN ('processing', 'completed', 'failed', 'reconciliation_required'));
    `)

    this.addSql(
      'DROP INDEX IF EXISTS "IDX_checkout_completion_log_idempotency_key_unique";'
    )

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_checkout_completion_log_operation_idempotency_key"
      ON "checkout_completion_log" ("operation", "idempotency_key");
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_checkout_completion_log_operation_cart_id"
      ON "checkout_completion_log" ("operation", "cart_id");
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_checkout_completion_log_operation_payment_intent_id"
      ON "checkout_completion_log" ("operation", "payment_intent_id");
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_checkout_completion_log_operation_payment_attempt_id"
      ON "checkout_completion_log" ("operation", "payment_attempt_id")
      WHERE "payment_attempt_id" IS NOT NULL;
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_checkout_completion_log_operation_order_id"
      ON "checkout_completion_log" ("operation", "order_id")
      WHERE "order_id" IS NOT NULL;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "checkout_completion_log"
          WHERE "status" = 'reconciliation_required'
             OR "execution_started_at" IS NOT NULL
             OR "last_reconciliation_at" IS NOT NULL
             OR "reconciliation_reason_code" IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'CHECKOUT_COMPLETION_R3_AUTHORITY_IN_USE'
            USING ERRCODE = '55000';
        END IF;

        IF EXISTS (SELECT 1 FROM "checkout_completion_log") THEN
          RAISE EXCEPTION 'CHECKOUT_COMPLETION_HISTORICAL_AUTHORITY_IN_USE'
            USING ERRCODE = '55000';
        END IF;
      END $$;
    `)

    this.addSql(
      'DROP INDEX IF EXISTS "UQ_checkout_completion_log_operation_order_id";'
    )
    this.addSql(
      'DROP INDEX IF EXISTS "UQ_checkout_completion_log_operation_payment_attempt_id";'
    )
    this.addSql(
      'DROP INDEX IF EXISTS "UQ_checkout_completion_log_operation_payment_intent_id";'
    )
    this.addSql(
      'DROP INDEX IF EXISTS "UQ_checkout_completion_log_operation_cart_id";'
    )
    this.addSql(
      'DROP INDEX IF EXISTS "UQ_checkout_completion_log_operation_idempotency_key";'
    )
    this.addSql(
      'ALTER TABLE "checkout_completion_log" DROP CONSTRAINT IF EXISTS "CK_checkout_completion_log_status";'
    )
    this.addSql(`
      ALTER TABLE "checkout_completion_log"
        ADD CONSTRAINT "checkout_completion_log_status_check"
        CHECK ("status" IN ('processing', 'completed', 'failed'));
    `)
    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_checkout_completion_log_idempotency_key_unique"
      ON "checkout_completion_log" ("idempotency_key")
      WHERE "deleted_at" IS NULL;
    `)
    this.addSql(`
      ALTER TABLE "checkout_completion_log"
        DROP COLUMN IF EXISTS "execution_started_at",
        DROP COLUMN IF EXISTS "last_reconciliation_at",
        DROP COLUMN IF EXISTS "reconciliation_reason_code";
    `)
  }
}
