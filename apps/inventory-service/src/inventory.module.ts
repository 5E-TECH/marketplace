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
} from '@app/common';
import { InventoryService } from './inventory.service';
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
  controllers: [InventoryOperationsController, AdminInventoryController],
  providers: [
    InventoryService,
    ReservationSweeperService,
    OutboxService,
    InventoryOutboxRelayService,
    AdminInventoryQueryService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
