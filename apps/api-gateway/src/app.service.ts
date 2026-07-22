import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /** Tiriklik tekshiruvi — infra/deploy monitoring uchun. */
  health() {
    return {
      status: 'ok',
      service: 'api-gateway',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
