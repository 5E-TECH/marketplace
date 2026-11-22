import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-06 (SOT-1): sotuvchi SMS kod bilan ro‘yxatdan o‘tadi va ofertani qabul qiladi.
 * - `otp_state` — telefon va maqsad bo‘yicha xato urinishlar va blok (3 xato → 15 daqiqa, TZ SOT-1);
 *   yangi kod so‘ralganda hisob nolga tushmaydi.
 * - `legal_document` — oferta va rozilik matni versiyalari (matnni yurist beradi — EQ-10); seed 1.0, matn bo‘sh.
 * - `user_agreement` — qabul qilingan versiya va vaqt (TZ: «Qabul qilingan oferta versiyasi va vaqti saqlanadi»).
 * - `users.first_name`, `last_name` — sotuvchi profilida (FE-04); `name` — ikkalasidan.
 */
export class AffiliateSmsRegistration1797465600000 implements MigrationInterface {
  name = 'AffiliateSmsRegistration1797465600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "identity"."otp_state" (
        "phone" VARCHAR(20) NOT NULL,
        "purpose" VARCHAR(30) NOT NULL,
        "failed_count" INTEGER NOT NULL DEFAULT 0,
        "blocked_until" TIMESTAMPTZ,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_identity_otp_state" PRIMARY KEY ("phone", "purpose"),
        CONSTRAINT "chk_identity_otp_failed" CHECK ("failed_count" >= 0)
      )`);
    await q.query(`
      CREATE TABLE "identity"."legal_document" (
        "id" BIGSERIAL PRIMARY KEY,
        "type" VARCHAR(40) NOT NULL,
        "version" VARCHAR(20) NOT NULL,
        "effective_at" TIMESTAMPTZ,
        "summary" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "sections" JSONB NOT NULL DEFAULT '[]'::jsonb,
        "created_by" BIGINT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_identity_legal_document" UNIQUE ("type", "version"),
        CONSTRAINT "chk_identity_legal_document_type" CHECK ("type" IN ('affiliate-offer', 'personal-data-consent'))
      )`);
    await q.query(`
      INSERT INTO "identity"."legal_document" ("type", "version")
      VALUES ('affiliate-offer', '1.0'), ('personal-data-consent', '1.0')`);
    await q.query(`
      CREATE TABLE "identity"."user_agreement" (
        "id" BIGSERIAL PRIMARY KEY,
        "user_id" BIGINT NOT NULL REFERENCES "identity"."users"("id"),
        "type" VARCHAR(40) NOT NULL,
        "version" VARCHAR(20) NOT NULL,
        "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "ip" VARCHAR(64),
        CONSTRAINT "uq_identity_user_agreement" UNIQUE ("user_id", "type", "version")
      )`);
    await q.query(
      `CREATE INDEX "idx_identity_user_agreement_user" ON "identity"."user_agreement" ("user_id", "type", "accepted_at" DESC)`,
    );
    await q.query(`ALTER TABLE "identity"."users"
      ADD COLUMN "first_name" VARCHAR(100),
      ADD COLUMN "last_name" VARCHAR(100)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "identity"."users"
      DROP COLUMN "last_name",
      DROP COLUMN "first_name"`);
    await q.query(`DROP TABLE "identity"."user_agreement"`);
    await q.query(`DROP TABLE "identity"."legal_document"`);
    await q.query(`DROP TABLE "identity"."otp_state"`);
  }
}
