import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  LeadCardDto,
  LeadPriceDto,
  LeadPriceQuoteDto,
  LeadResultAcceptedDto,
  LeadStatsPeriodQueryDto,
  OperatorAttemptsPageDto,
  OperatorAttemptsQueryDto,
  OperatorLeadListItemDto,
  OperatorLeadProductDto,
  OperatorQueueSummaryDto,
  OperatorStateDto,
  OperatorStatsDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  SubmitLeadResultDto,
  UpdateLeadAddressDto,
  UpdateOperatorStateDto,
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';

/**
 * Operator ish joyi API si (BE-25 shartnomasi).
 * Real kod: BE-13 (navbat, natija), BE-38 (manzil), BE-42 (mijoz tarixi), BE-28 (statistika).
 * Rollar (TZ 3-bo‘lim jadvali, BE-05): lidni bron qilish va natija — operator, nazoratchi (superadmin — hamma amal);
 * navbat xulosasi — nazoratchi, admin va superadmin.
 */
@ApiTags('operator')
@Roles(Role.OPERATOR_LEAD, Role.SUPERVISOR, Role.SUPERADMIN)
@ApiBearerAuth()
@Controller('operator')
export class OperatorLeadsController {
  constructor(@Inject(RmqClient.LEAD) private readonly lead: ClientProxy) {}

