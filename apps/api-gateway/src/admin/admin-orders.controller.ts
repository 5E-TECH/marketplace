import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AdminOrdersQueryDto,
  AuthErrorResponseDto,
  Role,
  Roles,
  RmqClient,
  sendRpc,
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
}
