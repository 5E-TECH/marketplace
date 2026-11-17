import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
  ensureSchema,
  ServiceHealthModule,
  shouldRunMigrations,
  typeOrmOptions,
} from '@app/common';
import { LEAD_ENTITIES } from './entities';
import { CreateLeadTables1794787200000 } from './migrations/1794787200000-create-lead-tables';

/** Lid xizmati (BE-10 skeleti). Biznes kodi: BE-11, BE-12, BE-13, BE-38, BE-42. */
@Module({
  imports: [
    CommonConfigModule,
    ServiceHealthModule.register('lead-service'),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'lead');
        return {
          ...typeOrmOptions(config, 'lead', LEAD_ENTITIES),
          synchronize: false,
          migrations: [CreateLeadTables1794787200000],
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(LEAD_ENTITIES),
  ],
})
export class LeadModule {}
