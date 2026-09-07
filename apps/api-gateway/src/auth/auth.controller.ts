import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
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
  AuthErrorResponseDto,
  AuthSuccessResponseDto,
  ForgotPasswordDto,
  CurrentUser,
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
  sendRpc,
} from '@app/common';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private static readonly REFRESH_COOKIE_NAME = 'refreshToken';
  private static readonly REFRESH_COOKIE_PATH = '/api/v1/auth';
  private static readonly FALLBACK_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
    private readonly jwt: JwtService,
  ) {}

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

  private setRefreshCookie(
    request: Request,
    response: Response,
    refreshToken: string,
  ): void {
    const decoded = this.jwt.decode(refreshToken) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? decoded.exp * 1000
      : Date.now() + AuthController.FALLBACK_REFRESH_TTL_MS;
    const https = AuthController.isHttps(request);

    response.cookie(AuthController.REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: https,
      sameSite: https ? 'none' : 'lax',
      path: AuthController.REFRESH_COOKIE_PATH,
      maxAge: Math.max(1, expiresAt - Date.now()),
    });
  }

  private clearRefreshCookie(request: Request, response: Response): void {
    const https = AuthController.isHttps(request);
    response.clearCookie(AuthController.REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: https,
      sameSite: https ? 'none' : 'lax',
      path: AuthController.REFRESH_COOKIE_PATH,
    });
  }

  @Public()
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
  register(@Body() dto: RegisterDto) {
    return sendRpc(this.identity, { cmd: 'auth.register' }, dto);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @ApiOperation({ summary: 'Telefon va parol orqali tizimga kirish' })
  @ApiCreatedResponse({
    description:
      'Login muvaffaqiyatli; access token body’da, refresh token HttpOnly cookie’da qaytarildi',
    type: LoginSuccessResponseDto,
    headers: {
      'Set-Cookie': {
        description: 'HttpOnly refreshToken cookie',
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

    this.setRefreshCookie(request, response, result.refreshToken);
    return rawResponse({
      accessToken: result.accessToken,
    });
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookie = req.headers.cookie
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('refreshToken='))
      ?.slice('refreshToken='.length);
    const result = await sendRpc<{ accessToken: string; refreshToken: string }>(
      this.identity,
      { cmd: 'auth.refresh' },
      {
        refreshToken:
          dto.refreshToken ?? (cookie ? decodeURIComponent(cookie) : ''),
      },
    );
    this.setRefreshCookie(req, res, result.refreshToken);
    return rawResponse({ accessToken: result.accessToken });
  }
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgot(@Body() dto: ForgotPasswordDto) {
    return sendRpc(this.identity, { cmd: 'auth.forgot-password' }, dto);
  }
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  reset(@Body() dto: ResetPasswordDto) {
    return sendRpc(this.identity, { cmd: 'auth.reset-password' }, dto);
  }
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-phone')
  @HttpCode(HttpStatus.OK)
  verify(@Body() dto: VerifyPhoneDto) {
    return sendRpc(this.identity, { cmd: 'auth.verify-phone' }, dto);
  }
  @Public()
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
    this.clearRefreshCookie(request, response);
    return result;
  }
}
