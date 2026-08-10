import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
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
