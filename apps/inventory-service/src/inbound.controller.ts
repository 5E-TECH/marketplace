import { Controller, UseFilters } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  INBOUND_RPC,
  InboundShipmentStatus,
  RpcHttpExceptionFilter,
  WHOLESALER_CABINET_RPC,
} from '@app/common';
import { InboundService } from './inbound.service';
import { ReturnInspectionService } from './return-inspection.service';
import { WholesalerStockService } from './wholesaler-stock.service';

/** BE-17: ombor qabuli, partiyalar va qaytganlarni saralash (gateway `admin/inventory/*`, `warehouse/returns`). */
@Controller()
@UseFilters(RpcHttpExceptionFilter)
export class InboundController {
  constructor(
    private readonly inbound: InboundService,
    private readonly returns: ReturnInspectionService,
    private readonly wholesalerStock: WholesalerStockService,
  ) {}

  /** BE-30 (OPT-3): optovik paneli — ombor raqamlari. */
  @MessagePattern({ cmd: WHOLESALER_CABINET_RPC.STOCK_SUMMARY })
  wholesalerSummary(
    @Payload()
    data: Parameters<WholesalerStockService['summary']>[0],
  ) {
    return this.wholesalerStock.summary(data);
  }

  @MessagePattern({ cmd: INBOUND_RPC.DECLARE })
  declare(
    @Payload()
    data: {
      wholesalerId: string;
      expectedAt: string;
      note?: string;
      items: Array<{ productId: string; quantity: number }>;
      actorId: string;
    },
  ) {
    return this.inbound.declare(data);
  }

  @MessagePattern({ cmd: INBOUND_RPC.LIST })
  list(
    @Payload()
    data: {
      status?: InboundShipmentStatus;
      wholesalerId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    return this.inbound.list(data ?? {});
  }

  @MessagePattern({ cmd: INBOUND_RPC.GET })
  get(@Payload() data: { id: string }) {
    return this.inbound.get(data);
  }

  @MessagePattern({ cmd: INBOUND_RPC.IN_TRANSIT })
  inTransit(@Payload() data: { id: string }) {
    return this.inbound.inTransit(data);
  }

  @MessagePattern({ cmd: INBOUND_RPC.RECEIVE })
  receive(
    @Payload()
    data: Parameters<InboundService['receive']>[0],
  ) {
    return this.inbound.receive(data);
  }

  @MessagePattern({ cmd: INBOUND_RPC.ACT_PDF })
  actPdf(@Payload() data: { id: string }) {
    return this.inbound.actPdf(data);
  }

  @MessagePattern({ cmd: INBOUND_RPC.LOTS })
  lots(@Payload() data: { state?: 'BLOCKED' | 'SELLABLE' | 'ALL' }) {
    return this.inbound.lots(data ?? {});
  }

  @MessagePattern({ cmd: INBOUND_RPC.RETURN_GRADE })
  grade(@Payload() data: Parameters<ReturnInspectionService['grade']>[0]) {
    return this.returns.grade(data);
  }

  @MessagePattern({ cmd: INBOUND_RPC.RETURN_GET })
  inspection(@Payload() data: { orderRef: string }) {
    return this.returns.get(data);
  }

  @MessagePattern({ cmd: INBOUND_RPC.DEFECT_ACT_PDF })
  defectAct(@Payload() data: { orderRef: string; shipmentId?: string | null }) {
    return this.returns.defectActPdf(data);
  }
}
