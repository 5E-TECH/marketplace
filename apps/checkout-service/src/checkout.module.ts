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
  typeOrmOptions,
} from '@app/common';
import { SellerOrdersController } from './seller-orders.controller';
import { SellerOrdersService } from './seller-orders.service';
import { CreateCheckoutTables1722513600000 } from './migrations/1722513600000-create-checkout-tables';
import { CreateCartTables1723032000000 } from './migrations/1723032000000-create-cart-tables';
import { Cart } from './entities/cart.entity';
import { CartItem } from './entities/cart-item.entity';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { ConfirmSalesOrderService } from './confirm-sales-order.service';
import { CreateOrderHistory1723200000000 } from './migrations/1723200000000-create-order-history';
import { CreateElchiWebhookEvent1724587200000 } from './migrations/1724587200000-create-elchi-webhook-event';
import { ElchiWebhookService } from './elchi-webhook.service';
import { ReviewEligibilityService } from './review-eligibility.service';

@Module({
  imports: [
    CommonConfigModule,
    ClientsModule.registerAsync([
      {
        name: RmqClient.CATALOG,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CATALOG),
      },
      {
        name: RmqClient.INVENTORY,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.INVENTORY),
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
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'checkout');
        return {
          ...typeOrmOptions(config, 'checkout', [Cart, CartItem]),
          synchronize: false,
          migrations: [
            CreateCheckoutTables1722513600000,
            CreateCartTables1723032000000,
            CreateOrderHistory1723200000000,
            CreateElchiWebhookEvent1724587200000,
          ],
          migrationsRun: true,
        };
      },
    }),
  ],
  controllers: [SellerOrdersController, CartController, CheckoutController],
  providers: [
    SellerOrdersService,
    CartService,
    CheckoutService,
    ConfirmSalesOrderService,
    ElchiWebhookService,
    ReviewEligibilityService,
  ],
})
export class CheckoutModule {}
