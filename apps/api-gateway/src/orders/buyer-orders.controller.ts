import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  BuyerOrderDetailsDto,
  BuyerOrderRefundDto,
  BuyerOrdersPageDto,
  BuyerOrdersQueryDto,
  BuyerOrderTrackingDto,
  JwtUser,
  legacyBuyer,
  LegacyRole,
  OrderActionResultDto,
  Public,
  RmqClient,
  Roles,
  sendRpc,
} from '@app/common';

@ApiTags('orders')
@Controller('orders')
export class BuyerOrdersController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  @Get()
  @Roles(LegacyRole.BUYER)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Xaridorning buyurtmalari' })
  @ApiOkResponse({ type: BuyerOrdersPageDto })
  list(
    @Req() request: Request & { user: JwtUser },
    @Query() query: BuyerOrdersQueryDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.orders.list-by-buyer' },
      { customerId: request.user.sub, query },
    );
  }

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

  @Post(':orderId/refund')
  @Public()
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Session-Id',
    required: false,
    description: 'Guest checkoutda ishlatilgan session identifikatori',
  })
  @ApiOperation({
    summary: 'Xaridor buyurtmasini qaytarish (to‘lanmagan bo‘lsa — bekor)',
    description:
      'To‘lanmagan buyurtma bekor qilinadi va rezerv bo‘shaydi; to‘langan, ' +
      'lekin posilka hali chiqmagan buyurtma to‘liq refund qilinadi. ' +
      'Posilka yo‘lga chiqqan bo‘lsa 400 qaytadi.',
    security: [{ bearer: [] }, {}],
  })
  @ApiResponse({ status: 201, type: OrderActionResultDto })
  @ApiBadRequestResponse({
    description: 'Buyurtma holati o‘z-o‘ziga qaytarishga yo‘l qo‘ymaydi',
  })
  refund(
    @Req() request: Request & { user?: JwtUser },
    @Param('orderId') orderId: string,
    @Body() dto: BuyerOrderRefundDto,
  ) {
    const owner = this.owner(request);
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.order.refund' },
      { orderId, reason: dto.reason ?? '', ...owner },
    );
  }

  private owner(request: Request & { user?: JwtUser }) {
    const sessionHeader = request.headers['x-session-id'];
    const sessionId = Array.isArray(sessionHeader)
      ? sessionHeader[0]
      : sessionHeader;
    const buyer = legacyBuyer(request.user); // BE-05: sotuvchi/xodim tokeni — mehmon
    if (!buyer?.sub && !sessionId?.trim()) {
      throw new UnauthorizedException('Token yoki X-Session-Id talab qilinadi');
    }
    return {
      customerId: buyer?.sub,
      sessionId: sessionId?.trim(),
    };
  }
}
