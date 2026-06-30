/**
 * PREPARED — CheckoutCompletionLog module migration draft.
 *
 * Review before application through `npm run db:migrate:safe`.
 * This gate does not apply the migration automatically.
 */
import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const OPERATIONS_SQL = ["complete_checkout_create_order"]
  .map((value) => `'${value}'`)
  .join(", ")

const STATUSES_SQL = ["processing", "completed", "failed"]
  .map((value) => `'${value}'`)
  .join(", ")

export class Migration20260702000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "checkout_completion_log" (
        "id" text not null,
        "operation" text not null default 'complete_checkout_create_order' check ("operation" in (${OPERATIONS_SQL})),
        "idempotency_key" text not null,
        "cart_id" text not null,
        "payment_intent_id" text not null,
        "payment_attempt_id" text null,
        "order_id" text null,
        "status" text not null default 'processing' check ("status" in (${STATUSES_SQL})),
        "error_code" text null,
        "error_message" text null,
        "metadata" jsonb null,
        "locked_at" timestamptz null,
        "completed_at" timestamptz null,
        "failed_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "checkout_completion_log_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_checkout_completion_log_idempotency_key_unique"
      ON "checkout_completion_log" ("idempotency_key")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_checkout_completion_log_payment_intent_id"
      ON "checkout_completion_log" ("payment_intent_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_checkout_completion_log_cart_id"
      ON "checkout_completion_log" ("cart_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_checkout_completion_log_payment_attempt_id"
      ON "checkout_completion_log" ("payment_attempt_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_checkout_completion_log_order_id"
      ON "checkout_completion_log" ("order_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_checkout_completion_log_status_locked_at"
      ON "checkout_completion_log" ("status", "locked_at")
      WHERE deleted_at IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "checkout_completion_log" cascade;')
  }
}
