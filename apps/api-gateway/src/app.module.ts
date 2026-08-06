import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import {
  CommonAuthModule,
  CommonConfigModule,
  JwtAuthGuard,
  RmqClient,
  RmqQueue,
  RolesGuard,
  rmqOptions,
} from '@app/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { EchoController } from './echo.controller';
import { AuthController } from './auth/auth.controller';
import { SellersController } from './sellers/sellers.controller';
import { CategoriesController } from './categories/categories.controller';
import { ProductsController } from './products/products.controller';
import { ProductVariantsController } from './products/product-variants.controller';
import { FilesController } from './files/files.controller';
import { InventoryController } from './inventory/inventory.controller';
import { SellerOrdersController } from './sellers/seller-orders.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { StorefrontController } from './storefront/storefront.controller';
import { SearchController } from './search/search.controller';
import { CartController } from './cart/cart.controller';

@Module({
  imports: [
    CommonConfigModule, // .env + Joi (global)
    CommonAuthModule, // JWT + guardlar (global)
    // Servislarga RMQ client'lari (echo demo + identity; keyin catalog/...)
    ClientsModule.registerAsync([
      {
        name: RmqClient.ECHO,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.ECHO),
      },
      {
        name: RmqClient.IDENTITY,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.IDENTITY),
      },
      {
        name: RmqClient.CATALOG,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CATALOG),
      },
      {
        name: RmqClient.FILE,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.FILE),
      },
      {
        name: RmqClient.INVENTORY,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.INVENTORY),
      },
      {
        name: RmqClient.CHECKOUT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CHECKOUT),
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
        name: RmqClient.SEARCH,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.SEARCH),
      },
    ]),
  ],
  controllers: [
    AppController,
    EchoController,
    AuthController,
    SellersController,
    CategoriesController,
    ProductsController,
    ProductVariantsController,
    FilesController,
    InventoryController,
    SellerOrdersController,
    NotificationsController,
    StorefrontController,
    SearchController,
    CartController,
  ],
  providers: [
    AppService,
    // Global auth: avval JWT (401), keyin rol (403)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
