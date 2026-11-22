import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-30 (OPT-1): optovik bilan elektron komissiya shartnomasi — huquqiy hujjat turi `wholesaler-contract`. Seed 1.0
 * bo‘sh: yurist matni e’lon qilinmaguncha optovik o‘zi ro‘yxatdan o‘ta olmaydi (BE-06 dagi oferta kabi).
 */
export class WholesalerContract1798329600000 implements MigrationInterface {
  name = 'WholesalerContract1798329600000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "identity"."legal_document"
      DROP CONSTRAINT "chk_identity_legal_document_type",
      ADD CONSTRAINT "chk_identity_legal_document_type"
        CHECK ("type" IN ('affiliate-offer', 'personal-data-consent', 'wholesaler-contract'))`);
    await q.query(`
      INSERT INTO "identity"."legal_document" ("type", "version")
      VALUES ('wholesaler-contract', '1.0')
      ON CONFLICT ("type", "version") DO NOTHING`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "identity"."user_agreement" WHERE "type" = 'wholesaler-contract'`,
    );
    await q.query(
      `DELETE FROM "identity"."legal_document" WHERE "type" = 'wholesaler-contract'`,
    );
    await q.query(`ALTER TABLE "identity"."legal_document"
      DROP CONSTRAINT "chk_identity_legal_document_type",
      ADD CONSTRAINT "chk_identity_legal_document_type"
        CHECK ("type" IN ('affiliate-offer', 'personal-data-consent'))`);
  }
}
