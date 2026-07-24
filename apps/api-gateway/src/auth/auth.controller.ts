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
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  JwtUser,
  LoginDto,
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
  @ApiResponse({ status: 201, description: 'Foydalanuvchi va tokenlar' })
  register(@Body() dto: RegisterDto) {
    return sendRpc(this.identity, { cmd: 'auth.register' }, dto);
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Telefon va parol orqali tizimga kirish' })
  @ApiResponse({ status: 201, description: 'Foydalanuvchi va tokenlar' })
  @ApiResponse({ status: 401, description: 'Telefon yoki parol xato' })
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
  @ApiResponse({ status: 200, description: 'Logout bajarildi; data null' })
  @ApiResponse({ status: 401, description: 'Token yaroqsiz yoki mos emas' })
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
