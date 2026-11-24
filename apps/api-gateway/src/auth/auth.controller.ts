import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Ip,
  Optional,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { AllowStaleToken } from './current-role.guard';
import type { Request, Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ACCESS_TOKEN_COOKIE,
  AFFILIATE_AUTH_RPC,
  TwoFactorChallengeDto,
  TwoFactorChallengeResultDto,
  TwoFactorEnableDto,
  TwoFactorSetupResultDto,
  TwoFactorVerifyDto,
  AuthErrorResponseDto,
  CurrentUserDto,
  OtpPurpose,
  OtpSendResultDto,
  RegisterAffiliateDto,
  RegisterWholesalerDto,
  SendOtpDto,
  VerifyOtpDto,
  AuthSuccessResponseDto,
  ForgotPasswordDto,
  CurrentUser,
  IgnoreAuthCookie,
  JwtUser,
  LoginDto,
  RefreshTokenDto,
  ResetPasswordDto,
  LoginSuccessResponseDto,
  LogoutSuccessResponseDto,
  Public,
  RegisterDto,
  RmqClient,
  UpdateProfileDto,
  VerifyPhoneDto,
  rawResponse,
  readCookie,
  sendRpc,
  WHOLESALER_CABINET_RPC,
} from '@app/common';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private static readonly REFRESH_COOKIE_NAME = 'refreshToken';
  private static readonly REFRESH_COOKIE_PATH = '/api/v1/auth';
  private static readonly ACCESS_COOKIE_PATH = '/api/v1';
  private static readonly FALLBACK_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    private readonly jwt: JwtService,
    @Optional() private readonly config?: ConfigService,
    // BE-30: optovik ro‘yxati optovik yozuvini catalog da ochadi
    @Optional()
    @Inject(RmqClient.CATALOG)
    private readonly catalog?: ClientProxy,
  ) {}

  /**
   * `AUTH_TOKENS_IN_BODY=false` — tokenlar faqat HttpOnly cookie'da. Body'da
   * qolsa XSS `POST /auth/refresh`ni chaqirib access tokenni o'qib olishi
   * mumkin; frontend cookie rejimiga o'tgach o'chiriladi.
   */
  private get tokensInBody(): boolean {
    return String(this.config?.get('AUTH_TOKENS_IN_BODY') ?? true) !== 'false';
  }

  /**
   * Cookie bayroqlari NODE_ENV emas, so'rovning haqiqiy protokoli bo'yicha
   * tanlanadi. Sababi: `Secure` cookie'ni brauzer HTTP orqali umuman
   * saqlamaydi, `SameSite=None` esa `Secure`siz rad etiladi. Domen hali
   * olinmagan va API HTTP orqali ishlayotgan bo'lsa, qat'iy qiymatlar
   * refresh oqimini butunlay ishlamas holga keltirardi.
   *
   * HTTPS'da: `Secure` + `SameSite=None` — boshqa domendagi kabinet ham
   * cookie'ni yubora oladi. HTTP'da: `SameSite=Lax` — port farq qilsa ham
   * brauzer buni bir xil sayt deb hisoblaydi, shuning uchun ishlaydi.
   */
  private static isHttps(request: Request): boolean {
    return request.secure || request.headers['x-forwarded-proto'] === 'https';
  }

  /**
   * Access cookie refresh bilan birga yashaydi (uning `exp`i emas): muddati
   * o'tgan access baribir yuboriladi va guard 401 qaytaradi — frontend xuddi
   * Bearer rejimidagidek refresh qiladi. Aks holda brauzer cookie'ni jim
   * tashlab yuborar, @Public() route'lar esa xaridorni anonim deb bilardi.
   */
  private setAuthCookies(
    request: Request,
    response: Response,
    tokens: { accessToken: string; refreshToken: string },
  ): void {
    const decoded = this.jwt.decode(tokens.refreshToken) as {
      exp?: number;
    } | null;
    const expiresAt = decoded?.exp
      ? decoded.exp * 1000
      : Date.now() + AuthController.FALLBACK_REFRESH_TTL_MS;
    const https = AuthController.isHttps(request);
    const options = {
      httpOnly: true,
      secure: https,
      sameSite: https ? ('none' as const) : ('lax' as const),
      maxAge: Math.max(1, expiresAt - Date.now()),
    };

    response.cookie(AuthController.REFRESH_COOKIE_NAME, tokens.refreshToken, {
      ...options,
      path: AuthController.REFRESH_COOKIE_PATH,
    });
    response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...options,
      path: AuthController.ACCESS_COOKIE_PATH,
    });
  }

  private clearAuthCookies(request: Request, response: Response): void {
    const https = AuthController.isHttps(request);
    const options = {
      httpOnly: true,
      secure: https,
      sameSite: https ? ('none' as const) : ('lax' as const),
    };
    response.clearCookie(AuthController.REFRESH_COOKIE_NAME, {
      ...options,
      path: AuthController.REFRESH_COOKIE_PATH,
    });
    response.clearCookie(ACCESS_TOKEN_COOKIE, {
      ...options,
      path: AuthController.ACCESS_COOKIE_PATH,
    });
  }

  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @ApiOperation({ summary: 'Yangi foydalanuvchini ro‘yxatdan o‘tkazish' })
  @ApiCreatedResponse({
    description: 'Foydalanuvchi yaratildi, access va refresh token qaytarildi',
    type: AuthSuccessResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request body validatsiyadan o‘tmadi',
    type: AuthErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Telefon raqami allaqachon ro‘yxatdan o‘tgan',
    type: AuthErrorResponseDto,
  })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await sendRpc<{
      accessToken: string;
      refreshToken: string;
    }>(this.identity, { cmd: 'auth.register' }, dto);
    this.setAuthCookies(request, response, result);
    if (this.tokensInBody) return result;
    const { accessToken: _access, refreshToken: _refresh, ...rest } = result;
    return rest;
  }

  // ---------------------------------------------------------------- BE-06: SMS kod (SOT-1, FE-04)

  @Public()
  @IgnoreAuthCookie()
  // IP bo‘yicha cheklov `resend-code` bilan bir xil (SMS pul turadi)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('otp/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'SMS kod yuborish: REGISTER — sotuvchi ro‘yxati, LOGIN — sotuvchi va optovik kirishi (kod 5 daqiqa)',
  })
  @ApiOkResponse({ type: OtpSendResultDto })
  @ApiBadRequestResponse({
    description:
      'PHONE_OPERATOR_INVALID — raqam O‘zbekiston mobil operatoriniki emas',
    type: AuthErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'PHONE_ALREADY_REGISTERED (REGISTER)',
    type: AuthErrorResponseDto,
  })
  @ApiResponse({ status: 404, description: 'ACCOUNT_NOT_FOUND (LOGIN)' })
  @ApiResponse({
    status: 423,
    description:
      'OTP_BLOCKED — 3 xatodan keyin 15 daqiqa; `retryAfterSeconds`, `Retry-After`',
  })
  sendOtp(@Body() dto: SendOtpDto): Promise<OtpSendResultDto> {
    return sendRpc(this.identity, { cmd: AFFILIATE_AUTH_RPC.OTP_SEND }, dto);
  }

  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'SMS kodni tekshirish: REGISTER → bir martalik `registrationToken`; LOGIN → kirish (`/auth/login` kabi, cookie)',
  })
  @ApiOkResponse({
    schema: {
      example: { registrationToken: 'eyJhbGciOiJIUzI1NiIs…' },
    },
  })
  @ApiBadRequestResponse({
    description: 'OTP_INVALID — kod noto‘g‘ri; `attemptsLeft`',
    type: AuthErrorResponseDto,
  })
  @ApiResponse({
    status: 410,
    description: 'OTP_EXPIRED — muddati o‘tgan yoki so‘ralmagan',
  })
  @ApiResponse({
    status: 423,
    description: 'OTP_BLOCKED — `retryAfterSeconds`',
  })
  async verifyOtp(
    @Body() dto: VerifyOtpDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await sendRpc<
      | { registrationToken: string }
      | { accessToken: string; refreshToken: string }
    >(this.identity, { cmd: AFFILIATE_AUTH_RPC.OTP_VERIFY }, dto);
    if (dto.purpose === OtpPurpose.REGISTER || 'registrationToken' in result)
      return result;
    this.setAuthCookies(request, response, result);
    return rawResponse({
      accessToken: this.tokensInBody ? result.accessToken : null,
    });
  }

  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register/wholesaler')
  @ApiOperation({
    summary:
      'Optovik ro‘yxati (OPT-1): SMS tasdig‘idan keyin rekvizitlar, komissiya shartnomasi va rozilik; sessiya ochiladi, holat PENDING (admin tasdiqlaydi)',
  })
  @ApiCreatedResponse({
    description:
      'profileCompleted false — foydalanuvchi yaratildi, optovik yozuvi ochilmadi (masalan, STIR band): kabinetda POST /wholesaler/profile',
    schema: {
      example: {
        accessToken: null,
        profileCompleted: true,
        profileError: null,
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'OFFER_NOT_ACCEPTED — shartnoma yoki rozilikning joriy versiyasi qabul qilinmagan',
    type: AuthErrorResponseDto,
  })
  @ApiConflictResponse({
    description:
      'PHONE_ALREADY_REGISTERED; shartnoma matni hali e’lon qilinmagan',
    type: AuthErrorResponseDto,
  })
  @ApiResponse({
    status: 410,
    description: 'REGISTRATION_EXPIRED — telefonni qayta tasdiqlang',
  })
  async registerWholesaler(
    @Body() dto: RegisterWholesalerDto,
    @Ip() ip: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { registrationToken, contractVersion, consentVersion, ...profile } =
      dto;
    // avval SMS token (identity tekshiradi) — STIR bandligini tokensiz so‘rab bo‘lmasin
    const result = await sendRpc<{
      accessToken: string;
      refreshToken: string;
      user: { id: string | number; phone: string };
    }>(
      this.identity,
      { cmd: WHOLESALER_CABINET_RPC.REGISTER_USER },
      {
        dto: {
          registrationToken,
          contractVersion,
          consentVersion,
          name: profile.name,
        },
        ip: ip ?? null,
      },
    );
    this.setAuthCookies(request, response, result);
    // optovik yozuvi ochilmasa (STIR band va h.k.) — sessiya baribir beriladi, kabinetda POST /wholesaler/profile
    let profileError: string | null = null;
    try {
      await sendRpc(
        this.catalog!,
        { cmd: WHOLESALER_CABINET_RPC.SELF_REGISTER },
        {
          ...profile,
          ownerUserId: String(result.user.id),
          phone: result.user.phone,
          contractVersion,
        },
      );
    } catch (error) {
      if (!(error instanceof HttpException)) throw error;
      profileError = error.message;
    }
    return rawResponse({
      accessToken: this.tokensInBody ? result.accessToken : null,
      profileCompleted: profileError === null,
      profileError,
    });
  }

  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register/affiliate')
  @ApiOperation({
    summary:
      'Sotuvchi ro‘yxati: SMS tasdig‘idan keyin oferta va rozilik versiyasi bilan; sessiya darhol ochiladi',
  })
  @ApiCreatedResponse({ schema: { example: { accessToken: null } } })
  @ApiBadRequestResponse({
    description:
      'OFFER_NOT_ACCEPTED — oferta yoki rozilikning joriy versiyasi qabul qilinmagan',
    type: AuthErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'PHONE_ALREADY_REGISTERED',
    type: AuthErrorResponseDto,
  })
  @ApiResponse({
    status: 410,
    description: 'REGISTRATION_EXPIRED — telefonni qayta tasdiqlang',
  })
  async registerAffiliate(
    @Body() dto: RegisterAffiliateDto,
    @Ip() ip: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await sendRpc<{ accessToken: string; refreshToken: string }>(
      this.identity,
      { cmd: AFFILIATE_AUTH_RPC.REGISTER },
      { dto, ip: ip ?? null },
    );
    this.setAuthCookies(request, response, result);
    return rawResponse({
      accessToken: this.tokensInBody ? result.accessToken : null,
    });
  }

  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Telefon va parol orqali tizimga kirish' })
  @ApiCreatedResponse({
    description:
      'Login muvaffaqiyatli; access token body’da va HttpOnly accessToken ' +
      'cookie’da, refresh token HttpOnly cookie’da qaytarildi',
    type: LoginSuccessResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'HttpOnly accessToken va refreshToken cookie',
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Request body validatsiyadan o‘tmadi',
    type: AuthErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Telefon yoki parol xato',
    type: AuthErrorResponseDto,
  })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await sendRpc<
      | { user: unknown; accessToken: string; refreshToken: string }
      | TwoFactorChallengeResultDto
    >(this.identity, { cmd: 'auth.login' }, dto);

    // BE-26: admin va moliya (ADMIN_2FA=on) — sessiya yo‘q, keyingi qadam 2FA kodi; cookie yozilmaydi
    if ('challengeToken' in result) return rawResponse(result);
    this.setAuthCookies(request, response, result);
    return rawResponse(
      this.tokensInBody ? { accessToken: result.accessToken } : {},
    );
  }

  // ---------------------------------------------------------------- BE-26: xodim 2FA (TOTP)

  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '2FA ni ulash: QR uchun sir va otpauth havola (parol bosqichidagi challengeToken bilan)',
  })
  @ApiOkResponse({ type: TwoFactorSetupResultDto })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  @ApiConflictResponse({
    description: '2FA allaqachon ulangan',
    type: AuthErrorResponseDto,
  })
  setupTwoFactor(
    @Body() dto: TwoFactorChallengeDto,
  ): Promise<TwoFactorSetupResultDto> {
    return sendRpc(this.identity, { cmd: 'auth.2fa.setup' }, dto);
  }

  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '2FA ni yoqish: birinchi kod → bir martalik tiklash kodlari (faqat shu javobda) va sessiya',
  })
  @ApiOkResponse({
    schema: { example: { recoveryCodes: ['K7QM2XPA4D'], accessToken: null } },
  })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  async enableTwoFactor(
    @Body() dto: TwoFactorEnableDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await sendRpc<{
      recoveryCodes: string[];
      accessToken: string;
      refreshToken: string;
    }>(this.identity, { cmd: 'auth.2fa.enable' }, dto);
    this.setAuthCookies(request, response, result);
    return rawResponse({
      recoveryCodes: result.recoveryCodes,
      accessToken: this.tokensInBody ? result.accessToken : null,
    });
  }

  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Kirish: 2FA kodi yoki tiklash kodi → sessiya (3 xato → 15 daqiqa blok)',
  })
  @ApiOkResponse({ schema: { example: { accessToken: null } } })
  @ApiUnauthorizedResponse({ type: AuthErrorResponseDto })
  async verifyTwoFactor(
    @Body() dto: TwoFactorVerifyDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await sendRpc<{ accessToken: string; refreshToken: string }>(
      this.identity,
      { cmd: 'auth.2fa.verify' },
      dto,
    );
    this.setAuthCookies(request, response, result);
    return rawResponse({
      accessToken: this.tokensInBody ? result.accessToken : null,
    });
  }

  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sessiyani yangilash (refresh token cookie’dan yoki body’dan)',
  })
  @ApiOkResponse({
    description:
      'Yangi tokenlar HttpOnly cookie’da; access token body’da ham (sukut), `AUTH_TOKENS_IN_BODY=false` bo‘lsa — `{}`',
    type: LoginSuccessResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'HttpOnly accessToken va refreshToken cookie',
        schema: { type: 'string' },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'Refresh token yaroqsiz yoki muddati o‘tgan (cookie’lar tozalanadi)',
    type: AuthErrorResponseDto,
  })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookie = readCookie(req.headers, AuthController.REFRESH_COOKIE_NAME);
    let result: { accessToken: string; refreshToken: string };
    try {
      result = await sendRpc(
        this.identity,
        { cmd: 'auth.refresh' },
        { refreshToken: dto.refreshToken ?? cookie ?? '' },
      );
    } catch (error) {
      // HttpOnly cookie'ni JS o'chira olmaydi. Refresh o'lgan bo'lsa eski
      // access cookie har so'rovda 401 berib qolmasligi uchun shu yerda tozalaymiz.
      this.clearAuthCookies(req, res);
      throw error;
    }
    this.setAuthCookies(req, res, result);
    return rawResponse(
      this.tokensInBody ? { accessToken: result.accessToken } : {},
    );
  }
  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Parolni tiklash kodi (SMS)' })
  @ApiOkResponse({
    description:
      'Kod SMS da yuborildi (`expiresIn` — soniya). Raqam ro‘yxatda bo‘lmasa ham javob bir xil — raqamlar tekshirib chiqilmasin',
    schema: { example: { sent: true, expiresIn: 300 } },
  })
  forgot(@Body() dto: ForgotPasswordDto) {
    return sendRpc(this.identity, { cmd: 'auth.forgot-password' }, dto);
  }
  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SMS kodi bilan yangi parol o‘rnatish' })
  @ApiOkResponse({
    description: 'Parol yangilandi, eski sessiyalar bekor',
    schema: { example: { reset: true } },
  })
  reset(@Body() dto: ResetPasswordDto) {
    return sendRpc(this.identity, { cmd: 'auth.reset-password' }, dto);
  }
  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-phone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Telefon raqamini SMS kodi bilan tasdiqlash' })
  @ApiOkResponse({ schema: { example: { verified: true } } })
  verify(@Body() dto: VerifyPhoneDto) {
    return sendRpc(this.identity, { cmd: 'auth.verify-phone' }, dto);
  }
  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('resend-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Telefonni tasdiqlash kodini qayta yuborish' })
  @ApiOkResponse({
    description:
      'Kod SMS da yuborildi (`expiresIn` — soniya). Raqam ro‘yxatda bo‘lmasa ham javob bir xil — raqamlar tekshirib chiqilmasin',
    schema: { example: { sent: true, expiresIn: 300 } },
  })
  resend(@Body() dto: ForgotPasswordDto) {
    return sendRpc(this.identity, { cmd: 'auth.resend-code' }, dto);
  }
  @Get('sessions')
  @ApiOperation({ summary: 'Mening sessiyalarim (yangisi tepada)' })
  @ApiOkResponse({
    description:
      '`active` — bekor qilinmagan va muddati o‘tmagan; `current` hozircha har doim false',
    schema: {
      example: [
        {
          id: '9b1f0c2e-6d4a-4c8e-9f3b-2a7d5e1c4b60',
          createdAt: '2026-12-01T08:00:00.000Z',
          expiresAt: '2026-12-08T08:00:00.000Z',
          current: false,
          active: true,
        },
      ],
    },
  })
  sessions(@CurrentUser() user: JwtUser) {
    return sendRpc(
      this.identity,
      { cmd: 'auth.sessions.list' },
      { userId: user.sub },
    );
  }
  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Sessiyani bekor qilish' })
  @ApiOkResponse({
    schema: {
      example: { id: '9b1f0c2e-6d4a-4c8e-9f3b-2a7d5e1c4b60', revoked: true },
    },
  })
  @ApiBadRequestResponse({
    description:
      'ID UUID emas, sessiya topilmadi yoki allaqachon bekor qilingan',
    type: AuthErrorResponseDto,
  })
  revoke(
    @CurrentUser() user: JwtUser,
    // sessiya ID si — UUID (auth_session.id); boshqa qiymat bazada 22P02 (500) berardi
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return sendRpc(
      this.identity,
      { cmd: 'auth.sessions.revoke' },
      { userId: user.sub, sessionId: id },
    );
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Joriy foydalanuvchini olish' })
  @ApiOkResponse({ type: CurrentUserDto })
  me(@CurrentUser() user: JwtUser) {
    return sendRpc(this.identity, { cmd: 'auth.me' }, { userId: user.sub });
  }

  @ApiBearerAuth()
  @Patch('profile')
  @ApiOperation({
    summary: 'Joriy foydalanuvchi o‘z profili yoki parolini yangilashi',
  })
  @ApiOkResponse({
    description: 'Yangilangan profil (parol xeshi qaytmaydi)',
    type: CurrentUserDto,
  })
  updateProfile(@CurrentUser() user: JwtUser, @Body() dto: UpdateProfileDto) {
    // Telefon ham: yangi telefonga parol tiklash orqali hisob egallanardi (BE-05 tekshiruvi)
    if (
      user.impersonatedBy &&
      (dto.password !== undefined || dto.phone !== undefined)
    ) {
      throw new ForbiddenException(
        'Impersonation rejimida parol yoki telefonni o‘zgartirish taqiqlangan',
      );
    }
    return sendRpc(
      this.identity,
      { cmd: 'auth.profile.update' },
      { userId: user.sub, dto },
    );
  }

  @ApiBearerAuth()
  @Post('logout')
  @AllowStaleToken() // BE-05: bloklangan foydalanuvchi ham chiqib, cookie'larini tozalaydi
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh tokenni bekor qilib tizimdan chiqish' })
  @ApiOkResponse({
    description:
      'Logout bajarildi va foydalanuvchining barcha refresh sessiyalari bekor qilindi',
    type: LogoutSuccessResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Access token yaroqsiz',
    type: AuthErrorResponseDto,
  })
  async logout(
    @CurrentUser() user: JwtUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await sendRpc(
      this.identity,
      { cmd: 'auth.logout' },
      {
        userId: user.sub,
      },
    );
    this.clearAuthCookies(request, response);
    return result;
  }
}
