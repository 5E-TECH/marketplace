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
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  ELCHI_CHECK_RPC,
  ElchiCheckItemDto,
  ElchiCheckItemPageDto,
  ElchiCheckItemsQueryDto,
  ElchiCheckQueryDto,
  ElchiCheckRunDto,
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
 * (TZ 3: pul o‘zgarishi — kim, qachon, nima uchun).
 *
 * TC3 (ega qarori 2026-11-24, savollar-M1 39-savol: «Avtomatik so‘rov») — Elchi fayli o‘rniga kunlik avtomatik
 * tekshiruv: tizim Elchi partner API sidan posilka holati va pulini oladi, farqlilari `elchi-check` ro‘yxatida.
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

  // ------------------------------------------------------------------ BE-46 TC3: Elchi bilan avtomatik tekshiruv

  @Get('elchi-check')
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Elchi bilan avtomatik tekshiruv: kunning oxirgi tekshiruvi (sonlar)',
    description:
      'Har kuni 10:00 (Toshkent) [taklif] tizim Elchi’ga topshirilgan posilkalarning holati va pulini Elchi partner API sidan oladi va o‘zidagi bilan solishtiradi. Mos posilkalar faqat sanaladi, farqlilari — `elchi-check/items`. `finishedAt` null — tekshiruv ishlamoqda.',
  })
  @ApiOkResponse({ type: ElchiCheckRunDto })
  @ApiNotFoundResponse({
    description: 'Bu kun (yoki umuman) tekshiruv bo‘lmagan',
  })
  elchiCheck(@Query() query: ElchiCheckQueryDto): Promise<ElchiCheckRunDto> {
    return sendRpc(
      this.finance,
      { cmd: ELCHI_CHECK_RPC.GET },
      { date: query.date },
    );
  }

  @Get('elchi-check/items')
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Elchi tekshiruvi farqlari: holat yoki pul farqi (DIFF), yopilgan (RESOLVED), Elchi’dan o‘qib bo‘lmagan (FAILED)',
    description:
      'Sabablar: NOT_FOUND — Elchi posilkani topmadi; STATUS — holat zid (masalan, Elchi «to‘landi», bizda «yetkazildi» — xabar kelmagan); UNKNOWN_STATUS; ORDER_REF — Elchi posilkasi boshqa buyurtmaga bog‘langan; NO_REMITTANCE — Elchi pul o‘tkazganini aytadi, moliyada yozuv yo‘q; COLLECTED — mijozdan yig‘ilgan summa farq qiladi; FEE — Elchi haqi; MARKET_PAID — o‘tkazilgan summa.',
  })
  @ApiOkResponse({ type: ElchiCheckItemPageDto })
  elchiCheckItems(
    @Query() query: ElchiCheckItemsQueryDto,
  ): Promise<ElchiCheckItemPageDto> {
    return sendRpc(this.finance, { cmd: ELCHI_CHECK_RPC.ITEMS }, { query });
  }

  @Post('elchi-check/run')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Elchi tekshiruvini hozir ishga tushirish',
    description:
      'Tekshiruv fonda ishlaydi (posilkalar ko‘p bo‘lsa — daqiqalar); natija `GET elchi-check` da (`finishedAt` to‘lgach).',
  })
  @ApiAcceptedResponse({ schema: { example: { accepted: true } } })
  @ApiConflictResponse({ description: 'Tekshiruv hozir ishlamoqda' })
  async elchiCheckRun(
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<{ accepted: true }> {
    const result = await sendRpc<{ accepted: true }>(
      this.finance,
      { cmd: ELCHI_CHECK_RPC.RUN },
      { userId: user.sub },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'finance.elchi-check.run',
        entityType: 'ElchiCheck',
        entityId: null,
        meta: { ip: ip ?? null },
      },
    ).catch(() => undefined);
    return result;
  }

  @Post('elchi-check/items/:id/resolve')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Elchi tekshiruvi farqini izoh bilan yopish',
    description:
      'Pul harakati yo‘q. Keyingi tekshiruvda xuddi shu farq bo‘lsa — izoh ko‘chadi (yopiq qoladi); farq o‘zgarsa — yana ochiladi.',
  })
  @ApiOkResponse({ type: ElchiCheckItemDto })
  @ApiNotFoundResponse({ description: 'Tekshiruv qatori topilmadi' })
  @ApiConflictResponse({
    description:
      'Farq yo‘q, allaqachon yopilgan yoki posilka keyin qayta tekshirilgan',
  })
  async elchiCheckResolve(
    @Param('id', ParseLeadIdPipe) id: string,
    @Body() dto: ResolveRemittanceDto,
    @CurrentUser() user: JwtUser,
    @Ip() ip: string,
  ): Promise<ElchiCheckItemDto> {
    const item = await sendRpc<ElchiCheckItemDto>(
      this.finance,
      { cmd: ELCHI_CHECK_RPC.RESOLVE },
      { id, comment: dto.comment, userId: user.sub },
    );
    void sendRpc(
      this.identity,
      { cmd: 'identity.audit.log' },
      {
        actorId: user.sub,
        action: 'finance.elchi-check.resolve',
        entityType: 'ElchiCheckItem',
        entityId: id,
        meta: {
          orderId: item.orderId,
          reasons: item.reasons,
          comment: dto.comment,
          ip: ip ?? null,
        },
      },
    ).catch(() => undefined);
    return item;
  }
}
