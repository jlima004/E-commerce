import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260720000200 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "admin_action_log" (
        "id" text not null,
        "action_attempt_id" text not null,
        "correlation_id" text not null,
        "audit_stage" text not null,
        "admin_id" text not null,
        "admin_email" text null,
        "action" text not null,
        "entity_type" text not null,
        "entity_id" text not null,
        "result" text not null,
        "severity" text not null default 'info',
        "reason" text null,
        "previous_state" jsonb null,
        "new_state" jsonb null,
        "metadata" jsonb null,
        "idempotency_key" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "admin_action_log_pkey" primary key ("id"),
        constraint "CK_admin_action_log_audit_stage"
          check ("audit_stage" in ('intent', 'outcome', 'reconciliation')),
        constraint "CK_admin_action_log_result"
          check ("result" in ('requested', 'succeeded', 'failed', 'blocked')),
        constraint "CK_admin_action_log_severity"
          check ("severity" in ('info', 'warning', 'critical')),
        constraint "CK_admin_action_log_action"
          check ("action" in (
            'refund_order',
            'update_exchange',
            'reject_exchange',
            'cancel_exchange'
          )),
        constraint "CK_admin_action_log_entity_type"
          check ("entity_type" in ('refund_request', 'exchange_request')),
        constraint "CK_admin_action_log_action_attempt_id"
          check (length(btrim("action_attempt_id")) between 1 and 128),
        constraint "CK_admin_action_log_correlation_id"
          check (length(btrim("correlation_id")) between 1 and 128),
        constraint "CK_admin_action_log_admin_id"
          check (length(btrim("admin_id")) between 1 and 128),
        constraint "CK_admin_action_log_entity_id"
          check (length(btrim("entity_id")) between 1 and 128),
        constraint "CK_admin_action_log_reason"
          check ("reason" is null or length("reason") <= 500),
        constraint "CK_admin_action_log_idempotency_key"
          check ("idempotency_key" is null or length("idempotency_key") <= 255),
        constraint "CK_admin_action_log_intent_result"
          check ("audit_stage" <> 'intent' or "result" = 'requested'),
        constraint "CK_admin_action_log_previous_state_object"
          check (
            "previous_state" is null
            or jsonb_typeof("previous_state") = 'object'
          ),
        constraint "CK_admin_action_log_new_state_object"
          check (
            "new_state" is null
            or jsonb_typeof("new_state") = 'object'
          ),
        constraint "CK_admin_action_log_metadata_object"
          check (
            "metadata" is null
            or jsonb_typeof("metadata") = 'object'
          )
      );
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_admin_action_log_attempt_intent"
      ON "admin_action_log" ("action_attempt_id")
      WHERE "audit_stage" = 'intent';
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_admin_action_log_attempt_terminal"
      ON "admin_action_log" ("action_attempt_id")
      WHERE "audit_stage" IN ('outcome', 'reconciliation');
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_action_log_actor_created"
      ON "admin_action_log" ("admin_id", "created_at" DESC);
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_action_log_entity_created"
      ON "admin_action_log" ("entity_type", "entity_id", "created_at" DESC);
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_action_log_attempt_created"
      ON "admin_action_log" ("action_attempt_id", "created_at");
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_action_log_correlation_created"
      ON "admin_action_log" ("correlation_id", "created_at");
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_action_log_idempotency_key"
      ON "admin_action_log" ("idempotency_key")
      WHERE "idempotency_key" IS NOT NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_admin_action_log_orphan_scan"
      ON "admin_action_log" ("audit_stage", "created_at", "id")
      WHERE "audit_stage" = 'intent';
    `)

    this.addSql(`
      CREATE OR REPLACE FUNCTION reject_admin_action_log_mutation()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'ADMIN_ACTION_LOG_APPEND_ONLY'
          USING ERRCODE = '55000';
      END;
      $$;
    `)

    this.addSql(`
      CREATE TRIGGER "TRG_admin_action_log_append_only"
      BEFORE UPDATE OR DELETE ON "admin_action_log"
      FOR EACH ROW
      EXECUTE FUNCTION reject_admin_action_log_mutation();
    `)
  }

  async down(): Promise<void> {
    this.addSql(
      'DROP TRIGGER IF EXISTS "TRG_admin_action_log_append_only" ON "admin_action_log";'
    )
    this.addSql(
      "DROP FUNCTION IF EXISTS reject_admin_action_log_mutation();"
    )
    this.addSql('DROP TABLE IF EXISTS "admin_action_log" CASCADE;')
  }
}
