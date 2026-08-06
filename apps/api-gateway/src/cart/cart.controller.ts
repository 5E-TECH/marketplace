import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AddCartItemDto,
  CartDto,
  CartOwnerDto,
  CurrentUser,
  JwtUser,
  Public,
  RmqClient,
  sendRpc,
  UpdateCartItemDto,
} from '@app/common';

@ApiTags('cart')
@Public()
@Controller('cart')
export class CartController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  @Get()
  @ApiOkResponse({ type: CartDto })
  get(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId?: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'cart.get' },
      { owner: this.owner(user, sessionId) },
    );
  }

  @Post('items')
  @ApiOperation({
    summary: 'Savatga mahsulot qo‘shish; joriy narx snapshot qilinadi',
  })
  @ApiOkResponse({ type: CartDto })
  add(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
    @Body() dto: AddCartItemDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'cart.item.add' },
      { owner: this.owner(user, sessionId), dto },
    );
  }

  @Patch('items/:id')
  @ApiOkResponse({ type: CartDto })
  update(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
    @Param('id') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'cart.item.update' },
      {
        owner: this.owner(user, sessionId),
        itemId,
        quantity: dto.quantity,
      },
    );
  }

  @Delete('items/:id')
  @ApiOkResponse({ type: CartDto })
  remove(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
    @Param('id') itemId: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'cart.item.remove' },
      {
        owner: this.owner(user, sessionId),
        itemId,
      },
    );
  }

  @Post('merge')
  @ApiOperation({ summary: 'Anon savatni login qilgan user savatiga qo‘shish' })
  @ApiOkResponse({ type: CartDto })
  merge(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId?: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'cart.merge' },
      {
        customerId: user?.sub,
        sessionId,
      },
    );
  }

  private owner(user?: JwtUser, sessionId?: string): CartOwnerDto {
    return user?.sub ? { customerId: user.sub } : { sessionId };
  }
}
