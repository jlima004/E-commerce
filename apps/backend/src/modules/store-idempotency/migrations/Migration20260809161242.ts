import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260809161242 extends Migration {

  override async up(): Promise<void> {
    // CLI-generated base DDL retained; version CHECKs added post-review to match
    // approved DB_MODEL_v1.22 §4.17 (MikroORM emit defaults only for these fields).
    this.addSql(`create table if not exists "store_idempotency_record" ("id" text not null, "operation" text not null, "actor_scope_hash" text not null, "resource_scope_hash" text not null, "idempotency_key_hash" text not null, "hash_version" text not null default 'hmac-sha256-v1', "pepper_version" integer not null default 1, "request_fingerprint" text not null, "state" text check ("state" in ('processing', 'completed', 'failed_retryable', 'failed_terminal', 'reconciliation_required', 'reconciliation_unresolved')) not null default 'processing', "state_version" integer not null default 1, "result_type" text null, "result_id" text null, "response_status" integer null, "result_safe_metadata" jsonb null, "locked_at" timestamptz null, "state_deadline_at" timestamptz null, "next_retry_at" timestamptz null, "retry_attempt_count" integer not null default 0, "retry_started_at" timestamptz null, "terminalized_at" timestamptz null, "completed_at" timestamptz null, "failure_code" text null, "expires_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "store_idempotency_record_pkey" primary key ("id"), constraint "store_idempotency_record_hash_version_check" check ("hash_version" = 'hmac-sha256-v1'), constraint "store_idempotency_record_pepper_version_check" check ("pepper_version" = 1), constraint "store_idempotency_record_state_version_check" check ("state_version" >= 1));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_idempotency_record_deleted_at" ON "store_idempotency_record" ("deleted_at") WHERE deleted_at IS NULL;`);
    // Non-partial UNIQUE required for frozen service claim() ON CONFLICT
    // (operation, actor_scope_hash, resource_scope_hash, idempotency_key_hash).
    // CLI emitted WHERE deleted_at IS NULL; PG cannot infer that partial index
    // for ON CONFLICT without a matching predicate (frozen service has none).
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_store_idempotency_record_claim_scope" ON "store_idempotency_record" ("operation", "actor_scope_hash", "resource_scope_hash", "idempotency_key_hash");`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_idempotency_record_state_deadline" ON "store_idempotency_record" ("state", "state_deadline_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_idempotency_record_next_retry_at" ON "store_idempotency_record" ("next_retry_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_store_idempotency_record_expires_at" ON "store_idempotency_record" ("expires_at") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "store_idempotency_record" cascade;`);
  }

}
