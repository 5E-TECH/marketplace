// libs/common — barcha servislar uchun umumiy kod (barrel export).

// Config
export * from './config/config.module';
export * from './config/env.validation';

// Enums & konstantalar
export * from './enums';
export * from './constants/error-codes';

// Interfeyslar
export * from './interfaces/api-response.interface';
export * from './interfaces/elchi-shipment.interface';

// Database
export * from './database/base.entity';
export * from './database/numeric.transformer';
export * from './database/money.transformer';
export * from './database/returning-rows';
export * from './database/typeorm.util';

// DTO
export * from './dto/auth.dto';
export * from './dto/affiliate-auth.dto';
export * from './dto/seller.dto';
export * from './dto/category.dto';
export * from './dto/banner.dto';
export * from './dto/product.dto';
export * from './dto/storefront.dto';
export * from './dto/search.dto';
export * from './dto/cart.dto';
export * from './dto/order-events.dto';
export * from './dto/lead-order.dto';
export * from './dto/fulfillment.dto';
export * from './dto/product-variant.dto';
export * from './dto/file.dto';
export * from './dto/creative.dto';
export * from './dto/inventory.dto';
export * from './dto/notification.dto';
export * from './dto/admin-shop.dto';
export * from './dto/admin-dashboard.dto';
export * from './dto/platform-metrics.dto';
export * from './dto/admin-user.dto';
export * from './dto/admin-order.dto';
export * from './dto/admin-notification.dto';
export * from './dto/admin-audit.dto';
export * from './dto/admin-team.dto';
export * from './dto/admin-settings.dto';
export * from './dto/payment.dto';
export * from './dto/finance.dto';
export * from './dto/finance-response.dto';
export * from './dto/review.dto';
export * from './dto/support.dto';
export * from './dto/favorite.dto';
export * from './dto/elchi-webhook.dto';
export * from './dto/elchi-webhook.normalize';
export * from './dto/geo.dto';
export * from './dto/order-tracking.dto';
export * from './dto/return-request.dto';
export * from './dto/admin-operations.dto';
export * from './dto/lead.dto';
export * from './dto/lead-affiliate.dto';
export * from './dto/lead-operator.dto';
export * from './dto/lead-events.dto';
export * from './dto/lead-fraud.dto';
export * from './dto/affiliate-income.dto';
export * from './dto/withdrawal.dto';
export * from './dto/wholesaler-settlement.dto';
export * from './dto/settlement-response.dto';
export * from './dto/finance-reconciliation.dto';

// So'rov konteksti / kuzatuv
export * from './context/request-context';
export * from './middleware/request-id.middleware';
export * from './interceptors/http-logger.interceptor';

// Javob qobig'i / xato
export * from './interceptors/transform.interceptor';
export * from './filters/all-exceptions.filter';
export * from './filters/rpc-http-exception.filter';
export * from './exceptions/business.exception';

// Auth: dekoratorlar, guard'lar, modul
export * from './decorators/public.decorator';
export * from './decorators/roles.decorator';
export * from './decorators/current-user.decorator';
export * from './guards/jwt-auth.guard';
export * from './guards/roles.guard';
export * from './guards/self.guard';
export * from './auth/common-auth.module';
export * from './auth/auth-cookies';

// Xavfsizlik yordamchilari
export * from './security/hmac.util';
export * from './security/crypto.util';
export * from './security/ssrf.util';

// Messaging
export * from './messaging/reliable-rmq.server';
export * from './messaging/rmq.util';
export * from './messaging/rpc.util';
export * from './health/service-health.module';

// Idempotency / Outbox / Activity-log
export * from './idempotency/idempotency-record.entity';
export * from './idempotency/idempotency.service';
export * from './outbox/outbox-event.entity';
export * from './outbox/outbox.service';
export * from './outbox/processed-event';
export * from './scheduling/leader-lock';
export * from './activity-log/activity-log.entity';
export * from './activity-log/activity-log.service';
// BE-39: S1 va S3 sinovi hisoboti
export * from './dto/lead-report.dto';

// BE-04: migratsiya CLI va servis bazasi ta’rifi
export * from './database/migrate-cli';
// BE-07: optovik (admin kiritadi)
export * from './dto/wholesaler.dto';
export * from './dto/wholesaler-cabinet.dto';
export * from './dto/warehouse-inbound.dto';
// BE-09: narx kalkulyatori (sof hisob)
export * from './pricing';
export * from './dto/pricing.dto';
// PDF: Unicode shrift (kirill, ʻ/ʼ) — hamma PDF generatorlar
export * from './pdf/pdf-fonts';
