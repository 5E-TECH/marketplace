import { Controller, UseFilters } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';
import {
  ElchiParcelCancelResultEvent,
  ElchiParcelCreatedEvent,
  ElchiParcelFailedEvent,
  ORDER_EVENTS,
  RpcHttpExceptionFilter,
  WAREHOUSE_RPC,
} from '@app/common';
import { ElchiParcelEventsService } from './elchi-parcel-events.service';
import { FulfillmentService, WarehouseActor } from './fulfillment.service';

/** Ombor (BE-19): yig‘ish ro‘yxati, skaner, qadoq, yorliq, topshirish akti; Elchi posilka xabarlari. */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class FulfillmentController {
  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly parcels: ElchiParcelEventsService,
  ) {}

  @MessagePattern({ cmd: WAREHOUSE_RPC.PICK_LIST })
  pickList(@Payload() data: { date?: string }) {
    return this.fulfillment.pickList(data?.date);
  }

  @MessagePattern({ cmd: WAREHOUSE_RPC.SCAN })
  scan(
    @Payload() data: { taskId: string; code: string; actor: WarehouseActor },
  ) {
    return this.fulfillment.scan(data?.taskId, data?.code, data?.actor);
  }

  @MessagePattern({ cmd: WAREHOUSE_RPC.PACK })
  pack(@Payload() data: { taskId: string; actor: WarehouseActor }) {
    return this.fulfillment.pack(data?.taskId, data?.actor);
  }

  @MessagePattern({ cmd: WAREHOUSE_RPC.LABEL })
  label(@Payload() data: { orderId: string }) {
    return this.fulfillment.label(data?.orderId);
  }

  @MessagePattern({ cmd: WAREHOUSE_RPC.HANDOVER })
  handover(@Payload() data: { qrTokens: string[]; actor: WarehouseActor }) {
    return this.fulfillment.handover(data?.qrTokens, data?.actor);
  }

  @MessagePattern({ cmd: WAREHOUSE_RPC.ACT_GET })
  act(@Payload() data: { id: string }) {
    return this.fulfillment.act(data?.id);
  }

  @MessagePattern({ cmd: WAREHOUSE_RPC.ACTS })
  acts(@Payload() data: { page?: number; limit?: number }) {
    return this.fulfillment.acts(data);
  }

  @MessagePattern({ cmd: WAREHOUSE_RPC.ACT_PDF })
  actPdf(@Payload() data: { id: string }) {
    return this.fulfillment.actPdf(data?.id);
  }

  @EventPattern(ORDER_EVENTS.PARCEL_CREATED)
  async parcelCreated(@Payload() event: ElchiParcelCreatedEvent) {
    await this.parcels.onCreated(event);
  }

  @EventPattern(ORDER_EVENTS.PARCEL_FAILED)
  async parcelFailed(@Payload() event: ElchiParcelFailedEvent) {
    await this.parcels.onFailed(event);
  }

  @EventPattern(ORDER_EVENTS.PARCEL_CANCELLED)
  async parcelCancelled(@Payload() event: ElchiParcelCancelResultEvent) {
    await this.parcels.onCancelled(event);
  }

  @EventPattern(ORDER_EVENTS.PARCEL_CANCEL_FAILED)
  async parcelCancelFailed(@Payload() event: ElchiParcelCancelResultEvent) {
    await this.parcels.onCancelFailed(event);
  }
}
