import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
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
  LogoutSuccessResponseDto,
  LogoutDto,
  Public,
  RegisterDto,
  RmqClient,
  sendRpc,
} from '@app/common';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(RmqClient.IDENTITY) private readonly identity: ClientProxy,
  ) {}

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
    description: 'Login muvaffaqiyatli, access va refresh token qaytarildi',
    type: AuthSuccessResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request body validatsiyadan o‘tmadi',
    type: AuthErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Telefon yoki parol xato',
    type: AuthErrorResponseDto,
  })
  login(@Body() dto: LoginDto) {
    return sendRpc(this.identity, { cmd: 'auth.login' }, dto);
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
    description: 'Logout bajarildi va refresh token bekor qilindi',
    type: LogoutSuccessResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Request body validatsiyadan o‘tmadi',
    type: AuthErrorResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Access yoki refresh token yaroqsiz',
    type: AuthErrorResponseDto,
  })
  logout(@CurrentUser() user: JwtUser, @Body() dto: LogoutDto) {
    return sendRpc(
      this.identity,
      { cmd: 'auth.logout' },
      {
        userId: user.sub,
        ...dto,
      },
    );
  }
}
