import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AdminOrdersQueryDto,
  AdminOrderActionDto,
  AdminOrderRefundDto,
  AdminShipmentTokensSyncDto,
  OrderActionResultDto,
  CurrentUser,
  JwtUser,
  AuthErrorResponseDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  ShippingLabelsBatchDto,
} from '@app/common';
import { LabelDocument, labelPdf } from '../orders/label-pdf';

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
  ) {}

  @Get('admin/orders')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Barcha buyurtmalar (status/to‘lov/do‘kon/sana filtr + sahifalash)',
  })
  @ApiOkResponse({ description: '{ items, total, page, limit, totalPages }' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  list(@Query() query: AdminOrdersQueryDto) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.orders-list' },
      { query },
    );
  }

  @Get('admin/orders/:id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Buyurtma to‘liq (sub-order + item + shipment + to‘lov)',
  })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  get(@Param('id') id: string) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.order-get' },
      { orderId: id },
    );
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
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Buyurtmani majburiy bekor qilish',
    description:
      'Faqat DRAFT/PENDING_PAYMENT buyurtma. Rezerv bo‘shatiladi va ' +
      'yakunlanmagan online to‘lov yozuvlari CANCELLED ga o‘tadi. ' +
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
