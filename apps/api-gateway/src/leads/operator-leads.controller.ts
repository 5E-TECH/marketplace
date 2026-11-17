import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
  LeadCardDto,
  LeadPriceDto,
  LeadPriceQuoteDto,
  LeadResultAcceptedDto,
  LeadStatsPeriodQueryDto,
  OperatorLeadListItemDto,
  OperatorQueueSummaryDto,
  OperatorStateDto,
  OperatorStatsDto,
  SubmitLeadResultDto,
  UpdateLeadAddressDto,
  UpdateOperatorStateDto,
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';
import { notImplementedYet } from './lead-stub';

/**
 * Operator ish joyi API si (BE-25 shartnomasi).
 * Real kod: BE-13 (navbat, natija), BE-38 (manzil), BE-42 (mijoz tarixi), BE-28 (statistika).
 * Rol cheklovi `@Roles(Role.OPERATOR_LEAD)` (navbat xulosasi — SUPERVISOR) BE-05 dan keyin qo‘shiladi.
 */
@ApiTags('operator')
@ApiBearerAuth()
@Controller('operator')
export class OperatorLeadsController {
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
      'errorCode OPERATOR_ON_BREAK — operator tanaffusda; BOOKING_LIMIT_REACHED — 5 ta bron to‘lgan',
  })
  takeNext(): Promise<LeadCardDto> {
    return notImplementedYet('BE-13');
  }

  @Get('leads')
  @ApiOperation({
    summary: 'Mening bronlarim va rejalashtirilgan qo‘ng‘iroqlar',
  })
  @ApiOkResponse({ type: [OperatorLeadListItemDto] })
  listMine(): Promise<OperatorLeadListItemDto[]> {
    return notImplementedYet('BE-13');
  }

  @Get('leads/:id')
  @ApiOperation({
    summary: 'Lid kartasi',
    description:
      'Mahsulot, narx, suhbat skripti, «formadan» manzil, urinishlar, tarix va shu telefondagi oldingi lidlar (OPR-2, BE-42).',
  })
  @ApiOkResponse({ type: LeadCardDto })
  @ApiNotFoundResponse({ description: 'Lid topilmadi yoki bu operatorda emas' })
  getCard(@Param('id', ParseLeadIdPipe) _id: string): Promise<LeadCardDto> {
    return notImplementedYet('BE-13');
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
  submitResult(
    @Param('id', ParseLeadIdPipe) _id: string,
    @Body() _dto: SubmitLeadResultDto,
  ): Promise<LeadResultAcceptedDto> {
    return notImplementedYet('BE-13');
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
    @Param('id', ParseLeadIdPipe) _id: string,
    @Body() _dto: UpdateLeadAddressDto,
  ): Promise<LeadCardDto> {
    return notImplementedYet('BE-38');
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
    @Param('id', ParseLeadIdPipe) _id: string,
    @Body() _dto: LeadPriceQuoteDto,
  ): Promise<LeadPriceDto> {
    return notImplementedYet('BE-13');
  }

  @Put('state')
  @ApiOperation({ summary: 'Operator holati: ishda, tanaffus, chiqdi' })
  @ApiOkResponse({ type: OperatorStateDto })
  setState(@Body() _dto: UpdateOperatorStateDto): Promise<OperatorStateDto> {
    return notImplementedYet('BE-13');
  }

  @Get('queue-summary')
  @ApiOperation({
    summary: 'Navbat xulosasi (nazoratchi)',
    description: 'Navbat hajmi va operatorlar holati (BE-13).',
  })
  @ApiOkResponse({ type: OperatorQueueSummaryDto })
  queueSummary(): Promise<OperatorQueueSummaryDto> {
    return notImplementedYet('BE-13');
  }

  @Get('stats')
  @ApiOperation({ summary: 'Mening statistikam (OPR-7)' })
  @ApiOkResponse({ type: OperatorStatsDto })
  stats(@Query() _query: LeadStatsPeriodQueryDto): Promise<OperatorStatsDto> {
    return notImplementedYet('BE-28');
  }
}
