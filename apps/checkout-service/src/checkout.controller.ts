import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateCheckoutDto,
  CheckoutAddressDto,
  ElchiWebhookDto,
  PaymentPaidEvent,
  RpcHttpExceptionFilter,
} from '@app/common';
import { CheckoutService } from './checkout.service';
import { ConfirmSalesOrderService } from './confirm-sales-order.service';
import { ElchiWebhookService } from './elchi-webhook.service';
import { ReviewEligibilityService } from './review-eligibility.service';
import { AdminIntegrationQueryService } from './admin-integration-query.service';
import { AdminShipmentsQueryDto, AdminWebhooksQueryDto } from '@app/common';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class CheckoutController {
  constructor(
    private readonly service: CheckoutService,
    private readonly confirmer: ConfirmSalesOrderService,
    private readonly elchiWebhook: ElchiWebhookService,
    private readonly reviewEligibility: ReviewEligibilityService,
    private readonly adminIntegration: AdminIntegrationQueryService,
  ) {}

  @MessagePattern({ cmd: 'checkout.admin.integration.shipments-list' })
  adminShipments(@Payload() data: { query: AdminShipmentsQueryDto }) {
    return this.adminIntegration.shipments(data.query);
  }

  @MessagePattern({ cmd: 'checkout.admin.integration.webhooks-list' })
  adminWebhooks(@Payload() data: { query: AdminWebhooksQueryDto }) {
    return this.adminIntegration.webhooks(data.query);
  }

  @MessagePattern({ cmd: 'checkout.payment-context' })
  paymentContext(@Payload() data: { orderId: string; customerId: string }) {
    return this.service.paymentContext(data.orderId, data.customerId);
  }

  @MessagePattern({ cmd: 'checkout.review.verify' })
  verifyReview(
    @Payload()
    data: {
      customerId: string;
      orderItemId: string;
      productId: string;
    },
  ) {
    return this.reviewEligibility.verify(
      data.customerId,
      data.orderItemId,
      data.productId,
    );
  }

  @MessagePattern({ cmd: 'checkout.create' })
  create(
    @Payload()
    data: {
      customerId: string;
      sessionId?: string;
      dto: CreateCheckoutDto;
      idempotencyKey?: string;
    },
  ) {
    return this.service.create(
      data.customerId,
      data.dto,
      data.idempotencyKey,
      data.sessionId,
    );
  }

  @MessagePattern({ cmd: 'checkout.delivery.preview' })
  preview(
    @Payload()
    data: {
      customerId?: string;
      sessionId?: string;
      address: CheckoutAddressDto;
    },
  ) {
    return this.service.preview(data.customerId, data.sessionId, data.address);
  }

  @MessagePattern({ cmd: 'checkout.confirm-cod' })
  confirmCod(
    @Payload()
    data: {
      orderId: string;
      customerId?: string;
      sessionId?: string;
    },
  ) {
    return this.confirmer.confirm(
      data.orderId,
      data.customerId,
      data.sessionId,
    );
  }

  @EventPattern('payment.paid')
  paymentPaid(@Payload() event: PaymentPaidEvent) {
    return this.confirmer.confirmPaid(
      event.salesOrderId,
      event.paymentId,
      event.amount,
    );
  }

  @MessagePattern({ cmd: 'checkout.payment-paid' })
  paymentPaidRpc(@Payload() event: PaymentPaidEvent) {
    return this.paymentPaid(event);
  }

  @MessagePattern({ cmd: 'checkout.elchi-webhook.process' })
  processElchiWebhook(@Payload() event: ElchiWebhookDto) {
    return this.elchiWebhook.process(event);
  }
}
