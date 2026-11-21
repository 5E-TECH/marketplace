import { CHECKOUT_DB } from './database';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CommonConfigModule,
  OutboxEvent,
  OutboxService,
  ensureSchema,
  shouldRunMigrations,
  RmqClient,
  RmqQueue,
  ServiceHealthModule,
  rmqOptions,
  typeOrmOptions,
} from '@app/common';
import { SellerOrdersController } from './seller-orders.controller';
import { SellerOrdersService } from './seller-orders.service';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { ConfirmSalesOrderService } from './confirm-sales-order.service';
import { ElchiWebhookService } from './elchi-webhook.service';
import { ElchiLeadWebhookService } from './elchi-lead-webhook.service';
import { ReviewEligibilityService } from './review-eligibility.service';
import { ShippingLabelService } from './shipping-label.service';
import { AdminIntegrationQueryService } from './admin-integration-query.service';
import { CheckoutOutboxRelayService } from './checkout-outbox-relay.service';
import { ReturnRequestsController } from './return-requests.controller';
import { ReturnRequestService } from './return-request.service';
import { ReturnRequestQueryService } from './return-request-query.service';
import { ReturnRefundService } from './return-refund.service';
import { ReturnNotifierService } from './return-notifier.service';
import { LeadOrderController } from './lead-order.controller';
import { LeadOrderService } from './lead-order.service';
import { LeadOrderStatusService } from './lead-order-status.service';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentService } from './fulfillment.service';
import { ElchiParcelEventsService } from './elchi-parcel-events.service';

@Module({
  imports: [
    CommonConfigModule,
    ScheduleModule.forRoot(),
    ServiceHealthModule.register('checkout-service'),
    ClientsModule.registerAsync([
      {
        name: RmqClient.CATALOG,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.CATALOG),
      },
      {
        name: RmqClient.IDENTITY,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.IDENTITY),
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
      // BE-18: order.status.changed va order.create-failed lid servisiga
      {
        name: RmqClient.LEAD,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.LEAD),
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        await ensureSchema(config, 'checkout');
        return {
          ...typeOrmOptions(config, CHECKOUT_DB.schema, CHECKOUT_DB.entities),
          synchronize: false,
          migrations: CHECKOUT_DB.migrations,
          migrationsRun: shouldRunMigrations(config),
        };
      },
    }),
    TypeOrmModule.forFeature([OutboxEvent]),
  ],
  controllers: [
    SellerOrdersController,
    CartController,
    CheckoutController,
    ReturnRequestsController,
    LeadOrderController,
    FulfillmentController,
  ],
  providers: [
    SellerOrdersService,
    CartService,
    CheckoutService,
    ConfirmSalesOrderService,
    ElchiWebhookService,
    ElchiLeadWebhookService,
    ReviewEligibilityService,
    ShippingLabelService,
    AdminIntegrationQueryService,
    ReturnRequestService,
    ReturnRequestQueryService,
    ReturnRefundService,
    ReturnNotifierService,
    OutboxService,
    CheckoutOutboxRelayService,
    LeadOrderService,
    LeadOrderStatusService,
    FulfillmentService,
    ElchiParcelEventsService,
  ],
})
export class CheckoutModule {}
