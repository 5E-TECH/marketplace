import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ClientsModule } from '@nestjs/microservices';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
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
import { ElchiApiClient } from './elchi-api.client';
import { ElchiIntegrationController } from './elchi-integration.controller';
import { ElchiIntegrationService } from './elchi-integration.service';

const entities = [ElchiMarketProvision, GeoCache];

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
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'integration');
        return {
          ...typeOrmOptions(config, 'integration', entities),
          synchronize: false,
          migrations: [CreateIntegrationTables1722900000000],
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [ElchiIntegrationController],
  providers: [ElchiIntegrationService, ElchiApiClient],
})
export class ElchiIntegrationModule {}
