import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
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
  AdminReturnRefundDto,
  AdminReturnRequestsQueryDto,
  AuthErrorResponseDto,
  CurrentUser,
  JwtUser,
  ReturnApproveDto,
  ReturnRejectDto,
  ReturnRequestDetailsDto,
  ReturnRequestsPageDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';

/**
 * C4.2 — admin: barcha qaytarish so'rovlari, nizo yechish (sotuvchi qarorini
 * bekor qilish) va pulni qaytarish. Pul chiqishi C6.4 dagidek faqat SUPERADMIN.
 */
@ApiTags('admin-returns')
@ApiBearerAuth()
@Controller('admin/returns')
export class AdminReturnsController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Qaytarish so‘rovlari (holat/do‘kon/buyurtma/sana filtri)',
  })
  @ApiOkResponse({ type: ReturnRequestsPageDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  list(@Query() query: AdminReturnRequestsQueryDto) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.returns-list' },
      { query },
    );
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Qaytarish so‘rovi va uning tarixi' })
  @ApiOkResponse({ type: ReturnRequestDetailsDto })
  @ApiNotFoundResponse({ description: 'So‘rov topilmadi' })
  get(@Param('id') id: string) {
    return sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.return-get' },
      { returnId: id },
    );
  }

  @Post(':id/approve')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Tasdiqlash (sotuvchi rad etgan bo‘lsa ham)',
    description: 'SUBMITTED/IN_REVIEW/REJECTED → APPROVED',
  })
  @ApiResponse({ status: 201, type: ReturnRequestDetailsDto })
  @ApiBadRequestResponse({ description: 'Holat o‘tishga yo‘l qo‘ymaydi' })
  async approve(
    @Param('id') id: string,
    @Body() dto: ReturnApproveDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.return-approve' },
      {
        returnId: id,
        actor: { id: admin.sub, role: admin.role },
        comment: dto.comment,
      },
    );
    this.audit(admin.sub, 'return.approve', id, ip, dto);
    return result;
  }

  @Post(':id/reject')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Rad etish (sotuvchi tasdiqlagan bo‘lsa ham, pul qaytarilgunicha)',
    description: 'SUBMITTED/IN_REVIEW/APPROVED → REJECTED',
  })
  @ApiResponse({ status: 201, type: ReturnRequestDetailsDto })
  @ApiBadRequestResponse({ description: 'Sabab yo‘q yoki holat mos emas' })
  async reject(
    @Param('id') id: string,
    @Body() dto: ReturnRejectDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.return-reject' },
      {
        returnId: id,
        actor: { id: admin.sub, role: admin.role },
        comment: dto.reason,
      },
    );
    this.audit(admin.sub, 'return.reject', id, ip, dto);
    return result;
  }

  @Post(':id/refund')
  @Roles(Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Tasdiqlangan qaytarish bo‘yicha pulni qaytarish (qisman ham)',
    description:
      'APPROVED → REFUNDED. `amount` berilmasa so‘rovdagi tovarlar summasi ' +
      'to‘liq qaytariladi, kichikroq summa — qisman refund. Online to‘lovda ' +
      'provayder to‘lovidan shu summa qaytariladi; COD da pul xaridorga qo‘lda ' +
      'qaytariladi va `comment` majburiy. Ikkala holatda summa (komissiya ' +
      'ulushi qaytarilgan holda) sotuvchi hisobidan yechiladi. Sifatli tovar ' +
      'omborga qaytadi (`restock`). Idempotent: takror chaqiruv pulni ikkinchi ' +
      'marta qaytarmaydi.',
  })
  @ApiResponse({ status: 201, type: ReturnRequestDetailsDto })
  @ApiBadRequestResponse({
    description:
      'So‘rov tasdiqlanmagan, summa ortiq, COD da izoh yo‘q yoki buyurtma to‘liq qaytarilgan',
  })
  @ApiNotFoundResponse({ description: 'So‘rov topilmadi' })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async refund(
    @Param('id') id: string,
    @Body() dto: AdminReturnRefundDto,
    @CurrentUser() admin: JwtUser,
    @Ip() ip: string,
  ) {
    const result = await sendRpc(
      this.checkout,
      { cmd: 'checkout.admin.return-refund' },
      {
        returnId: id,
        actor: { id: admin.sub, role: admin.role },
        amount: dto.amount,
        restock: dto.restock,
        comment: dto.comment,
      },
    );
    this.audit(admin.sub, 'return.refund', id, ip, dto);
    return result;
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip: string,
    meta: object,
  ) {
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId,
        action,
        entityType: 'ReturnRequest',
        entityId,
        meta: { ...meta, ip: ip || null },
      },
    ).catch(() => undefined);
  }
}
