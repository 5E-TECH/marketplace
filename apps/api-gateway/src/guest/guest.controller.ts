import { Controller, Headers, Inject, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  JwtUser,
  LegacyRole,
  Roles,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('guest')
@ApiBearerAuth()
@Controller('guest')
export class GuestController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Post('merge')
  // BE-05: mijoz foydalanuvchi emas — eski xaridor yo‘li hech kimga ochilmaydi (BE-29 da o‘chiriladi)
  @Roles(LegacyRole.BUYER)
  @ApiOperation({
    summary: 'Anonim savat va sevimlilarni joriy userga birlashtirish',
  })
  async merge(
    @CurrentUser() user: JwtUser,
    @Headers('x-session-id') sessionId: string,
  ) {
    const [cart, favorites] = await Promise.all([
      sendRpc(
        this.checkout,
        { cmd: 'cart.merge' },
        {
          customerId: user.sub,
          sessionId,
        },
      ),
      sendRpc(
        this.catalog,
        { cmd: 'favorite.merge' },
        {
          userId: user.sub,
          sessionId,
        },
      ),
    ]);
    return { cart, favorites };
  }
}
