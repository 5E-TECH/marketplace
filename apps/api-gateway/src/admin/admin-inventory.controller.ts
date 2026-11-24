import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { randomUUID } from 'crypto';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiProduces,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AdminStockAdjustDto,
  AdminStockInboundDto,
  AdminStockMovementsPageDto,
  AdminStockMovementsQueryDto,
  AdminStockPageDto,
  AdminStockQueryDto,
  AuthErrorResponseDto,
  CurrentUser,
  DeclareInboundDto,
  INBOUND_RPC,
  InboundShipmentDto,
  InboundShipmentPageDto,
  InboundShipmentQueryDto,
  LotsQueryDto,
  ReceiveInboundDto,
  StockLotDto,
  JwtUser,
  Role,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { LabelDocument, labelPdf } from '../orders/label-pdf';
import { withLotNames, withShipmentNames } from './inbound-names';

/** inventory `stockResult`: amal, HQ qoldiq qatori va undan keyingi qoldiq (takror kalit — o‘sha javob). */
const stockResultExample = (
  operation: 'INBOUND' | 'ADJUST',
  onHand: number,
) => ({
  schema: { example: { operation, stockId: '31', onHand, reserved: 4 } },
});

import { ADMIN_STOCK_MOVEMENTS_EXAMPLE } from './admin-m1.examples';

@ApiTags('admin-inventory')
@ApiBearerAuth()
// TZ 3: qoldiqni ko‘rish — omborchi va admin (BE-05)
@Roles(Role.ADMIN, Role.WAREHOUSE, Role.SUPERADMIN)
@Controller('admin/inventory')
export class AdminInventoryController {
  constructor(
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  private names(shipments: InboundShipmentDto[]) {
    return withShipmentNames(
      { catalog: this.catalog, identity: this.identity },
      shipments,
    );
  }

  /** BE-25 (FE-16): nomlar va «muddat kuzatiladi» belgisi bilan. */
  private async named(
    shipment: InboundShipmentDto,
  ): Promise<InboundShipmentDto> {
    const [result] = await this.names([shipment]);
    return result;
  }

  @Post('inbound')
  @ApiOperation({
    summary: 'HQ omborga kirim (omborchi) — BE-16; to‘liq qabul akti BE-17 da',
  })
  @ApiCreatedResponse(stockResultExample('INBOUND', 120))
  async inbound(
    @Body() dto: AdminStockInboundDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.inventory,
      { cmd: 'inventory.hq.inbound' },
      {
        variantId: dto.variantId,
        quantity: dto.quantity,
        reason: dto.reason,
        actorId: user.sub,
        idempotencyKey: dto.idempotencyKey ?? randomUUID(),
      },
    );
    this.audit(user.sub, 'inventory.hq.inbound', dto.variantId, ip, { ...dto });
    return result;
  }

