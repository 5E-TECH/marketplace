import { LEAD_DB } from './database';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
  ensureSchema,
  RmqClient,
  RmqQueue,
  rmqOptions,
  ServiceHealthModule,
  shouldRunMigrations,
  typeOrmOptions,
} from '@app/common';
import { LEAD_ENTITIES } from './entities';
import { ApiKeyService } from './api-key.service';
import { CatalogOfferClient } from './catalog-offer.client';
import { LandingService } from './landing.service';
import { LeadAddressController } from './lead-address.controller';
import { LeadAdminController } from './lead-admin.controller';
import { LeadAdminService } from './lead-admin.service';
import { LeadAddressService } from './lead-address.service';
import { LeadCardService } from './lead-card.service';
import { LeadOutboxRelayService } from './lead-outbox-relay.service';
import { LeadQueueController } from './lead-queue.controller';
import { LeadQueueScheduler } from './lead-queue.scheduler';
import { LeadQueueService } from './lead-queue.service';
import { LeadIntakeController } from './lead-intake.controller';
import { LeadIntakeService } from './lead-intake.service';
import { SiteOrderService } from './site-order.service';
import { LeadOfferController } from './lead-offer.controller';
import { CapiService } from './capi.service';
import { LeadOrderService } from './lead-order.service';
import { LeadStatsController } from './lead-stats.controller';
import { LeadStatsService } from './lead-stats.service';
import { PlatformStatsController } from './platform-stats.controller';
import { PlatformStatsService } from './platform-stats.service';
import { OfferService } from './offer.service';
import { PostbackService } from './postback.service';
import { StreamService } from './stream.service';
import { VariantReportController } from './variant-report.controller';
import { VariantReportService } from './variant-report.service';
import { AffiliateIdentityClient } from './affiliate-identity.client';
import { FraudScheduler } from './fraud.scheduler';
import { FraudService } from './fraud.service';
import { LeadSupervisorController } from './lead-supervisor.controller';
import { LeadSupervisorService } from './lead-supervisor.service';

/** Lid xizmati (BE-10). Manzil — BE-38; offer va sahifalar — BE-11; lid qabul qilish — BE-12; operator navbati — BE-13; admin lidlari — BE-42; statistika — BE-28; nazoratchi va firibgarlik — BE-35. */
@Module({
  imports: [
    CommonConfigModule,
    ServiceHealthModule.register('lead-service'),
    ScheduleModule.forRoot(),
    ClientsModule.registerAsync([
      {
        name: RmqClient.CHECKOUT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions(
            [config.getOrThrow<string>('RABBITMQ_URL')],
            RmqQueue.CHECKOUT,
          ),
      },
      {
        name: RmqClient.NOTIFICATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions(
            [config.getOrThrow<string>('RABBITMQ_URL')],
            RmqQueue.NOTIFICATION,
          ),
      },
      {
        name: RmqClient.CATALOG,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions(
            [config.getOrThrow<string>('RABBITMQ_URL')],
            RmqQueue.CATALOG,
          ),
      },
      {
        name: RmqClient.FINANCE,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions(
            [config.getOrThrow<string>('RABBITMQ_URL')],
            RmqQueue.FINANCE,
          ),
      },
      {
        name: RmqClient.IDENTITY,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions(
            [config.getOrThrow<string>('RABBITMQ_URL')],
            RmqQueue.IDENTITY,
          ),
      },
      {
        name: RmqClient.INTEGRATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions(
            [config.getOrThrow<string>('RABBITMQ_URL')],
            RmqQueue.INTEGRATION,
          ),
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'lead');
        return {
          ...typeOrmOptions(config, LEAD_DB.schema, LEAD_DB.entities),
          synchronize: false,
          migrations: LEAD_DB.migrations,
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(LEAD_ENTITIES),
  ],
  controllers: [
    PlatformStatsController,
    LeadAddressController,
    LeadOfferController,
    LeadIntakeController,
    VariantReportController,
    LeadQueueController,
    LeadAdminController,
    LeadStatsController,
    LeadSupervisorController,
  ],
  providers: [
    LeadAddressService,
    CatalogOfferClient,
    OfferService,
    VariantReportService,
    StreamService,
    LandingService,
    LeadIntakeService,
    SiteOrderService,
    LeadQueueService,
    LeadCardService,
    LeadQueueScheduler,
    LeadOutboxRelayService,
    LeadAdminService,
    PostbackService,
    ApiKeyService,
    LeadStatsService,
    PlatformStatsService,
    LeadOrderService,
    CapiService,
    AffiliateIdentityClient,
    FraudService,
    FraudScheduler,
    LeadSupervisorService,
  ],
})
export class LeadModule {}
