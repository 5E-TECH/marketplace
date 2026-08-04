import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1722776400000 implements MigrationInterface {
  name = 'CreateUsers1722776400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "identity"."users" (
        "id" BIGSERIAL NOT NULL,
        "role" VARCHAR(20) NOT NULL,
        "name" VARCHAR(255) NOT NULL,
        "phone" VARCHAR(20) NOT NULL,
        "email" VARCHAR(255),
        "password_hash" VARCHAR(255) NOT NULL,
        "avatar_url" VARCHAR(500),
        "is_active" BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "is_deleted" BOOLEAN NOT NULL DEFAULT FALSE,
        CONSTRAINT "pk_identity_users" PRIMARY KEY ("id"),
        CONSTRAINT "uq_identity_users_phone" UNIQUE ("phone"),
        CONSTRAINT "chk_identity_users_role"
          CHECK ("role" IN ('BUYER', 'SELLER', 'ADMIN', 'SUPERADMIN'))
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "identity"."users"`);
  }
}
