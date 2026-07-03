import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const CANONICAL_STATUSES_SQL = [
  "opened",
  "awaiting_customer_return",
  "return_in_transit",
  "return_received",
  "replacement_review",
  "resolved",
  "rejected",
  "canceled",
]
  .map((value) => `'${value}'`)
  .join(", ")

const CANONICAL_REASONS_SQL = ["defect", "wrong_product"]
  .map((value) => `'${value}'`)
  .join(", ")

const CANONICAL_PROVIDERS_SQL = ["correios_manual", "other_manual"]
  .map((value) => `'${value}'`)
  .join(", ")

export class MigrationTBDExchangeRequest extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "exchange_request" (
        "id" text not null,
        "order_id" text not null,
        "reason" text not null check ("reason" in (${CANONICAL_REASONS_SQL})),
        "status" text not null default 'opened' check ("status" in (${CANONICAL_STATUSES_SQL})),
        "affected_items" jsonb not null default '[]'::jsonb,
        "customer_visible_note" text null,
        "operator_note" text null,
        "reverse_logistics_provider" text null check ("reverse_logistics_provider" is null or "reverse_logistics_provider" in (${CANONICAL_PROVIDERS_SQL})),
        "reverse_tracking_code" text null,
        "reverse_authorization_code" text null,
        "reverse_label_reference" text null,
        "return_received_at" timestamptz null,
        "resolved_at" timestamptz null,
        "created_by_operator_id" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "exchange_request_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_exchange_request_order_id"
      ON "exchange_request" ("order_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_exchange_request_status"
      ON "exchange_request" ("status")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_exchange_request_reason"
      ON "exchange_request" ("reason")
      WHERE deleted_at IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "exchange_request" cascade;')
  }
}
