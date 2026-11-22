import type { DatabaseDefinition } from '@app/common';
import { CreateInventoryTables1721822400000 } from './migrations/1721822400000-create-inventory-tables';
import { CreateInventoryOperation1721822400001 } from './migrations/1721822400001-create-inventory-operation';
import { CreateInventoryOutbox1721822400002 } from './migrations/1721822400002-create-inventory-outbox';
import { AddInventoryBaseColumns1721822400003 } from './migrations/1721822400003-add-inventory-base-columns';
import { HqWarehouse1796256000000 } from './migrations/1796256000000-hq-warehouse';
import { InboundLotReturn1796688000000 } from './migrations/1796688000000-inbound-lot-return';
import { Warehouse } from './entities/warehouse.entity';
import { Stock } from './entities/stock.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Reservation } from './entities/reservation.entity';
import { ReservationItem } from './entities/reservation-item.entity';
import { InventoryOperation } from './entities/inventory-operation.entity';
import { OutboxEvent } from '@app/common';

/**
 * inventory-service bazasi (BE-04): sxema, entity va migratsiyalar bitta joyda — modul (`inventory.module.ts`) va migratsiya CLI
 * (`migrate.ts`) shu ro‘yxatdan foydalanadi. Yangi migratsiya shu yerga qo‘shiladi.
 */
export const INVENTORY_DB: DatabaseDefinition = {
  schema: 'inventory',
  entities: [
    Warehouse,
    Stock,
    StockMovement,
    Reservation,
    ReservationItem,
    InventoryOperation,
    OutboxEvent,
  ],
  migrations: [
    CreateInventoryTables1721822400000,
    CreateInventoryOperation1721822400001,
    CreateInventoryOutbox1721822400002,
    AddInventoryBaseColumns1721822400003,
    HqWarehouse1796256000000,
    InboundLotReturn1796688000000,
  ],
};
