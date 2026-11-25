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
  affiliateFullName,
  AffiliateProfileDto,
  AuthErrorResponseDto,
  CurrentUser,
  JwtUser,
  Role,
  Roles,
  RenameSelfEmployedResult,
  RmqClient,
  SELF_EMPLOYED_RPC,
  SelfEmployedInfoDto,
  UpdateAffiliateProfileDto,
  sendRpc,
} from '@app/common';

/**
 * BE-06 (SOT-1, FE-04): sotuvchi profili — ism-familiya, ro‘yxat sanasi, qabul qilingan oferta va rozilik
 * versiyalari; yangi versiyani qabul qilish. O‘zini o‘zi band qilganlik maqomi — moliyadan (BE-25 5-tur).
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
  @ApiOperation({
    summary: 'Ism va familiya (soliq hisoboti uchun)',
    description:
      'Ism o‘zgarsa tasdiqlangan yoki tekshirilayotgan maqom qayta tekshiruvga tushadi (PENDING), pul yechish yopiladi.',
  })
  @ApiOkResponse({ type: AffiliateProfileDto })
  @ApiBadRequestResponse({ type: AuthErrorResponseDto })
  async update(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateAffiliateProfileDto,
    @Ip() ip: string,
  ): Promise<AffiliateProfileDto> {
    // ism o‘zgarsa tasdiqlangan maqom AVVAL qayta tekshiruvga (pul yechish yopiladi), keyin ism yangilanadi:
    // yangi ism bilan eski tasdiq hech qachon birga turmasin. Moliya javob bermasa — ism ham o‘zgarmaydi.
    const { recheck, info } = await sendRpc<RenameSelfEmployedResult>(
      this.finance,
      { cmd: SELF_EMPLOYED_RPC.RENAME },
      { affiliateId: user.sub, fullName: affiliateFullName(dto) },
    );
    if (recheck)
      void sendRpc(
        this.identity,
        { cmd: 'identity.audit.log' },
        {
          actorId: user.sub,
          action: 'self-employed.recheck',
          entityType: 'User',
          entityId: user.sub,
          meta: {
            status: info.status,
            impersonatedBy: user.impersonatedBy ?? null,
            ip: ip ?? null,
          },
        },
      ).catch((e: Error) =>
        this.logger.warn(`Qayta tekshiruv auditga yozilmadi: ${e.message}`),
      );
    const profile = await sendRpc<AffiliateProfileDto>(
      this.identity,
      { cmd: AFFILIATE_AUTH_RPC.PROFILE_UPDATE },
      { userId: user.sub, dto },
    );
    return { ...profile, selfEmployed: info, card: null };
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
      const selfEmployed = await sendRpc<SelfEmployedInfoDto>(
        this.finance,
        { cmd: SELF_EMPLOYED_RPC.CURRENT },
        { affiliateId },
      );
      return { ...profile, selfEmployed, card: null };
    } catch (error) {
      this.logger.warn(`Maqom olinmadi: ${(error as Error).message}`);
      return { ...profile, card: null };
    }
  }
}
