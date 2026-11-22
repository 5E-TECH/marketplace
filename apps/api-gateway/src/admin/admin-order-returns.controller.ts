import { Body, Controller, Inject, Ip, Param, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateReturnRequestDto,
  CurrentUser,
  JwtUser,
  ReturnRequestDetailsDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';

/**
 * BE-44: yetkazilgandan keyin qaytarish so‘rovini xodim mijoz nomidan kiritadi (mijoz qo‘ng‘iroq qiladi —
 * sotuvchi sahifasidagi «So‘rov uchun qo‘ng‘iroq qiling»). Tasdiqlash va rad — `admin/returns/:id/approve|reject`.
 */
@ApiTags('admin-returns')
@ApiBearerAuth()
@Controller('admin/orders')
export class AdminOrderReturnsController {
  constructor(
    @Inject(RmqClient.CHECKOUT) private readonly checkout: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Post(':id/returns')
  // karta: «admin yoki operator» [taklif: nazoratchi ham]; TC6 — sotuvchi va omborchi 403
  @Roles(Role.ADMIN, Role.SUPERADMIN, Role.OPERATOR_LEAD, Role.SUPERVISOR)
  @ApiOperation({
    summary: 'Qaytarish so‘rovini mijoz nomidan kiritish',
    description:
      'Faqat «Yetkazildi» buyurtma, EQ-10 dagi qaytarish muddati ichida (`RETURN_WINDOW_DAYS`), sabab majburiy ' +
      '(`OTHER` da izoh ham). Buyurtma RETURN_REQUESTED; tarixda kiritgan xodim.',
  })
  @ApiCreatedResponse({ type: ReturnRequestDetailsDto })
  @ApiBadRequestResponse({
    description:
      'Sababsiz, muddat o‘tgan, buyurtma «Yetkazildi» emas yoki tovar noto‘g‘ri',
  })
  @ApiConflictResponse({ description: 'Bu buyurtmada ochiq so‘rov bor' })
  async create(
    @Param('id', ParseLeadIdPipe) orderId: string,
    @Body() dto: CreateReturnRequestDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<ReturnRequestDetailsDto> {
    const result = await sendRpc<ReturnRequestDetailsDto>(
      this.checkout,
      { cmd: 'checkout.admin.order-return-create' },
      { orderId, dto, actor: { id: user.sub, role: user.role } },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'return.create',
        entityType: 'ReturnRequest',
        entityId: String(result.id),
        meta: { orderId, reason: dto.reason, ip: ip || null },
      },
    ).catch(() => undefined);
    return result;
  }
}
