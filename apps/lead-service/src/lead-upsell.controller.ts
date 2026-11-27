import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { LEAD_UPSELL_RPC, RpcHttpExceptionFilter } from '@app/common';
import { LeadUpsellService } from './lead-upsell.service';

/** BE-45: operator ish joyida qo‘shimcha tovar (OPR-4). Operator ID gateway'da tokendan. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadUpsellController {
  constructor(private readonly upsell: LeadUpsellService) {}

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
