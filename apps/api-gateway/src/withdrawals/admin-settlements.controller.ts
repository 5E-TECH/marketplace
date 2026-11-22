import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Optional,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  BankFileQueryDto,
  CurrentUser,
  FINANCE_SETTLEMENT_RPC,
  RmqClient,
  Role,
  Roles,
  RunSettlementDto,
  sendRpc,
  SettlementRunResultDto,
  WholesalerSettlementDto,
  WholesalerSettlementPageDto,
  WholesalerSettlementQueryDto,
  SETTLEMENT_PAID_EVENT,
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { LabelDocument, labelPdf } from '../orders/label-pdf';

/**
 * Moliya: optovik bilan haftalik hisob-kitob va akt-sverka (BE-33; MOL-7). Aktlar har dushanba 09:00 avtomatik;
 * «To‘landi» va qo‘lda ishga tushirish — FINANCE va SUPERADMIN (BE-05); ko‘rish — ADMIN ham.
 */
@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance/settlements')
export class AdminSettlementsController {
  private readonly logger = new Logger(AdminSettlementsController.name);

  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
    // BE-47: optovikka «Pul o‘tkazildi» (SMS va kabinet)
    @Optional()
    @Inject(RmqClient.NOTIFICATION)
    private readonly notification?: ClientProxy,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Optovik aktlari (holat, optovik, davr filtri)' })
  @ApiOkResponse({ type: WholesalerSettlementPageDto })
  list(
    @Query() query: WholesalerSettlementQueryDto,
  ): Promise<WholesalerSettlementPageDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RPC.LIST },
      { query },
    );
  }

  @Get('bank-file')
  // BE-05: bank fayli davr aktlarini muzlatadi — to‘lov qadami, TZ 3: moliya
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Bank to‘lov topshiriqnomasi fayli (davrning to‘lovga tayyor aktlari)',
    description:
      'Davrning tayyor aktlari muzlatiladi: qaytgan tovar chiqadi, oldingi qaytarishlar qarzi ushlanadi, summa saqlanadi; qayta yuklab olish o‘sha faylni beradi. Format bank tanlangach aniqlanadi; hozir 11 ustunli CSV, rekvizitlar BE-07 dan keyin (BE-33 TC3).',
  })
  @ApiProduces('text/csv')
  @ApiNotFoundResponse({ description: 'Bu davrda to‘lanadigan akt yo‘q' })
  async bankFile(
    @Query() query: BankFileQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await sendRpc<LabelDocument>(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RPC.BANK_FILE },
      { periodEnd: query.periodEnd },
    );
    return labelPdf(res, file);
  }

  @Post('run')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Hisob-kitobni qo‘lda ishga tushirish (cron har dushanba 09:00)',
    description:
      'Takror ishga tushirish xavfsiz: bir tovar qatori bir marta aktga kiradi.',
  })
  @ApiOkResponse({ type: SettlementRunResultDto })
  run(@Body() dto: RunSettlementDto): Promise<SettlementRunResultDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RPC.RUN },
      { asOf: dto.asOf },
    );
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Akt va uning tovar qatorlari' })
  @ApiOkResponse({ type: WholesalerSettlementDto })
  @ApiNotFoundResponse({ description: 'Akt topilmadi' })
  get(
    @Param('id', ParseLeadIdPipe) id: string,
  ): Promise<WholesalerSettlementDto> {
    return sendRpc(this.finance, { cmd: FINANCE_SETTLEMENT_RPC.GET }, { id });
  }

  @Get(':id/act.pdf')
  @Roles(Role.ADMIN, Role.FINANCE, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Akt-sverka PDF' })
  @ApiProduces('application/pdf')
  @ApiNotFoundResponse({ description: 'Akt topilmadi' })
  async actPdf(
    @Param('id', ParseLeadIdPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await sendRpc<LabelDocument>(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RPC.ACT_PDF },
      { id },
    );
    return labelPdf(res, file);
  }

  @Post(':id/paid')
  @Roles(Role.FINANCE, Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '«To‘landi»: moliya bankda o‘tkazdi',
    description:
      'Faqat bank faylidan keyin (EXPORTED); ledgerga aynan fayldagi summa (WHOLESALER_PAID). Keyin qaytgan tovar qarzi keyingi aktdan ushlanadi. Takror — o‘sha natija.',
  })
  @ApiOkResponse({ type: WholesalerSettlementDto })
  @ApiNotFoundResponse({ description: 'Akt topilmadi' })
  @ApiConflictResponse({
    description:
      'INVALID_STATE: akt bank fayliga chiqmagan (READY, NETTED, VOID)',
  })
  async paid(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser('sub') paidBy: string,
  ): Promise<WholesalerSettlementDto> {
    const result = await sendRpc<WholesalerSettlementDto>(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RPC.PAID },
      { id, paidBy },
    );
    // BE-47 (TC3): optovikka «Pul o‘tkazildi» — takror bosilsa ham bitta xabar (notification `dedupeKey`). BE-24 dagi
    // sotuvchi «pul o‘tkazildi» kabi gateway’dan, outbox’siz [taklif]: yuborilmasa — log; «To‘landi» ni qayta bosish
    // xabarni qayta yuboradi (holat idempotent)
    if (this.notification)
      this.notification
        .emit(SETTLEMENT_PAID_EVENT, {
          settlementId: String(result.id),
          number: result.number,
          wholesalerId: String(result.wholesalerId),
          amount: result.exportedTotal ?? result.totalAmount,
          periodStart: result.periodStart,
          periodEnd: result.periodEnd,
        })
        .subscribe({
          error: (error: Error) =>
            this.logger.warn(
              `Optovikka «Pul o‘tkazildi» xabari yuborilmadi: ${error.message}`,
            ),
        });
    return result;
  }
}
