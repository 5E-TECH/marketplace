import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-44 / QA-02: qaytarish so‘rovi ochiq turgan buyurtmalar. Endi so‘rov Elchi pulni o‘tkazgan («Pul o‘tkazildi»)
 * buyurtmaga ham ochiladi — optovik yozuvlari AVAILABLE va qaytarish muddati o‘tgan bo‘lishi mumkin. So‘rov hal
 * bo‘lmaguncha bu buyurtma optovikning haftalik aktiga kirmaydi (aks holda pul optovikka ketib, keyin qarz bo‘lardi).
 * Belgi `order.status.changed` RETURN_REQUESTED da qo‘yiladi; rad (DELIVERED/REMITTED) yoki `order.returned` da olinadi.
 */
export class CreateReturnPending1799193600000 implements MigrationInterface {
  name = 'CreateReturnPending1799193600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "finance"."return_pending" (
        "order_id" VARCHAR(64) PRIMARY KEY,
        "requested_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "finance"."return_pending"`);
  }
}
