import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  CurrentUser,
  JwtUser,
  LegacyRole,
  RmqClient,
  Roles,
  SelfGuard,
  SellerShopResponseDto,
  sendRpc,
  UpdateSellerShopDto,
} from '@app/common';

@ApiTags('sellers')
@Controller('sellers')
export class SellersController {
  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.CATALOG) private readonly catalog: ClientProxy,
  ) {}

  @Get('me')
  @Roles(LegacyRole.SELLER)
  @UseGuards(SelfGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Joriy sotuvchining do‘kon profilini olish' })
  @ApiOkResponse({ type: SellerShopResponseDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'Boshqa foydalanuvchi do‘koniga ruxsat yo‘q',
    type: AuthErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Sotuvchining do‘koni topilmadi',
    type: AuthErrorResponseDto,
  })
  getMyShop(@CurrentUser() user: JwtUser) {
    return sendRpc(
      this.catalog,
      { cmd: 'seller.shop.get-me' },
      {
        ownerUserId: user.sub,
      },
    );
  }

  @Patch('me')
  @Roles(LegacyRole.SELLER)
  @UseGuards(SelfGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Joriy sotuvchining do‘kon profilini tahrirlash' })
  @ApiOkResponse({ type: SellerShopResponseDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({
    description: 'Boshqa foydalanuvchi do‘koniga ruxsat yo‘q',
    type: AuthErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Sotuvchining do‘koni topilmadi',
    type: AuthErrorResponseDto,
  })
  updateMyShop(@CurrentUser() user: JwtUser, @Body() dto: UpdateSellerShopDto) {
    return sendRpc(
      this.catalog,
      { cmd: 'seller.shop.update-me' },
      {
        ownerUserId: user.sub,
        dto,
      },
    );
  }
}
