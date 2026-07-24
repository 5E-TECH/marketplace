import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryTables1721822400000 implements MigrationInterface {
  name = 'CreateInventoryTables1721822400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "inventory"."warehouse" (
        "id" BIGSERIAL NOT NULL,
        "owner_type" VARCHAR(10) NOT NULL DEFAULT 'SHOP',
        "owner_id" BIGINT NOT NULL,
        "name" VARCHAR(255) NOT NULL,
        "region_id" BIGINT,
        "district_id" BIGINT,
        "address" TEXT,
        "is_default" BOOLEAN NOT NULL DEFAULT FALSE,
        "is_active" BOOLEAN NOT NULL DEFAULT TRUE,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inventory_warehouse" PRIMARY KEY ("id"),
        CONSTRAINT "chk_inventory_warehouse_owner_type"
          CHECK ("owner_type" IN ('SHOP', 'HQ'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inventory_warehouse_owner"
      ON "inventory"."warehouse" ("owner_type", "owner_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_inventory_warehouse_default_owner"
      ON "inventory"."warehouse" ("owner_type", "owner_id")
      WHERE "is_default" = TRUE
    `);

    await queryRunner.query(`
      CREATE TABLE "inventory"."stock" (
        "id" BIGSERIAL NOT NULL,
        "variant_id" BIGINT NOT NULL,
        "warehouse_id" BIGINT NOT NULL,
        "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
        "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
        "low_stock_threshold" INTEGER NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inventory_stock" PRIMARY KEY ("id"),
        CONSTRAINT "uq_inventory_stock_variant_warehouse"
          UNIQUE ("variant_id", "warehouse_id"),
        CONSTRAINT "fk_inventory_stock_warehouse"
          FOREIGN KEY ("warehouse_id")
          REFERENCES "inventory"."warehouse"("id")
          ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "chk_inventory_stock_quantities"
          CHECK (
            "quantity_on_hand" >= 0
            AND "quantity_reserved" >= 0
            AND "quantity_reserved" <= "quantity_on_hand"
            AND "low_stock_threshold" >= 0
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inventory_stock_warehouse_id"
      ON "inventory"."stock" ("warehouse_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "inventory"."stock_movement" (
        "id" BIGSERIAL NOT NULL,
        "stock_id" BIGINT NOT NULL,
        "variant_id" BIGINT NOT NULL,
        "warehouse_id" BIGINT NOT NULL,
        "type" VARCHAR(20) NOT NULL,
        "quantity" INTEGER NOT NULL,
        "on_hand_after" INTEGER NOT NULL,
        "reserved_after" INTEGER NOT NULL,
        "reference_type" VARCHAR(30),
        "reference_id" BIGINT,
        "reason" TEXT,
        "actor_id" BIGINT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inventory_stock_movement" PRIMARY KEY ("id"),
        CONSTRAINT "fk_inventory_stock_movement_stock"
          FOREIGN KEY ("stock_id") REFERENCES "inventory"."stock"("id")
          ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "chk_inventory_stock_movement_type"
          CHECK (
            "type" IN (
              'INBOUND', 'OUTBOUND', 'RESERVE', 'RELEASE',
              'COMMIT', 'ADJUST', 'TRANSFER'
            )
          ),
        CONSTRAINT "chk_inventory_stock_movement_quantity"
          CHECK ("quantity" <> 0),
        CONSTRAINT "chk_inventory_stock_movement_balances"
          CHECK (
            "on_hand_after" >= 0
            AND "reserved_after" >= 0
            AND "reserved_after" <= "on_hand_after"
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inventory_stock_movement_stock_created"
      ON "inventory"."stock_movement" ("stock_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inventory_stock_movement_reference"
      ON "inventory"."stock_movement" ("reference_type", "reference_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "inventory"."reservation" (
        "id" BIGSERIAL NOT NULL,
        "order_ref" BIGINT NOT NULL,
        "status" VARCHAR(15) NOT NULL DEFAULT 'HELD',
        "expires_at" TIMESTAMPTZ,
        "idempotency_key" VARCHAR(255),
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_inventory_reservation" PRIMARY KEY ("id"),
        CONSTRAINT "uq_inventory_reservation_order_ref" UNIQUE ("order_ref"),
        CONSTRAINT "uq_inventory_reservation_idempotency_key"
          UNIQUE ("idempotency_key"),
        CONSTRAINT "chk_inventory_reservation_status"
          CHECK ("status" IN ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inventory_reservation_status_expires"
      ON "inventory"."reservation" ("status", "expires_at")
    `);

    await queryRunner.query(`
      CREATE TABLE "inventory"."reservation_item" (
        "id" BIGSERIAL NOT NULL,
        "reservation_id" BIGINT NOT NULL,
        "variant_id" BIGINT NOT NULL,
        "warehouse_id" BIGINT NOT NULL,
        "quantity" INTEGER NOT NULL,
        CONSTRAINT "pk_inventory_reservation_item" PRIMARY KEY ("id"),
        CONSTRAINT "uq_inventory_reservation_item_variant_warehouse"
          UNIQUE ("reservation_id", "variant_id", "warehouse_id"),
        CONSTRAINT "fk_inventory_reservation_item_reservation"
          FOREIGN KEY ("reservation_id")
          REFERENCES "inventory"."reservation"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "fk_inventory_reservation_item_warehouse"
          FOREIGN KEY ("warehouse_id")
          REFERENCES "inventory"."warehouse"("id")
          ON DELETE RESTRICT ON UPDATE NO ACTION,
        CONSTRAINT "chk_inventory_reservation_item_quantity"
          CHECK ("quantity" > 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_inventory_reservation_item_warehouse_id"
      ON "inventory"."reservation_item" ("warehouse_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "inventory"."reservation_item"`);
    await queryRunner.query(`DROP TABLE "inventory"."reservation"`);
    await queryRunner.query(`DROP TABLE "inventory"."stock_movement"`);
    await queryRunner.query(`DROP TABLE "inventory"."stock"`);
    await queryRunner.query(`DROP TABLE "inventory"."warehouse"`);
  }
}
