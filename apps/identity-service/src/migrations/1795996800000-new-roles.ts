import { MigrationInterface, QueryRunner } from 'typeorm';

/** TZ 3-bo‘lim: sakkizta rol (BE-05). Tartib `Role` enumi bilan bir xil. */
export const NEW_ROLES = [
  'AFFILIATE',
  'WHOLESALER',
  'OPERATOR_LEAD',
  'SUPERVISOR',
  'WAREHOUSE',
  'FINANCE',
  'ADMIN',
  'SUPERADMIN',
] as const;
const OLD_ROLES = ['BUYER', 'SELLER', 'OPERATOR', 'ADMIN', 'SUPERADMIN'];

const roleCheck = (roles: readonly string[]) =>
  `ALTER TABLE "identity"."users" ADD CONSTRAINT "chk_identity_users_role" CHECK ("role" IN (${roles
    .map((role) => `'${role}'`)
    .join(', ')}))`;

/**
 * BE-05: yangi rollar, `users.shop_id` olib tashlanadi (JWT da do‘kon yo‘q, identity catalog.shop ga yozmaydi).
 *
 * Eski SELLER/BUYER/OPERATOR qatorlari ko‘chirilmaydi: TZ 1-bo‘lim 3-qaror — «elchimarket.uz yopiladi, ma’lumot
 * ko‘chirilmaydi»; prod toza bazada boshlanadi (BE-40). Bunday qator bor bazada migratsiya hech narsani o‘zgartirmay
 * to‘xtaydi — rolni jimgina almashtirish yoki o‘chirish o‘rniga.
 */
export class NewRoles1795996800000 implements MigrationInterface {
  name = 'NewRoles1795996800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const old = (await queryRunner.query(
      `SELECT "role", COUNT(*)::int AS "count" FROM "identity"."users" WHERE "role" <> ALL($1::text[]) GROUP BY "role" ORDER BY "role"`,
      [[...NEW_ROLES]],
    )) as Array<{ role: string; count: number }>;
    if (old.length) {
      throw new Error(
        `identity.users da eski rollar bor (${old
          .map((row) => `${row.role}: ${row.count}`)
          .join(
            ', ',
          )}). Ma’lumot ko‘chirilmaydi (TZ 1-bo‘lim 3-qaror) — eski baza arxivlanadi va toza baza bilan boshlanadi (BE-40).`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE "identity"."users" DROP CONSTRAINT IF EXISTS "chk_identity_users_role"`,
    );
    await queryRunner.query(roleCheck(NEW_ROLES));
    await queryRunner.query(
      `DROP INDEX IF EXISTS "identity"."idx_identity_users_shop"`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity"."users" DROP COLUMN IF EXISTS "shop_id"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "shop_id" BIGINT`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_identity_users_shop" ON "identity"."users" ("shop_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "identity"."users" DROP CONSTRAINT IF EXISTS "chk_identity_users_role"`,
    );
    // Yangi rolli qator bo‘lsa, eski CHECK qo‘yilmaydi — Postgres xatosi bilan to‘xtaydi (qaytarish ma’lumotni buzmaydi).
    await queryRunner.query(roleCheck(OLD_ROLES));
  }
}
