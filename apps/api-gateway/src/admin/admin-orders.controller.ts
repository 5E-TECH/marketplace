import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AdminOrdersQueryDto,
  AdminOrderActionDto,
  AdminOrderRefundDto,
  CurrentUser,
  JwtUser,
  AuthErrorResponseDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
  ShippingLabelsBatchDto,
} from '@app/common';

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
  @ApiOperation({ summary: 'Seller-order Elchi QR yorlig‘ini PDF olish' })
  async label(@Param('id') id: string): Promise<StreamableFile> {
    const document = await sendRpc<{
      fileName: string;
      contentType: string;
      base64: string;
    }>(this.checkout, { cmd: 'checkout.admin.order-label' }, { orderId: id });
    return this.pdf(document);
  }

  @Post('admin/orders/labels')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Bir nechta seller-order yorlig‘ini bitta PDF olish',
  })
  async labelsBatch(
    @Body() dto: ShippingLabelsBatchDto,
  ): Promise<StreamableFile> {
    const document = await sendRpc<{
      fileName: string;
      contentType: string;
      base64: string;
    }>(
      this.checkout,
      { cmd: 'checkout.admin.order-labels' },
      { orderIds: dto.orderIds },
    );
    return this.pdf(document);
  }

  @Post('admin/orders/:id/cancel')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiBearerAuth()
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

  private pdf(document: {
    fileName: string;
    contentType: string;
    base64: string;
  }): StreamableFile {
    return new StreamableFile(Buffer.from(document.base64, 'base64'), {
      type: document.contentType,
      disposition: `attachment; filename="${document.fileName}"`,
      length: Buffer.byteLength(document.base64, 'base64'),
    });
  }
}
