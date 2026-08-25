import {
  Controller,
  Delete,
  Get,
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
  FavoritesPageDto,
  FavoritesQueryDto,
  JwtUser,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('favorites')
@ApiBearerAuth()
@Controller('favorites')
export class FavoritesController {
  constructor(
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Joriy userning sevimli mahsulotlari' })
  @ApiOkResponse({ type: FavoritesPageDto })
  list(@CurrentUser() user: JwtUser, @Query() query: FavoritesQueryDto) {
    return sendRpc(
      this.catalog,
      { cmd: 'favorite.list' },
      { userId: user.sub, query },
    );
  }

  @Get(':productId/check')
  @ApiOperation({ summary: 'Mahsulot sevimlilarga qo‘shilganini tekshirish' })
  check(@CurrentUser() user: JwtUser, @Param('productId') productId: string) {
    return sendRpc(
      this.catalog,
      { cmd: 'favorite.check' },
      { userId: user.sub, productId },
    );
  }

  @Post(':productId')
  @ApiOperation({ summary: 'Mahsulotni sevimlilarga qo‘shish' })
  add(@CurrentUser() user: JwtUser, @Param('productId') productId: string) {
    return sendRpc(
      this.catalog,
      { cmd: 'favorite.add' },
      { userId: user.sub, productId },
    );
  }

  @Delete(':productId')
  @ApiOperation({ summary: 'Mahsulotni sevimlilardan olib tashlash' })
  remove(@CurrentUser() user: JwtUser, @Param('productId') productId: string) {
    return sendRpc(
      this.catalog,
      { cmd: 'favorite.remove' },
      { userId: user.sub, productId },
    );
  }
}
