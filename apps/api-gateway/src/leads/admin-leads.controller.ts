import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { firstValueFrom, timeout } from 'rxjs';
import {
  AdminLeadCardDto,
  AdminLeadOrderDto,
  AdminLeadsPageDto,
  AdminLeadsQueryDto,
  AdminLeadViewer,
  CurrentUser,
  ExportAcceptedDto,
  ExportPhone,
  JwtUser,
  LeadExportChunk,
  LeadExportRequestDto,
  LeadFilterOptionsDto,
  LeadReleasedDto,
  LeadReopenedDto,
  LeadReviewDecisionDto,
  LeadReviewedDto,
  ReleaseLeadDto,
  ReopenLeadDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
import { csvStream } from '../exports/csv-stream';
import { ExportLinkService } from '../exports/export-link.service';
import { ParseLeadIdPipe } from './lead-id.pipe';

/** Buyurtma qisqachasi kutish vaqti: checkout javob bermasa karta baribir ochiladi [taklif]. */
const ORDER_TIMEOUT_MS = 1_500;

/** Ko‘ruvchi: IP, qurilma, sub va tekshiruvdagi arizalar — admin va superadminga. */
const viewerOf = (user: JwtUser): AdminLeadViewer => ({
  admin: [Role.ADMIN, Role.SUPERADMIN].includes(user.role),
});

/**
 * Admin va nazoratchi uchun lidlar ro‘yxati (BE-25 shartnomasi, real kod BE-42; FE-26).
 * Fayl Claude backend oqimining `leads/` papkasida; yo‘l `admin/leads`.
 * Rollar: ro‘yxat, karta, filtrlar — ADMIN, SUPERVISOR, SUPERADMIN; qayta ochish, bronni bo‘shatish va CSV — faqat admin
 * (TZ 3-bo‘lim jadvali; T02:180 — eksport faqat admin).
 */
@ApiTags('admin-leads')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERVISOR, Role.SUPERADMIN)
@Controller('admin/leads')
export class AdminLeadsController {
  constructor(
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    private readonly exports: ExportLinkService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Lidlar ro‘yxati: yorliq, holat, sotuvchi, mahsulot, operator, manba, sana, qidiruv',
    description:
      'Telefon niqoblangan (BE-42), telefon bo‘yicha qidiruv yo‘q. `counts` — yorliqdagi sonlar (filtrlar bo‘yicha). `tab=REVIEW` va `review` faqat adminga.',
  })
  @ApiOkResponse({ type: AdminLeadsPageDto })
  @ApiForbiddenResponse({ description: 'Nazoratchi `tab=REVIEW` so‘radi' })
  list(
    @Query() query: AdminLeadsQueryDto,
    @CurrentUser() user: JwtUser,
  ): Promise<AdminLeadsPageDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.admin.list' },
      { query, viewer: viewerOf(user) },
    );
  }

  @Get('filter-options')
  @ApiOperation({
    summary: 'Filtr variantlari: lidlardagi mahsulot, operator va sotuvchilar',
  })
  @ApiOkResponse({ type: LeadFilterOptionsDto })
  filterOptions(): Promise<LeadFilterOptionsDto> {
    return sendRpc(this.lead, { cmd: 'lead.admin.filter-options' }, {});
  }

  @Post('export')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'CSV eksport so‘rovi (faqat admin)',
    description:
      'Auditga yoziladi: kim, filtr, ustunlar, qatorlar soni. Fayl `file` havolasidan yuklab olinadi (shu admin, vaqtli). Telefon — oxirgi 4 raqam; `FULL` — 403 (ega qarori kutilmoqda).',
  })
  @ApiAcceptedResponse({ type: ExportAcceptedDto })
  @ApiForbiddenResponse({ description: 'To‘liq raqam eksporti yopiq' })
  async export(
    @Body() dto: LeadExportRequestDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<ExportAcceptedDto> {
    if (dto.phone === ExportPhone.FULL)
      throw new ForbiddenException(
        'To‘liq telefon raqami eksporti yopiq: ega qarori kutilmoqda',
      );
    const filters = { ...dto.filters };
    const until = new Date().toISOString();
    const { rows } = await sendRpc<{ rows: number }>(
      this.lead,
      { cmd: 'lead.admin.export-count' },
      { filters, until },
    );
    try {
      await sendRpc(
        this.identity,
        { cmd: 'identity.audit.log' },
        {
          actorId: user.sub,
          action: 'lead.export',
          entityType: 'Lead',
          entityId: null,
          meta: {
            filters,
            columns: dto.columns,
            phone: ExportPhone.LAST4,
            rows,
            ip: ip || null,
          },
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'Audit yozilmadi — eksport hozir ochilmaydi, qayta urinib ko‘ring',
      );
    }
    const { id, expiresAt } = this.exports.sign({
      kind: 'leads',
      userId: String(user.sub),
      filters,
      columns: dto.columns,
      until,
    });
    return {
      id,
      rows,
      file: `/api/v1/admin/leads/exports/${id}`,
      expiresAt,
    };
  }

  @Post('review')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tekshiruvdagi arizalar: navbatga qo‘yish yoki spam (faqat admin)',
    description:
      'LID-5. Har ariza alohida: `items[].result`. Navbatga — 3 kunlik aloqa oynasi qarordan boshlanadi. Sabab lid tarixida va firibgarlik markazining choralar tarixida.',
  })
  @ApiOkResponse({ type: LeadReviewedDto })
  review(
    @CurrentUser('sub') actorId: string,
    @Body() body: LeadReviewDecisionDto,
  ): Promise<LeadReviewedDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.admin.review' },
      { actorId, decision: body },
    );
  }

  @Get('exports/:id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Eksport fayli (CSV, UTF-8 BOM, «;»)' })
  @ApiProduces('text/csv')
  @ApiOkResponse({
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiNotFoundResponse({
    description: 'Havola buzilgan, muddati o‘tgan yoki boshqa adminniki',
  })
  async exportFile(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
  ): Promise<StreamableFile> {
    const ticket = this.exports.verify(id, 'leads', String(user.sub));
    if (!ticket)
      throw new NotFoundException('Eksport topilmadi yoki muddati o‘tgan');
    return csvStream(`lidlar_${ticket.until.slice(0, 10)}.csv`, (afterId) =>
      sendRpc<LeadExportChunk>(
        this.lead,
        { cmd: 'lead.admin.export-chunk' },
        {
          filters: ticket.filters,
          columns: ticket.columns,
          until: ticket.until,
          afterId,
        },
      ),
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Lid kartasi (admin va nazoratchi)',
    description:
      'Operator kartasi + admin bloklari. IP, qurilma va sub faqat adminga. Qo‘ng‘iroq yozuvi: `attempts[].call` va `POST /calls/{id}/recording-link` (BE-15).',
  })
  @ApiOkResponse({ type: AdminLeadCardDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi' })
  async getCard(
    @Param('id', ParseLeadIdPipe) leadId: string,
    @CurrentUser() user: JwtUser,
  ): Promise<AdminLeadCardDto> {
    const card = await sendRpc<AdminLeadCardDto>(
      this.lead,
      { cmd: 'lead.admin.card' },
      { leadId, viewer: viewerOf(user) },
    );
    return { ...card, order: await this.orderBrief(card.orderId) };
  }

  @Post(':id/reopen')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary: '«Rad etildi» lidni qayta ochish (faqat admin, sabab majburiy)',
    description:
      'TZ 3 ruxsatlar jadvali va 5-bo‘lim 10-qoida (BE-35). Lid navbatga qaytadi; tarixga kim, qachon va sabab yoziladi.',
  })
  @ApiOkResponse({ type: LeadReopenedDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi' })
  @ApiConflictResponse({
    description:
      'LEAD_NOT_REJECTED; ACTIVE_LEAD_EXISTS — shu raqam va mahsulotda faol lid bor',
  })
  reopen(
    @CurrentUser('sub') actorId: string,
    @Param('id', ParseLeadIdPipe) leadId: string,
    @Body() body: ReopenLeadDto,
  ): Promise<LeadReopenedDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.admin.reopen' },
      { actorId, leadId, reason: body.reason },
    );
  }

  @Post(':id/release')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bronni bo‘shatish: lid navbatga qaytadi (faqat admin, sabab)',
    description:
      'Bron muddati tugagandagi kabi (5-qoida): mijoz aytgan qo‘ng‘iroq egasida qoladi, boshqasi navbatga. Tarixga kim va sabab.',
  })
  @ApiOkResponse({ type: LeadReleasedDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi' })
  @ApiConflictResponse({
    description:
      'LEAD_NOT_BOOKED — bronda emas; LEAD_CALL_ACTIVE — operator hozir gaplashmoqda',
  })
  release(
    @CurrentUser('sub') actorId: string,
    @Param('id', ParseLeadIdPipe) leadId: string,
    @Body() body: ReleaseLeadDto,
  ): Promise<LeadReleasedDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.admin.release' },
      { actorId, leadId, reason: body.reason },
    );
  }

  private async orderBrief(
    orderId: string | null,
  ): Promise<AdminLeadOrderDto | null> {
    if (!orderId) return null;
    try {
      const order = await firstValueFrom(
        this.checkout
          .send<{
            id: string;
            status: string;
            createdAt: string;
            totalAmount: number;
          }>({ cmd: 'checkout.admin.order-brief' }, { orderId })
          .pipe(timeout(ORDER_TIMEOUT_MS)),
      );
      return {
        id: String(order.id),
        status: order.status,
        createdAt: new Date(order.createdAt).toISOString(),
        totalAmount: Number(order.totalAmount),
      };
    } catch {
      return null;
    }
  }
}
