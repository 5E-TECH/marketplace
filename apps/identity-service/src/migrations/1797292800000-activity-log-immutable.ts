import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-27 (ADM-6): audit jurnali o‘zgartirilmaydi va o‘chirilmaydi — bazada ham. Ilovada tahrir/o‘chirish yo‘li
 * yo‘q (C1.31), lekin to‘g‘ridan-to‘g‘ri SQL yoki kelajakdagi kod ham yozuvni o‘zgartira olmasin.
 * 3 yil saqlash: tozalash ishi yo‘q; eskisini o‘chirish — ega qarori bilan, trigger vaqtincha olinadi.
 */
export class ActivityLogImmutable1797292800000 implements MigrationInterface {
  name = 'ActivityLogImmutable1797292800000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION "identity"."activity_log_immutable"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Audit yozuvini o‘zgartirib yoki o‘chirib bo‘lmaydi (activity_log %)', OLD.id
          USING ERRCODE = 'insufficient_privilege';
      END
      $$`);
    await q.query(`
      CREATE TRIGGER "trg_activity_log_immutable"
        BEFORE UPDATE OR DELETE ON "identity"."activity_log"
        FOR EACH ROW EXECUTE FUNCTION "identity"."activity_log_immutable"()`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP TRIGGER IF EXISTS "trg_activity_log_immutable" ON "identity"."activity_log"`,
    );
    await q.query(
      `DROP FUNCTION IF EXISTS "identity"."activity_log_immutable"()`,
    );
  }
}
