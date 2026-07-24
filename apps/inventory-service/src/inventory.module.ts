import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonConfigModule, ensureSchema, typeOrmOptions } from '@app/common';
import { InventoryOperation } from './entities/inventory-operation.entity';
import { ReservationItem } from './entities/reservation-item.entity';
import { Reservation } from './entities/reservation.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Stock } from './entities/stock.entity';
import { Warehouse } from './entities/warehouse.entity';
import { InventoryService } from './inventory.service';
import { CreateInventoryTables1721822400000 } from './migrations/1721822400000-create-inventory-tables';
import { CreateInventoryOperation1721822400001 } from './migrations/1721822400001-create-inventory-operation';

const entities = [
  Warehouse,
  Stock,
  StockMovement,
  Reservation,
  ReservationItem,
  InventoryOperation,
];

@Module({
  imports: [
    CommonConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'inventory');
        return {
          ...typeOrmOptions(config, 'inventory', entities),
          synchronize: false,
          migrations: [
            CreateInventoryTables1721822400000,
            CreateInventoryOperation1721822400001,
          ],
          migrationsRun: true,
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
