import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
  ensureSchema,
  shouldRunMigrations,
  typeOrmOptions,
} from '@app/common';
import { SearchDocument } from './entities/search-document.entity';
import { CreateSearchIndex1722945600000 } from './migrations/1722945600000-create-search-index';
import { SearchController } from './search.controller';
import { SearchIndexService } from './search-index.service';

@Module({
  imports: [
    CommonConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'search');
        return {
          ...typeOrmOptions(config, 'search', [SearchDocument]),
          migrations: [CreateSearchIndex1722945600000],
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
