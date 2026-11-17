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
  OperatorLeadListItemDto,
  OperatorQueueSummaryDto,
  OperatorStateDto,
  OperatorStatsDto,
  RmqClient,
  sendRpc,
  SubmitLeadResultDto,
  UpdateLeadAddressDto,
  UpdateOperatorStateDto,
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';

/**
 * Operator ish joyi API si (BE-25 shartnomasi).
 * Real kod: BE-13 (navbat, natija), BE-38 (manzil), BE-42 (mijoz tarixi), BE-28 (statistika).
 * Rol cheklovi `@Roles(Role.OPERATOR_LEAD)` (navbat xulosasi — SUPERVISOR) BE-05 dan keyin qo‘shiladi.
 */
@ApiTags('operator')
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
  @ApiOperation({
    summary: 'Navbat xulosasi (nazoratchi)',
    description: 'Navbat hajmi va operatorlar holati (BE-13).',
  })
  @ApiOkResponse({ type: OperatorQueueSummaryDto })
  queueSummary(): Promise<OperatorQueueSummaryDto> {
    return sendRpc(this.lead, { cmd: 'lead.queue.summary' }, {});
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
