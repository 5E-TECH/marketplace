import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateCheckoutDto,
  CurrentUser,
  JwtUser,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('checkout')
@Controller('checkout')
export class CheckoutController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Savatni do‘konlar bo‘yicha ajratib buyurtma yaratish',
  })
  create(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateCheckoutDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.create' },
      {
        customerId: user.sub,
        dto,
        idempotencyKey,
      },
    );
  }
}
