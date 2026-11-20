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
  legacyBuyer,
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

  @Delete()
  @ApiOperation({
    summary: 'Savatni bo‘shatish',
    description:
      'Idempotent: faol savat bo‘lmasa ham 200 va bo‘sh savat qaytaradi.',
  })
  @ApiOkResponse({ type: CartDto })
  clear(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId?: string,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'cart.clear' },
      { owner: this.owner(user, sessionId) },
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

  // BE-18: `POST /cart/merge` yopildi (404) — mijoz foydalanuvchi emas (T01:140), mijoz kabineti 2-bosqichda.

  private owner(user?: JwtUser, sessionId?: string): CartOwnerDto {
    const buyer = legacyBuyer(user); // BE-05: sotuvchi/xodim tokeni — mehmon
    return buyer?.sub ? { customerId: buyer.sub } : { sessionId };
  }
}
