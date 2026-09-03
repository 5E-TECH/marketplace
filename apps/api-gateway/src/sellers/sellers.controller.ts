import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
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
  Public,
  Role,
  Roles,
  RmqClient,
  SelfGuard,
  SellerRegisterDto,
  SellerRegisterResponseDto,
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

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({
    summary: 'Inactive SELLER va PENDING shopni atomik yaratish',
  })
  @ApiCreatedResponse({ type: SellerRegisterResponseDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  @ApiConflictResponse({
    description: 'Telefon yoki shop mavjud',
    type: AuthErrorResponseDto,
  })
  register(@Body() dto: SellerRegisterDto) {
    return sendRpc(this.identity, { cmd: 'seller.register' }, dto);
  }

  @Get('me')
  @Roles(Role.SELLER)
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
  @Roles(Role.SELLER)
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
