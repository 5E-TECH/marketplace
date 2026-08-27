import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreateCheckoutDto,
  ElchiWebhookDto,
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

  @MessagePattern({ cmd: 'checkout.elchi-webhook.process' })
  processElchiWebhook(@Payload() event: ElchiWebhookDto) {
    return this.elchiWebhook.process(event);
  }
}
