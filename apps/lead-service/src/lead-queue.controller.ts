import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  CheckoutDeliveryDestination,
  LEAD_EVENTS,
  OperatorWorkState,
  OrderCreateFailedEvent,
  RpcHttpExceptionFilter,
  SubmitLeadResultDto,
  UpdateLeadAddressDto,
} from '@app/common';
import { LeadAddressService } from './lead-address.service';
import { LeadCardService } from './lead-card.service';
import { LeadQueueService } from './lead-queue.service';

/** Operator ish joyi RPC lari (BE-13; manzil — BE-38). Operator ID gateway'da tokendan. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class LeadQueueController {
  constructor(
    private readonly queue: LeadQueueService,
    private readonly cards: LeadCardService,
    private readonly address: LeadAddressService,
  ) {}

  @MessagePattern({ cmd: 'lead.queue.next' })
  async next(@Payload() input: { operatorId: string }) {
    const leadId = await this.queue.takeNext(input.operatorId);
    return this.cards.forOperator(input.operatorId, leadId);
  }

  @MessagePattern({ cmd: 'lead.queue.mine' })
  mine(@Payload() input: { operatorId: string }) {
    return this.cards.listMine(input.operatorId);
  }

  @MessagePattern({ cmd: 'lead.card.get' })
  card(@Payload() input: { operatorId: string; leadId: string }) {
    return this.cards.forOperator(input.operatorId, input.leadId);
  }

  @MessagePattern({ cmd: 'lead.queue.result' })
  result(
    @Payload()
    input: {
      operatorId: string;
      leadId: string;
      result: SubmitLeadResultDto;
    },
  ) {
    return this.queue.submitResult(
      input.operatorId,
      input.leadId,
      input.result,
    );
  }

  /** PATCH manzil: avval egalik (karta 404 beradi), keyin BE-38 qoidasi, javob — yangilangan karta. */
  @MessagePattern({ cmd: 'lead.queue.update-address' })
  async updateAddress(
    @Payload()
    input: {
      operatorId: string;
      leadId: string;
      address: UpdateLeadAddressDto;
    },
  ) {
    await this.cards.forOperator(input.operatorId, input.leadId);
    await this.address.confirmByOperator(
      input.leadId,
      input.operatorId,
      input.address,
      { requireOwner: true },
    );
    return this.cards.forOperator(input.operatorId, input.leadId);
  }

  @MessagePattern({ cmd: 'lead.card.quote' })
  async quote(
    @Payload()
    input: {
      operatorId: string;
      leadId: string;
      quantity: number;
      whereDeliver: CheckoutDeliveryDestination;
    },
  ) {
    const card = await this.cards.forOperator(input.operatorId, input.leadId);
    // BE-34: saytdan ko‘p tovarli lid — butun posilka; operator o‘zgartiradigan son — birinchi tovarniki
    if (card.items.length > 1)
      return this.cards.parcelPrice(
        card.items.map((item, index) =>
          index === 0 ? { ...item, quantity: input.quantity } : item,
        ),
        input.whereDeliver,
      );
    return this.cards.priceFor(
      card.product.id,
      card.product.salePrice,
      input.quantity,
      input.whereDeliver,
    );
  }

  @MessagePattern({ cmd: 'lead.operator.state' })
  state(@Payload() input: { operatorId: string; state: OperatorWorkState }) {
    return this.queue.setState(input.operatorId, input.state);
  }

  @MessagePattern({ cmd: 'lead.queue.summary' })
  summary() {
    return this.queue.summary();
  }

  /** checkout → lead-service: tovar band qilinmadi (BE-18 → BE-13 TC8). */
  @EventPattern(LEAD_EVENTS.ORDER_CREATE_FAILED)
  orderCreateFailed(@Payload() event: OrderCreateFailedEvent) {
    return this.queue.onOrderCreateFailed(event);
  }
}
