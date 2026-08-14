import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule } from '@nestjs/microservices';
import {
  CommonConfigModule,
  ensureSchema,
  RmqClient,
  RmqQueue,
  rmqOptions,
  typeOrmOptions,
} from '@app/common';
import { Category } from './entities/category.entity';
import { ProductVariant } from './entities/product-variant.entity';
import { Product } from './entities/product.entity';
import { Shop } from './entities/shop.entity';
import { CreateCatalogTables1721736000000 } from './migrations/1721736000000-create-catalog-tables';
import { DefaultProductActive1724414400000 } from './migrations/1724414400000-default-product-active';
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

const entities = [Shop, Category, Product, ProductVariant];

@Module({
  imports: [
    CommonConfigModule,
    ClientsModule.registerAsync([
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
          ...typeOrmOptions(config, 'catalog', entities),
          synchronize: false,
          migrations: [
            CreateCatalogTables1721736000000,
            DefaultProductActive1724414400000,
          ],
          migrationsRun: true,
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
  ],
  providers: [
    SellerShopService,
    AdminShopService,
    CategoryService,
    ProductService,
    ProductVariantService,
    StorefrontService,
  ],
})
export class CatalogModule {}
