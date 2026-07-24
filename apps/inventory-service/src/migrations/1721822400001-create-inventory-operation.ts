import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryOperation1721822400001 implements MigrationInterface {
  name = 'CreateInventoryOperation1721822400001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inventory"."inventory_operation" (
        "key" VARCHAR(255) NOT NULL,
        "response" JSONB NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inventory_operation" PRIMARY KEY ("key")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "inventory"."inventory_operation"`);
  }
}
