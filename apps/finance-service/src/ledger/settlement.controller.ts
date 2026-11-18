import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  FINANCE_SETTLEMENT_RPC,
  RpcHttpExceptionFilter,
  WholesalerSettlementQueryDto,
} from '@app/common';
import { SettlementService } from './settlement.service';

/** BE-33: optovik bilan haftalik hisob-kitob va akt-sverka (moliya). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class SettlementController {
  constructor(private readonly settlements: SettlementService) {}

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RPC.RUN })
  run(@Payload() input: { asOf?: string }) {
    return this.settlements.run(input ?? {});
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RPC.LIST })
  list(@Payload() input: { query: WholesalerSettlementQueryDto }) {
    return this.settlements.list(input);
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RPC.GET })
  get(@Payload() input: { id: string }) {
    return this.settlements.get(input);
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RPC.PAID })
  paid(@Payload() input: { id: string; paidBy: string }) {
    return this.settlements.markPaid(input);
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RPC.ACT_PDF })
  actPdf(@Payload() input: { id: string }) {
    return this.settlements.actPdf(input);
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RPC.BANK_FILE })
  bankFile(@Payload() input: { periodEnd: string }) {
    return this.settlements.bankFile(input);
  }
}
