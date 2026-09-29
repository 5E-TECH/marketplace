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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  JwtUser,
  ReturnApproveDto,
  ReturnRejectDto,
  ReturnRequestDetailsDto,
  ReturnRequestsPageDto,
  ReturnRequestsQueryDto,
  ReturnReviewDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';

/**
 * C4.2 — do'konga kelgan qaytarish so'rovlari. Sotuvchi (owner) yoki
 * operator faqat o'z do'koni so'rovlarini ko'radi va qaror beradi; qaror
 * bir marta beriladi, keyin uni faqat admin o'zgartira oladi.
 */
@ApiTags('seller')
@ApiBearerAuth()
@Controller('seller/returns')
export class SellerReturnsController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
  ) {}

  /** Scope: OPERATOR → JWT shopId; SELLER (owner) → ownerUserId. */
  private scope(user: JwtUser): { shopId?: string; ownerUserId?: string } {
    return user.role === Role.OPERATOR
      ? { shopId: user.shopId }
      : { ownerUserId: user.sub };
  }

  private actor(user: JwtUser) {
    return { id: user.sub, role: user.role };
  }

  @Get()
  @Roles(Role.SELLER, Role.OPERATOR)
  @ApiOperation({ summary: 'Do‘konga kelgan qaytarish so‘rovlari' })
  @ApiOkResponse({ type: ReturnRequestsPageDto })
  list(@CurrentUser() user: JwtUser, @Query() query: ReturnRequestsQueryDto) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.returns.list' },
      { ...this.scope(user), query },
    );
  }

  @Get(':id')
  @Roles(Role.SELLER, Role.OPERATOR)
  @ApiOperation({ summary: 'Qaytarish so‘rovi va uning tarixi' })
  @ApiOkResponse({ type: ReturnRequestDetailsDto })
  @ApiNotFoundResponse({
    description: 'So‘rov topilmadi yoki boshqa do‘konniki',
  })
  get(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.returns.get' },
      { ...this.scope(user), returnId: id },
    );
  }

  @Post(':id/review')
  @Roles(Role.SELLER, Role.OPERATOR)
  @ApiOperation({
    summary: 'Ko‘rib chiqishga olish (tovar qabul qilindi, tekshirilmoqda)',
    description: 'SUBMITTED → IN_REVIEW',
  })
  @ApiResponse({ status: 201, type: ReturnRequestDetailsDto })
  @ApiBadRequestResponse({ description: 'Holat o‘tishga yo‘l qo‘ymaydi' })
  review(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: ReturnReviewDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.returns.review' },
      {
        ...this.scope(user),
        returnId: id,
        actor: this.actor(user),
        comment: dto.comment,
      },
    );
  }

  @Post(':id/approve')
  @Roles(Role.SELLER, Role.OPERATOR)
  @ApiOperation({
    summary: 'Qaytarishni tasdiqlash',
    description:
      'SUBMITTED/IN_REVIEW → APPROVED. Pulni admin qaytaradi ' +
      '(`POST /admin/returns/:id/refund`).',
  })
  @ApiResponse({ status: 201, type: ReturnRequestDetailsDto })
  @ApiBadRequestResponse({ description: 'Holat o‘tishga yo‘l qo‘ymaydi' })
  approve(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: ReturnApproveDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.returns.approve' },
      {
        ...this.scope(user),
        returnId: id,
        actor: this.actor(user),
        comment: dto.comment,
      },
    );
  }

  @Post(':id/reject')
  @Roles(Role.SELLER, Role.OPERATOR)
  @ApiOperation({
    summary: 'Qaytarishni rad etish (sabab majburiy)',
    description: 'SUBMITTED/IN_REVIEW → REJECTED',
  })
  @ApiResponse({ status: 201, type: ReturnRequestDetailsDto })
  @ApiBadRequestResponse({ description: 'Sabab yo‘q yoki holat mos emas' })
  reject(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: ReturnRejectDto,
  ) {
    return sendRpc(
      this.checkout,
      { cmd: 'seller.returns.reject' },
      {
        ...this.scope(user),
        returnId: id,
        actor: this.actor(user),
        comment: dto.reason,
      },
    );
  }
}
