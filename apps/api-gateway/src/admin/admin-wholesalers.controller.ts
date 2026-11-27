import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  AdminWholesalersQueryDto,
  CreateWholesalerDto,
  CurrentUser,
  JwtUser,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  UpdateWholesalerDto,
  WholesalerActItemDto,
  WholesalerAttentionDefectNotReturnedDto,
  WholesalerAttentionOutOfStockDto,
  WholesalerAttentionSettlementReadyDto,
  WholesalerAttentionShipmentDefectDto,
  WholesalerDto,
  WholesalerPageDto,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import {
  WHOLESALER_ACTS_EXAMPLE,
  WHOLESALER_ATTENTION_EXAMPLE,
} from './admin-m1.examples';
import { WholesalerAttentionService } from './wholesaler-attention.service';
import {
  pickFields,
  seesFullView,
  WAREHOUSE_WHOLESALER_FIELDS,
} from './warehouse-view';

/**
 * BE-07 (OPT-1, FE-25): optovikni admin kiritadi — foydalanuvchisiz, rekvizitlar va komissiya shartnomasi bilan.
 * Har amal audit jurnaliga yoziladi (ADM-6).
 */
@ApiTags('admin-wholesalers')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/wholesalers')
export class AdminWholesalersController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    private readonly attentions: WholesalerAttentionService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Optovikni kiritish (foydalanuvchisiz)' })
  @ApiCreatedResponse({ type: WholesalerDto })
  async create(
    @Body() dto: CreateWholesalerDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const wholesaler = await sendRpc<WholesalerDto>(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-create' },
      dto,
    );
    this.audit(admin.sub, 'wholesaler.create', wholesaler.id, ip, {
      after: wholesaler,
    });
    return wholesaler;
  }

  @Get()
  // BE-25 (FE-16, OMB-1): omborchi arizasiz postavkada optovikni tanlaydi
  @Roles(Role.ADMIN, Role.WAREHOUSE, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Optoviklar ro‘yxati (nom yoki STIR bo‘yicha qidiruv)',
    description:
      'Omborchiga faqat `id`, `name`, `status`, `tin`, `contractNumber`, `contractDate` — bank rekvizitlari, telefon va kabinet egasisiz.',
  })
  @ApiOkResponse({ type: WholesalerPageDto })
  async list(
    @Query() query: AdminWholesalersQueryDto,
    @CurrentUser() user: JwtUser,
  ) {
    const page = await sendRpc<WholesalerPageDto>(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-list' },
      query,
    );
    return seesFullView(user)
      ? page
      : pickFields(page, WAREHOUSE_WHOLESALER_FIELDS);
  }

  // `:id` dan oldin — aks holda «attention» optovik ID si deb olinadi
  @Get('attention')
  @ApiOperation({
    summary: '«Diqqat talab qiladi» (FE-25) [taklif]',
    description:
      'Hamma optoviklar bo‘yicha: qabulda farq chiqqan postavka (`SHIPMENT_DEFECT`), sotuvdagi mahsulot qoldig‘i 0 ' +
      '(`OUT_OF_STOCK`, eng yaqin kelayotgan postavka bilan), optovikka qaytarilmagan brak (`DEFECT_NOT_RETURNED`; ' +
      'qaytarish operatsiyasi hali yo‘q — faqat o‘sadi), «Tayyor» akt-sverka — optovik qabul qilmagan va e’tirozi ' +
      'yo‘q (`SETTLEMENT_READY`). Tartib: shu to‘rt tur ketma-ket.',
  })
  @ApiExtraModels(
    WholesalerAttentionShipmentDefectDto,
    WholesalerAttentionOutOfStockDto,
    WholesalerAttentionDefectNotReturnedDto,
    WholesalerAttentionSettlementReadyDto,
  )
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        oneOf: [
          { $ref: getSchemaPath(WholesalerAttentionShipmentDefectDto) },
          { $ref: getSchemaPath(WholesalerAttentionOutOfStockDto) },
          { $ref: getSchemaPath(WholesalerAttentionDefectNotReturnedDto) },
          { $ref: getSchemaPath(WholesalerAttentionSettlementReadyDto) },
        ],
        discriminator: {
          propertyName: 'kind',
          mapping: {
            SHIPMENT_DEFECT: getSchemaPath(
              WholesalerAttentionShipmentDefectDto,
            ),
            OUT_OF_STOCK: getSchemaPath(WholesalerAttentionOutOfStockDto),
            DEFECT_NOT_RETURNED: getSchemaPath(
              WholesalerAttentionDefectNotReturnedDto,
            ),
            SETTLEMENT_READY: getSchemaPath(
              WholesalerAttentionSettlementReadyDto,
            ),
          },
        },
      },
      example: WHOLESALER_ATTENTION_EXAMPLE,
    },
  })
  attention() {
    return this.attentions.attention();
  }

  @Get(':id/acts')
  @ApiOperation({
    summary:
      'Optovik aktlari (FE-25): brak akti, qabul (farq) akti, akt-sverka',
    description:
      'Yangisi tepada. Brak akti raqami `BA-<buyurtma>` [taklif]; `sentAt` hozir doim null — aktni optovikka ' +
      'yuborish ega qarorini kutadi.',
  })
  @ApiOkResponse({
    type: [WholesalerActItemDto],
    schema: {
      type: 'array',
      items: { $ref: getSchemaPath(WholesalerActItemDto) },
      example: WHOLESALER_ACTS_EXAMPLE,
    },
  })
  @ApiNotFoundResponse({ description: 'Optovik topilmadi' })
  acts(@Param('id', ParseLeadIdPipe) id: string) {
    return this.attentions.acts(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Optovik' })
  @ApiOkResponse({ type: WholesalerDto })
  get(@Param('id') id: string) {
    return sendRpc(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-get' },
      { id },
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Optovik rekvizitlari va shartnomasini tahrirlash' })
  @ApiOkResponse({ type: WholesalerDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateWholesalerDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const wholesaler = await sendRpc<WholesalerDto>(
      this.catalog,
      { cmd: 'catalog.wholesaler.admin-update' },
      { id, dto },
    );
    this.audit(admin.sub, 'wholesaler.update', id, ip, { changes: dto });
    return wholesaler;
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
        entityType: 'Wholesaler',
        entityId,
        meta: { ...meta, ip: ip ?? null },
      },
    ).catch(() => undefined);
  }
}
