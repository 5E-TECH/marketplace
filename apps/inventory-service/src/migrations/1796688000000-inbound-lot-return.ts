import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * BE-17 (TZ T4, 6.6 OMB-1/2/3/6): postavka qabuli (`inbound_shipment`, `_item`), yacheyka (`stock.cell`),
 * yaroqlilik partiyalari (`stock_lot`) va qaytgan tovarni saralash (`return_inspection`).
 */
export class InboundLotReturn1796688000000 implements MigrationInterface {
  name = 'InboundLotReturn1796688000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "inventory"."stock" ADD COLUMN "cell" VARCHAR(32)`,
    );
    await q.query(`
      CREATE TABLE "inventory"."inbound_shipment" (
        "id" BIGSERIAL PRIMARY KEY,
        "wholesaler_id" BIGINT NOT NULL,
        "status" VARCHAR(16) NOT NULL DEFAULT 'DECLARED',
        "expected_at" DATE NOT NULL,
        "note" TEXT,
        "declared_by" BIGINT NOT NULL,
        "received_by" BIGINT,
        "received_at" TIMESTAMPTZ,
        "receive_comment" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_inventory_inbound_status"
          CHECK ("status" IN ('DECLARED','IN_TRANSIT','RECEIVED','DISCREPANCY')),
        CONSTRAINT "chk_inventory_inbound_received"
          CHECK (("status" IN ('RECEIVED','DISCREPANCY')) = ("received_at" IS NOT NULL))
      )
    `);
    await q.query(
      `CREATE INDEX "idx_inventory_inbound_status" ON "inventory"."inbound_shipment" ("status", "id")`,
    );
    await q.query(`
      CREATE TABLE "inventory"."inbound_shipment_item" (
        "id" BIGSERIAL PRIMARY KEY,
        "shipment_id" BIGINT NOT NULL REFERENCES "inventory"."inbound_shipment"("id"),
        "product_id" BIGINT NOT NULL,
        "variant_id" BIGINT NOT NULL,
        "product_name" VARCHAR(255) NOT NULL,
        "sku" VARCHAR(100) NOT NULL,
        "barcode" VARCHAR(100),
        "declared_qty" INT NOT NULL CHECK ("declared_qty" > 0),
        "received_qty" INT CHECK ("received_qty" >= 0),
        "defective_qty" INT CHECK ("defective_qty" >= 0),
        "batch" VARCHAR(64),
        "expiry_date" DATE,
        "cell" VARCHAR(32),
        CONSTRAINT "uq_inventory_inbound_item" UNIQUE ("shipment_id", "variant_id"),
        CONSTRAINT "chk_inventory_inbound_defective"
          CHECK ("defective_qty" IS NULL OR "defective_qty" <= "received_qty")
      )
    `);
    await q.query(`
      CREATE TABLE "inventory"."stock_lot" (
        "id" BIGSERIAL PRIMARY KEY,
        "variant_id" BIGINT NOT NULL,
        "warehouse_id" BIGINT NOT NULL,
        "shipment_item_id" BIGINT REFERENCES "inventory"."inbound_shipment_item"("id"),
        "batch" VARCHAR(64),
        "expiry_date" DATE NOT NULL,
        "sellable_until" DATE NOT NULL,
        "quantity" INT NOT NULL CHECK ("quantity" >= 0),
        "notified_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "chk_inventory_lot_sellable" CHECK ("sellable_until" <= "expiry_date")
      )
    `);
    await q.query(
      `CREATE INDEX "idx_inventory_lot_stock" ON "inventory"."stock_lot" ("variant_id", "warehouse_id", "expiry_date") WHERE "quantity" > 0`,
    );
    await q.query(`
      CREATE TABLE "inventory"."return_inspection" (
        "id" BIGSERIAL PRIMARY KEY,
        "order_ref" BIGINT NOT NULL,
        "parcel_id" BIGINT,
        "variant_id" BIGINT NOT NULL,
        "sellable_qty" INT NOT NULL CHECK ("sellable_qty" >= 0),
        "defective_qty" INT NOT NULL CHECK ("defective_qty" >= 0),
        "comment" TEXT,
        "inspected_by" BIGINT NOT NULL,
        "inspected_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_inventory_return_inspection" UNIQUE ("order_ref", "variant_id"),
        CONSTRAINT "chk_inventory_return_inspection_qty" CHECK ("sellable_qty" + "defective_qty" > 0)
      )
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE IF EXISTS "inventory"."return_inspection"');
    await q.query('DROP TABLE IF EXISTS "inventory"."stock_lot"');
    await q.query('DROP TABLE IF EXISTS "inventory"."inbound_shipment_item"');
    await q.query('DROP TABLE IF EXISTS "inventory"."inbound_shipment"');
    await q.query(
      'ALTER TABLE "inventory"."stock" DROP COLUMN IF EXISTS "cell"',
    );
  }
}
