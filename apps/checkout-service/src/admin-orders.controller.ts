import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  OrderExportChunkInput,
  OrderExportFilterDto,
  OrderViewer,
  RpcHttpExceptionFilter,
} from '@app/common';
import { AdminOrdersService } from './admin-orders.service';
import { AdminOrderListQuery } from './seller-orders.service';

/** Ko‘ruvchi berilmasa yoki noma’lum — eng kam huquq (hech kimning buyurtmasi emas). */
const viewerOf = (viewer?: OrderViewer): OrderViewer =>
  viewer?.kind === 'ADMIN' || viewer?.kind === 'SUPERVISOR'
    ? { kind: viewer.kind, userId: String(viewer.userId ?? '') }
    : { kind: 'OPERATOR', userId: String(viewer?.userId ?? '') };

/** Buyurtmalar RPC lari: admin, nazoratchi, operator (BE-18; FE-26 — BE-25). Kim — gateway tokenidan. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class AdminOrdersRpcController {
  constructor(private readonly orders: AdminOrdersService) {}

  @MessagePattern({ cmd: 'checkout.admin.orders-list' })
  list(@Payload() data: { query?: AdminOrderListQuery; viewer?: OrderViewer }) {
    return this.orders.list(data?.query ?? {}, viewerOf(data?.viewer));
  }

  @MessagePattern({ cmd: 'checkout.admin.order-get' })
  get(@Payload() data: { orderId: string; viewer?: OrderViewer }) {
    return this.orders.get(String(data?.orderId), viewerOf(data?.viewer));
  }

  /** Lid kartasi (gateway): buyurtma qisqachasi — raqam va sotuvchi ma’lumotisiz. */
  @MessagePattern({ cmd: 'checkout.admin.order-brief' })
  brief(@Payload() data: { orderId: string }) {
    return this.orders.brief(String(data?.orderId));
  }

  @MessagePattern({ cmd: 'checkout.admin.order-label-reprint' })
  reprint(
    @Payload() data: { orderId: string; actorId: string; reason: string },
  ) {
    return this.orders.logReprint(data.orderId, data.actorId, data.reason);
  }

  @MessagePattern({ cmd: 'checkout.admin.order-dispute' })
  dispute(
    @Payload() data: { orderId: string; actorId: string; reason: string },
  ) {
    return this.orders.openDisputeFor(data.orderId, data.actorId, data.reason);
  }

  @MessagePattern({ cmd: 'checkout.admin.order-dispute-close' })
  closeDispute(
    @Payload() data: { orderId: string; actorId: string; comment?: string },
  ) {
    return this.orders.closeDispute(
      data.orderId,
      data.actorId,
      data.comment ?? null,
    );
  }

  @MessagePattern({ cmd: 'checkout.admin.order-elchi-resend' })
  resend(@Payload() data: { orderId: string }) {
    return this.orders.resendToElchi(data.orderId);
  }

  @MessagePattern({ cmd: 'checkout.admin.order-elchi-refresh' })
  refresh(@Payload() data: { orderId: string }) {
    return this.orders.refreshFromElchi(data.orderId);
  }

  @MessagePattern({ cmd: 'checkout.admin.orders-export-count' })
  exportCount(
    @Payload() data: { filters: OrderExportFilterDto; until: string },
  ) {
    return this.orders.exportCount(data.filters ?? {}, new Date(data.until));
  }

  @MessagePattern({ cmd: 'checkout.admin.orders-export-chunk' })
  exportChunk(@Payload() data: OrderExportChunkInput) {
    return this.orders.exportChunk(data);
  }
}
