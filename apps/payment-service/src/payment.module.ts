import { PAYMENT_DB } from './database';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
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
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { PaymeService } from './payme.service';
import { ClickService } from './click.service';
import { PaymentEventsService } from './payment-events.service';
import { PaymentRefundService } from './payment-refund.service';
import { PaymentQueryService } from './payment-query.service';
import { PaymentOutboxRelayService } from './payment-outbox-relay.service';

const entities = PAYMENT_DB.entities;

@Module({
  imports: [
    CommonConfigModule,
    ScheduleModule.forRoot(),
    ServiceHealthModule.register('payment-service'),
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
          ...typeOrmOptions(config, PAYMENT_DB.schema, PAYMENT_DB.entities),
          synchronize: false,
          migrations: PAYMENT_DB.migrations,
          migrationsRun: shouldRunMigrations(config),
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
    PaymentOutboxRelayService,
    PaymentRefundService,
    PaymentQueryService,
  ],
})
export class PaymentModule {}
