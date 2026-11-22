import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AffiliateApiKeyCreatedDto,
  AffiliateApiKeyDto,
  AffiliateCapiDeliveriesPageDto,
  AffiliateLeadsPageDto,
  AffiliateLeadsQueryDto,
  AffiliateOffersPageDto,
  AffiliateOffersQueryDto,
  AffiliatePageQueryDto,
  AffiliatePostbacksPageDto,
  AffiliatePostbacksQueryDto,
  AffiliateStatsDto,
  AffiliateStatsQueryDto,
  AffiliateStreamDto,
  AffiliateStreamsPageDto,
  CreateAffiliateStreamDto,
  CurrentUser,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  UpdateAffiliateStreamDto,
  AffiliateOfferDetailDto,
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';

/**
 * Sotuvchi (AFFILIATE) kabineti API si (BE-25 shartnomasi).
 * Real kod: BE-11 (offer va sahifa), BE-28 (statistika va lidlar ro‘yxati).
 * Faqat sotuvchi (BE-05). Shaxsiy kabinet: superadmin ham bu yerda emas — u sotuvchi ma’lumotini admin yo‘llarida
 * ko‘radi (sotuvchi ID si tokendan, `sub`).
 */
@ApiTags('affiliate')
@Roles(Role.AFFILIATE)
@ApiBearerAuth()
@Controller('affiliate')
export class AffiliateStreamsController {
  constructor(@Inject(RmqClient.LEAD) private readonly lead: ClientProxy) {}

  @Get('offers')
  @ApiOperation({
    summary: 'Offerlar: mahsulot, narx, haq, EPC, tasdiq va sotilish foizi',
  })
  @ApiOkResponse({ type: AffiliateOffersPageDto })
  listOffers(
    @Query() query: AffiliateOffersQueryDto,
  ): Promise<AffiliateOffersPageDto> {
    return sendRpc(this.lead, { cmd: 'lead.offer.list' }, { query });
  }

