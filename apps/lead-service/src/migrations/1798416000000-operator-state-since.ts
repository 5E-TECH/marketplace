import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-25 (FE-08 «operator ish joyi»): operator holati qachondan beri — `GET /operator/state` `since`. Ekran sahifa
 * yangilanganda «Tanaffusdasiz · 6 daqiqa» ni ko‘rsatadi. Mavjud qatorlarda — oxirgi yangilangan vaqt.
 */
export class OperatorStateSince1798416000000 implements MigrationInterface {
  name = 'OperatorStateSince1798416000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "lead"."operator_state" ADD COLUMN "state_since" TIMESTAMPTZ`,
    );
    await q.query(
      `UPDATE "lead"."operator_state" SET "state_since" = "updated_at" WHERE "state_since" IS NULL`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "lead"."operator_state" DROP COLUMN "state_since"`,
    );
  }
}
