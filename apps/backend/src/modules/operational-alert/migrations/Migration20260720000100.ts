import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260720000100 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "operational_alert" (
        "id" text not null,
        "type" text not null,
        "severity" text not null,
        "status" text not null default 'open',
        "entity_type" text not null,
        "entity_id" text not null,
        "message_code" text not null,
        "message" text not null,
        "error_code" text null,
        "metadata" jsonb null,
        "first_seen_at" timestamptz not null default now(),
        "last_seen_at" timestamptz not null default now(),
        "occurrence_count" integer not null default 1,
        "acknowledged_at" timestamptz null,
        "acknowledged_by" text null,
        "resolved_at" timestamptz null,
        "resolved_by" text null,
        "ignored_at" timestamptz null,
        "ignored_by" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "operational_alert_pkey" primary key ("id"),
        constraint "CK_operational_alert_type"
          check ("type" in ('payment_stuck', 'fulfillment_failed')),
        constraint "CK_operational_alert_severity"
          check ("severity" in ('low', 'medium', 'high', 'critical')),
        constraint "CK_operational_alert_status"
          check ("status" in ('open', 'acknowledged', 'resolved', 'ignored')),
        constraint "CK_operational_alert_entity_type"
          check ("entity_type" in ('payment_attempt', 'fulfillment')),
        constraint "CK_operational_alert_entity_id"
          check (length(btrim("entity_id")) between 1 and 128),
        constraint "CK_operational_alert_occurrence_count"
          check ("occurrence_count" >= 1),
        constraint "UQ_operational_alert_logical_key"
          unique ("type", "entity_type", "entity_id")
      );
    `)

    this.addSql(`
      create index if not exists "IDX_operational_alert_status_severity"
      on "operational_alert" ("status", "severity");
    `)
    this.addSql(`
      create index if not exists "IDX_operational_alert_entity"
      on "operational_alert" ("entity_type", "entity_id");
    `)
    this.addSql(`
      create index if not exists "IDX_operational_alert_type_last_seen"
      on "operational_alert" ("type", "last_seen_at" desc);
    `)
    this.addSql(`
      create index if not exists "IDX_operational_alert_last_seen_id"
      on "operational_alert" ("last_seen_at" desc, "id" desc);
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "operational_alert" cascade;')
  }
}
