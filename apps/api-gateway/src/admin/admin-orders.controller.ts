import {
  Body,
  ConflictException,
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
  Res,
  ServiceUnavailableException,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  AdminOrdersQueryDto,
  AdminOrderActionDto,
  AdminOrderRefundDto,
  AdminShipmentTokensSyncDto,
  OrderActionResultDto,
  CurrentUser,
  JwtUser,
  AuthErrorResponseDto,
  ElchiRefreshDto,
  ElchiResendDto,
  ErrorCode,
  ExportAcceptedDto,
  LabelReprintDto,
  LeadOrderStatus,
  ORDER_SMS_RPC,
  OrderCommentDto,
  OrderDisputeClosedDto,
  OrderDisputeDto,
  OrderExportRequestDto,
  OrderReasonDto,
  OrderSmsDto,
  OrderSmsResendRequestDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  ShippingLabelsBatchDto,
} from '@app/common';
import { CsvChunk, csvStream } from '../exports/csv-stream';
import { ExportLinkService } from '../exports/export-link.service';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { LabelDocument, labelPdf } from '../orders/label-pdf';
import {
  OrderDetailRpc,
  orderViewer,
  withLeadContext,
  withPriceApproval,
  withSmsJournal,
} from '../orders/order-view';
import {
  ADMIN_ORDER_EXAMPLE,
  ADMIN_ORDERS_PAGE_EXAMPLE,
} from './admin-m1.examples';

/**
 * C1.30 — Admin buyurtma nazorati (faqat o'qish). Butun platformadagi buyurtmalar
 * ro'yxati + drill-in. Global JwtAuthGuard + RolesGuard, faqat @Roles(ADMIN,
 * SUPERADMIN). Bekor/refund MVP'da EMAS (keyingi faza).
 */
