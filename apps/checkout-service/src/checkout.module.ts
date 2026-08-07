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
          ],
          migrationsRun: true,
        };
      },
    }),
  ],
  controllers: [SellerOrdersController, CartController, CheckoutController],
  providers: [SellerOrdersService, CartService, CheckoutService],
})
export class CheckoutModule {}
