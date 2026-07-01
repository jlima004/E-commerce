import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const CANONICAL_EVENT_NAMES_SQL = ["purchase_completed"]
  .map((value) => `'${value}'`)
  .join(", ")

const CANONICAL_STATUSES_SQL = [
  "recorded",
  "queued",
  "sending",
  "sent",
  "failed",
  "dead_letter",
]
  .map((value) => `'${value}'`)
  .join(", ")

export class Migration20260701010000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "analytics_event_log" (
        "id" text not null,
        "event_name" text not null default 'purchase_completed' check ("event_name" in (${CANONICAL_EVENT_NAMES_SQL})),
        "event_version" integer not null default 1 check ("event_version" = 1),
        "idempotency_key" text not null,
        "order_id" text not null,
        "cart_id" text not null,
        "payment_attempt_id" text not null,
        "checkout_completion_log_id" text not null,
        "payment_intent_id" text not null,
        "status" text not null default 'recorded' check ("status" in (${CANONICAL_STATUSES_SQL})),
        "payload" jsonb not null,
        "metadata" jsonb null,
        "attempt_count" integer not null default 0 check ("attempt_count" >= 0),
        "last_error_code" text null,
        "last_error_message" text null,
        "next_retry_at" timestamptz null,
        "recorded_at" timestamptz not null,
        "queued_at" timestamptz null,
        "sending_started_at" timestamptz null,
        "sent_at" timestamptz null,
        "failed_at" timestamptz null,
        "dead_lettered_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "analytics_event_log_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_analytics_event_log_name_idempotency_key_unique"
      ON "analytics_event_log" ("event_name", "idempotency_key")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_analytics_event_log_name_order_id_unique"
      ON "analytics_event_log" ("event_name", "order_id")
      WHERE deleted_at IS NULL
        AND order_id IS NOT NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_analytics_event_log_status_next_retry_at"
      ON "analytics_event_log" ("status", "next_retry_at")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_analytics_event_log_order_id"
      ON "analytics_event_log" ("order_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_analytics_event_log_payment_attempt_id"
      ON "analytics_event_log" ("payment_attempt_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_analytics_event_log_checkout_completion_log_id"
      ON "analytics_event_log" ("checkout_completion_log_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_analytics_event_log_payment_intent_id"
      ON "analytics_event_log" ("payment_intent_id")
      WHERE deleted_at IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "analytics_event_log" cascade;')
  }
}
