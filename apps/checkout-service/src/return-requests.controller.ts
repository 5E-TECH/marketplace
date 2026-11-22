import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminReturnRequestsQueryDto,
  RpcHttpExceptionFilter,
} from '@app/common';
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
  ) {}

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
  adminApprove(@Payload() data: ActionPayload) {
    return this.returns.transition('adminApprove', this.action(data));
  }

  @MessagePattern({ cmd: 'checkout.admin.return-reject' })
  adminReject(@Payload() data: ActionPayload) {
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
