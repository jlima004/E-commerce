import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const CANONICAL_STATUSES_SQL = [
  "recorded",
  "eligible",
  "queued",
  "dispatching",
  "submitted",
  "accepted",
  "in_production",
  "partially_shipped",
  "shipped",
  "delivered",
  "failed",
  "dead_letter",
  "canceled",
]
  .map((value) => `'${value}'`)
  .join(", ")

export class Migration20260703000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "gelato_fulfillment" (
        "id" text not null,
        "order_id" text not null,
        "cart_id" text not null,
        "payment_attempt_id" text not null,
        "checkout_completion_log_id" text not null,
        "analytics_event_log_id" text not null,
        "email_delivery_log_id" text not null,
        "idempotency_key" text not null,
        "order_reference_id" text not null,
        "customer_reference_id" text null,
        "status" text not null default 'recorded' check ("status" in (${CANONICAL_STATUSES_SQL})),
        "gelato_primary_order_id" text null,
        "connected_order_ids" jsonb not null default '[]'::jsonb,
        "request_hash" text not null,
        "request_summary" jsonb not null,
        "response_summary" jsonb null,
        "tracking_summary" jsonb null,
        "metadata" jsonb null,
        "attempt_count" integer not null default 0 check ("attempt_count" >= 0),
        "last_error_code" text null,
        "last_error_message" text null,
        "next_retry_at" timestamptz null,
        "requires_operator_attention" boolean not null default false,
        "operator_alert_code" text null,
        "operator_alert_message" text null,
        "operator_alerted_at" timestamptz null,
        "recorded_at" timestamptz not null,
        "queued_at" timestamptz null,
        "dispatching_started_at" timestamptz null,
        "submitted_at" timestamptz null,
        "accepted_at" timestamptz null,
        "failed_at" timestamptz null,
        "dead_lettered_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "gelato_fulfillment_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_gelato_fulfillment_order_id_unique"
      ON "gelato_fulfillment" ("order_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_gelato_fulfillment_idempotency_key_unique"
      ON "gelato_fulfillment" ("idempotency_key")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_gelato_fulfillment_status_next_retry_at"
      ON "gelato_fulfillment" ("status", "next_retry_at")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_gelato_fulfillment_order_id"
      ON "gelato_fulfillment" ("order_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_gelato_fulfillment_analytics_event_log_id"
      ON "gelato_fulfillment" ("analytics_event_log_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_gelato_fulfillment_email_delivery_log_id"
      ON "gelato_fulfillment" ("email_delivery_log_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_gelato_fulfillment_payment_attempt_id"
      ON "gelato_fulfillment" ("payment_attempt_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_gelato_fulfillment_checkout_completion_log_id"
      ON "gelato_fulfillment" ("checkout_completion_log_id")
      WHERE deleted_at IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "gelato_fulfillment" cascade;')
  }
}
