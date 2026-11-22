import { MigrationInterface, QueryRunner } from 'typeorm';

/** BE-27 (ADM-1): yashirish sababi mahsulotda saqlanadi (FE-12 «Sabab»); avval faqat hodisaga ketardi. */
export class ProductBlockReason1797379200000 implements MigrationInterface {
  name = 'ProductBlockReason1797379200000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "catalog"."product" ADD COLUMN "block_reason" VARCHAR(500)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "catalog"."product" DROP COLUMN "block_reason"`);
  }
}
