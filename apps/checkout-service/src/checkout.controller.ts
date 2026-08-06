import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CreateCheckoutDto, RpcHttpExceptionFilter } from '@app/common';
import { CheckoutService } from './checkout.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class CheckoutController {
  constructor(private readonly service: CheckoutService) {}

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
}
