import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const CANONICAL_STATUSES_SQL = ["active", "expired", "revoked"]
  .map((value) => `'${value}'`)
  .join(", ")

const CANONICAL_CREATED_FOR_SQL = ["guest_tracking"]
  .map((value) => `'${value}'`)
  .join(", ")

export class MigrationTBDTrackingAccessToken extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "tracking_access_token" (
        "id" text not null,
        "order_id" text not null,
        "gelato_fulfillment_id" text not null,
        "token_hash" text not null,
        "status" text not null default 'active' check ("status" in (${CANONICAL_STATUSES_SQL})),
        "expires_at" timestamptz not null,
        "revoked_at" timestamptz null,
        "last_used_at" timestamptz null,
        "created_for" text not null default 'guest_tracking' check ("created_for" in (${CANONICAL_CREATED_FOR_SQL})),
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "tracking_access_token_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tracking_access_token_token_hash_unique"
      ON "tracking_access_token" ("token_hash")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_tracking_access_token_order_id"
      ON "tracking_access_token" ("order_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_tracking_access_token_gelato_fulfillment_id"
      ON "tracking_access_token" ("gelato_fulfillment_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_tracking_access_token_status_expires_at"
      ON "tracking_access_token" ("status", "expires_at")
      WHERE deleted_at IS NULL;
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "tracking_access_token" cascade;')
  }
}
