import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  FINANCE_SETTLEMENT_RPC,
  RpcHttpExceptionFilter,
  WHOLESALER_CABINET_RPC,
  WholesalerSettlementQueryDto,
  UpdateSettlementSettingsDto,
} from '@app/common';
import { SettlementService } from './settlement.service';
import { WholesalerBalanceService } from './wholesaler-balance.service';

/** BE-33: optovik bilan haftalik hisob-kitob va akt-sverka (moliya). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class SettlementController {
  constructor(
    private readonly settlements: SettlementService,
    private readonly balances: WholesalerBalanceService,
  ) {}

  /** BE-30 (OPT-3): optovik paneli — pul holati. */
  @MessagePattern({ cmd: WHOLESALER_CABINET_RPC.BALANCE })
  balance(@Payload() input: { wholesalerId: string }) {
    return this.balances.balance(input);
  }

  /** BE-30 (OPT-3): optovik paneli — sotilgan dona moliya hisobidan (pul bilan bir hisob). */
  @MessagePattern({ cmd: WHOLESALER_CABINET_RPC.SOLD_UNITS })
  soldUnits(@Payload() input: { wholesalerId: string }) {
    return this.balances.soldUnits(input);
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RPC.SETTINGS_GET })
  settings() {
    return this.settlements.settings();
  }

  @MessagePattern({ cmd: FINANCE_SETTLEMENT_RPC.SETTINGS_UPDATE })
  updateSettings(
    @Payload()
    input: {
      dto: UpdateSettlementSettingsDto;
      changedBy: string;
    },
  ) {
    return this.settlements.updateSettings(input);
  }

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
