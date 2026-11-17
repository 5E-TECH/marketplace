import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
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
} from '@app/common';
import { ParseLeadIdPipe } from '../leads/lead-id.pipe';
import { LabelDocument, labelPdf } from '../orders/label-pdf';

/**
 * Moliya: optovik bilan haftalik hisob-kitob va akt-sverka (BE-33; MOL-7). Aktlar har dushanba 09:00 avtomatik;
 * «To‘landi» va qo‘lda ishga tushirish — FINANCE roli BE-05 da qo‘shilguncha faqat SUPERADMIN [taklif].
 */
@ApiTags('admin-finance')
@ApiBearerAuth()
@Controller('admin/finance/settlements')
export class AdminSettlementsController {
  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPERADMIN)
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
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary:
      'Bank to‘lov topshiriqnomasi fayli (davrning to‘lovga tayyor aktlari)',
    description:
      'Format bank tanlangach aniqlanadi; hozir 11 ustunli CSV, rekvizitlar BE-07 dan keyin (BE-33 TC3).',
  })
  @ApiProduces('text/csv')
  @ApiNotFoundResponse({ description: 'Bu davrda to‘lovga tayyor akt yo‘q' })
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
  @Roles(Role.SUPERADMIN)
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
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({ summary: 'Akt va uning tovar qatorlari' })
  @ApiOkResponse({ type: WholesalerSettlementDto })
  @ApiNotFoundResponse({ description: 'Akt topilmadi' })
  get(
    @Param('id', ParseLeadIdPipe) id: string,
  ): Promise<WholesalerSettlementDto> {
    return sendRpc(this.finance, { cmd: FINANCE_SETTLEMENT_RPC.GET }, { id });
  }

  @Get(':id/act.pdf')
  @Roles(Role.ADMIN, Role.SUPERADMIN)
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
  @Roles(Role.SUPERADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '«To‘landi»: moliya bankda o‘tkazdi',
    description:
      'Qaytarilgan tovarlar aktdan chiqariladi, summa qayta hisoblanadi; ledgerga WHOLESALER_PAID jurnali. Takror — o‘sha natija.',
  })
  @ApiOkResponse({ type: WholesalerSettlementDto })
  @ApiNotFoundResponse({ description: 'Akt topilmadi' })
  @ApiConflictResponse({
    description: 'INVALID_STATE: summa 0 yoki optovik balansi yetmaydi',
  })
  paid(
    @Param('id', ParseLeadIdPipe) id: string,
    @CurrentUser('sub') paidBy: string,
  ): Promise<WholesalerSettlementDto> {
    return sendRpc(
      this.finance,
      { cmd: FINANCE_SETTLEMENT_RPC.PAID },
      { id, paidBy },
    );
  }
}
