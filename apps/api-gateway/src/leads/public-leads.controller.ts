import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateLandingClickDto,
  CreateLeadDto,
  LandingClickCreatedDto,
  LandingPageDto,
  LeadCreatedDto,
  Public,
} from '@app/common';
import { notImplementedYet } from './lead-stub';

/**
 * Sotuvchi sahifasi uchun ochiq API (BE-25 shartnomasi). Login yo‘q.
 * Real kod: BE-11 (sahifa, klik), BE-12 (POST /leads), BE-38 (manzil qoidalari).
 */
@ApiTags('leads')
@Public()
@Controller()
export class PublicLeadsController {
  @Get('landing/:code')
  @ApiOperation({
    summary: 'Sotuvchi sahifasi ma’lumoti (kod bo‘yicha)',
    description:
      'Mahsulot, kreativlar, ko‘rinadigan narx va yetkazish, shablon, piksel va sahifa holati. ' +
      'Bazaviy narx, sotuvchi haqi va optovik ma’lumoti qaytmaydi (BE-11).',
  })
  @ApiOkResponse({ type: LandingPageDto })
  @ApiNotFoundResponse({ description: 'Bunday sotuvchi sahifasi yo‘q' })
  getLandingPage(@Param('code') _code: string): Promise<LandingPageDto> {
    return notImplementedYet('BE-11');
  }

  @Post('clicks')
  @ApiOperation({
    summary: 'Sotuvchi sahifasiga o‘tish (klik)',
    description:
      'Sotuvchi sahifasi serveri yuboradi; mijozning IP va user agenti so‘rov sarlavhasidan olinadi (BE-11).',
  })
  @ApiCreatedResponse({ type: LandingClickCreatedDto })
  @ApiBadRequestResponse({ description: 'Maydonlar noto‘g‘ri' })
  createClick(
    @Body() _dto: CreateLandingClickDto,
  ): Promise<LandingClickCreatedDto> {
    return notImplementedYet('BE-11');
  }

  @Post('leads')
  @ApiOperation({
    summary: 'Sotuvchi sahifasi formasidan ariza (lid)',
    description:
      'Ism, telefon, viloyat, tuman, ko‘cha/uy va yetkazish turi majburiy. Javob bazaga yozilgandan keyin (LID-3). ' +
      'Yashirin maydon to‘ldirilsa lid yozilmaydi, javob baribir 201 (BE-12).',
  })
  @ApiCreatedResponse({ type: LeadCreatedDto })
  @ApiBadRequestResponse({
    description: 'Telefon yoki manzil noto‘g‘ri; javobda maydon nomlari',
  })
  createLead(@Body() _dto: CreateLeadDto): Promise<LeadCreatedDto> {
    return notImplementedYet('BE-12');
  }
}
