import { MigrationInterface, QueryRunner } from 'typeorm';

/** BE-25 (FE-26): buyurtma kartasidagi SMS jurnali — mijoz SMS lari buyurtma ID si bo‘yicha topiladi. */
export class OrderSmsIndex1799020800000 implements MigrationInterface {
  name = 'OrderSmsIndex1799020800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE INDEX "idx_notification_customer_order"
      ON "notification"."notification" (("data"->>'orderId'), "id")
      WHERE "user_id" IS NULL
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP INDEX IF EXISTS "notification"."idx_notification_customer_order"`,
    );
  }
}
