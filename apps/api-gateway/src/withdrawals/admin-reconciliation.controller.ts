import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Ip,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  FINANCE_RECONCILIATION_RPC,
  JwtUser,
  RemittanceDayDto,
  RemittanceDaysQueryDto,
  RemittanceItemDto,
  RemittanceItemPageDto,
  RemittanceItemsQueryDto,
  ResolveRemittanceDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';

/**
 * BE-46 (FE-19, ELC-4, DZ-07 «Elchi sverkasi»): kunlar, posilkalar va farqni izoh bilan yopish.
 * Ko‘rish — FINANCE, ADMIN, SUPERADMIN; yopish — FINANCE va SUPERADMIN [taklif]. Yopish audit jurnaliga yoziladi
 * (TZ 3: pul o‘zgarishi — kim, qachon, nima uchun). Elchi fayli yuklash — savollar-M1 39-savol javobidan keyin.
 */
@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance/reconciliation')
export class AdminReconciliationController {
  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

  @Get('days')
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Elchi o‘tkazmasi kunlari: holat va kun jami (yangisi birinchi)',
  })
  @ApiOkResponse({ type: [RemittanceDayDto] })
  days(@Query() query: RemittanceDaysQueryDto): Promise<RemittanceDayDto[]> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_RECONCILIATION_RPC.DAYS },
      { from: query.from, to: query.to },
    );
  }

  @Get('items')
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Posilkalar: kun, holat (Farq bor, Hal qilindi, Mos, Kutilmoqda), buyurtma bo‘yicha qidiruv',
  })
  @ApiOkResponse({ type: RemittanceItemPageDto })
  items(
    @Query() query: RemittanceItemsQueryDto,
  ): Promise<RemittanceItemPageDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_RECONCILIATION_RPC.ITEMS },
      { query },
    );
  }

  @Post('items/:id/resolve')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '«Hal qilindi deb yopish» — izoh majburiy',
    description:
      'Buyurtmaning ochiq farqi yopiladi; pul harakati yo‘q — yozuvlar HOLD da qoladi [taklif]. Keyin yangi o‘tkazma kelsa, farq yana ochiladi.',
  })
  @ApiOkResponse({ type: RemittanceItemDto })
  @ApiNotFoundResponse({ description: 'O‘tkazma qatori topilmadi' })
  @ApiConflictResponse({
    description: 'Farq yo‘q yoki allaqachon hal qilingan',
  })
  async resolve(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: ResolveRemittanceDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<RemittanceItemDto> {
    const item = await sendRpc<RemittanceItemDto>(
      this.finance,
      { cmd: FINANCE_RECONCILIATION_RPC.RESOLVE },
      { id, comment: dto.comment, userId: user.sub },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'finance.reconciliation.resolve',
        entityType: 'RemittanceItem',
        entityId: id,
        meta: {
          orderId: item.orderId,
          diff: item.diff,
          comment: dto.comment,
          ip: ip ?? null,
        },
      },
    ).catch(() => undefined);
    return item;
  }
}
