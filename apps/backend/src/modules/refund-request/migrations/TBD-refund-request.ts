import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const CANONICAL_STATUSES_SQL = [
  "requested",
  "rejected",
  "stripe_create_pending",
  "stripe_created",
  "confirmation_pending",
  "confirmed",
  "failed",
  "canceled",
]
  .map((value) => `'${value}'`)
  .join(", ")

export class MigrationTBDRefundRequest extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "refund_request" (
        "id" text not null,
        "order_id" text not null,
        "payment_intent_id" text not null,
        "payment_attempt_id" text not null,
        "stripe_refund_id" text null,
        "idempotency_key" text not null,
        "amount" integer not null,
        "currency_code" text not null,
        "reason" text null,
        "operator_note" text null,
        "status" text not null default 'requested' check ("status" in (${CANONICAL_STATUSES_SQL})),
        "failure_code" text null,
        "failure_message" text null,
        "requested_by_operator_id" text null,
        "confirmed_at" timestamptz null,
        "failed_at" timestamptz null,
        "canceled_at" timestamptz null,
        "rejected_at" timestamptz null,
        "metadata" jsonb null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "refund_request_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_refund_request_idempotency_key_unique"
      ON "refund_request" ("idempotency_key")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_refund_request_stripe_refund_id_unique"
      ON "refund_request" ("stripe_refund_id")
      WHERE stripe_refund_id IS NOT NULL AND deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_refund_request_order_id"
      ON "refund_request" ("order_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_refund_request_payment_intent_id"
      ON "refund_request" ("payment_intent_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_refund_request_status"
      ON "refund_request" ("status")
      WHERE deleted_at IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "refund_request" cascade;')
  }
}
