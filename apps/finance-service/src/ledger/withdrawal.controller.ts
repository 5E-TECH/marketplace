import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminWithdrawalQueryDto,
  FINANCE_WITHDRAWAL_RPC,
  RpcHttpExceptionFilter,
  WithdrawalQueryDto,
} from '@app/common';
import { WithdrawalService } from './withdrawal.service';

/** BE-23: pul yechish so‘rovlari (sotuvchi kabineti va moliya). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class WithdrawalController {
  constructor(private readonly withdrawals: WithdrawalService) {}

  @MessagePattern({ cmd: FINANCE_WITHDRAWAL_RPC.BALANCE })
  balance(@Payload() input: { affiliateId: string }) {
    return this.withdrawals.balance(input);
  }

  @MessagePattern({ cmd: FINANCE_WITHDRAWAL_RPC.CREATE })
  create(@Payload() input: { affiliateId: string; amount: number }) {
    return this.withdrawals.create(input);
  }

  @MessagePattern({ cmd: FINANCE_WITHDRAWAL_RPC.LIST_MINE })
  listMine(
    @Payload() input: { affiliateId: string; query: WithdrawalQueryDto },
  ) {
    return this.withdrawals.listMine(input);
  }

  @MessagePattern({ cmd: FINANCE_WITHDRAWAL_RPC.ADMIN_LIST })
  adminList(@Payload() input: { query: AdminWithdrawalQueryDto }) {
    return this.withdrawals.adminList(input);
  }

  @MessagePattern({ cmd: FINANCE_WITHDRAWAL_RPC.APPROVE })
  approve(@Payload() input: { id: string; approverId: string }) {
    return this.withdrawals.approve(input);
  }

  @MessagePattern({ cmd: FINANCE_WITHDRAWAL_RPC.REJECT })
  reject(@Payload() input: { id: string; rejectedBy: string; reason: string }) {
    return this.withdrawals.reject(input);
  }

  @MessagePattern({ cmd: FINANCE_WITHDRAWAL_RPC.PAID })
  paid(@Payload() input: { id: string; paidBy: string }) {
    return this.withdrawals.markPaid(input);
  }

  @MessagePattern({ cmd: FINANCE_WITHDRAWAL_RPC.SELF_EMPLOYED_SET })
  setSelfEmployed(
    @Payload()
    input: {
      affiliateId: string;
      selfEmployed: boolean;
      updatedBy: string;
    },
  ) {
    return this.withdrawals.setSelfEmployed(input);
  }
}
