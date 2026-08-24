import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260824160628 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "cart_merge_result" ("id" text not null, "idempotency_record_id" text not null, "customer_id" text not null, "guest_cart_id" text not null, "customer_cart_id" text null, "canonical_cart_id" text not null, "capability_id" text not null, "capability_hash" text null, "request_fingerprint" text not null, "guest_version_before" integer not null, "customer_version_before" integer null, "guest_version_after" integer not null, "customer_version_after" integer null, "outcome" text check ("outcome" in ('MERGED', 'MERGED_PARTIAL', 'GUEST_CART_ATTACHED', 'CUSTOMER_CART_PRESERVED', 'NO_ITEMS')) not null, "rejected_items" jsonb not null, "review_id" text null, "review_ref" text null, "original_public_cart_snapshot" jsonb not null, "original_review_snapshot" jsonb not null, "original_etag" text not null, "expires_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cart_merge_result_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cart_merge_result_deleted_at" ON "cart_merge_result" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cart_merge_result_idempotency_record" ON "cart_merge_result" ("idempotency_record_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cart_merge_result_customer_id" ON "cart_merge_result" ("customer_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cart_merge_result_guest_cart_id" ON "cart_merge_result" ("guest_cart_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cart_merge_result_canonical_cart_id" ON "cart_merge_result" ("canonical_cart_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cart_merge_result_expires_at" ON "cart_merge_result" ("expires_at") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "cart_review" ("id" text not null, "cart_id" text not null, "review_ref" text not null, "merge_result_id" text not null, "produced_cart_version" integer not null, "status" text check ("status" in ('pending', 'acknowledged')) not null default 'pending', "rejected_items" jsonb not null, "acknowledged_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "cart_review_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cart_review_deleted_at" ON "cart_review" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cart_review_review_ref" ON "cart_review" ("review_ref") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cart_review_merge_result" ON "cart_review" ("merge_result_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_cart_review_pending_cart" ON "cart_review" ("cart_id") WHERE status = 'pending' AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_cart_review_cart_status" ON "cart_review" ("cart_id", "status") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "customer_cart_authority" ("id" text not null, "customer_id" text not null, "cart_id" text not null, "state" text check ("state" in ('active', 'superseded')) not null default 'active', "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "customer_cart_authority_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_cart_authority_deleted_at" ON "customer_cart_authority" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_cart_authority_active_customer" ON "customer_cart_authority" ("customer_id") WHERE state = 'active' AND deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_cart_authority_active_cart" ON "customer_cart_authority" ("cart_id") WHERE state = 'active' AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_customer_cart_authority_state" ON "customer_cart_authority" ("state") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "cart_merge_result" cascade;`);

    this.addSql(`drop table if exists "cart_review" cascade;`);

    this.addSql(`drop table if exists "customer_cart_authority" cascade;`);
  }

}
