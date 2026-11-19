import { SEARCH_DB } from './database';
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
import { SearchDocument } from './entities/search-document.entity';
import { SearchController } from './search.controller';
import { SearchIndexService } from './search-index.service';

@Module({
  imports: [
    CommonConfigModule,
    ServiceHealthModule.register('search-service'),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'search');
        return {
          ...typeOrmOptions(config, SEARCH_DB.schema, SEARCH_DB.entities),
          migrations: SEARCH_DB.migrations,
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature([SearchDocument]),
  ],
  controllers: [SearchController],
  providers: [SearchIndexService],
})
export class SearchModule {}
