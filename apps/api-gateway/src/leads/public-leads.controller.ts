import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiHeader,
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
  RmqClient,
  sendRpc,
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
  constructor(@Inject(RmqClient.LEAD) private readonly lead: ClientProxy) {}

  @Get('landing/:code')
  @ApiOperation({
    summary: 'Sotuvchi sahifasi ma’lumoti (kod bo‘yicha)',
    description:
      'Mahsulot, kreativlar, ko‘rinadigan narx va yetkazish, shablon, piksel va sahifa holati. ' +
      'Bazaviy narx, sotuvchi haqi va optovik ma’lumoti qaytmaydi (BE-11).',
  })
  @ApiOkResponse({ type: LandingPageDto })
  @ApiNotFoundResponse({ description: 'Bunday sotuvchi sahifasi yo‘q' })
  getLandingPage(@Param('code') code: string): Promise<LandingPageDto> {
    return sendRpc(this.lead, { cmd: 'lead.landing.get' }, { code });
  }

  @Post('clicks')
  @ApiOperation({
    summary: 'Sotuvchi sahifasiga o‘tish (klik)',
    description:
      'Sotuvchi sahifasi serveri yuboradi; mijozning IP va user agenti so‘rov sarlavhasidan olinadi (BE-11).',
  })
  @ApiHeader({
    name: 'user-agent',
    required: false,
    description:
      'Mijoz brauzerining user agenti — sotuvchi sahifasi serveri uzatadi',
  })
  @ApiCreatedResponse({ type: LandingClickCreatedDto })
  @ApiBadRequestResponse({ description: 'Maydonlar noto‘g‘ri' })
  createClick(
    @Body() click: CreateLandingClickDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ): Promise<LandingClickCreatedDto> {
    // IP — trust-proxy sozlamasidan (trust-proxy.ts): sotuvchi sahifasi serveri X-Forwarded-For ni uzatadi.
    return sendRpc(
      this.lead,
      { cmd: 'lead.click.create' },
      { click, ip: ip || null, userAgent: userAgent?.slice(0, 1000) || null },
    );
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
