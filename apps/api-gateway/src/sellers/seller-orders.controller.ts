import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  JwtUser,
  RmqClient,
  Role,
  Roles,
  SellerDashboardDto,
  CreateShipmentDto,
  SellerOrdersPageDto,
  SellerOrdersQueryDto,
  UpdateSellerOrderStatusDto,
  sendRpc,
} from '@app/common';

@ApiTags('seller')
@ApiBearerAuth()
@Controller('seller')
export class SellerOrdersController {
  constructor(
    @Inject(RmqClient.CHECKOUT)
    private readonly checkout: ClientProxy,
  ) {}

  /** Scope: OPERATOR → JWT shopId; SELLER (owner) → ownerUserId. */
  private scope(user: JwtUser): { shopId?: string; ownerUserId?: string } {
    return user.role === Role.OPERATOR
      ? { shopId: user.shopId }
      : { ownerUserId: user.sub };
  }

  @Get('orders')
  @Roles(Role.SELLER, Role.OPERATOR)
  @ApiOperation({ summary: 'Do‘kon buyurtmalari (sotuvchi yoki operator)' })
  @ApiOkResponse({ type: SellerOrdersPageDto })
  orders(@CurrentUser() user: JwtUser, @Query() query: SellerOrdersQueryDto) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.list' },
      { ...this.scope(user), query },
    );
  }

  @Get('orders/:id') @Roles(Role.SELLER, Role.OPERATOR) getOrder(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.get' },
      { ...this.scope(u), orderId: id },
    );
  }
  @Get('orders/:id/items') @Roles(Role.SELLER, Role.OPERATOR) items(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.items' },
      { ...this.scope(u), orderId: id },
    );
  }
  @Get('orders/:id/history') @Roles(Role.SELLER, Role.OPERATOR) history(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.history' },
      { ...this.scope(u), orderId: id },
    );
  }
  @Post('orders/:id/cancel') @Roles(Role.SELLER, Role.OPERATOR) cancel(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.update-status' },
      { ...this.scope(u), orderId: id, status: 'CANCELLED' },
    );
  }
  @Post('orders/:id/confirm') @Roles(Role.SELLER, Role.OPERATOR) confirm(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.update-status' },
      { ...this.scope(u), orderId: id, status: 'CONFIRMED' },
    );
  }
  @Post('orders/:id/shipment')
  @Roles(Role.SELLER, Role.OPERATOR)
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
  @Get('shipments') @Roles(Role.SELLER, Role.OPERATOR) listShipments(
    @CurrentUser() u: JwtUser,
    @Query() query: SellerOrdersQueryDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.shipments.list' },
      { ...this.scope(u), query },
    );
  }
  @Get('shipments/:id') @Roles(Role.SELLER, Role.OPERATOR) shipment(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.shipments.get' },
      { ...this.scope(u), shipmentId: id },
    );
  }
  @Get('shipments/:id/tracking') @Roles(Role.SELLER, Role.OPERATOR) tracking(
    @CurrentUser() u: JwtUser,
    @Param('id') id: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.shipments.tracking' },
      { ...this.scope(u), shipmentId: id },
    );
  }

  @Patch('orders/:id')
  @Roles(Role.SELLER, Role.OPERATOR)
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
  @Roles(Role.SELLER)
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