  @Post('adjust')
  @ApiOperation({
    summary:
      'HQ qoldig‘ini tuzatish (inventarizatsiya); band qilingandan kam bo‘lmaydi',
  })
  @ApiCreatedResponse(stockResultExample('ADJUST', 119))
  async adjust(
    @Body() dto: AdminStockAdjustDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.inventory,
      { cmd: 'inventory.hq.adjust' },
      {
        variantId: dto.variantId,
        delta: dto.delta,
        reason: dto.reason,
        lotId: dto.lotId,
        goodStock: dto.goodStock,
        actorId: user.sub,
        idempotencyKey: dto.idempotencyKey ?? randomUUID(),
      },
    );
    this.audit(user.sub, 'inventory.hq.adjust', dto.variantId, ip, { ...dto });
    return result;
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip: string | undefined,
    meta: Record<string, unknown>,
  ): void {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action,
        entityType: 'Stock',
        entityId,
        meta: { ...meta, ip: ip ?? null },
      },
    ).catch(() => undefined);
  }

  /** BE-17 (OMB-1): postavka e’loni optovik nomidan (omborchi, admin, superadmin; optovik kabineti — BE-30). */
  @Post('shipments')
  @ApiOperation({
    summary: 'Postavkani e’lon qilish (optovik nomidan)',
    description:
      'CPA mahsulotlarining yagona varianti; mahsulot shu optovikniki bo‘lishi shart. Holat «E’lon qilindi».',
  })
  @ApiCreatedResponse({ type: InboundShipmentDto })
  @ApiBadRequestResponse({
    description: 'Mahsulot topilmadi yoki boshqa optovikniki',
  })
  async declareShipment(
    @Body() dto: DeclareInboundDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<InboundShipmentDto> {
    const shipment = await sendRpc<InboundShipmentDto>(
      this.inventory,
      { cmd: INBOUND_RPC.DECLARE },
      { ...dto, actorId: user.sub },
    );
    this.audit(user.sub, 'inventory.inbound.declare', shipment.id, ip, {
      wholesalerId: dto.wholesalerId,
      items: dto.items,
    });
    return this.named(shipment);
  }

  @Get('shipments')
  @ApiOperation({
    summary: 'Postavkalar ro‘yxati',
    description:
      'BE-25: bir nechta holat, qidiruv, kelish sanasi, qabul kuni; `counts` — holatlar soni.',
  })
  @ApiOkResponse({ type: InboundShipmentPageDto })
  async shipments(
    @Query() query: InboundShipmentQueryDto,
  ): Promise<InboundShipmentPageDto> {
    const page = await sendRpc<InboundShipmentPageDto>(
      this.inventory,
      { cmd: INBOUND_RPC.LIST },
      query,
    );
    return { ...page, items: await this.names(page.items) };
  }

  @Get('shipments/:id')
  @ApiOperation({ summary: 'Postavka kartasi' })
  @ApiOkResponse({ type: InboundShipmentDto })
  @ApiNotFoundResponse({ description: 'Postavka topilmadi' })
  async shipment(
    @Param('id', ParseLeadIdPipe) id: string,
  ): Promise<InboundShipmentDto> {
    return this.named(
      await sendRpc<InboundShipmentDto>(
        this.inventory,
        { cmd: INBOUND_RPC.GET },
        { id },
      ),
    );
  }

  @Post('shipments/:id/in-transit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Postavka «Yo‘lda» [taklif — ixtiyoriy]' })
  @ApiOkResponse({ type: InboundShipmentDto })
  @ApiConflictResponse({ description: 'Postavka holati boshqa' })
  async shipmentInTransit(
    @Param('id', ParseLeadIdPipe) id: string,
  ): Promise<InboundShipmentDto> {
    return this.named(
      await sendRpc<InboundShipmentDto>(
        this.inventory,
        { cmd: INBOUND_RPC.IN_TRANSIT },
        { id },
      ),
    );
  }

  /** OMB-1, OMB-3: qabul — faqat omborchi va superadmin (TZ rollar jadvali). */
  @Post('shipments/:id/receive')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.WAREHOUSE, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Postavkani qabul qilish',
    description:
      'Har qator: qabul qilingan va brak soni, partiya, yaroqlilik muddati (BAD, kosmetika, oziq-ovqat), yacheyka. Qoldiqqa yaroqli soni kiradi; muddatga 60 kundan kam qolgan partiya sotilmaydi. Farq yoki brak — «Farq bor» va akt.',
  })
  @ApiOkResponse({ type: InboundShipmentDto })
  async receiveShipment(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: ReceiveInboundDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<InboundShipmentDto> {
    const shipment = await sendRpc<InboundShipmentDto>(
      this.inventory,
      { cmd: INBOUND_RPC.RECEIVE },
      { id, items: dto.items, comment: dto.comment, actorId: user.sub },
    );
    this.audit(user.sub, 'inventory.inbound.receive', id, ip, {
      status: shipment.status,
      items: dto.items,
    });
    return this.named(shipment);
  }

  @Get('shipments/:id/act.pdf')
  @ApiProduces('application/pdf')
  @ApiOperation({ summary: 'Qabul (farq va brak) akti PDF — optovikka qo‘lda' })
  @ApiOkResponse({
    description: 'PDF fayl: `qabul-akti_PS-000014.pdf`',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiConflictResponse({ description: 'Postavka hali qabul qilinmagan' })
  async shipmentAct(
    @Param('id', ParseLeadIdPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await sendRpc<LabelDocument>(
      this.inventory,
      { cmd: INBOUND_RPC.ACT_PDF },
      { id },
    );
    return labelPdf(res, document);
  }

  /** OMB-3: partiyalar — muddat va sotuvdan chiqish sanasi (admin «Muddat» ro‘yxati). */
  @Get('lots')
  @ApiOperation({ summary: 'Yaroqlilik partiyalari' })
  @ApiOkResponse({ type: [StockLotDto] })
  async lots(@Query() query: LotsQueryDto): Promise<StockLotDto[]> {
    return withLotNames(
      this.catalog,
      await sendRpc<StockLotDto[]>(
        this.inventory,
        { cmd: INBOUND_RPC.LOTS },
        query,
      ),
    );
  }

  @Get('stock')
  @ApiOperation({ summary: 'Butun platformadagi sotuvchilar qoldig‘i' })
  @ApiOkResponse({ type: AdminStockPageDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  stock(@Query() query: AdminStockQueryDto) {
    return sendRpc(
      this.inventory,
      { cmd: 'inventory.admin.stock-list' },
      { query },
    );
  }

  @Get('movements')
  @ApiOperation({ summary: 'Butun platformadagi qoldiq harakati jurnali' })
  @ApiOkResponse({
    type: AdminStockMovementsPageDto,
    example: ADMIN_STOCK_MOVEMENTS_EXAMPLE,
  })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  movements(@Query() query: AdminStockMovementsQueryDto) {
    return sendRpc(
      this.inventory,
      { cmd: 'inventory.admin.movements-list' },
      { query },
    );
  }
}
