import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260809201808 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table if not exists "store_resource_version" ("id" text not null, "resource_type" text not null, "resource_id" text not null, "version" integer not null default 1, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "store_resource_version_pkey" primary key ("id"), constraint store_resource_version_version_check check (version > 0));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_resource_version_deleted_at" ON "store_resource_version" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_store_resource_version_resource" ON "store_resource_version" ("resource_type", "resource_id") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "store_resource_version" cascade;`);
  }

}
