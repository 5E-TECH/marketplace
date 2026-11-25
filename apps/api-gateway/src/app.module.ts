import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '@nestjs/microservices';
import { ThrottlerGuard } from '@nestjs/throttler';
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
import { AuthController } from './auth/auth.controller';
import { CategoriesController } from './categories/categories.controller';
import { StorefrontController } from './storefront/storefront.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { AdminDashboardController } from './admin/admin-dashboard.controller';
import { AdminUsersController } from './admin/admin-users.controller';
import { AdminOrdersController } from './admin/admin-orders.controller';
import { PaymentsController } from './payments/payments.controller';
import { SupportController } from './support/support.controller';
import { ElchiWebhookController } from './webhooks/elchi-webhook.controller';
import { AdminFinanceController } from './admin/admin-finance.controller';
import { AdminProductsController } from './admin/admin-products.controller';
import { AdminCreativesController } from './admin/admin-creatives.controller';
import { AdminWholesalersController } from './admin/admin-wholesalers.controller';
import { AdminPricingController } from './admin/admin-pricing.controller';
import { AdminAuditController } from './admin/admin-audit.controller';
import { AdminNotificationsController } from './admin/admin-notifications.controller';
import { AdminTeamController } from './admin/admin-team.controller';
import { AdminSettingsController } from './admin/admin-settings.controller';
import { AdminIntegrationController } from './admin/admin-integration.controller';
import { AdminContentController } from './admin/admin-content.controller';
import { RegionsController } from './geo/regions.controller';
import { ReadinessService } from './readiness.service';
import { CurrentRoleGuard } from './auth/current-role.guard';
import { AdminInventoryController } from './admin/admin-inventory.controller';
import { AdminVariantReportController } from './leads/admin-variant-report.controller';
import { AdminReturnsController } from './admin/admin-returns.controller';
import { AdminOrderReturnsController } from './admin/admin-order-returns.controller';
import { PublicLeadsController } from './leads/public-leads.controller';
import { AffiliateStreamsController } from './leads/affiliate-streams.controller';
import { AffiliateWithdrawalsController } from './withdrawals/affiliate-withdrawals.controller';
import { AdminWithdrawalsController } from './withdrawals/admin-withdrawals.controller';
import { AffiliateProfileController } from './affiliate-account/affiliate-profile.controller';
import { AffiliateSelfEmployedController } from './affiliate-account/affiliate-self-employed.controller';
import { AdminSelfEmployedController } from './withdrawals/admin-self-employed.controller';
import { LegalDocumentsController } from './affiliate-account/legal-documents.controller';
import { AdminFinanceSettingsController } from './withdrawals/admin-finance-settings.controller';
import { AdminModerationController } from './admin/admin-moderation.controller';
import { OpsHealthController } from './ops-health.controller';
import { AdminSettlementsController } from './withdrawals/admin-settlements.controller';
import { AdminReconciliationController } from './withdrawals/admin-reconciliation.controller';
import { AdminActResponsesController } from './withdrawals/admin-act-responses.controller';
import { WholesalerSettlementsController } from './withdrawals/wholesaler-settlements.controller';
import { AdminWholesalerCabinetController } from './wholesaler-cabinet/admin-wholesaler-cabinet.controller';
import { SignedFilesController } from './wholesaler-cabinet/signed-files.controller';
import { SignedLinkService } from './wholesaler-cabinet/signed-link';
import { WholesalerCabinetController } from './wholesaler-cabinet/wholesaler-cabinet.controller';
import { WholesalerProductsController } from './wholesaler-cabinet/wholesaler-products.controller';
import { WholesalerShipmentsController } from './wholesaler-cabinet/wholesaler-shipments.controller';
import { AdminMetricsController } from './metrics/admin-metrics.controller';
import { OperatorLeadsController } from './leads/operator-leads.controller';
import { OperatorCallsController } from './leads/operator-calls.controller';
import { AdminOperatorPhoneController } from './calls/admin-operator-phone.controller';
import { CallRecordingsController } from './calls/call-recordings.controller';
import { CallsController } from './calls/calls.controller';
import { ExportLinkService } from './exports/export-link.service';
import { RecordingLinkService } from './calls/recording-link';
import { TelephonyWebhookController } from './webhooks/telephony-webhook.controller';
import { OperatorOrdersController } from './leads/operator-orders.controller';
import { WarehouseController } from './warehouse/warehouse.controller';
import { WarehouseReturnsController } from './warehouse/warehouse-returns.controller';
import { AdminLeadsController } from './leads/admin-leads.controller';
import { AdminFraudController } from './leads/admin-fraud.controller';
import { SupervisorLeadsController } from './leads/supervisor-leads.controller';
import { AdminOfferContentController } from './leads/admin-offer-content.controller';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { gatewayThrottlerModule } from './rate-limit/gateway-throttler.module';

