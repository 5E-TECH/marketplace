import { CATALOG_DB } from './database';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '@nestjs/microservices';
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
import { SellerShopController } from './seller-shop.controller';
import { SellerShopService } from './seller-shop.service';
import { AdminShopController } from './admin-shop.controller';
import { AdminShopService } from './admin-shop.service';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { ProductVariantController } from './product-variant.controller';
import { ProductVariantService } from './product-variant.service';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
import { FavoriteController } from './favorite.controller';
import { FavoriteService } from './favorite.service';
import { BannerController } from './banner.controller';
import { BannerService } from './banner.service';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';
import { CategorySeeder } from './seed/category.seeder';

const entities = CATALOG_DB.entities;

@Module({
  imports: [
    CommonConfigModule,
    ServiceHealthModule.register('catalog-service'),
    ClientsModule.registerAsync([
      {
        name: RmqClient.CHECKOUT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CHECKOUT),
      },
      {
        name: RmqClient.SEARCH,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.SEARCH),
      },
      {
        name: RmqClient.NOTIFICATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions(
            [config.get<string>('RABBITMQ_URL')!],
            RmqQueue.NOTIFICATION,
          ),
      },
      {
        name: RmqClient.INTEGRATION,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions(
            [config.get<string>('RABBITMQ_URL')!],
            RmqQueue.INTEGRATION,
          ),
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'catalog');
        return {
          ...typeOrmOptions(config, CATALOG_DB.schema, CATALOG_DB.entities),
          synchronize: false,
          migrations: CATALOG_DB.migrations,
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [
    SellerShopController,
    AdminShopController,
    CategoryController,
    ProductController,
    ProductVariantController,
    StorefrontController,
    FavoriteController,
    ReviewController,
    BannerController,
  ],
  providers: [
    SellerShopService,
    AdminShopService,
    CategoryService,
    ProductService,
    ProductVariantService,
    StorefrontService,
    FavoriteService,
    ReviewService,
    BannerService,
    CategorySeeder,
  ],
})
export class CatalogModule {}
