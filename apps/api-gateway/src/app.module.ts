import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  CommonAuthModule,
  CommonConfigModule,
  JwtAuthGuard,
  RequestIdMiddleware,
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
import { PublicProductsController } from './products/public-products.controller';
import { ProductVariantsController } from './products/product-variants.controller';
import { FilesController } from './files/files.controller';
import { InventoryController } from './inventory/inventory.controller';
import { SellerOrdersController } from './sellers/seller-orders.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { StorefrontController } from './storefront/storefront.controller';
import { SearchController } from './search/search.controller';
import { AdminShopsController } from './shops/admin-shops.controller';
import { AdminDashboardController } from './admin/admin-dashboard.controller';
import { AdminUsersController } from './admin/admin-users.controller';
import { AdminOrdersController } from './admin/admin-orders.controller';
import { SellerOperatorsController } from './sellers/seller-operators.controller';
import { CartController } from './cart/cart.controller';
import { CheckoutController } from './cart/checkout.controller';
import { PaymentsController } from './payments/payments.controller';
import { SupportController } from './support/support.controller';
import { FavoritesController } from './favorites/favorites.controller';
import { GuestController } from './guest/guest.controller';
import { ElchiWebhookController } from './webhooks/elchi-webhook.controller';
import { AdminFinanceController } from './admin/admin-finance.controller';
import { ReviewsController } from './storefront/reviews.controller';
import { AdminProductsController } from './admin/admin-products.controller';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [
    CommonConfigModule, // .env + Joi (global)
    CommonAuthModule, // JWT + guardlar (global)
    // Rate limiting — umumiy chegara. Auth kabi nozik endpointlarda
    // controller darajasida @Throttle bilan qattiqroq limit qo'yiladi.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('RATE_LIMIT_WINDOW_MS', 60_000),
            limit: config.get<number>('RATE_LIMIT_MAX', 300),
          },
        ],
      }),
    }),
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
        name: RmqClient.PAYMENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.PAYMENT),
      },
      {
        name: RmqClient.FINANCE,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.FINANCE),
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
  ],
  controllers: [
    AppController,
    EchoController,
    AuthController,
    SellersController,
    CategoriesController,
    ProductsController,
    PublicProductsController,
    ProductVariantsController,
    FilesController,
    InventoryController,
    SellerOrdersController,
    NotificationsController,
    StorefrontController,
    SearchController,
    AdminShopsController,
    AdminDashboardController,
    AdminUsersController,
    AdminOrdersController,
    SellerOperatorsController,
    CartController,
    CheckoutController,
    PaymentsController,
    SupportController,
    FavoritesController,
    GuestController,
    ElchiWebhookController,
    AdminFinanceController,
    ReviewsController,
    AdminProductsController,
  ],
  providers: [
    AppService,
    ReadinessService,
    // Tartib muhim: avval rate limit (429) — tokensiz toshqin ham to'siladi,
    // keyin JWT (401), keyin rol (403).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
