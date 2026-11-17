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
import { CreateSearchIndex1722945600000 } from './migrations/1722945600000-create-search-index';
import { MoneyToBigint1795219200000 } from './migrations/1795219200000-money-to-bigint';
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
          ...typeOrmOptions(config, 'search', [SearchDocument]),
          migrations: [
            CreateSearchIndex1722945600000,
            MoneyToBigint1795219200000,
          ],
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
