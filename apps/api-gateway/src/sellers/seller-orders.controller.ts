import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateShipmentDto,
  CurrentUser,
  JwtUser,
  LegacyRole,
  RmqClient,
  Roles,
  SellerDashboardDto,
  SellerOrdersPageDto,
  SellerOrdersQueryDto,
  sendRpc,
  ShippingLabelsBatchDto,
  UpdateSellerOrderStatusDto,
} from '@app/common';
import { LabelDocument, labelPdf } from '../orders/label-pdf';

@ApiTags('seller')
@ApiBearerAuth()
@Controller('seller')
export class SellerOrdersController {
  constructor(
    @Inject(RmqClient.CHECKOUT)
    private readonly checkout: ClientProxy,
  ) {}

  /** Scope: do‘kon egasi (ownerUserId). Do‘kon operatori roli BE-05 da bekor (tokenda shopId yo‘q). */
  private scope(user: JwtUser): { shopId?: string; ownerUserId?: string } {
    return { ownerUserId: user.sub };
  }

  @Get('orders')
  @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR)
  @ApiOperation({ summary: 'Do‘kon buyurtmalari (sotuvchi yoki operator)' })
  @ApiOkResponse({ type: SellerOrdersPageDto })
  orders(@CurrentUser() user: JwtUser, @Query() query: SellerOrdersQueryDto) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.list' },
      { ...this.scope(user), query },
    );
  }

  @Get('orders/:id') @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR) getOrder(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.get' },
      { ...this.scope(u), orderId: id },
    );
  }
  @Get('orders/:id/items') @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR) items(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.items' },
      { ...this.scope(u), orderId: id },
    );
  }

  @Get('orders/:id/label')
  @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR)
  @ApiOperation({
    summary: 'Buyurtmaning 100x60 mm Elchi QR yorlig‘ini olish',
  })
  @ApiProduces('application/pdf')
  @ApiOkResponse({
    description: 'Chop etishga tayyor PDF yorliq',
    content: {
      'application/pdf': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  async label(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await sendRpc<LabelDocument>(
      this.checkout,
      { cmd: 'seller.orders.label' },
      { ...this.scope(user), orderId: id },
    );
    return labelPdf(res, document);
  }

  @Post('orders/labels')
  @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR)
  @ApiOperation({
    summary: 'Bir nechta Elchi QR yorlig‘ini bitta PDFda olish',
    description:
      'Yorlig‘i chiqmagan buyurtmalar partiyani yiqitmaydi: ular ' +
      '`X-Labels-Skipped` headerida (URI-encoded JSON) sababi bilan ' +
      'qaytadi. Birortasi ham chiqmasa 409.',
  })
  @ApiProduces('application/pdf')
  async labelsBatch(
    @CurrentUser() user: JwtUser,
    @Body() dto: ShippingLabelsBatchDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const document = await sendRpc<LabelDocument>(
      this.checkout,
      { cmd: 'seller.orders.labels' },
      { ...this.scope(user), orderIds: dto.orderIds },
    );
    return labelPdf(res, document);
  }

  @Get('orders/:id/history')
  @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR)
  history(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.history' },
      { ...this.scope(u), orderId: id },
    );
  }
  @Post('orders/:id/cancel')
  @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR)
  cancel(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.update-status' },
      { ...this.scope(u), orderId: id, status: 'CANCELLED' },
    );
  }
  @Post('orders/:id/confirm')
  @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR)
  confirm(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.update-status' },
      { ...this.scope(u), orderId: id, status: 'CONFIRMED' },
    );
  }
  @Post('orders/:id/shipment')
  @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR)
  createShipment(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
    @Body() dto: CreateShipmentDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.shipments.create' },
      { ...this.scope(u), orderId: id, customerPhone: dto.customerPhone },
    );
  }
  @Get('shipments')
  @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR)
  listShipments(
    @CurrentUser() u: JwtUser,
    @Query() query: SellerOrdersQueryDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.shipments.list' },
      { ...this.scope(u), query },
    );
  }
  @Get('shipments/:id') @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR) shipment(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.shipments.get' },
      { ...this.scope(u), shipmentId: id },
    );
  }
  @Get('shipments/:id/tracking')
  @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR)
  tracking(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.shipments.tracking' },
      { ...this.scope(u), shipmentId: id },
    );
  }

  @Patch('orders/:id')
  @Roles(LegacyRole.SELLER, LegacyRole.OPERATOR)
  @ApiOperation({ summary: 'Buyurtmani tasdiqlash/holat yangilash' })
  updateOrder(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdateSellerOrderStatusDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.update-status' },
      { ...this.scope(user), orderId: id, status: dto.status },
    );
  }

  @Get('dashboard')
  @Roles(LegacyRole.SELLER)
  @ApiOperation({ summary: 'Sotuvchi dashboard ko‘rsatkichlarini olish' })
  @ApiOkResponse({ type: SellerDashboardDto })
  dashboard(@CurrentUser() user: JwtUser) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.dashboard.get' },
      { ownerUserId: user.sub },
    );
  }
}
