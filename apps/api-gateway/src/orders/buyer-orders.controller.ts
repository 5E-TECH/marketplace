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
  BuyerOrderDetailsDto,
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

  @Get(':orderId')
  @Public()
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Session-Id',
    required: false,
    description: 'Guest checkoutda ishlatilgan session identifikatori',
  })
  @ApiOperation({
    summary: 'Xaridor yoki guest buyurtmasining tafsilotlari',
    security: [{ bearer: [] }, {}],
  })
  @ApiOkResponse({ type: BuyerOrderDetailsDto })
  details(
    @Req() request: Request & { user?: JwtUser },
    @Param('orderId') orderId: string,
  ) {
    const owner = this.owner(request);
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.order.details' },
      { orderId, ...owner },
    );
  }

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
    const owner = this.owner(request);
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.order.tracking' },
      { orderId, ...owner },
    );
  }

  private owner(request: Request & { user?: JwtUser }) {
    const sessionHeader = request.headers['x-session-id'];
    const sessionId = Array.isArray(sessionHeader)
      ? sessionHeader[0]
      : sessionHeader;
    if (!request.user?.sub && !sessionId?.trim()) {
      throw new UnauthorizedException('Token yoki X-Session-Id talab qilinadi');
    }
    return {
      customerId: request.user?.sub,
      sessionId: sessionId?.trim(),
    };
  }
}
