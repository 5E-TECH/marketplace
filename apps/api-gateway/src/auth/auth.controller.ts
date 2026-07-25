import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
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
  CurrentUser,
  JwtUser,
  LoginDto,
  LoginSuccessResponseDto,
  LogoutSuccessResponseDto,
  Public,
  RegisterDto,
  RmqClient,
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

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Joriy foydalanuvchini olish' })
  me(@CurrentUser() user: JwtUser) {
    return sendRpc(this.identity, { cmd: 'auth.me' }, { userId: user.sub });
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
