import { Controller, Get, Inject, Query } from '@nestjs/common';
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
  sendRpc,
} from '@app/common';

@ApiTags('seller')
@ApiBearerAuth()
@Roles(Role.SELLER)
@Controller('seller')
export class SellerOrdersController {
  constructor(
    @Inject(RmqClient.CHECKOUT)
    private readonly checkout: ClientProxy,
  ) {}

  @Get('orders')
  @ApiOperation({ summary: 'Sotuvchining o‘z buyurtmalarini olish' })
  @ApiOkResponse({ type: SellerOrdersPageDto })
  orders(@CurrentUser() user: JwtUser, @Query() query: SellerOrdersQueryDto) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.orders.list' },
      { ownerUserId: user.sub, query },
    );
  }

  @Get('dashboard')
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
