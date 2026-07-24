import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthSession1721908800000 implements MigrationInterface {
  name = 'CreateAuthSession1721908800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "identity"."auth_session" (
        "id" UUID NOT NULL,
        "user_id" BIGINT NOT NULL,
        "token_hash" VARCHAR(64) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "revoked_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_identity_auth_session" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_identity_auth_session_user_id"
      ON "identity"."auth_session" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_identity_auth_session_expires_at"
      ON "identity"."auth_session" ("expires_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "identity"."auth_session"`);
  }
}
