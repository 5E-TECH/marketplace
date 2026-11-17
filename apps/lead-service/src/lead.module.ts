import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
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
import { LeadAddressService } from './lead-address.service';
import { LeadIntakeController } from './lead-intake.controller';
import { LeadIntakeService } from './lead-intake.service';
import { LeadOfferController } from './lead-offer.controller';
import { OfferService } from './offer.service';
import { StreamService } from './stream.service';
import { CreateLeadTables1794787200000 } from './migrations/1794787200000-create-lead-tables';
import { CreateOfferContent1794873600000 } from './migrations/1794873600000-create-offer-content';
import { AddLeadReview1794960000000 } from './migrations/1794960000000-add-lead-review';

/** Lid xizmati (BE-10). Manzil — BE-38; offer va sahifalar — BE-11; lid qabul qilish — BE-12; keyin BE-13, BE-42. */
@Module({
  imports: [
    CommonConfigModule,
    ServiceHealthModule.register('lead-service'),
    ClientsModule.registerAsync([
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
  ],
  providers: [
    LeadAddressService,
    CatalogOfferClient,
    OfferService,
    StreamService,
    LandingService,
    LeadIntakeService,
  ],
})
export class LeadModule {}
