import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Ip,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  CurrentUser,
  INBOUND_RPC,
  InboundShipmentDto,
  InboundShipmentPageDto,
  InboundShipmentQueryDto,
  JwtUser,
  ProductStatus,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  WHOLESALER_CABINET_RPC,
  WholesalerShipmentDeclareDto,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { LabelDocument, labelPdf } from '../orders/label-pdf';
import { ownWholesaler } from './own-wholesaler';

/**
 * BE-30 (OMB-1, OPT-4): optovik postavka arizasini o‘zi yuboradi (omborda DECLARED — TC5), holatini va qabul aktini
 * panelda ko‘radi (TC3). Faqat tasdiqlangan optovik va admin tasdiqlagan o‘z mahsulotlari; boshqa optovik
 * postavkasi — 403. Qabulda farq yoki brak bo‘lsa optovik kabinetiga xabar boradi (BE-47).
 */
@ApiTags('wholesaler')
@ApiBearerAuth()
@Roles(Role.WHOLESALER)
@Controller('wholesaler/shipments')
export class WholesalerShipmentsController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.INVENTORY) private readonly inventory: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Postavka arizasi: tovar, miqdor, kelish sanasi (OMB-1)',
  })
  @ApiCreatedResponse({ type: InboundShipmentDto })
  @ApiForbiddenResponse({
    description: 'Optovik tasdiqlanmagan yoki boshqa optovik mahsuloti',
  })
  async declare(
    @Body() dto: WholesalerShipmentDeclareDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<InboundShipmentDto> {
    const wholesaler = await ownWholesaler(this.catalog, user, {
      active: true,
    });
    // faqat admin tasdiqlagan o‘z mahsuloti (boshqa optovikniki — 403); tasdiqlanmagan tovar omborga yuborilmaydi
    for (const productId of new Set(dto.items.map((item) => item.productId))) {
      const product = await sendRpc<{ status: ProductStatus; name: string }>(
        this.catalog,
        { cmd: WHOLESALER_CABINET_RPC.PRODUCT_GET },
        { ownerUserId: user.sub, productId },
      );
      if (product.status !== ProductStatus.ACTIVE)
        throw new BadRequestException(
          `«${product.name}» hali tasdiqlanmagan (${product.status}) — postavka faqat tasdiqlangan mahsulotga`,
        );
    }
    const shipment = await sendRpc<InboundShipmentDto>(
      this.inventory,
      { cmd: INBOUND_RPC.DECLARE },
      { ...dto, wholesalerId: wholesaler.id, actorId: user.sub },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'inventory.inbound.declare',
        entityType: 'InboundShipment',
        entityId: shipment.id,
        meta: { wholesalerId: wholesaler.id, ip: ip ?? null },
      },
    ).catch(() => undefined);
    return shipment;
  }

  @Get()
  @ApiOperation({ summary: 'O‘z postavkalarim va holati' })
  @ApiOkResponse({ type: InboundShipmentPageDto })
  async list(
    @Query() query: InboundShipmentQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    const wholesaler = await ownWholesaler(this.catalog, user);
    return sendRpc(
      this.inventory,
      { cmd: INBOUND_RPC.LIST },
      { ...query, wholesalerId: wholesaler.id },
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Postavka kartasi' })
  @ApiOkResponse({ type: InboundShipmentDto })
  @ApiForbiddenResponse({ description: 'Boshqa optovik postavkasi' })
  async get(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() user: JwtUser,
  ): Promise<InboundShipmentDto> {
    return this.own(id, user);
  }

  @Get(':id/act.pdf')
  @ApiOperation({
    summary: 'Qabul akti PDF (farq va brak bilan) — qabul qilingandan keyin',
  })
  @ApiProduces('application/pdf')
  @ApiForbiddenResponse({ description: 'Boshqa optovik postavkasi' })
  async act(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() user: JwtUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.own(id, user);
    const file = await sendRpc<LabelDocument>(
      this.inventory,
      { cmd: INBOUND_RPC.ACT_PDF },
      { id },
    );
    return labelPdf(res, file);
  }

  private async own(id: string, user: JwtUser): Promise<InboundShipmentDto> {
    const wholesaler = await ownWholesaler(this.catalog, user);
    const shipment = await sendRpc<InboundShipmentDto>(
      this.inventory,
      { cmd: INBOUND_RPC.GET },
      { id },
    );
    if (String(shipment.wholesalerId) !== wholesaler.id)
      throw new ForbiddenException('Boshqa optovik postavkasi');
    return shipment;
  }
}
