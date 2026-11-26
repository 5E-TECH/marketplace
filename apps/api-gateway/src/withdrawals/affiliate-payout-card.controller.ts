import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadGatewayResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CurrentUser,
  PAYOUT_CARD_RPC,
  PayoutCardInfoDto,
  PayoutCardSessionDto,
  RmqClient,
  Role,
  Roles,
  sendRpc,
} from '@app/common';

/**
 * Sotuvchi kabineti: pul o‘tkaziladigan karta (BE-32; MOL-6). Karta provayder sahifasida kiritiladi — bizga va brauzer
 * orqali bizning serverga karta raqami kelmaydi; kabinetda faqat niqob.
 */
@ApiTags('affiliate')
@Roles(Role.AFFILIATE)
@ApiBearerAuth()
@Controller('affiliate/payout-card')
export class AffiliatePayoutCardController {
  constructor(
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Pul o‘tkaziladigan karta (niqob)',
    description:
      '`enabled: false` — kartaga avtomatik to‘lov hali yoqilmagan: pulni moliya qo‘lda o‘tkazadi, «Kartani ulash» ko‘rsatilmaydi.',
  })
  @ApiOkResponse({ type: PayoutCardInfoDto })
  card(@CurrentUser('sub') affiliateId: string): Promise<PayoutCardInfoDto> {
    return sendRpc(this.finance, { cmd: PAYOUT_CARD_RPC.GET }, { affiliateId });
  }

  @Post('session')
  @HttpCode(HttpStatus.OK)
  // har bosish provayderda sessiya ochadi [taklif]
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Kartani ulash: provayder sahifasi havolasi',
    description:
      'Sotuvchi shu havolaga o‘tib kartani provayder sahifasida kiritadi; karta ulangach provayder `PAYOUT_RETURN_URL` ga qaytaradi. Havola 15 daqiqa amal qiladi. Yangi karta eskisining o‘rnini oladi.',
  })
  @ApiOkResponse({ type: PayoutCardSessionDto })
  @ApiServiceUnavailableResponse({
    description: 'PAYOUT_NOT_CONFIGURED: kartaga to‘lov yoqilmagan',
  })
  @ApiBadGatewayResponse({
    description: 'PAYOUT_FAILED: provayder sahifani bermadi',
  })
  session(
    @CurrentUser('sub') affiliateId: string,
  ): Promise<PayoutCardSessionDto> {
    return sendRpc(
      this.finance,
      { cmd: PAYOUT_CARD_RPC.SESSION },
      { affiliateId },
    );
  }

  @Delete()
  @ApiOperation({
    summary: 'Kartani o‘chirish',
    description:
      'Keyingi to‘lovlar moliya tomonidan qo‘lda; allaqachon kartaga yuborilgan so‘rovga ta’sir qilmaydi.',
  })
  @ApiOkResponse({ type: PayoutCardInfoDto })
  remove(@CurrentUser('sub') affiliateId: string): Promise<PayoutCardInfoDto> {
    return sendRpc(
      this.finance,
      { cmd: PAYOUT_CARD_RPC.REMOVE },
      { affiliateId },
    );
  }
}
