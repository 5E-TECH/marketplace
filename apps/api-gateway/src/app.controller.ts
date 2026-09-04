import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtUser, Public } from '@app/common';
import { AppService } from './app.service';
import { ReadinessService } from './readiness.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly readinessService: ReadinessService,
  ) {}

  // GET /api/v1/health — ochiq, tiriklik (Docker healthcheck shuni chaqiradi).
  // Bog'liqlik vaqtincha yiqilganda konteynerni qayta ishga tushirish
  // muammoni hal qilmaydi, shuning uchun bu yerda ular tekshirilmaydi.
  @Public()
  @SkipThrottle()
  @Get('health')
  @ApiOperation({ summary: 'Tiriklik tekshiruvi — jarayon ishlayaptimi' })
  health() {
    return this.appService.health();
  }

  // GET /api/v1/health/readiness — har bir mikroservisni RMQ orqali so'roqlaydi;
  // servis o'z Postgres ulanishini ham tekshiradi (ServiceHealthModule).
  // Birortasi javob bermasa 503 qaytadi.
  @Public()
  @SkipThrottle()
  @Get('health/readiness')
  @ApiOperation({
    summary: 'Tayyorlik tekshiruvi — barcha servis va ularning DB ulanishi',
  })
  readiness() {
    return this.readinessService.check();
  }

  // GET /api/v1/whoami — himoyalangan (tokensiz → 401), joriy user'ni qaytaradi
  @Get('whoami')
  whoami(@CurrentUser() user: JwtUser) {
    return user;
  }
}
