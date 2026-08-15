import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260814030000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      alter table "operational_alert"
        drop constraint if exists "CK_operational_alert_type",
        add constraint "CK_operational_alert_type"
          check ("type" in ('payment_stuck', 'fulfillment_failed', 'auth_notification_failed'));
    `)
    this.addSql(`
      alter table "operational_alert"
        drop constraint if exists "CK_operational_alert_entity_type",
        add constraint "CK_operational_alert_entity_type"
          check ("entity_type" in ('payment_attempt', 'fulfillment', 'auth_notification_outbox'));
    `)
  }

  async down(): Promise<void> {
    this.addSql(`
      alter table "operational_alert"
        drop constraint if exists "CK_operational_alert_type",
        add constraint "CK_operational_alert_type"
          check ("type" in ('payment_stuck', 'fulfillment_failed'));
    `)
    this.addSql(`
      alter table "operational_alert"
        drop constraint if exists "CK_operational_alert_entity_type",
        add constraint "CK_operational_alert_entity_type"
          check ("entity_type" in ('payment_attempt', 'fulfillment'));
    `)
  }
}
