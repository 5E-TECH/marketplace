import { BadRequestException, Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  LEAD_UPSELL_RPC,
  OPERATOR_BONUS_RPC,
  RpcHttpExceptionFilter,
} from '@app/common';
import { OperatorBonusService } from './operator-bonus.service';
import { LeadUpsellService } from './lead-upsell.service';

/** BE-45: operator ish joyida qo‘shimcha tovar (OPR-4). Operator ID gateway'da tokendan. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadUpsellController {
  constructor(
    private readonly upsell: LeadUpsellService,
    private readonly bonus: OperatorBonusService,
  ) {}

  /** BE-45 TC6: upsell bonusi sozlamasi (superadmin). */
  @MessagePattern({ cmd: OPERATOR_BONUS_RPC.SETTINGS_GET })
  bonusSettings() {
    return this.bonus.settings();
  }

  @MessagePattern({ cmd: OPERATOR_BONUS_RPC.SETTINGS_SET })
  setBonusSettings(@Payload() input: { actorId: string; upsellBonus: number }) {
    const amount = Number(input?.upsellBonus);
    if (!Number.isSafeInteger(amount) || amount < 0)
      throw new BadRequestException('upsellBonus — 0 yoki musbat butun son');
    return this.bonus.updateSettings(String(input?.actorId ?? ''), amount);
  }

  @MessagePattern({ cmd: LEAD_UPSELL_RPC.GET })
  get(@Payload() input: { operatorId: string; leadId: string }) {
    return this.upsell.get(String(input?.operatorId), String(input?.leadId));
  }

  @MessagePattern({ cmd: LEAD_UPSELL_RPC.ADD })
  add(
    @Payload()
    input: {
      operatorId: string;
      leadId: string;
      productId: string;
      quantity: number;
    },
  ) {
    return this.upsell.add(
      String(input?.operatorId),
      String(input?.leadId),
      String(input?.productId),
      Number(input?.quantity),
    );
  }

  @MessagePattern({ cmd: LEAD_UPSELL_RPC.REMOVE })
  remove(
    @Payload() input: { operatorId: string; leadId: string; itemId: string },
  ) {
    return this.upsell.remove(
      String(input?.operatorId),
      String(input?.leadId),
      String(input?.itemId),
    );
  }

  @MessagePattern({ cmd: LEAD_UPSELL_RPC.DECLINE })
  decline(@Payload() input: { operatorId: string; leadId: string }) {
    return this.upsell.decline(
      String(input?.operatorId),
      String(input?.leadId),
    );
  }
}
