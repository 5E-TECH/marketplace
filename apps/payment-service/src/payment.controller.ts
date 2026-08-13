import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreatePaymentDto,
  PaymentProvider,
  RpcHttpExceptionFilter,
  UpsertProviderConfigDto,
} from '@app/common';
import { PaymentService } from './payment.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  @MessagePattern({ cmd: 'payment.create' })
  create(@Payload() dto: CreatePaymentDto) {
    return this.service.create(dto);
  }

  @MessagePattern({ cmd: 'payment.provider-config.upsert' })
  upsertProviderConfig(
    @Payload()
    data: {
      provider: PaymentProvider;
      dto: UpsertProviderConfigDto;
    },
  ) {
    return this.service.upsertProviderConfig(data.provider, data.dto);
  }
}
