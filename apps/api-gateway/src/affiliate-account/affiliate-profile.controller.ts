import {
  Body,
  Controller,
  Get,
  Inject,
  Ip,
  Logger,
  Patch,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  AcceptAgreementDto,
  AFFILIATE_AUTH_RPC,
  AffiliateProfileDto,
  AuthErrorResponseDto,
  CurrentUser,
  FINANCE_WITHDRAWAL_RPC,
  JwtUser,
  Role,
  Roles,
  RmqClient,
  UpdateAffiliateProfileDto,
  sendRpc,
} from '@app/common';

/**
 * BE-06 (SOT-1, FE-04): sotuvchi profili — ism-familiya, ro‘yxat sanasi, qabul qilingan oferta va rozilik
 * versiyalari; yangi versiyani qabul qilish. O‘zini o‘zi band qilganlik belgisi — moliyadan (BE-23).
 */
@ApiTags('affiliate')
@ApiBearerAuth()
@Roles(Role.AFFILIATE)
@Controller('affiliate')
export class AffiliateProfileController {
  private readonly logger = new Logger(AffiliateProfileController.name);

  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    @Inject(RmqClient.FINANCE) private readonly finance: ClientProxy,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Sotuvchi profili' })
  @ApiOkResponse({ type: AffiliateProfileDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiForbiddenResponse({ type: AuthErrorResponseDto })
  async profile(@CurrentUser() user: JwtUser): Promise<AffiliateProfileDto> {
    const profile = await sendRpc<AffiliateProfileDto>(
      this.identity,
      { cmd: AFFILIATE_AUTH_RPC.PROFILE_GET },
      { userId: user.sub },
    );
    return this.withSelfEmployed(user.sub, profile);
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Ism va familiya (soliq hisoboti uchun)' })
  @ApiOkResponse({ type: AffiliateProfileDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  async update(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateAffiliateProfileDto,
  ): Promise<AffiliateProfileDto> {
    const profile = await sendRpc<AffiliateProfileDto>(
      this.identity,
      { cmd: AFFILIATE_AUTH_RPC.PROFILE_UPDATE },
      { userId: user.sub, dto },
    );
    return this.withSelfEmployed(user.sub, profile);
  }

  @Post('agreements')
  @ApiOperation({
    summary:
      'Ofertaning (yoki rozilikning) yangi versiyasini qabul qilish — versiya va vaqt saqlanadi',
  })
  @ApiOkResponse({ type: AffiliateProfileDto })
  @ApiBadRequestResponse({
    description: 'OFFER_NOT_ACCEPTED — joriy versiya emas',
    type: AuthErrorResponseDto,
  })
  async accept(
    @CurrentUser() user: JwtUser,
    @Body() dto: AcceptAgreementDto,
    @Ip() ip: string,
  ): Promise<AffiliateProfileDto> {
    const profile = await sendRpc<AffiliateProfileDto>(
      this.identity,
      { cmd: AFFILIATE_AUTH_RPC.AGREEMENT_ACCEPT },
      { userId: user.sub, dto, ip: ip ?? null },
    );
    return this.withSelfEmployed(user.sub, profile);
  }

  /** Moliya javob bermasa profil baribir qaytadi (maqom ko‘rsatilmaydi). */
  private async withSelfEmployed(
    affiliateId: string,
    profile: AffiliateProfileDto,
  ): Promise<AffiliateProfileDto> {
    try {
      const balance = await sendRpc<{ selfEmployed: boolean }>(
        this.finance,
        { cmd: FINANCE_WITHDRAWAL_RPC.BALANCE },
        { affiliateId },
      );
      return {
        ...profile,
        selfEmployed: {
          status: balance?.selfEmployed ? 'VERIFIED' : 'NOT_SUBMITTED',
        },
        card: null,
      };
    } catch (error) {
      this.logger.warn(`Maqom olinmadi: ${(error as Error).message}`);
      return { ...profile, card: null };
    }
  }
}
