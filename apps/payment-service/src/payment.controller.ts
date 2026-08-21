import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreatePaymentDto,
  PaymentProvider,
  RpcHttpExceptionFilter,
  UpsertProviderConfigDto,
} from '@app/common';
import { PaymentService } from './payment.service';
import { PaymeService } from './payme.service';
import { PaymeRpcPayload } from './payme.types';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class PaymentController {
  constructor(
    private readonly service: PaymentService,
    private readonly payme: PaymeService,
  ) {}

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

  @MessagePattern({ cmd: 'payment.payme.callback' })
  paymeCallback(@Payload() payload: PaymeRpcPayload) {
    return this.payme.callback(payload);
  }
}
