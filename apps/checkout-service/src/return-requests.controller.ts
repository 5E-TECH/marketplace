import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminReturnRequestsQueryDto,
  CreateReturnRequestDto,
  RpcHttpExceptionFilter,
} from '@app/common';
import { LeadReturnService } from './lead-return.service';
import { ReturnActor } from './return-history';
import { ReturnRequestQueryService } from './return-request-query.service';
import { ReturnRequestService } from './return-request.service';
import { ReturnRefundService } from './return-refund.service';

interface ActionPayload {
  returnId: string;
  actor: ReturnActor;
  comment?: string;
}

/** C4.2 — qaytarish so'rovlari: admin (xaridor va sotuvchi yo‘llari BE-29 da o‘chirildi). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class ReturnRequestsController {
  constructor(
    private readonly returns: ReturnRequestService,
    private readonly refunds: ReturnRefundService,
    private readonly queries: ReturnRequestQueryService,
    private readonly leadReturns: LeadReturnService,
  ) {}

  /** BE-44: xodim (admin, operator) mijoz nomidan yetkazilgan buyurtmaga qaytarish so‘rovini kiritadi. */
  @MessagePattern({ cmd: 'checkout.admin.order-return-create' })
  createForOrder(
    @Payload()
    data: {
      orderId: string;
      dto: CreateReturnRequestDto;
      actor: ReturnActor;
    },
  ) {
    return this.leadReturns.create({
      orderId: String(data?.orderId ?? ''),
      dto: data.dto,
      actor: { id: String(data.actor.id), role: String(data.actor.role) },
    });
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  @MessagePattern({ cmd: 'checkout.admin.returns-list' })
  adminList(@Payload() data: { query?: AdminReturnRequestsQueryDto }) {
    return this.queries.list(data?.query ?? {});
  }

  @MessagePattern({ cmd: 'checkout.admin.return-get' })
  adminGet(@Payload() data: { returnId: string }) {
    return this.queries.get(String(data.returnId));
  }

  @MessagePattern({ cmd: 'checkout.admin.return-approve' })
  async adminApprove(@Payload() data: ActionPayload) {
    // BE-44: liddan buyurtmaga xodim so‘rovi — buyurtma holati va order.returned shu yerda
    if (await this.leadReturns.isStaffRequest(String(data.returnId)))
      return this.leadReturns.decide({ ...this.action(data), approve: true });
    return this.returns.transition('adminApprove', this.action(data));
  }

  @MessagePattern({ cmd: 'checkout.admin.return-reject' })
  async adminReject(@Payload() data: ActionPayload) {
    if (await this.leadReturns.isStaffRequest(String(data.returnId)))
      return this.leadReturns.decide({ ...this.action(data), approve: false });
    return this.returns.transition('adminReject', this.action(data));
  }

  @MessagePattern({ cmd: 'checkout.admin.return-refund' })
  adminRefund(
    @Payload()
    data: ActionPayload & { amount?: number; restock?: boolean },
  ) {
    return this.refunds.refund({
      ...this.action(data),
      amount: data.amount,
      restock: data.restock,
    });
  }

  private action(data: ActionPayload) {
    return {
      returnId: String(data.returnId),
      actor: { id: String(data.actor.id), role: String(data.actor.role) },
      comment: data.comment ?? null,
    };
  }
}