@Module({
  imports: [
    CommonConfigModule, // .env + Joi (global)
    CommonAuthModule, // JWT + guardlar (global)
    // Rate limiting — umumiy chegara va saqlagich (BE-36: REDIS_URL bilan nusxalar orasida umumiy).
    RateLimitModule,
    gatewayThrottlerModule(),
    // Servislarga RMQ client'lari
    ClientsModule.registerAsync([
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
      {
        name: RmqClient.LEAD,
        inject: [ConfigService],
        useFactory: (config: ConfigService) =>
          rmqOptions([config.get<string>('RABBITMQ_URL')!], RmqQueue.LEAD),
      },
    ]),
  ],
  controllers: [
    AppController,
    AuthController,
    CategoriesController,
    StorefrontController,
    NotificationsController,
    AdminDashboardController,
    AdminUsersController,
    AdminOrdersController,
    PaymentsController,
    SupportController,
    ElchiWebhookController,
    AdminFinanceController,
    AdminProductsController,
    AdminCreativesController,
    AdminWholesalersController,
    AdminPricingController,
    AdminAuditController,
    AdminNotificationsController,
    AdminTeamController,
    AdminSettingsController,
    AdminIntegrationController,
    AdminContentController,
    RegionsController,
    AdminInventoryController,
    AdminReturnsController,
    AdminOrderReturnsController,
    AdminVariantReportController,
    PublicLeadsController,
    AffiliateStreamsController,
    // BE-23: pul yechish
    AffiliateWithdrawalsController,
    AdminWithdrawalsController,
    // BE-06
    AffiliateProfileController,
    AffiliateSelfEmployedController,
    AdminSelfEmployedController,
    LegalDocumentsController,
    // BE-27
    AdminFinanceSettingsController,
    AdminModerationController,
    // BE-26
    OpsHealthController,
    // BE-33: optovik hisob-kitobi
    AdminSettlementsController,
    AdminReconciliationController,
    AdminActResponsesController,
    WholesalerSettlementsController,
    // BE-30: optovik kabineti
    WholesalerCabinetController,
    WholesalerProductsController,
    WholesalerShipmentsController,
    AdminWholesalerCabinetController,
    SignedFilesController,
    AdminMetricsController,
    OperatorLeadsController,
    // BE-15: telefoniya
    OperatorCallsController,
    CallsController,
    CallRecordingsController,
    AdminOperatorPhoneController,
    TelephonyWebhookController,
    OperatorOrdersController,
    WarehouseController,
    WarehouseReturnsController,
    AdminLeadsController,
    AdminOfferContentController,
    SupervisorLeadsController,
    AdminFraudController,
  ],
  providers: [
    AppService,
    ReadinessService,
    SignedLinkService, // BE-30: yopiq hujjatlarga imzolangan havola
    ExportLinkService, // BE-25 (FE-26): CSV eksport chiptasi
    RecordingLinkService, // BE-15: qo‘ng‘iroq yozuviga imzolangan havola
    // Tartib muhim: avval rate limit (429) — tokensiz toshqin ham to'siladi,
    // keyin JWT (401), keyin rol (403).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CurrentRoleGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
