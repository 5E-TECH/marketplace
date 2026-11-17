import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-28: sotuvchi statistikasi ledgerdan o‘qiydi (`finance.affiliate.income`).
 * - journal(lead_id) — lidlar ro‘yxatidagi «Haq» ustuni (sahifadagi lidlar bo‘yicha);
 * - ledger_entry(reverses_entry_id) — qaytarish (ko‘zgu) yozuvidan asl yozuvga.
 * Davr bo‘yicha so‘rov sotuvchi hisobining yozuvlaridan boshlanadi (idx_finance_entry_account).
 */
export class AddJournalLeadIndex1795564800000 implements MigrationInterface {
  name = 'AddJournalLeadIndex1795564800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "idx_finance_journal_lead" ON "finance"."journal" ("lead_id")
      WHERE "lead_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_finance_entry_reverses" ON "finance"."ledger_entry" ("reverses_entry_id")
      WHERE "reverses_entry_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "finance"."idx_finance_entry_reverses"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "finance"."idx_finance_journal_lead"`,
    );
  }
}