@ApiTags('admin-orders')
@Controller()
export class AdminOrdersController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.LEAD) private readonly lead: ClientProxy,
    @Inject(RmqClient.NOTIFICATION)
    private readonly notifications: ClientProxy,
    private readonly exports: ExportLinkService,
    // FE-26: narx tasdiqlangan sana (narx qarorlari tarixi)
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Get('admin/orders')
  // BE-18 (TC12, FE-26): nazoratchi ham o‘qiydi
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Barcha buyurtmalar (status/to‘lov/do‘kon/sana filtr + sahifalash)',
  })
  @ApiOkResponse({
    description:
      '{ items, total, page, limit, totalPages }; ro‘yxatda telefon niqoblangan',
    schema: { example: ADMIN_ORDERS_PAGE_EXAMPLE },
  })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  list(@Query() query: AdminOrdersQueryDto, @CurrentUser() user: JwtUser) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.orders-list' },
      { query, viewer: orderViewer(user) },
    );
  }

  @Post('admin/orders/export')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'CSV eksport so‘rovi (faqat admin)',
    description:
      'Auditga yoziladi: kim, filtr, ustunlar, qatorlar soni. Fayl `file` havolasidan yuklab olinadi (shu admin, vaqtli). Telefon — oxirgi 4 raqam; `FULL` — 403 (ega qarori kutilmoqda).',
  })
  @ApiAcceptedResponse({ type: ExportAcceptedDto })
  @ApiForbiddenResponse({ description: 'To‘liq raqam eksporti yopiq' })
  async export(
    @Body() dto: OrderExportRequestDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<ExportAcceptedDto> {
    if (dto.phone === 'FULL')
      throw new ForbiddenException(
        'To‘liq telefon raqami eksporti yopiq: ega qarori kutilmoqda',
      );
    const filters = { ...dto.filters };
    const until = new Date().toISOString();
    const { rows } = await sendRpc<{ rows: number }>(
      this.checkout,
      { cmd: 'checkout.admin.orders-export-count' },
      { filters, until },
    );
    try {
      await sendRpc(
        this.identity,
        { cmd: 'identity.audit.log' },
        {
          actorId: user.sub,
          action: 'order.export',
          entityType: 'SalesOrder',
          entityId: null,
          meta: {
            filters,
            columns: dto.columns,
            phone: 'LAST4',
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
      kind: 'orders',
      userId: String(user.sub),
      filters,
      columns: dto.columns,
      until,
    });
    return { id, rows, file: `/api/v1/admin/orders/exports/${id}`, expiresAt };
  }

  @Get('admin/orders/exports/:id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
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
    const ticket = this.exports.verify(id, 'orders', String(user.sub));
    if (!ticket)
      throw new NotFoundException('Eksport topilmadi yoki muddati o‘tgan');
    return csvStream(
      `buyurtmalar_${ticket.until.slice(0, 10)}.csv`,
      (afterId) =>
        sendRpc<CsvChunk>(
          this.checkout,
          { cmd: 'checkout.admin.orders-export-chunk' },
          {
            filters: ticket.filters,
            columns: ticket.columns,
            until: ticket.until,
            afterId,
          },
        ),
    );
  }

  @Get('admin/orders/:id')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Buyurtma to‘liq (sub-order + item + shipment + to‘lov)',
  })
  @ApiOkResponse({
    description:
      'Buyurtma, posilkalar (`sellerOrders`) va tovarlar; lid buyurtmasida `lead` (narx nusxasi, holat jurnali), eski buyurtmada `lead: null`. ' +
      '`pricing` (FE-26) — narx nusxasi buyurtma paytidagi qiymatlardan, faqat ADMIN/SUPERADMIN (nazoratchiga null): `recommendedPrice` — alohida rejim tavsiyasi ' +
      '(`priceSnapshot.recommendedPrice` — shu rejimdagisi), `hiddenDelivery` — Elchi tarifining ko‘rinmagan qismi, `priceAdd` — narxga qo‘shimcha ' +
      '(= `priceSnapshot.hiddenDelivery`), `visibleCenter`/`visibleAddress` — tanlangan turi va tanlanmagani (buyurtma paytidagi nusxa, `lead.deliveryShownOther`; migratsiya 1799280000000 dan oldingi buyurtmada — null), `split` — buyurtma jami, ' +
      '`approvedAt` — buyurtmadan oldingi shu narxdagi narx qarori [taklif].',
    schema: { example: ADMIN_ORDER_EXAMPLE },
  })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async get(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    const order = await sendRpc<OrderDetailRpc>(
      this.checkout,
      { cmd: 'checkout.admin.order-get' },
      { orderId: id, viewer: orderViewer(user) },
    );
    const [withLead, approval] = await Promise.all([
      withLeadContext(this.lead, order, user),
      withPriceApproval(this.catalog, order),
    ]);
    return withSmsJournal(this.notifications, id, {
      ...withLead,
      pricing: approval.pricing,
    });
  }

  @Post('admin/orders/:id/sms/resend')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mijozga avtomatik SMS ni qo‘lda qayta yuborish (FE-26)',
    description:
      'O‘sha matn va raqam; buyurtma holati o‘zgarmaydi. SMS navbatga qo‘yiladi (`PENDING`), natija — buyurtma kartasidagi `sms` jurnalida. Audit: kim, qaysi shablon.',
  })
  @ApiOkResponse({ type: OrderSmsDto })
  @ApiNotFoundResponse({
    description: 'Buyurtma topilmadi yoki bu SMS hali yuborilmagan',
  })
  @ApiConflictResponse({
    description:
      'INVALID_STATE — SMS hali navbatda, buyurtma bekor qilingan yoki SMS xizmati sozlanmagan',
  })
  async resendSms(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: OrderSmsResendRequestDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<OrderSmsDto> {
    const order = await sendRpc<{ status: string }>(
      this.checkout,
      { cmd: 'checkout.admin.order-brief' },
      { orderId: id },
    );
    // bekor qilingan buyurtmaga «tasdiqlandi» ketmasin [taklif]
    if (order.status === LeadOrderStatus.CANCELLED)
      throw new ConflictException({
        message: 'Buyurtma bekor qilingan — SMS qayta yuborilmaydi',
        errorCode: ErrorCode.INVALID_STATE,
      });
    const result = await sendRpc<OrderSmsDto>(
      this.notifications,
      { cmd: ORDER_SMS_RPC.RESEND },
      { orderId: id, template: dto.template, actorId: admin.sub },
    );
    this.audit(admin.sub, 'order.sms.resend', id, ip, {
      template: result.template,
      state: result.state,
    });
    return result;
  }

  @Post('admin/orders/:id/label/reprints')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Yorliqni qayta chop etish sababi',
    description:
      'PDF — `GET admin/orders/{id}/label`. Audit: kim, qachon, sabab.',
  })
  @ApiCreatedResponse({ type: LabelReprintDto })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  async reprint(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: OrderReasonDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<LabelReprintDto> {
    const result = await sendRpc<LabelReprintDto>(
      this.checkout,
      { cmd: 'checkout.admin.order-label-reprint' },
      { orderId: id, actorId: admin.sub, reason: dto.reason },
    );
    this.audit(admin.sub, 'order.label.reprint', id, ip, dto);
    return result;
  }

  @Post('admin/orders/:id/dispute')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Buyurtmani «Nizoli» deb belgilash',
    description:
      'TEL-6: nizoli buyurtmaning qo‘ng‘iroq yozuvi 1 yil saqlanadi (`keepUntil`). Provayderdagi muddat — EQ-02 dan keyin.',
  })
  @ApiCreatedResponse({ type: OrderDisputeDto })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiConflictResponse({ description: 'INVALID_STATE — nizo allaqachon ochiq' })
  async dispute(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: OrderReasonDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<OrderDisputeDto> {
    const result = await sendRpc<OrderDisputeDto>(
      this.checkout,
      { cmd: 'checkout.admin.order-dispute' },
      { orderId: id, actorId: admin.sub, reason: dto.reason },
    );
    this.audit(admin.sub, 'order.dispute.open', id, ip, dto);
    return result;
  }

  @Post('admin/orders/:id/dispute/close')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Nizoni yopish' })
  @ApiOkResponse({ type: OrderDisputeClosedDto })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiConflictResponse({ description: 'INVALID_STATE — ochiq nizo yo‘q' })
  async closeDispute(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: OrderCommentDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<OrderDisputeClosedDto> {
    const result = await sendRpc<OrderDisputeClosedDto>(
      this.checkout,
      { cmd: 'checkout.admin.order-dispute-close' },
      { orderId: id, actorId: admin.sub, comment: dto?.comment },
    );
    this.audit(admin.sub, 'order.dispute.close', id, ip, dto ?? {});
    return result;
  }

  @Post('admin/orders/:id/elchi/resend')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Posilkani Elchi’ga qayta yuborish',
    description:
      'Faqat posilka so‘rovi rad etilgan (`FAILED`) va topshirilmagan buyurtma. Vaqtinchalik xatolarda qayta urinish avtomatik (BE-20).',
  })
  @ApiAcceptedResponse({ type: ElchiResendDto })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiConflictResponse({
    description: 'INVALID_STATE — posilka rad etilmagan yoki topshirilgan',
  })
  async resend(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<ElchiResendDto> {
    const result = await sendRpc<ElchiResendDto>(
      this.checkout,
      { cmd: 'checkout.admin.order-elchi-resend' },
      { orderId: id },
    );
    this.audit(admin.sub, 'order.elchi.resend', id, ip, {});
    return result;
  }

  @Post('admin/orders/:id/elchi/refresh')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Elchi’dan posilka holatini so‘rash',
    description:
      'Posilka Elchi’da bo‘lsa (webhook kelmagan). Holat faqat oldinga; pul holatlari qo‘llanmaydi (webhook va kunlik tekshiruv).',
  })
  @ApiAcceptedResponse({ type: ElchiRefreshDto })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiConflictResponse({
    description: 'INVALID_STATE — posilka hozir Elchi’da emas',
  })
  async refreshElchi(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ): Promise<ElchiRefreshDto> {
    const result = await sendRpc<ElchiRefreshDto>(
      this.checkout,
      { cmd: 'checkout.admin.order-elchi-refresh' },
      { orderId: id },
    );
    this.audit(admin.sub, 'order.elchi.refresh', id, ip, {
      elchiStatus: result.elchiStatus,
      applied: result.applied,
    });
    return result;
  }

  @Get('admin/orders/:id/label')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Buyurtmaning barcha posilka yorliqlari (bitta PDF)',
    description:
      '`:id` — admin ro‘yxatidagi buyurtma id’si (sales_order), boshqa ' +
      'admin endpointlari bilan bir xil. Har do‘kon posilkasi alohida ' +
      '100x60 mm sahifa. Chiqmay qolgan posilkalar `X-Labels-Skipped` ' +
      'headerida (URI-encoded JSON); birortasi ham chiqmasa 409.',
  })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiResponse({ status: 409, description: 'Birorta yorliq chiqmadi' })
  async label(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await sendRpc<LabelDocument>(
      this.checkout,
      { cmd: 'checkout.admin.order-label' },
      { orderId: id },
    );
    return labelPdf(res, document);
  }

  @Get('admin/orders/:id/sellers/:sellerOrderId/label')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Buyurtmaning bitta posilkasi (do‘koni) yorlig‘i',
  })
  @ApiNotFoundResponse({
    description: 'Posilka topilmadi yoki shu buyurtmaga tegishli emas',
  })
  @ApiResponse({ status: 409, description: 'Posilka yoki QR token yo‘q' })
  async sellerOrderLabel(
    @Param('id') id: string,
    @Param('sellerOrderId') sellerOrderId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await sendRpc<LabelDocument>(
      this.checkout,
      { cmd: 'checkout.admin.seller-order-label' },
      { orderId: id, sellerOrderId },
    );
    return labelPdf(res, document);
  }

  @Post('admin/orders/labels')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Bir nechta buyurtma yorliqlari bitta PDF da',
    description:
      '`orderIds` — sales_order id’lari. Yorlig‘i chiqmagan posilkalar ' +
      'partiyani yiqitmaydi: ular `X-Labels-Skipped` headerida sababi ' +
      'bilan qaytadi. Birortasi ham chiqmasa 409.',
  })
  @ApiResponse({ status: 409, description: 'Birorta yorliq chiqmadi' })
  async labelsBatch(
    @Body() dto: ShippingLabelsBatchDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await sendRpc<LabelDocument>(
      this.checkout,
      { cmd: 'checkout.admin.order-labels' },
      { orderIds: dto.orderIds },
    );
    return labelPdf(res, document);
  }

  @Post('admin/orders/shipment-tokens/sync')
  @Roles(Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Posilka QR tokenlarini Elchi bilan tenglashtirish (backfill)',
    description:
      'Tokeni yo‘q yoki Elchi’dagidan farq qiladigan posilkalarni ' +
      'tuzatadi. Avval `dryRun: true` bilan ko‘ring. Javobdagi ' +
      '`nextAfterId` null bo‘lguncha `afterId` bilan takrorlang.',
  })
  async syncShipmentTokens(
    @Body() dto: AdminShipmentTokensSyncDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.shipment-tokens-sync' },
      dto,
    );
    if (!dto.dryRun) {
      this.audit(admin.sub, 'order.shipment-tokens-sync', 'all', ip, dto);
    }
    return result;
  }

  @Post('admin/orders/:id/cancel')
  // BE-18 (BUY-3): nazoratchi ham bekor qiladi
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Buyurtmani majburiy bekor qilish',
    description:
      'Liddan buyurtma (BE-18): Elchi’ga topshirilgunga qadar (CONFIRMED, PICKING, PACKED), sabab bilan; ' +
      'band tovar darhol bo‘shaydi, boshqa holatda 409 va jurnalda. ' +
      'Eski buyurtma: faqat DRAFT/PENDING_PAYMENT, rezerv va yakunlanmagan online to‘lov bekor qilinadi. ' +
      'Idempotent: allaqachon CANCELLED bo‘lsa `idempotent: true` qaytadi.',
  })
  @ApiResponse({ status: 201, type: OrderActionResultDto })
  @ApiBadRequestResponse({
    description: 'Buyurtma holati bekor qilishga yo‘l qo‘ymaydi',
  })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async cancel(
    @Param('id') id: string,
    @Body() dto: AdminOrderActionDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.order-cancel' },
      {
        orderId: id,
        reason: dto.reason,
        actorId: admin.sub,
        actorRole: admin.role,
      },
    );
    this.audit(admin.sub, 'order.cancel', id, ip, dto);
    return result;
  }

  @Post('admin/orders/:id/refund')
  @Roles(Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'To‘langan buyurtmani to‘liq qaytarish',
    description:
      'Provayderda refund, ombor qaytimi va har sotuvchi ledgeri bitta ' +
      'oqimda bajariladi. Muvaffaqiyatdan keyin buyurtma REFUNDED, ' +
      'sub-buyurtmalar RETURNED va to‘lov holati (GET /orders, ' +
      'GET /orders/:id/tracking) REFUNDED bo‘ladi. Idempotent: takror ' +
      'chaqirilsa provayderga hech narsa yuborilmaydi va ' +
      '`idempotent: true` qaytadi. Hozircha faqat to‘liq summa: `amount` ' +
      'berilsa u buyurtma totaliga teng bo‘lishi kerak. COD buyurtma rad etiladi.',
  })
  @ApiResponse({ status: 201, type: OrderActionResultDto })
  @ApiBadRequestResponse({
    description: 'COD buyurtma, qisman summa yoki refundga yaroqsiz holat',
  })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async refund(
    @Param('id') id: string,
    @Body() dto: AdminOrderRefundDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.order-refund' },
      {
        orderId: id,
        reason: dto.reason,
        amount: dto.amount,
        actorId: admin.sub,
      },
    );
    this.audit(admin.sub, 'order.refund', id, ip, dto);
    return result;
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip: string,
    meta: object,
  ) {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action,
        entityType: 'SalesOrder',
        entityId,
        meta: { ...meta, ip: ip || null },
      },
    ).catch(() => undefined);
  }
}
