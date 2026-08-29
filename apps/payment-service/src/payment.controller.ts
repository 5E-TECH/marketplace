import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  CreatePaymentDto,
  PaymentProvider,
  RefundPaymentDto,
  RpcHttpExceptionFilter,
  UpsertProviderConfigDto,
} from '@app/common';
import { PaymentService } from './payment.service';
import { PaymeService } from './payme.service';
import { PaymeRpcPayload } from './payme.types';
import { ClickService } from './click.service';
import { ClickRpcPayload } from './click.types';
import { PaymentRefundService } from './payment-refund.service';

@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class PaymentController {
  constructor(
    private readonly service: PaymentService,
    private readonly payme: PaymeService,
    private readonly click: ClickService,
    private readonly refunds: PaymentRefundService,
  ) {}

  @MessagePattern({ cmd: 'payment.refund' })
  refund(@Payload() dto: RefundPaymentDto) {
    return this.refunds.refund(dto);
  }

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

  @MessagePattern({ cmd: 'payment.click.prepare' })
  clickPrepare(@Payload() payload: ClickRpcPayload) {
    return this.click.prepare(payload.body);
  }

  @MessagePattern({ cmd: 'payment.click.complete' })
  clickComplete(@Payload() payload: ClickRpcPayload) {
    return this.click.complete(payload.body);
  }
}
