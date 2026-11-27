import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  FINANCE_SETTLEMENT_RESPONSE_RPC,
  RpcHttpExceptionFilter,
  SettlementDisputeQueryDto,
  WHOLESALER_ATTENTION_RPC,
} from '@app/common';
import { SettlementResponseService } from './settlement-response.service';

/** BE-46 (FE-24): optovik akti — qabul, e’tiroz, moliya javobi. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class SettlementResponseController {
  constructor(private readonly responses: SettlementResponseService) {}

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.WHOLESALER_GET })
  wholesalerGet(@Payload() input: { id?: string; wholesalerId?: string }) {
    return this.responses.wholesalerGet(input);
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.ACT })
  act(@Payload() input: { id?: string }) {
    return this.responses.adminGet(input);
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.ACCEPT })
  accept(
    @Payload() input: { id?: string; wholesalerId?: string; userId?: string },
  ) {
    return this.responses.accept(input);
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.DISPUTE })
  dispute(
    @Payload()
    input: {
      id?: string;
      wholesalerId?: string;
      userId?: string;
      comment?: string;
    },
  ) {
    return this.responses.dispute(input);
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.DISPUTES })
  disputes(@Payload() input: { query?: SettlementDisputeQueryDto }) {
    return this.responses.disputes(input);
  }

  /** BE-25 (FE-25): «Diqqat talab qiladi» — javob kutayotgan «Tayyor» aktlar. */
  @MessagePattern({ cmd: WHOLESALER_ATTENTION_RPC.FINANCE_READY })
  readyForAttention() {
    return this.responses.readyForAttention();
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RESPONSE_RPC.ANSWER })
  answer(@Payload() input: { id?: string; userId?: string; comment?: string }) {
    return this.responses.answer(input);
  }
}
