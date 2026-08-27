import {
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  FavoriteOwnerDto,
  FavoritesPageDto,
  FavoritesQueryDto,
  JwtUser,
  Public,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('favorites')
@ApiBearerAuth()
@Public()
@Controller('favorites')
export class FavoritesController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Joriy userning sevimli mahsulotlari' })
  @ApiOkResponse({ type: FavoritesPageDto })
  list(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
    @Query() query: FavoritesQueryDto,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'favorite.list' },
      { owner: this.owner(user, sessionId), query },
    );
  }

  @Get(':productId/check')
  @ApiOperation({ summary: 'Mahsulot sevimlilarga qo‘shilganini tekshirish' })
  check(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
    @Param('productId') productId: string,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'favorite.check' },
      { owner: this.owner(user, sessionId), productId },
    );
  }

  @Post(':productId')
  @ApiOperation({ summary: 'Mahsulotni sevimlilarga qo‘shish' })
  add(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
    @Param('productId') productId: string,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'favorite.add' },
      { owner: this.owner(user, sessionId), productId },
    );
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Mahsulotni sevimlilardan olib tashlash' })
  remove(
    @CurrentUser() user: JwtUser | undefined,
    @Headers('x-session-id') sessionId: string | undefined,
    @Param('productId') productId: string,
  ) {
    return sendRpc(
      this.catalog,
      { cmd: 'favorite.remove' },
      { owner: this.owner(user, sessionId), productId },
    );
  }

  private owner(user?: JwtUser, sessionId?: string): FavoriteOwnerDto {
    return user?.sub ? { userId: user.sub } : { sessionId };
  }
}
