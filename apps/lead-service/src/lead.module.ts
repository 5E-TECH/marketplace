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
import { LeadOfferController } from './lead-offer.controller';
import { OfferService } from './offer.service';
import { StreamService } from './stream.service';
import { CreateLeadTables1794787200000 } from './migrations/1794787200000-create-lead-tables';
import { CreateOfferContent1794873600000 } from './migrations/1794873600000-create-offer-content';
import { AddLeadReview1794960000000 } from './migrations/1794960000000-add-lead-review';
import { AddLeadQueue1795046400000 } from './migrations/1795046400000-add-lead-queue';

/** Lid xizmati (BE-10). Manzil — BE-38; offer va sahifalar — BE-11; lid qabul qilish — BE-12; operator navbati — BE-13; admin lidlari — BE-42. */
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
          ...typeOrmOptions(config, 'lead', LEAD_ENTITIES),
          synchronize: false,
          migrations: [
            CreateLeadTables1794787200000,
            CreateOfferContent1794873600000,
            AddLeadReview1794960000000,
            AddLeadQueue1795046400000,
          ],
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(LEAD_ENTITIES),
  ],
  controllers: [
    LeadAddressController,
    LeadOfferController,
    LeadIntakeController,
    LeadQueueController,
    LeadAdminController,
  ],
  providers: [
    LeadAddressService,
    CatalogOfferClient,
    OfferService,
    StreamService,
    LandingService,
    LeadIntakeService,
    LeadQueueService,
    LeadCardService,
    LeadQueueScheduler,
    LeadOutboxRelayService,
    LeadAdminService,
  ],
})
export class LeadModule {}
