/**
 * DRAFT — PaymentAttempt module migration.
 *
 * HUMAN REVIEW REQUIRED before running `medusa db:migrate`.
 * Generated/planned for Phase 04 Plan 02; not applied to any database.
 *
 * Constraints:
 * - Partial unique index on provider_payment_intent_id when not null
 * - Partial unique index enforcing at most one active attempt per cart
 * - amount bigint > 0 (minor monetary unit, centavos BRL)
 * - currency_code = 'brl' (MVP single-currency; matches service toLowerCase())
 * - status IN (13 canonical Phase 04 statuses)
 * - payment_session_id nullable (created may precede provider session)
 */
import { Migration } from "@medusajs/framework/mikro-orm/migrations"

const CANONICAL_STATUSES = [
  "created",
  "provider_session_created",
  "client_action_required",
  "card_client_secret_created",
  "payment_client_confirmed",
  "payment_instructions_displayed",
  "awaiting_pix_payment",
  "awaiting_webhook_confirmation",
  "pix_expired",
  "payment_failed",
  "payment_canceled",
  "superseded",
  "invalidated_by_cart_change",
] as const

const CANONICAL_STATUSES_SQL = CANONICAL_STATUSES.map(
  (status) => `'${status}'`
).join(", ")

const ACTIVE_STATUSES_SQL = [
  "created",
  "provider_session_created",
  "client_action_required",
  "card_client_secret_created",
  "payment_client_confirmed",
  "payment_instructions_displayed",
  "awaiting_pix_payment",
  "awaiting_webhook_confirmation",
]
  .map((status) => `'${status}'`)
  .join(", ")

export class CreatePaymentAttempt20260629000000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      create table if not exists "payment_attempt" (
        "id" text not null,
        "cart_id" text not null,
        "payment_collection_id" text not null,
        "payment_session_id" text null,
        "provider" text not null,
        "provider_payment_intent_id" text null,
        "provider_payment_session_id" text null,
        "payment_method_type" text check ("payment_method_type" in ('card', 'pix')) not null,
        "status" text not null default 'created' check ("status" in (${CANONICAL_STATUSES_SQL})),
        "amount" bigint not null check ("amount" > 0),
        "currency_code" text not null check ("currency_code" = 'brl'),
        "expires_at" timestamptz null,
        "order_id" text null,
        "metadata" jsonb null,
        "client_confirmed_at" timestamptz null,
        "instructions_displayed_at" timestamptz null,
        "awaiting_webhook_since" timestamptz null,
        "superseded_at" timestamptz null,
        "invalidated_at" timestamptz null,
        "canceled_at" timestamptz null,
        "failed_at" timestamptz null,
        "expired_at" timestamptz null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        "deleted_at" timestamptz null,
        constraint "payment_attempt_pkey" primary key ("id")
      );
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_attempt_cart_id"
      ON "payment_attempt" ("cart_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_attempt_status"
      ON "payment_attempt" ("status")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_attempt_cart_provider_pi"
      ON "payment_attempt" ("cart_id", "provider_payment_intent_id")
      WHERE deleted_at IS NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_attempt_provider_pi_unique"
      ON "payment_attempt" ("provider_payment_intent_id")
      WHERE deleted_at IS NULL
        AND provider_payment_intent_id IS NOT NULL;
    `)

    this.addSql(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_attempt_one_active_per_cart"
      ON "payment_attempt" ("cart_id")
      WHERE deleted_at IS NULL
        AND status IN (${ACTIVE_STATUSES_SQL});
    `)
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "payment_attempt" cascade;')
  }
}
