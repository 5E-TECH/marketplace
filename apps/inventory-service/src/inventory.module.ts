import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ClientsModule } from '@nestjs/microservices';
import {
  CommonConfigModule,
  ensureSchema,
  shouldRunMigrations,
  OutboxEvent,
  OutboxService,
  RmqClient,
  RmqQueue,
  rmqOptions,
  typeOrmOptions,
} from '@app/common';
import { InventoryOperation } from './entities/inventory-operation.entity';
import { ReservationItem } from './entities/reservation-item.entity';
import { Reservation } from './entities/reservation.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Stock } from './entities/stock.entity';
import { Warehouse } from './entities/warehouse.entity';
import { InventoryService } from './inventory.service';
import { CreateInventoryTables1721822400000 } from './migrations/1721822400000-create-inventory-tables';
import { CreateInventoryOperation1721822400001 } from './migrations/1721822400001-create-inventory-operation';
import { CreateInventoryOutbox1721822400002 } from './migrations/1721822400002-create-inventory-outbox';
import { AddInventoryBaseColumns1721822400003 } from './migrations/1721822400003-add-inventory-base-columns';
import { ReservationSweeperService } from './reservation-sweeper.service';
import { InventoryOutboxRelayService } from './inventory-outbox-relay.service';
import { SellerInventoryController } from './seller-inventory.controller';
import { StockQueryService } from './stock-query.service';
import { WarehouseService } from './warehouse.service';
import { InventoryOperationsController } from './inventory-operations.controller';

const entities = [
  Warehouse,
  Stock,
  StockMovement,
  Reservation,
  ReservationItem,
  InventoryOperation,
  OutboxEvent,
];

@Module({
  imports: [
    CommonConfigModule,
    ScheduleModule.forRoot(),
    ClientsModule.registerAsync([
      {
        name: RmqClient.CATALOG,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CATALOG),
      },
    ]),
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
            CreateInventoryOutbox1721822400002,
            AddInventoryBaseColumns1721822400003,
          ],
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [SellerInventoryController, InventoryOperationsController],
  providers: [
    InventoryService,
    WarehouseService,
    StockQueryService,
    ReservationSweeperService,
    OutboxService,
    InventoryOutboxRelayService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
