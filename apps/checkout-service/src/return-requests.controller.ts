import { ConflictException, Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminReturnRequestsQueryDto,
  CreateReturnRequestDto,
  ErrorCode,
  RETURN_PHOTO_RPC,
  RpcHttpExceptionFilter,
  StoredReturnPhoto,
} from '@app/common';
import { LeadReturnService } from './lead-return.service';
import { ReturnActor } from './return-history';
import { ReturnPhotoService } from './return-photo.service';
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
    private readonly photos: ReturnPhotoService,
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

  /** BE-25 (FE-26): so‘rovga mijoz rasmlari. */
  @MessagePattern({ cmd: RETURN_PHOTO_RPC.CHECK })
  photoCheck(@Payload() data: { orderId: string; count: number }) {
    return this.photos.check(data);
  }

  @MessagePattern({ cmd: RETURN_PHOTO_RPC.ADD })
  photoAdd(
    @Payload()
    data: {
      orderId: string;
      returnId: string;
      files: StoredReturnPhoto[];
      actorId: string;
    },
  ) {
    return this.photos.add(data);
  }

  @MessagePattern({ cmd: RETURN_PHOTO_RPC.GET })
  photoGet(@Payload() data: { photoId: string; returnId?: string }) {
    return this.photos.get(data);
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
  async adminRefund(
    @Payload()
    data: ActionPayload & { amount?: number; restock?: boolean },
  ) {
    // BE-44: xodim so‘rovida pul `order.returned` (moliya teskari yozuvlari), tovar — ombor saralashi (BE-17);
    // eski onlayn refund va darhol qoldiqqa qaytarish ikki marta yozardi
    if (await this.leadReturns.isStaffRequest(String(data.returnId)))
      throw new ConflictException({
        message:
          'Liddan buyurtma qaytarishida pul va tovar avtomatik (moliya va ombor) — refund yo‘q',
        errorCode: ErrorCode.INVALID_STATE,
      });
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
