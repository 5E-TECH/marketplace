import { MigrationInterface, QueryRunner } from 'typeorm';

const PRODUCT_STATUSES_OLD = ['DRAFT', 'ACTIVE', 'ARCHIVED', 'OUT_OF_STOCK'];
const PRODUCT_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'REJECTED',
  'ARCHIVED',
  'OUT_OF_STOCK',
];
const list = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

/**
 * BE-07: do‘kon o‘rniga optovik va CPA mahsulot maydonlari.
 * - optovik (`catalog.shop`): foydalanuvchisiz (admin kiritadi), OPT-1 rekvizitlari; tariflar olib tashlanadi;
 * - mahsulot: bazaviy narx, sotuvchi haqi, og‘irlik va o‘lchamlar, CPA va BAD belgilari, moderatsiya holatlari;
 *   yangi mahsulot sukuti `PENDING_REVIEW`; slug global unikal (takrorlar `-<id>` bilan ajratiladi).
 */
export class WholesalerCpaProduct1796083200000 implements MigrationInterface {
  name = 'WholesalerCpaProduct1796083200000';

  async up(q: QueryRunner): Promise<void> {
    // Optovik
    await q.query(
      `ALTER TABLE "catalog"."shop" ALTER COLUMN "owner_user_id" DROP NOT NULL`,
    );
    await q.query(`ALTER TABLE "catalog"."shop"
      ADD COLUMN "legal_type" VARCHAR(20),
      ADD COLUMN "tin" VARCHAR(9),
      ADD COLUMN "bank_name" VARCHAR(255),
      ADD COLUMN "bank_account" VARCHAR(20),
      ADD COLUMN "bank_mfo" VARCHAR(5),
      ADD COLUMN "contract_number" VARCHAR(64),
      ADD COLUMN "contract_date" DATE,
      ADD CONSTRAINT "chk_catalog_shop_legal_type" CHECK ("legal_type" IS NULL OR "legal_type" IN ('LEGAL_ENTITY', 'SOLE_PROPRIETOR')),
      ADD CONSTRAINT "chk_catalog_shop_tin" CHECK ("tin" IS NULL OR "tin" ~ '^[0-9]{9}$'),
      ADD CONSTRAINT "chk_catalog_shop_bank_account" CHECK ("bank_account" IS NULL OR "bank_account" ~ '^[0-9]{20}$'),
      ADD CONSTRAINT "chk_catalog_shop_bank_mfo" CHECK ("bank_mfo" IS NULL OR "bank_mfo" ~ '^[0-9]{5}$')`);
    // Bitta STIR — bitta optovik (o‘chirilganlardan tashqari)
    await q.query(`CREATE UNIQUE INDEX "uq_catalog_shop_tin" ON "catalog"."shop" ("tin")
      WHERE "tin" IS NOT NULL AND "is_deleted" = FALSE`);
    await q.query(`ALTER TABLE "catalog"."shop"
      DROP COLUMN IF EXISTS "tariff_home",
      DROP COLUMN IF EXISTS "tariff_center"`);

    // Mahsulot
    await q.query(
      `ALTER TABLE "catalog"."product" ALTER COLUMN "owner_user_id" DROP NOT NULL`,
    );
    await q.query(
      `ALTER TABLE "catalog"."product" DROP CONSTRAINT IF EXISTS "chk_catalog_product_status"`,
    );
    await q.query(
      `ALTER TABLE "catalog"."product" ADD CONSTRAINT "chk_catalog_product_status" CHECK ("status" IN (${list(PRODUCT_STATUSES)}))`,
    );
    await q.query(
      `ALTER TABLE "catalog"."product" ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW'`,
    );
    await q.query(`ALTER TABLE "catalog"."product"
      ADD COLUMN "moderation_note" TEXT,
      ADD COLUMN "base_price" BIGINT,
      ADD COLUMN "affiliate_fee" BIGINT,
      ADD COLUMN "weight_grams" INTEGER,
      ADD COLUMN "length_mm" INTEGER,
      ADD COLUMN "width_mm" INTEGER,
      ADD COLUMN "height_mm" INTEGER,
      ADD COLUMN "cpa_enabled" BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN "is_bad" BOOLEAN NOT NULL DEFAULT FALSE,
      ADD CONSTRAINT "chk_catalog_product_base_price" CHECK ("base_price" IS NULL OR "base_price" >= 0),
      ADD CONSTRAINT "chk_catalog_product_affiliate_fee" CHECK ("affiliate_fee" IS NULL OR "affiliate_fee" >= 0),
      ADD CONSTRAINT "chk_catalog_product_weight" CHECK ("weight_grams" IS NULL OR "weight_grams" > 0),
      ADD CONSTRAINT "chk_catalog_product_dimensions" CHECK (
        ("length_mm" IS NULL OR "length_mm" > 0) AND ("width_mm" IS NULL OR "width_mm" > 0) AND ("height_mm" IS NULL OR "height_mm" > 0))`);

    // Eski mahsulotlar CPA offeriga avtomatik aylanmaydi (og‘irlik, narx, shartnoma yo‘q): ular uchun FALSE,
    // yangi mahsulot sukuti — TRUE (admin tasdig‘idan keyin sotuvchilarga ochiladi)
    await q.query(
      `ALTER TABLE "catalog"."product" ALTER COLUMN "cpa_enabled" SET DEFAULT TRUE`,
    );

    // Slug global unikal: takrorlarda eng kichik id o‘z slugini saqlaydi, qolganlariga `--<id>` qo‘shiladi.
    // `toSlug` hech qachon `--` hosil qilmaydi, shuning uchun mavjud `iphone-15` bilan to‘qnashmaydi; 255 belgiga sig‘adi.
    await q.query(`UPDATE "catalog"."product" p
      SET "slug" = LEFT(p."slug", 255 - LENGTH('--' || p."id")) || '--' || p."id"
      WHERE EXISTS (SELECT 1 FROM "catalog"."product" o WHERE o."slug" = p."slug" AND o."id" < p."id")`);
    await q.query(
      `ALTER TABLE "catalog"."product" DROP CONSTRAINT IF EXISTS "uq_catalog_product_shop_slug"`,
    );
    await q.query(
      `ALTER TABLE "catalog"."product" ADD CONSTRAINT "uq_catalog_product_slug" UNIQUE ("slug")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "catalog"."product" DROP CONSTRAINT IF EXISTS "uq_catalog_product_slug"`,
    );
    await q.query(
      `ALTER TABLE "catalog"."product" ADD CONSTRAINT "uq_catalog_product_shop_slug" UNIQUE ("shop_id", "slug")`,
    );
    await q.query(`ALTER TABLE "catalog"."product"
      DROP CONSTRAINT IF EXISTS "chk_catalog_product_base_price",
      DROP CONSTRAINT IF EXISTS "chk_catalog_product_affiliate_fee",
      DROP CONSTRAINT IF EXISTS "chk_catalog_product_weight",
      DROP CONSTRAINT IF EXISTS "chk_catalog_product_dimensions",
      DROP COLUMN IF EXISTS "moderation_note",
      DROP COLUMN IF EXISTS "base_price",
      DROP COLUMN IF EXISTS "affiliate_fee",
      DROP COLUMN IF EXISTS "weight_grams",
      DROP COLUMN IF EXISTS "length_mm",
      DROP COLUMN IF EXISTS "width_mm",
      DROP COLUMN IF EXISTS "height_mm",
      DROP COLUMN IF EXISTS "cpa_enabled",
      DROP COLUMN IF EXISTS "is_bad"`);
    await q.query(
      `ALTER TABLE "catalog"."product" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'`,
    );
    await q.query(
      `ALTER TABLE "catalog"."product" DROP CONSTRAINT IF EXISTS "chk_catalog_product_status"`,
    );
    // Yangi holatli mahsulot bo‘lsa, eski CHECK qo‘yilmaydi — xato bilan to‘xtaydi (ma’lumot buzilmaydi)
    await q.query(
      `ALTER TABLE "catalog"."product" ADD CONSTRAINT "chk_catalog_product_status" CHECK ("status" IN (${list(PRODUCT_STATUSES_OLD)}))`,
    );
    // Egasiz mahsulot yoki optovik bo‘lsa, NOT NULL qaytmaydi — xato bilan to‘xtaydi
    await q.query(
      `ALTER TABLE "catalog"."product" ALTER COLUMN "owner_user_id" SET NOT NULL`,
    );
    await q.query(`ALTER TABLE "catalog"."shop"
      ADD COLUMN IF NOT EXISTS "tariff_home" BIGINT NOT NULL DEFAULT 25000,
      ADD COLUMN IF NOT EXISTS "tariff_center" BIGINT NOT NULL DEFAULT 15000`);
    await q.query(`DROP INDEX IF EXISTS "catalog"."uq_catalog_shop_tin"`);
    await q.query(`ALTER TABLE "catalog"."shop"
      DROP CONSTRAINT IF EXISTS "chk_catalog_shop_legal_type",
      DROP CONSTRAINT IF EXISTS "chk_catalog_shop_tin",
      DROP CONSTRAINT IF EXISTS "chk_catalog_shop_bank_account",
      DROP CONSTRAINT IF EXISTS "chk_catalog_shop_bank_mfo",
      DROP COLUMN IF EXISTS "legal_type",
      DROP COLUMN IF EXISTS "tin",
      DROP COLUMN IF EXISTS "bank_name",
      DROP COLUMN IF EXISTS "bank_account",
      DROP COLUMN IF EXISTS "bank_mfo",
      DROP COLUMN IF EXISTS "contract_number",
      DROP COLUMN IF EXISTS "contract_date"`);
    await q.query(
      `ALTER TABLE "catalog"."shop" ALTER COLUMN "owner_user_id" SET NOT NULL`,
    );
  }
}
