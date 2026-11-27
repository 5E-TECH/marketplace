import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FE-26: tanlanmagan yetkazish turida mijozga ko‘rinadigan summa (buyurtma paytidagi, katalog nusxasidan) — kartadagi
 * «eshikkacha bo‘lsa …» izohi uchun. Eski buyurtmalarda NULL (qayta hisoblanmaydi).
 */
export class DeliveryShownOther1799280000000 implements MigrationInterface {
  name = 'DeliveryShownOther1799280000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "checkout"."sales_order" ADD COLUMN "delivery_shown_other" BIGINT`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "checkout"."sales_order" DROP COLUMN "delivery_shown_other"`,
    );
  }
}
