import {
  Controller,
  Get,
  Inject,
  Param,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  BuyerOrderTrackingDto,
  JwtUser,
  RmqClient,
  Public,
  sendRpc,
} from '@app/common';

@ApiTags('orders')
@Controller('orders')
export class BuyerOrdersController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  @Get(':orderId/tracking')
  @Public()
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Session-Id',
    required: false,
    description: 'Guest checkoutda ishlatilgan session identifikatori',
  })
  @ApiOperation({
    summary: 'Xaridor yoki guest buyurtmasi va posilkalarini kuzatish',
    security: [{ bearer: [] }, {}],
  })
  @ApiOkResponse({ type: BuyerOrderTrackingDto })
  tracking(
    @Req() request: Request & { user?: JwtUser },
    @Param('orderId') orderId: string,
  ) {
    const user = request.user;
    const sessionHeader = request.headers['x-session-id'];
    const sessionId = Array.isArray(sessionHeader)
      ? sessionHeader[0]
      : sessionHeader;
    if (!user?.sub && !sessionId?.trim()) {
      throw new UnauthorizedException('Token yoki X-Session-Id talab qilinadi');
    }
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.order.tracking' },
      { orderId, customerId: user?.sub, sessionId: sessionId?.trim() },
    );
  }
}
