import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  FINANCE_WITHDRAWAL_RPC,
  PAYOUT_CARD_RPC,
  PAYOUT_EVENTS,
  PayoutCardBoundEvent,
  PayoutStatusEvent,
  RpcHttpExceptionFilter,
} from '@app/common';
import { PayoutService } from './payout.service';

/** BE-32: sotuvchi kartasi, provayder hodisalari va `PAYING` ni qo‘lda yopish. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class PayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @MessagePattern({ cmd: PAYOUT_CARD_RPC.GET })
  card(@Payload() input: { affiliateId: string }) {
    return this.payouts.card(input);
  }

  @MessagePattern({ cmd: PAYOUT_CARD_RPC.SESSION })
  session(@Payload() input: { affiliateId: string }) {
    return this.payouts.createSession(input);
  }

  @MessagePattern({ cmd: PAYOUT_CARD_RPC.REMOVE })
  remove(@Payload() input: { affiliateId: string }) {
    return this.payouts.removeCard(input);
  }

  @MessagePattern({ cmd: FINANCE_WITHDRAWAL_RPC.PAYOUT_RESULT })
  resolve(
    @Payload()
    input: {
      id: string;
      result: 'PAID' | 'FAILED';
      note: string;
      actorId: string;
    },
  ) {
    return this.payouts.resolve(input);
  }

  // xato qayta tashlanadi — RMQ qayta urinadi, keyin DLQ (BE-02)
  @EventPattern(PAYOUT_EVENTS.CARD_BOUND)
  onCardBound(@Payload() event: PayoutCardBoundEvent) {
    return this.payouts.onCardBound(event);
  }

  @EventPattern(PAYOUT_EVENTS.STATUS)
  onStatus(@Payload() event: PayoutStatusEvent) {
    return this.payouts.onStatus(event);
  }
}
