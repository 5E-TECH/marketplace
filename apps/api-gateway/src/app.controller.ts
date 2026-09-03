import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser, JwtUser, Public, rawResponse } from '@app/common';
import { AppService } from './app.service';

@ApiTags('health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  // GET /api/v1/health — ochiq, tiriklik (Docker healthcheck shuni chaqiradi)
  @Public()
  @SkipThrottle()
  @Get('health')
  @ApiOperation({ summary: 'Tiriklik tekshiruvi — jarayon ishlayaptimi' })
  health() {
    return this.appService.health();
  }

  // GET /api/v1/health/ready — bog'liqliklar bilan birga tekshiradi
  @Public()
  @SkipThrottle()
  @Get('health/ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tayyorlik tekshiruvi — Postgres va RabbitMQ javob beryaptimi',
  })
  async ready(@Res({ passthrough: true }) response: Response) {
    const result = await this.appService.readiness();
    if (result.status !== 'ok') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return rawResponse(result);
  }

  // GET /api/v1/whoami — himoyalangan (tokensiz → 401), joriy user'ni qaytaradi
  @Get('whoami')
  whoami(@CurrentUser() user: JwtUser) {
    return user;
  }
}