  /** BE-08 (QA TC5): offer kartasi — kreativlar ochiq havola bilan (sotuvchi videoni ko‘radi). */
  @Get('offers/:productId')
  @ApiOperation({
    summary: 'Offer kartasi: tafsilot va kreativlar',
    description:
      'Ro‘yxat maydonlari va tafsilot (kategoriya, tavsif, og‘irlik, yetkazish, BAD, holat, kreativlar). Katalogda hali bo‘lmagan qismlar (yetkazish rejimi, narx taqsimoti, hamma sotuvchilar natijasi) — null. Yopiq offer — 404.',
  })
  @ApiOkResponse({ type: AffiliateOfferDetailDto })
  @ApiNotFoundResponse({ description: 'Offer topilmadi yoki yopiq' })
  getOffer(
    @Param('productId', ParseLeadIdPipe) productId: string,
  ): Promise<AffiliateOfferDetailDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.offer.get-affiliate' },
      { productId },
    );
  }

  @Post('streams')
  @ApiOperation({
    summary: 'Sotuvchi sahifasini yaratish (bitta tugma)',
    description:
      'Faqat offer ID: standart shablon, tasdiqlangan narx va unikal kod bilan tayyor havola. Qoldiq 0 bo‘lsa rad (BE-11).',
  })
  @ApiCreatedResponse({ type: AffiliateStreamDto })
  @ApiNotFoundResponse({ description: 'Offer topilmadi' })
  @ApiConflictResponse({ description: 'Qoldiq yo‘q yoki offer yopiq' })
  createStream(
    @CurrentUser('sub') affiliateId: string,
    @Body() dto: CreateAffiliateStreamDto,
  ): Promise<AffiliateStreamDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.stream.create' },
      { affiliateId, productId: dto.productId },
    );
  }

  @Get('streams')
  @ApiOperation({ summary: '«Mening sahifalarim»' })
  @ApiOkResponse({ type: AffiliateStreamsPageDto })
  listStreams(
    @CurrentUser('sub') affiliateId: string,
    @Query() query: AffiliatePageQueryDto,
  ): Promise<AffiliateStreamsPageDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.stream.list' },
      { affiliateId, page: query.page, limit: query.limit },
    );
  }

  @Patch('streams/:id')
  @ApiOperation({
    summary: 'Sotuvchi sahifasi sozlamalari',
    description:
      'Shablon, narx (tasdiqlangan narxdan +10% gacha), sub1–sub5, piksellar. Sir va token faqat yoziladi.',
  })
  @ApiOkResponse({ type: AffiliateStreamDto })
  @ApiBadRequestResponse({ description: 'Narx chegaradan tashqarida' })
  @ApiConflictResponse({ description: 'Offer narxi tasdiqlanmagan' })
  @ApiNotFoundResponse({ description: 'Sahifa bu sotuvchiniki emas' })
  updateStream(
    @CurrentUser('sub') affiliateId: string,
    @Param('id', ParseLeadIdPipe) streamId: string,
    @Body() patch: UpdateAffiliateStreamDto,
  ): Promise<AffiliateStreamDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.stream.update' },
      { affiliateId, streamId, patch },
    );
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Sotuvchi statistikasi: kun, sahifa yoki sub bo‘yicha',
    description:
      'Kliklar, lidlar, yaroqli, tasdiq, yetkazildi, rad, daromad. Variant, manzil va telefon yo‘q (BE-28).',
  })
  @ApiOkResponse({ type: AffiliateStatsDto })
  stats(
    @CurrentUser('sub') affiliateId: string,
    @Query() query: AffiliateStatsQueryDto,
  ): Promise<AffiliateStatsDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.stats.affiliate' },
      { affiliateId, query },
    );
  }

  @Get('leads')
  @ApiOperation({
    summary: 'Sotuvchining lidlari: CSV manbasi',
    description:
      'Har lid: keldi, sahifa, sub, raqam ****4567, lid va buyurtma holati, haq. ' +
      'Ism, manzil, to‘liq raqam va variant yo‘q. CSV ni frontend umumiy yuklab olish bilan yig‘adi (BE-28 TC2, FE-06 TC2).',
  })
  @ApiOkResponse({ type: AffiliateLeadsPageDto })
  listLeads(
    @CurrentUser('sub') affiliateId: string,
    @Query() query: AffiliateLeadsQueryDto,
  ): Promise<AffiliateLeadsPageDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.stats.affiliate-leads' },
      { affiliateId, query },
    );
  }

  @Get('capi-deliveries')
  @ApiOperation({
    summary:
      'Meta CAPI yuborish jurnali: Lead va Purchase, holat va xato sababi (BE-31)',
  })
  @ApiOkResponse({ type: AffiliateCapiDeliveriesPageDto })
  capiDeliveries(
    @CurrentUser('sub') affiliateId: string,
    @Query() query: AffiliatePostbacksQueryDto,
  ): Promise<AffiliateCapiDeliveriesPageDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.capi.journal' },
      {
        affiliateId,
        query: {
          page: query.page,
          limit: query.limit,
          streamId: query.streamId,
        },
      },
    );
  }

  @Get('postbacks')
  @ApiOperation({
    summary:
      'Yuborilganlar jurnali: postback hodisalari va javob kodlari (BE-14)',
  })
  @ApiOkResponse({ type: AffiliatePostbacksPageDto })
  postbacks(
    @CurrentUser('sub') affiliateId: string,
    @Query() query: AffiliatePostbacksQueryDto,
  ): Promise<AffiliatePostbacksPageDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.postback.journal' },
      {
        affiliateId,
        query: {
          page: query.page,
          limit: query.limit,
          streamId: query.streamId,
        },
      },
    );
  }

  @Get('api-keys')
  @ApiOperation({ summary: 'Lid API kalitlarim (BE-43, SOT-6)' })
  @ApiOkResponse({ type: [AffiliateApiKeyDto] })
  listApiKeys(
    @CurrentUser('sub') affiliateId: string,
  ): Promise<AffiliateApiKeyDto[]> {
    return sendRpc(this.lead, { cmd: 'lead.api-key.list' }, { affiliateId });
  }

  @Post('api-keys')
  @ApiOperation({
    summary: 'Yangi lid API kaliti',
    description:
      'To‘liq kalit faqat shu javobda ko‘rsatiladi; bazada faqat xeshi saqlanadi.',
  })
  @ApiCreatedResponse({ type: AffiliateApiKeyCreatedDto })
  createApiKey(
    @CurrentUser('sub') affiliateId: string,
  ): Promise<AffiliateApiKeyCreatedDto> {
    return sendRpc(this.lead, { cmd: 'lead.api-key.create' }, { affiliateId });
  }

  @Delete('api-keys/:id')
  @ApiOperation({ summary: 'Kalitni bekor qilish — darhol ishlamaydi' })
  @ApiOkResponse({ type: AffiliateApiKeyDto })
  @ApiNotFoundResponse({ description: 'Kalit topilmadi' })
  revokeApiKey(
    @CurrentUser('sub') affiliateId: string,
    @Param('id', ParseLeadIdPipe) id: string,
  ): Promise<AffiliateApiKeyDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.api-key.revoke' },
      { affiliateId, id },
    );
  }
}
