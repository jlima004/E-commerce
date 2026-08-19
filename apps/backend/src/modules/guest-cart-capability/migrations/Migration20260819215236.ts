import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260819215236 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "guest_cart_capability" drop constraint if exists "guest_cart_capability_cart_id_active_unique";`);
    this.addSql(`alter table if exists "guest_cart_capability" drop constraint if exists "guest_cart_capability_token_hash_unique";`);
    this.addSql(`create table if not exists "guest_cart_capability" ("id" text not null, "cart_id" text not null, "token_hash" text not null, "status" text check ("status" in ('active', 'expired', 'revoked', 'consumed')) not null default 'active', "expires_at" timestamptz not null, "consumed_at" timestamptz null, "revoked_at" timestamptz null, "last_used_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "guest_cart_capability_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_guest_cart_capability_deleted_at" ON "guest_cart_capability" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_guest_cart_capability_token_hash_unique" ON "guest_cart_capability" ("token_hash") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_guest_cart_capability_cart_id_active_unique" ON "guest_cart_capability" ("cart_id") WHERE status = 'active' AND deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_guest_cart_capability_status_expires_at" ON "guest_cart_capability" ("status", "expires_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "guest_cart_capability" cascade;`);
  }

}
