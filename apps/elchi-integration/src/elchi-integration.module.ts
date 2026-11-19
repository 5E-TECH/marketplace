import { INTEGRATION_DB } from './database';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ClientsModule } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
  OutboxService,
  ensureSchema,
  shouldRunMigrations,
  RmqClient,
  RmqQueue,
  ServiceHealthModule,
  rmqOptions,
  typeOrmOptions,
} from '@app/common';
import { ElchiApiClient } from './elchi-api.client';
import { ElchiIntegrationController } from './elchi-integration.controller';
import { ElchiIntegrationService } from './elchi-integration.service';
import { GeoLookupController } from './geo-lookup.controller';
import { GeoLookupService } from './geo-lookup.service';
import { ParcelService } from './parcel.service';
import { ElchiOutboxRelayService } from './elchi-outbox-relay.service';

const entities = INTEGRATION_DB.entities;

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
          ...typeOrmOptions(
            config,
            INTEGRATION_DB.schema,
            INTEGRATION_DB.entities,
          ),
          synchronize: false,
          migrations: INTEGRATION_DB.migrations,
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
