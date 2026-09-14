import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  BuyerOrderTrackingDto,
  CurrentUser,
  JwtUser,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class BuyerOrdersController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  @Get(':orderId/tracking')
  @Roles(Role.BUYER)
  @ApiOperation({ summary: 'Xaridor buyurtmasi va posilkalarini kuzatish' })
  @ApiOkResponse({ type: BuyerOrderTrackingDto })
  tracking(@CurrentUser() user: JwtUser, @Param('orderId') orderId: string) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.order.tracking' },
      { orderId, customerId: user.sub },
    );
  }
}
