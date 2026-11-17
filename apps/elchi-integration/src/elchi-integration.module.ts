import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ClientsModule } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
  OutboxEvent,
  OutboxService,
  ensureSchema,
  shouldRunMigrations,
  RmqClient,
  RmqQueue,
  ServiceHealthModule,
  rmqOptions,
  typeOrmOptions,
} from '@app/common';
import { ElchiMarketProvision } from './entities/elchi-market-provision.entity';
import { GeoCache } from './entities/geo-cache.entity';
import { CreateIntegrationTables1722900000000 } from './migrations/1722900000000-create-integration-tables';
import { AddGeoSatoCode1725285600000 } from './migrations/1725285600000-add-geo-sato-code';
import { AddProvisionTariffs1725375600000 } from './migrations/1725375600000-add-provision-tariffs';
import { MoneyToBigint1795219200000 } from './migrations/1795219200000-money-to-bigint';
import { ElchiApiClient } from './elchi-api.client';
import { ElchiIntegrationController } from './elchi-integration.controller';
import { ElchiIntegrationService } from './elchi-integration.service';
import { GeoLookupController } from './geo-lookup.controller';
import { GeoLookupService } from './geo-lookup.service';
import { CreateParcelQueue1795392000000 } from './migrations/1795392000000-create-parcel-queue';
import { ParcelService } from './parcel.service';
import { ElchiOutboxRelayService } from './elchi-outbox-relay.service';

const entities = [ElchiMarketProvision, GeoCache, OutboxEvent];

@Module({
  imports: [
    CommonConfigModule,
    ServiceHealthModule.register('elchi-integration'),
    ScheduleModule.forRoot(),
    ClientsModule.registerAsync([
      {
        name: RmqClient.CATALOG,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CATALOG),
      },
      {
        name: RmqClient.CHECKOUT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CHECKOUT),
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'integration');
        return {
          ...typeOrmOptions(config, 'integration', entities),
          synchronize: false,
          migrations: [
            CreateIntegrationTables1722900000000,
            AddGeoSatoCode1725285600000,
            AddProvisionTariffs1725375600000,
            MoneyToBigint1795219200000,
            CreateParcelQueue1795392000000,
          ],
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [ElchiIntegrationController, GeoLookupController],
  providers: [
    ElchiIntegrationService,
    ElchiApiClient,
    GeoLookupService,
    OutboxService,
    ParcelService,
    ElchiOutboxRelayService,
  ],
})
export class ElchiIntegrationModule {}
