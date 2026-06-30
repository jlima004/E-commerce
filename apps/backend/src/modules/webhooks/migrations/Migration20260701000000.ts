import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const PROVIDERS_SQL = ["stripe", "gelato"].map((value) => `'${value}'`).join(", ")
const ENTITY_TYPES_SQL = [
  "payment_attempt",
  "order",
  "refund",
  "fulfillment",
  "unknown",
]
  .map((value) => `'${value}'`)
  .join(", ")
const STATUSES_SQL = [
  "received",
  "processing",
  "processed",
  "ignored",
  "failed",
]
  .map((value) => `'${value}'`)
  .join(", ")

export class Migration20260701000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "webhook_event_log" (
        "id" text not null,
        "provider" text not null check ("provider" in (${PROVIDERS_SQL})),
        "external_event_id" text null,
        "event_type" text not null,
        "entity_type" text not null default 'unknown' check ("entity_type" in (${ENTITY_TYPES_SQL})),
        "entity_id" text null,
        "payload_hash" text not null,
        "deduplication_key" text not null,
        "status" text not null default 'received' check ("status" in (${STATUSES_SQL})),
        "processing_attempts" integer not null default 0 check ("processing_attempts" >= 0),
        "error_code" text null,
        "error_message" text null,
        "metadata" jsonb null,
        "received_at" timestamptz not null default now(),
        "processed_at" timestamptz null,
        "ignored_at" timestamptz null,
        "failed_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "webhook_event_log_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_webhook_event_log_provider_external_event_id_unique"
      ON "webhook_event_log" ("provider", "external_event_id")
      WHERE deleted_at IS NULL
        AND external_event_id IS NOT NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_webhook_event_log_provider_deduplication_key_unique"
      ON "webhook_event_log" ("provider", "deduplication_key")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_event_log_provider_payload_hash"
      ON "webhook_event_log" ("provider", "payload_hash")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_event_log_event_type"
      ON "webhook_event_log" ("event_type")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_event_log_status_received_at"
      ON "webhook_event_log" ("status", "received_at")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_webhook_event_log_entity"
      ON "webhook_event_log" ("entity_type", "entity_id")
      WHERE deleted_at IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "webhook_event_log" cascade;')
  }
}
