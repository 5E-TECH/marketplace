import { Body, Controller, Get, Inject, Param, Put } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  OfferContentDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
  UpdateOfferContentDto,
} from '@app/common';
import { ParseLeadIdPipe } from './lead-id.pipe';

/**
 * Offer matnlari: suhbat skripti, afzalliklar, qutida (BE-11, FE-12; ega qarori 2026-11-17).
 * Narx, haq va kreativlar — katalog va fayl servisida (BE-07, BE-09, BE-08).
 */
@ApiTags('admin-leads')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERADMIN)
@Controller('admin/offer-content')
export class AdminOfferContentController {
  constructor(@Inject(RmqClient.LEAD) private readonly lead: ClientProxy) {}

  @Get(':productId')
  @ApiOperation({ summary: 'Offer matnlari (bo‘sh bo‘lsa bo‘sh ro‘yxatlar)' })
  @ApiOkResponse({ type: OfferContentDto })
  get(
    @Param('productId', ParseLeadIdPipe) productId: string,
  ): Promise<OfferContentDto> {
    return sendRpc(this.lead, { cmd: 'lead.offer-content.get' }, { productId });
  }

  @Put(':productId')
  @ApiOperation({
    summary: 'Offer matnlarini saqlash',
    description:
      'Suhbat skripti operator lid kartasida, afzalliklar va «qutida» sotuvchi sahifasida ko‘rinadi. Bo‘sh qatorlar tashlanadi.',
  })
  @ApiOkResponse({ type: OfferContentDto })
  update(
    @CurrentUser('sub') actorId: string,
    @Param('productId', ParseLeadIdPipe) productId: string,
    @Body() content: UpdateOfferContentDto,
  ): Promise<OfferContentDto> {
    return sendRpc(
      this.lead,
      { cmd: 'lead.offer-content.update' },
      { productId, actorId, content },
    );
  }
}
