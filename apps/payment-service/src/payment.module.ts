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
import { Payment } from './entities/payment.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { ProviderConfig } from './entities/provider-config.entity';
import { CreatePaymentTables1724241600000 } from './migrations/1724241600000-create-payment-tables';
import { AddPaymeTransactionState1724328000000 } from './migrations/1724328000000-add-payme-transaction-state';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymeService } from './payme.service';
import { ClickService } from './click.service';
import { PaymentEventsService } from './payment-events.service';
import { PaymentRefundService } from './payment-refund.service';

const entities = [Payment, PaymentTransaction, ProviderConfig];

@Module({
  imports: [
    CommonConfigModule,
    ClientsModule.registerAsync([
      {
        name: RmqClient.CHECKOUT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CHECKOUT),
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'payment');
        return {
          ...typeOrmOptions(config, 'payment', entities),
          synchronize: false,
          migrations: [
            CreatePaymentTables1724241600000,
            AddPaymeTransactionState1724328000000,
          ],
          migrationsRun: true,
        };
      },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    PaymeService,
    ClickService,
    PaymentEventsService,
    PaymentRefundService,
  ],
})
export class PaymentModule {}
