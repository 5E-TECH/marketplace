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

  private setRefreshCookie(response: Response, refreshToken: string): void {
    const decoded = this.jwt.decode(refreshToken) as { exp?: number } | null;
    const expiresAt = decoded?.exp
      ? decoded.exp * 1000
      : Date.now() + AuthController.FALLBACK_REFRESH_TTL_MS;
    const isProduction = process.env.NODE_ENV === 'production';

    response.cookie(AuthController.REFRESH_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: AuthController.REFRESH_COOKIE_PATH,
      maxAge: Math.max(1, expiresAt - Date.now()),
    });
  }

  private clearRefreshCookie(response: Response): void {
    const isProduction = process.env.NODE_ENV === 'production';
    response.clearCookie(AuthController.REFRESH_COOKIE_NAME, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
      path: AuthController.REFRESH_COOKIE_PATH,
    });
  }

  @Public()
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
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await sendRpc<{
      user: unknown;
      accessToken: string;
      refreshToken: string;
    }>(this.identity, { cmd: 'auth.login' }, dto);

    this.setRefreshCookie(response, result.refreshToken);
    return rawResponse({
      accessToken: result.accessToken,
    });
  }

  @Public()
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
    this.setRefreshCookie(res, result.refreshToken);
    return rawResponse({ accessToken: result.accessToken });
  }
  @Public() @Post('forgot-password') @HttpCode(HttpStatus.OK) forgot(
    @Body() dto: ForgotPasswordDto,
  ) {
    return sendRpc(this.identity, { cmd: 'auth.forgot-password' }, dto);
  }
  @Public() @Post('reset-password') @HttpCode(HttpStatus.OK) reset(
    @Body() dto: ResetPasswordDto,
  ) {
    return sendRpc(this.identity, { cmd: 'auth.reset-password' }, dto);
  }
  @Public() @Post('verify-phone') @HttpCode(HttpStatus.OK) verify(
    @Body() dto: VerifyPhoneDto,
  ) {
    return sendRpc(this.identity, { cmd: 'auth.verify-phone' }, dto);
  }
  @Public() @Post('resend-code') @HttpCode(HttpStatus.OK) resend(
    @Body() dto: ForgotPasswordDto,
  ) {
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
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await sendRpc(
      this.identity,
      { cmd: 'auth.logout' },
      {
        userId: user.sub,
      },
    );
    this.clearRefreshCookie(response);
    return result;
  }
}
