import { Controller, Inject, UseFilters } from '@nestjs/common';
import { ClientProxy, MessagePattern, Payload } from '@nestjs/microservices';
import {
  AdminReturnRequestsQueryDto,
  CreateReturnRequestDto,
  ReturnRequestsQueryDto,
  RmqClient,
  RpcHttpExceptionFilter,
} from '@app/common';
import { resolveSellerShopId, SellerScope } from './catalog-shop.util';
import { ReturnActor } from './return-history';
import { ReturnRequestQueryService } from './return-request-query.service';
import {
  ReturnRequestService,
  ReturnTransition,
} from './return-request.service';
import { ReturnRefundService } from './return-refund.service';

interface ActionPayload {
  returnId: string;
  actor: ReturnActor;
  comment?: string;
}

/** C4.2 — qaytarish so'rovlari: xaridor, sotuvchi/operator va admin. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class ReturnRequestsController {
  constructor(
    private readonly returns: ReturnRequestService,
    private readonly refunds: ReturnRefundService,
    private readonly queries: ReturnRequestQueryService,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  // ─── Xaridor ──────────────────────────────────────────────────────────────

  @MessagePattern({ cmd: 'checkout.returns.create' })
  create(
    @Payload()
    data: {
      orderId: string;
      customerId: string;
      dto: CreateReturnRequestDto;
    },
  ) {
    return this.returns.create(data);
  }

  @MessagePattern({ cmd: 'checkout.returns.list-by-buyer' })
  listByBuyer(
    @Payload() data: { customerId: string; query?: ReturnRequestsQueryDto },
  ) {
    return this.queries.list({
      ...(data.query ?? {}),
      customerId: String(data.customerId),
    });
  }

  @MessagePattern({ cmd: 'checkout.returns.get-by-buyer' })
  getByBuyer(@Payload() data: { customerId: string; returnId: string }) {
    return this.queries.get(String(data.returnId), {
      customerId: String(data.customerId),
    });
  }

  // ─── Sotuvchi / operator (o'z do'koni bilan cheklangan) ──────────────────

  @MessagePattern({ cmd: 'seller.returns.list' })
  async sellerList(
    @Payload() data: SellerScope & { query?: ReturnRequestsQueryDto },
  ) {
    const shopId = await resolveSellerShopId(this.catalog, data);
    return this.queries.list({ ...(data.query ?? {}), shopId });
  }

  @MessagePattern({ cmd: 'seller.returns.get' })
  async sellerGet(@Payload() data: SellerScope & { returnId: string }) {
    const shopId = await resolveSellerShopId(this.catalog, data);
    return this.queries.get(String(data.returnId), { shopId });
  }

  @MessagePattern({ cmd: 'seller.returns.review' })
  sellerReview(@Payload() data: SellerScope & ActionPayload) {
    return this.sellerAction('review', data);
  }

  @MessagePattern({ cmd: 'seller.returns.approve' })
  sellerApprove(@Payload() data: SellerScope & ActionPayload) {
    return this.sellerAction('sellerApprove', data);
  }

  @MessagePattern({ cmd: 'seller.returns.reject' })
  sellerReject(@Payload() data: SellerScope & ActionPayload) {
    return this.sellerAction('sellerReject', data);
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

  private async sellerAction(
    kind: ReturnTransition,
    data: SellerScope & ActionPayload,
  ) {
    const shopId = await resolveSellerShopId(this.catalog, data);
    return this.returns.transition(kind, { ...this.action(data), shopId });
  }

  private action(data: ActionPayload) {
    return {
      returnId: String(data.returnId),
      actor: { id: String(data.actor.id), role: String(data.actor.role) },
      comment: data.comment ?? null,
    };
  }
}
