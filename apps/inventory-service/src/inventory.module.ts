import { INVENTORY_DB } from './database';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ClientsModule } from '@nestjs/microservices';
import {
  CommonConfigModule,
  ensureSchema,
  shouldRunMigrations,
  OutboxService,
  RmqClient,
  RmqQueue,
  ServiceHealthModule,
  rmqOptions,
  typeOrmOptions,
  UserNamesClient,
} from '@app/common';
import { InventoryService } from './inventory.service';
import { InboundController } from './inbound.controller';
import { InboundService } from './inbound.service';
import { ReturnInspectionService } from './return-inspection.service';
import { WholesalerStockService } from './wholesaler-stock.service';
import { ReservationSweeperService } from './reservation-sweeper.service';
import { InventoryOutboxRelayService } from './inventory-outbox-relay.service';
import { InventoryOperationsController } from './inventory-operations.controller';
import { AdminInventoryController } from './admin-inventory.controller';
import { AdminInventoryQueryService } from './admin-inventory-query.service';

const entities = INVENTORY_DB.entities;

@Module({
  imports: [
    CommonConfigModule,
    ServiceHealthModule.register('inventory-service'),
    ScheduleModule.forRoot(),
    ClientsModule.registerAsync([
      {
        name: RmqClient.CATALOG,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CATALOG),
      },
      // BE-17 (OMB-3): partiya sotuvdan chiqdi — admin va superadminga xabar
      {
        name: RmqClient.NOTIFICATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions(
            [config.get<string>('RABBITMQ_URL')!],
            RmqQueue.NOTIFICATION,
          ),
      },
      // aktlarda xodim ismi (`#ID` o‘rniga) — `UserNamesClient`
      {
        name: RmqClient.IDENTITY,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.IDENTITY),
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'inventory');
        return {
          ...typeOrmOptions(config, INVENTORY_DB.schema, INVENTORY_DB.entities),
          synchronize: false,
          migrations: INVENTORY_DB.migrations,
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [
    InventoryOperationsController,
    AdminInventoryController,
    InboundController,
  ],
  providers: [
    InboundService,
    ReturnInspectionService,
    WholesalerStockService,
    InventoryService,
    ReservationSweeperService,
    OutboxService,
    InventoryOutboxRelayService,
    AdminInventoryQueryService,
    UserNamesClient,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
