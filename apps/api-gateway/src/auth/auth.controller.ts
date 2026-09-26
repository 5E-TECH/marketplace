import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ACCESS_TOKEN_COOKIE,
  AuthErrorResponseDto,
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
    const result = await sendRpc<{
      user: unknown;
      accessToken: string;
      refreshToken: string;
    }>(this.identity, { cmd: 'auth.login' }, dto);

    this.setAuthCookies(request, response, result);
    return rawResponse(
      this.tokensInBody ? { accessToken: result.accessToken } : {},
    );
  }

  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
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
  forgot(@Body() dto: ForgotPasswordDto) {
    return sendRpc(this.identity, { cmd: 'auth.forgot-password' }, dto);
  }
  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  reset(@Body() dto: ResetPasswordDto) {
    return sendRpc(this.identity, { cmd: 'auth.reset-password' }, dto);
  }
  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-phone')
  @HttpCode(HttpStatus.OK)
  verify(@Body() dto: VerifyPhoneDto) {
    return sendRpc(this.identity, { cmd: 'auth.verify-phone' }, dto);
  }
  @Public()
  @IgnoreAuthCookie()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('resend-code')
  @HttpCode(HttpStatus.OK)
  resend(@Body() dto: ForgotPasswordDto) {
    return sendRpc(this.identity, { cmd: 'auth.resend-code' }, dto);
  }
  @Get('sessions') sessions(@CurrentUser() user: JwtUser) {
    return sendRpc(
      this.identity,
      { cmd: 'auth.sessions.list' },
      { userId: user.sub },
    );
  }
  @Delete('sessions/:id') revoke(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
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
  me(@CurrentUser() user: JwtUser) {
    return sendRpc(this.identity, { cmd: 'auth.me' }, { userId: user.sub });
  }

  @ApiBearerAuth()
  @Patch('profile')
  @ApiOperation({
    summary: 'Joriy foydalanuvchi o‘z profili yoki parolini yangilashi',
  })
  @ApiOkResponse({ description: 'Yangilangan profil (passwordHash qaytmaydi)' })
  updateProfile(@CurrentUser() user: JwtUser, @Body() dto: UpdateProfileDto) {
    if (user.impersonatedBy && dto.password !== undefined) {
      throw new ForbiddenException(
        'Impersonation rejimida parolni o‘zgartirish taqiqlangan',
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
