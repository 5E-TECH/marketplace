import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AffiliateOffersPageDto,
  AffiliateOffersQueryDto,
  AffiliatePageQueryDto,
  AffiliateStatsDto,
  AffiliateStatsQueryDto,
  AffiliateStreamDto,
  AffiliateStreamsPageDto,
  CreateAffiliateStreamDto,
  UpdateAffiliateStreamDto,
} from '@app/common';
import { notImplementedYet } from './lead-stub';

/**
 * Sotuvchi (AFFILIATE) kabineti API si (BE-25 shartnomasi).
 * Real kod: BE-11 (offer va sahifa), BE-28 (statistika).
 * Rol cheklovi `@Roles(Role.AFFILIATE)` BE-05 dan keyin qo‘shiladi (rollar OpenAPI ga chiqmaydi).
 */
@ApiTags('affiliate')
@ApiBearerAuth()
@Controller('affiliate')
export class AffiliateStreamsController {
  @Get('offers')
  @ApiOperation({
    summary: 'Offerlar: mahsulot, narx, haq, EPC, tasdiq va sotilish foizi',
  })
  @ApiOkResponse({ type: AffiliateOffersPageDto })
  listOffers(
    @Query() _query: AffiliateOffersQueryDto,
  ): Promise<AffiliateOffersPageDto> {
    return notImplementedYet('BE-11');
  }

  @Post('streams')
  @ApiOperation({
    summary: 'Sotuvchi sahifasini yaratish (bitta tugma)',
    description:
      'Faqat offer ID: standart shablon, tasdiqlangan narx va unikal kod bilan tayyor havola. Qoldiq 0 bo‘lsa rad (BE-11).',
  })
  @ApiCreatedResponse({ type: AffiliateStreamDto })
  @ApiBadRequestResponse({ description: 'Qoldiq yo‘q yoki offer yopiq' })
  createStream(
    @Body() _dto: CreateAffiliateStreamDto,
  ): Promise<AffiliateStreamDto> {
    return notImplementedYet('BE-11');
  }

  @Get('streams')
  @ApiOperation({ summary: '«Mening sahifalarim»' })
  @ApiOkResponse({ type: AffiliateStreamsPageDto })
  listStreams(
    @Query() _query: AffiliatePageQueryDto,
  ): Promise<AffiliateStreamsPageDto> {
    return notImplementedYet('BE-11');
  }

  @Patch('streams/:id')
  @ApiOperation({
    summary: 'Sotuvchi sahifasi sozlamalari',
    description:
      'Shablon, narx (tasdiqlangan narxdan +10% gacha), sub1–sub5, piksellar. Sir va token faqat yoziladi.',
  })
  @ApiOkResponse({ type: AffiliateStreamDto })
  @ApiBadRequestResponse({ description: 'Narx chegaradan tashqarida' })
  @ApiNotFoundResponse({ description: 'Sahifa bu sotuvchiniki emas' })
  updateStream(
    @Param('id') _id: string,
    @Body() _dto: UpdateAffiliateStreamDto,
  ): Promise<AffiliateStreamDto> {
    return notImplementedYet('BE-11');
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Sotuvchi statistikasi: kun, sahifa yoki sub bo‘yicha',
    description:
      'Kliklar, lidlar, yaroqli, tasdiq, yetkazildi, rad, daromad. Variant, manzil va telefon yo‘q (BE-28).',
  })
  @ApiOkResponse({ type: AffiliateStatsDto })
  stats(@Query() _query: AffiliateStatsQueryDto): Promise<AffiliateStatsDto> {
    return notImplementedYet('BE-28');
  }
}
