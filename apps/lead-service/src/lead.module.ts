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
import { LeadOfferController } from './lead-offer.controller';
import { OfferService } from './offer.service';
import { StreamService } from './stream.service';
import { CreateLeadTables1794787200000 } from './migrations/1794787200000-create-lead-tables';
import { CreateOfferContent1794873600000 } from './migrations/1794873600000-create-offer-content';

/** Lid xizmati (BE-10). Manzil — BE-38; offer va sahifalar — BE-11; keyin BE-12, BE-13, BE-42. */
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
          ],
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(LEAD_ENTITIES),
  ],
  controllers: [LeadAddressController, LeadOfferController],
  providers: [
    LeadAddressService,
    CatalogOfferClient,
    OfferService,
    StreamService,
    LandingService,
  ],
})
export class LeadModule {}
