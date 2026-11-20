import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-07: qidiruvda do‘kon maydonlari yo‘q (do‘kon o‘rniga optovik, u xaridorga ko‘rsatilmaydi). Hujjatlar katalog
 * hodisasidan qayta yoziladi, shuning uchun ma’lumot ko‘chirilmaydi.
 */
export class DropShopFields1796083200001 implements MigrationInterface {
  name = 'DropShopFields1796083200001';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "search"."search_document"
      DROP COLUMN IF EXISTS "shop_id",
      DROP COLUMN IF EXISTS "shop_name"`);
  }

  async down(q: QueryRunner): Promise<void> {
    // Eski hujjatlar uchun bo‘sh qiymat: qayta indekslashda katalog hodisasi to‘ldiradi
    await q.query(`ALTER TABLE "search"."search_document"
      ADD COLUMN IF NOT EXISTS "shop_id" BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "shop_name" VARCHAR(255) NOT NULL DEFAULT ''`);
    await q.query(`ALTER TABLE "search"."search_document"
      ALTER COLUMN "shop_id" DROP DEFAULT,
      ALTER COLUMN "shop_name" DROP DEFAULT`);
  }
}
