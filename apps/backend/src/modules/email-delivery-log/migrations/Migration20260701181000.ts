import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const CANONICAL_EMAIL_TYPES_SQL = ["order_confirmation"]
  .map((value) => `'${value}'`)
  .join(", ")

const CANONICAL_TEMPLATE_KEYS_SQL = ["order_confirmation_v1"]
  .map((value) => `'${value}'`)
  .join(", ")

const CANONICAL_PROVIDERS_SQL = ["resend"]
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

export class Migration20260701181000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "email_delivery_log" (
        "id" text not null,
        "email_type" text not null default 'order_confirmation' check ("email_type" in (${CANONICAL_EMAIL_TYPES_SQL})),
        "template_key" text not null default 'order_confirmation_v1' check ("template_key" in (${CANONICAL_TEMPLATE_KEYS_SQL})),
        "template_version" integer not null default 1 check ("template_version" = 1),
        "provider" text not null default 'resend' check ("provider" in (${CANONICAL_PROVIDERS_SQL})),
        "idempotency_key" text not null,
        "order_id" text not null,
        "cart_id" text not null,
        "payment_attempt_id" text not null,
        "checkout_completion_log_id" text not null,
        "analytics_event_log_id" text not null,
        "payment_intent_id" text not null,
        "status" text not null default 'recorded' check ("status" in (${CANONICAL_STATUSES_SQL})),
        "recipient_email_hash" text not null,
        "recipient_email_domain" text not null,
        "payload" jsonb not null,
        "metadata" jsonb null,
        "provider_message_id" text null,
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
        constraint "email_delivery_log_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_email_delivery_log_type_idempotency_key_unique"
      ON "email_delivery_log" ("email_type", "idempotency_key")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_email_delivery_log_type_order_id_unique"
      ON "email_delivery_log" ("email_type", "order_id")
      WHERE deleted_at IS NULL
        AND order_id IS NOT NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_email_delivery_log_status_next_retry_at"
      ON "email_delivery_log" ("status", "next_retry_at")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_email_delivery_log_order_id"
      ON "email_delivery_log" ("order_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_email_delivery_log_analytics_event_log_id"
      ON "email_delivery_log" ("analytics_event_log_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_email_delivery_log_payment_attempt_id"
      ON "email_delivery_log" ("payment_attempt_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_email_delivery_log_checkout_completion_log_id"
      ON "email_delivery_log" ("checkout_completion_log_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_email_delivery_log_payment_intent_id"
      ON "email_delivery_log" ("payment_intent_id")
      WHERE deleted_at IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "email_delivery_log" cascade;')
  }
}
