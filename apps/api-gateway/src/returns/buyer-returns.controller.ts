import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AuthErrorResponseDto,
  CreateReturnRequestDto,
  CreateReturnRequestsResultDto,
  CurrentUser,
  JwtUser,
  LegacyRole,
  ReturnRequestDetailsDto,
  ReturnRequestsPageDto,
  ReturnRequestsQueryDto,
  RmqClient,
  Roles,
  sendRpc,
} from '@app/common';

/**
 * C4.2 — xaridorning qaytarish so'rovlari. Faqat ro'yxatdan o'tgan xaridor:
 * so'rov va uning holati akkauntga bog'lanadi.
 */
@ApiTags('returns')
@ApiBearerAuth()
@Controller()
export class BuyerReturnsController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  @Post('orders/:orderId/returns')
  @Roles(LegacyRole.BUYER)
  @ApiOperation({
    summary: 'Yetkazilgan tovarni qaytarish so‘rovi',
    description:
      'Faqat DELIVERED posilkadagi tovarlar, yetkazilgandan keyin ' +
      '`RETURN_WINDOW_DAYS` (default 10) kun ichida. Qisman qaytarish ' +
      'mumkin: har tovar uchun miqdor beriladi. Tovarlar turli do‘konlardan ' +
      'bo‘lsa, har posilka uchun alohida so‘rov yaratiladi.',
  })
  @ApiResponse({ status: 201, type: CreateReturnRequestsResultDto })
  @ApiBadRequestResponse({
    description:
      'Posilka yetkazilmagan, muddat o‘tgan, miqdor ortiq yoki tovar buyurtmaga tegishli emas',
  })
  @ApiForbiddenResponse({ description: 'Buyurtma boshqa xaridorniki' })
  @ApiNotFoundResponse({ description: 'Buyurtma topilmadi' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  create(
    @CurrentUser() user: JwtUser,
    @Param('orderId') orderId: string,
    @Body() dto: CreateReturnRequestDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.returns.create' },
      { orderId, customerId: user.sub, dto },
    );
  }

  @Get('returns')
  @Roles(LegacyRole.BUYER)
  @ApiOperation({ summary: 'Xaridorning qaytarish so‘rovlari' })
  @ApiOkResponse({ type: ReturnRequestsPageDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  list(@CurrentUser() user: JwtUser, @Query() query: ReturnRequestsQueryDto) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.returns.list-by-buyer' },
      { customerId: user.sub, query },
    );
  }

  @Get('returns/:id')
  @Roles(LegacyRole.BUYER)
  @ApiOperation({ summary: 'Qaytarish so‘rovi va uning tarixi' })
  @ApiOkResponse({ type: ReturnRequestDetailsDto })
  @ApiNotFoundResponse({ description: 'So‘rov topilmadi yoki boshqaniki' })
  get(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.returns.get-by-buyer' },
      { customerId: user.sub, returnId: id },
    );
  }
}
