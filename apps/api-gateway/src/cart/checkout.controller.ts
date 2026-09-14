import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  CreateCheckoutDto,
  CurrentUser,
  DeliveryPreviewDto,
  JwtUser,
  Public,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Public()
  @Post('delivery-preview')
  @ApiOperation({ summary: 'Savatdagi har bir posilka uchun dostavka narxi' })
  preview(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
    @Body() dto: DeliveryPreviewDto,
  ) {
    if (!user?.sub && !sessionId?.trim()) {
      throw new BadRequestException('Preview uchun x-session-id majburiy');
    }
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.delivery.preview' },
      {
        customerId: user?.sub,
        sessionId: user?.sub ? undefined : sessionId,
        address: dto.address,
      },
    );
  }

  @Public()
  @Post()
  @ApiOperation({
    summary: 'Savatni do‘konlar bo‘yicha ajratib buyurtma yaratish',
  })
  create(
    @CurrentUser() user: JwtUser | undefined,
    @Body() dto: CreateCheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-session-id') sessionId?: string,
  ) {
    if (!user?.sub && !sessionId?.trim()) {
      throw new BadRequestException(
        'Guest checkout uchun x-session-id majburiy',
      );
    }
    return this.createForCustomer(user, dto, idempotencyKey, sessionId);
  }

  private async createForCustomer(
    user: JwtUser | undefined,
    dto: CreateCheckoutDto,
    idempotencyKey?: string,
    sessionId?: string,
  ) {
    const customerId = user?.sub
      ? user.sub
      : (
          await sendRpc<{ id: string }>(
            this.identity,
            { cmd: 'identity.customer.create' },
            { phone: dto.address.phone, name: dto.address.recipientName },
          )
        ).id;
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.create' },
      {
        customerId,
        sessionId: user?.sub ? undefined : sessionId,
        dto,
        idempotencyKey,
      },
    );
  }

  @Post(':orderId/confirm')
  @Public()
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Session-Id',
    required: false,
    description: 'Guest checkoutda ishlatilgan session identifikatori',
  })
  @ApiOperation({
    summary: 'Buyer yoki guest uchun COD buyurtmani tasdiqlash',
    security: [{ bearer: [] }, {}],
  })
  confirm(
    @Req() request: Request & { user?: JwtUser },
    @Param('orderId') orderId: string,
  ) {
    const sessionHeader = request.headers['x-session-id'];
    const sessionId = Array.isArray(sessionHeader)
      ? sessionHeader[0]
      : sessionHeader;
    if (!request.user?.sub && !sessionId?.trim()) {
      throw new UnauthorizedException(
        'Token yoki X-Session-Id berilishi kerak',
      );
    }
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.confirm-cod' },
      {
        orderId,
        customerId: request.user?.sub,
        sessionId: sessionId?.trim(),
      },
    );
  }
}