  @Post('leads/next')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Keyingi lidni olish va bron qilish (10 daqiqa)',
    description:
      'Vaqti kelgan qayta qo‘ng‘iroqlar, keyin eng yangi lidlar. 5 tadan ortiq bron yoki tanaffus holatida rad (OPR-1, BE-13).',
  })
  @ApiOkResponse({ type: LeadCardDto })
  @ApiNotFoundResponse({
    description: 'Navbat bo‘sh: errorCode LEAD_QUEUE_EMPTY',
  })
  @ApiConflictResponse({
    description:
      'errorCode OPERATOR_ON_BREAK — operator tanaffusda; OPERATOR_OFFLINE — «ishda» holati tanlanmagan; BOOKING_LIMIT_REACHED — 5 ta bron to‘lgan',
  })
  takeNext(@CurrentUser('sub') operatorId: string): Promise<LeadCardDto> {
    return sendRpc(this.lead, { cmd: 'lead.queue.next' }, { operatorId });
  }

  @Get('leads')
  @ApiOperation({
    summary: 'Mening bronlarim va rejalashtirilgan qo‘ng‘iroqlar',
  })
  @ApiOkResponse({ type: [OperatorLeadListItemDto] })
  listMine(
    @CurrentUser('sub') operatorId: string,
  ): Promise<OperatorLeadListItemDto[]> {
    return sendRpc(this.lead, { cmd: 'lead.queue.mine' }, { operatorId });
  }

  @Get('leads/:id')
  @ApiOperation({
    summary: 'Lid kartasi',
    description:
      'Mahsulot, narx, suhbat skripti, «formadan» manzil, urinishlar, tarix va shu telefondagi oldingi lidlar (OPR-2, BE-42).',
  })
  @ApiOkResponse({ type: LeadCardDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi yoki bu operatorda emas' })
  getCard(
    @CurrentUser('sub') operatorId: string,
    @Param('id', ParseLeadIdPipe) leadId: string,
  ): Promise<LeadCardDto> {
    return sendRpc(this.lead, { cmd: 'lead.card.get' }, { operatorId, leadId });
  }

  @Get('leads/:id/product')
  @ApiOperation({
    summary: 'Mahsulot ma’lumoti (lid kartasi paneli)',
    description:
      'Tavsif, afzalliklar, qutida nima bor, qoldiq, og‘irlik, ikki yetkazish narxi, sotuvchi sahifasi va BAD ogohlantirishi (BE-25, FE-08). Faqat shu operatordagi lid.',
  })
  @ApiOkResponse({ type: OperatorLeadProductDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi yoki bu operatorda emas' })
  getProduct(
    @CurrentUser('sub') operatorId: string,
    @Param('id', ParseLeadIdPipe) leadId: string,
  ): Promise<OperatorLeadProductDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.card.product' },
      { operatorId, leadId },
    );
  }

  @Get('attempts')
  @ApiOperation({
    summary: 'Mening urinishlarim (sukut — bugun, oxirgi 10 tasi)',
    description:
      'Yangisi birinchi; `total` — davrdagi jami (GET /operator/stats `attempts` bilan bir xil). BE-25, FE-08.',
  })
  @ApiOkResponse({ type: OperatorAttemptsPageDto })
  @ApiBadRequestResponse({ description: 'Sana yoki limit noto‘g‘ri' })
  attempts(
    @CurrentUser('sub') operatorId: string,
    @Query() query: OperatorAttemptsQueryDto,
  ): Promise<OperatorAttemptsPageDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.operator.attempts' },
      { operatorId, query },
    );
  }

  @Post('leads/:id/result')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Qo‘ng‘iroq natijasi',
    description:
      'CONFIRMED faqat manzil tasdiqlangan lidga, aks holda 400 va lead.confirmed ketmaydi. REJECTED da sabab majburiy (OPR-3, BE-13).',
  })
  @ApiOkResponse({ type: LeadResultAcceptedDto })
  @ApiBadRequestResponse({
    description:
      'errorCode ADDRESS_NOT_CONFIRMED — manzil tasdiqlanmagan; VALIDATION_ERROR — sabab yoki vaqt yo‘q',
  })
  @ApiNotFoundResponse({
    description: 'Lid topilmadi, bu operatorda emas yoki bron muddati tugagan',
  })
  submitResult(
    @CurrentUser('sub') operatorId: string,
    @Param('id', ParseLeadIdPipe) leadId: string,
    @Body() result: SubmitLeadResultDto,
  ): Promise<LeadResultAcceptedDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.queue.result' },
      { operatorId, leadId, result },
    );
  }

  @Patch('leads/:id/address')
  @ApiOperation({
    summary: 'Mijoz manzilini tasdiqlash yoki tuzatish',
    description:
      'Saqlash — tasdiq. Tuzatilsa eski va yangi qiymat lid tarixiga yoziladi; yetkazish turini ham o‘zgartiradi (OPR-4, BE-38).',
  })
  @ApiOkResponse({ type: LeadCardDto })
  @ApiBadRequestResponse({
    description: 'Tuman tanlangan viloyatga tegishli emas yoki maydon bo‘sh',
  })
  updateAddress(
    @CurrentUser('sub') operatorId: string,
    @Param('id', ParseLeadIdPipe) leadId: string,
    @Body() address: UpdateLeadAddressDto,
  ): Promise<LeadCardDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.queue.update-address' },
      { operatorId, leadId, address },
    );
  }

  @Post('leads/:id/quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Summani oldindan hisoblash: miqdor va yetkazish turi bo‘yicha',
    description:
      'Lid o‘zgarmaydi. Tovar, ko‘rinadigan yetkazish va jami — operator mijozga aytadigan summa (FE-09, OPR-4; yetkazish BE-09).',
  })
  @ApiOkResponse({ type: LeadPriceDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi yoki bu operatorda emas' })
  quote(
    @CurrentUser('sub') operatorId: string,
    @Param('id', ParseLeadIdPipe) leadId: string,
    @Body() dto: LeadPriceQuoteDto,
  ): Promise<LeadPriceDto | null> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.card.quote' },
      {
        operatorId,
        leadId,
        quantity: dto.quantity,
        whereDeliver: dto.whereDeliver,
      },
    );
  }

  @Get('state')
  @ApiOperation({
    summary: 'Joriy holat va bronlar soni',
    description:
      'Sahifa yangilanganda ekran «Oflayn» dan boshlanmasin; `since` — holat boshlangan vaqt (BE-25, FE-08).',
  })
  @ApiOkResponse({ type: OperatorStateDto })
  getState(@CurrentUser('sub') operatorId: string): Promise<OperatorStateDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.operator.state.get' },
      { operatorId },
    );
  }

  @Put('state')
  @ApiOperation({ summary: 'Operator holati: ishda, tanaffus, chiqdi' })
  @ApiOkResponse({ type: OperatorStateDto })
  setState(
    @CurrentUser('sub') operatorId: string,
    @Body() dto: UpdateOperatorStateDto,
  ): Promise<OperatorStateDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.operator.state' },
      { operatorId, state: dto.state },
    );
  }

  @Get('queue-summary')
  @Roles(Role.OPERATOR_LEAD, Role.SUPERVISOR, Role.ADMIN, Role.SUPERADMIN)
  @ApiOperation({
    summary: 'Navbat xulosasi',
    description:
      'Navbat hajmi va operatorlar holati (BE-13). Operator ish joyi (BE-25, FE-08) — faqat navbat hajmi, `operators` bo‘sh.',
  })
  @ApiOkResponse({ type: OperatorQueueSummaryDto })
  async queueSummary(
    @CurrentUser('role') role: Role,
  ): Promise<OperatorQueueSummaryDto> {
    const operatorView = role === Role.OPERATOR_LEAD;
    const summary = await sendRpc<OperatorQueueSummaryDto>(
      this.lead,
      { cmd: 'lead.queue.summary' },
      { operatorView },
    );
    // gateway ham yashiradi: eski lead-service (deploy yoki rollback paytida) bayroqni bilmasa ham operatorga boshqa
    // operatorlar holati chiqmasin
    return operatorView ? { ...summary, operators: [] } : summary;
  }

  @Get('stats')
  @ApiOperation({ summary: 'Mening statistikam (OPR-7)' })
  @ApiOkResponse({ type: OperatorStatsDto })
  stats(
    @CurrentUser('sub') operatorId: string,
    @Query() query: LeadStatsPeriodQueryDto,
  ): Promise<OperatorStatsDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.stats.operator' },
      { operatorId, query },
    );
  }
}
