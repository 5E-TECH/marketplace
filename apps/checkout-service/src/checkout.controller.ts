import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateCheckoutDto,
  ElchiWebhookDto,
  PaymentPaidEvent,
  RpcHttpExceptionFilter,
} from '@app/common';
import { CheckoutService } from './checkout.service';
import { ConfirmSalesOrderService } from './confirm-sales-order.service';
import { ElchiWebhookService } from './elchi-webhook.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class CheckoutController {
  constructor(
    private readonly service: CheckoutService,
    private readonly confirmer: ConfirmSalesOrderService,
    private readonly elchiWebhook: ElchiWebhookService,
  ) {}

  @MessagePattern({ cmd: 'checkout.create' })
  create(
    @Payload()
    data: {
      customerId: string;
      dto: CreateCheckoutDto;
      idempotencyKey?: string;
    },
  ) {
    return this.service.create(data.customerId, data.dto, data.idempotencyKey);
  }

  @MessagePattern({ cmd: 'checkout.confirm-cod' })
  confirmCod(@Payload() data: { orderId: string; customerId?: string }) {
    return this.confirmer.confirm(data.orderId, data.customerId);
  }

  @EventPattern('payment.paid')
  paymentPaid(@Payload() event: PaymentPaidEvent) {
    return this.confirmer.confirmPaid(
      event.salesOrderId,
      event.paymentId,
      event.amount,
    );
  }

  @MessagePattern({ cmd: 'checkout.elchi-webhook.process' })
  processElchiWebhook(@Payload() event: ElchiWebhookDto) {
    return this.elchiWebhook.process(event);
  }
}
