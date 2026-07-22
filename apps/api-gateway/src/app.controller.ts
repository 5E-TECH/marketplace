import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtUser, Public } from '@app/common';
import { AppService } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // GET /api/v1/health — ochiq (auth talab qilinmaydi)
  @Public()
  @Get('health')
  health() {
    return this.appService.health();
  }

  // GET /api/v1/whoami — himoyalangan (tokensiz → 401), joriy user'ni qaytaradi
  @Get('whoami')
  whoami(@CurrentUser() user: JwtUser) {
    return user;
  }
}
