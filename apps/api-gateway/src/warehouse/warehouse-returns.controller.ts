import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import {
  CurrentUser,
  GradeReturnDto,
  INBOUND_RPC,
  JwtUser,
  LEAD_ORDER_RPC,
  LeadOrderActorType,
  LeadOrderStatus,
  ReturnInspectionDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  WAREHOUSE_RPC,
  WarehouseReturnView,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { LabelDocument, labelPdf } from '../orders/label-pdf';

/**
 * Qaytgan tovarni saralash (BE-17; TZ OMB-6, T5 «RETURNING → RETURNED_GRADED — omborchi»). Saralash — omborchi va
 * superadmin (TZ rollar jadvali); ro‘yxat va brak akti — admin ham.
 */
@ApiTags('warehouse')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.WAREHOUSE, Role.SUPERADMIN)
@Controller('warehouse/returns')
export class WarehouseReturnsController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Omborga qaytayotgan posilkalar (saralanadi)' })
  list(): Promise<WarehouseReturnView[]> {
    return sendRpc(this.checkout, { cmd: WAREHOUSE_RPC.RETURNS }, {});
  }

  /**
   * Saralash: har tovar — sotiladigan (qoldiqqa) va brak (optovikka), jami = posilkadagi soni. Keyin buyurtma
   * «Saralandi». Qayta yuborilsa — o‘sha natija (ombor va holat takrorga chidamli).
   */
  @Post(':orderId/grade')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.WAREHOUSE, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Qaytgan posilkani saralash' })
  @ApiOkResponse({ type: ReturnInspectionDto })
  @ApiConflictResponse({ description: 'Buyurtma «Qaytmoqda» holatida emas' })
  async grade(
    @Param('orderId', ParseLeadIdPipe) orderId: string,
    @Body() dto: GradeReturnDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<ReturnInspectionDto> {
    const order = await sendRpc<WarehouseReturnView>(
      this.checkout,
      { cmd: WAREHOUSE_RPC.RETURN_INFO },
      { orderId },
    );
    if (order.status === LeadOrderStatus.RETURNED_GRADED)
      return sendRpc(
        this.inventory,
        { cmd: INBOUND_RPC.RETURN_GET },
        { orderRef: orderId },
      );
    if (order.status !== LeadOrderStatus.RETURNING)
      throw new ConflictException(
        `Buyurtma «Qaytmoqda» holatida emas (${order.status})`,
      );
    const inspection = await sendRpc<ReturnInspectionDto>(
      this.inventory,
      { cmd: INBOUND_RPC.RETURN_GRADE },
      {
        orderRef: orderId,
        parcelId: order.parcelId,
        items: dto.items,
        comment: dto.comment,
        actorId: user.sub,
      },
    );
    await sendRpc(
      this.checkout,
      { cmd: LEAD_ORDER_RPC.TRANSITION },
      {
        orderId,
        to: LeadOrderStatus.RETURNED_GRADED,
        actor: { type: LeadOrderActorType.USER, id: user.sub, role: user.role },
        reason: 'Qaytgan tovar saralandi',
      },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'warehouse.return.grade',
        entityType: 'Order',
        entityId: orderId,
        meta: { items: dto.items, ip: ip ?? null },
      },
    ).catch(() => undefined);
    return inspection;
  }

  @Get(':orderId/defect-act.pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Brak akti PDF (har posilka uchun) — optovikka qo‘lda',
  })
  @ApiConflictResponse({ description: 'Bu posilkada brak yo‘q' })
  async defectAct(
    @Param('orderId', ParseLeadIdPipe) orderId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const order = await sendRpc<WarehouseReturnView>(
      this.checkout,
      { cmd: WAREHOUSE_RPC.RETURN_INFO },
      { orderId },
    );
    const document = await sendRpc<LabelDocument>(
      this.inventory,
      { cmd: INBOUND_RPC.DEFECT_ACT_PDF },
      { orderRef: orderId, shipmentId: order.shipmentId },
    );
    return labelPdf(res, document);
  }
}
