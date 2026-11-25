import { MigrationInterface, QueryRunner } from 'typeorm';

/** BE-25 (FE-26): qaytarish so‘roviga mijoz rasmlari (fayl yopiq joyda, bu yerda — kaliti). */
export class ReturnPhoto1799020800000 implements MigrationInterface {
  name = 'ReturnPhoto1799020800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "checkout"."return_photo" (
        "id" BIGSERIAL PRIMARY KEY,
        "return_request_id" BIGINT NOT NULL REFERENCES "checkout"."return_request"("id"),
        "object_key" VARCHAR(200) NOT NULL,
        "content_type" VARCHAR(40) NOT NULL,
        "size" INTEGER NOT NULL,
        "uploaded_by" BIGINT NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_checkout_return_photo_key" UNIQUE ("object_key"),
        CONSTRAINT "chk_checkout_return_photo_size" CHECK ("size" > 0)
      )
    `);
    await q.query(`
      CREATE INDEX "idx_checkout_return_photo_request"
      ON "checkout"."return_photo" ("return_request_id", "id")
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "checkout"."return_photo"`);
  }
}
